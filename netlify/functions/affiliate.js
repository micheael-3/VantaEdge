const { sql } = require('./_shared/db');
const { json, error, notFound, parseBody, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { COMMISSION, PAYOUT_THRESHOLD, randomCode } = require('./_shared/affiliate');

function buildReferralLink(event, code) {
  const origin =
    process.env.URL ||
    (event.headers && (event.headers.origin || event.headers.referer || `https://${event.headers.host}`)) ||
    '';
  const base = origin.replace(/\/+$/, '');
  return `${base}/ref/${code}`;
}

async function getOrCreateUniqueCode() {
  // Retry a handful of times to defeat the (astronomically unlikely) collision.
  for (let i = 0; i < 8; i++) {
    const code = randomCode();
    const existing = await sql()`SELECT 1 FROM affiliates WHERE code = ${code}`;
    if (existing.length === 0) return code;
  }
  throw new Error('Failed to allocate unique affiliate code');
}

async function join(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const existing = await sql()`SELECT id, code FROM affiliates WHERE user_id = ${user.id}`;
  if (existing.length) {
    return json(200, {
      alreadyJoined: true,
      code: existing[0].code,
      referralLink: buildReferralLink(event, existing[0].code),
    });
  }

  const code = await getOrCreateUniqueCode();
  const inserted = await sql()`
    INSERT INTO affiliates (user_id, code)
    VALUES (${user.id}, ${code})
    RETURNING id, code`;
  return json(201, {
    code: inserted[0].code,
    referralLink: buildReferralLink(event, inserted[0].code),
  });
}

function startOfMonthIso(offsetMonths = 0) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return d.toISOString();
}

async function dashboard(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const aff = await sql()`SELECT id, code, total_referrals, active_referrals, pending_payout, lifetime_payout, total_earned
                          FROM affiliates WHERE user_id = ${user.id}`;
  if (aff.length === 0) {
    return json(200, { hasAffiliate: false });
  }
  const a = aff[0];

  const recent = await sql()`
    SELECT r.id, r.plan, r.status, r.monthly_commission, r.created_at, r.last_paid_at
    FROM referrals r
    WHERE r.affiliate_id = ${a.id}
    ORDER BY r.created_at DESC
    LIMIT 20`;

  // Monthly earnings: bucket by month from referral.last_paid_at + creation credit.
  // Simpler model: credit each ACTIVE referral × commission for every month they've been active.
  // We approximate from the payouts + current pending breakdown using last_paid_at and created_at.
  // For visualisation we sum monthly_commission of referrals that were active in each of the past 6 months.
  const since = startOfMonthIso(-5);
  const monthly = await sql()`
    SELECT to_char(date_trunc('month', months.m), 'YYYY-MM') AS month,
           COALESCE(SUM(r.monthly_commission), 0)::float8 AS amount
    FROM generate_series(${since}::timestamptz, date_trunc('month', now()), interval '1 month') AS months(m)
    LEFT JOIN referrals r
           ON r.affiliate_id = ${a.id}
          AND r.created_at <= (date_trunc('month', months.m) + interval '1 month' - interval '1 second')
          AND (r.status = 'ACTIVE' OR (r.status = 'CANCELLED' AND r.last_paid_at >= date_trunc('month', months.m)))
    GROUP BY months.m
    ORDER BY months.m ASC`;

  const payouts = await sql()`
    SELECT id, amount, status, payout_method, payout_dest, requested_at, paid_at
    FROM payouts
    WHERE affiliate_id = ${a.id}
    ORDER BY requested_at DESC
    LIMIT 20`;

  return json(200, {
    hasAffiliate: true,
    code: a.code,
    referralLink: buildReferralLink(event, a.code),
    totalReferrals: a.total_referrals,
    activeReferrals: a.active_referrals,
    pendingPayout: Number(a.pending_payout),
    lifetimePayout: Number(a.lifetime_payout),
    totalEarned: Number(a.total_earned),
    payoutThreshold: PAYOUT_THRESHOLD,
    commissionRates: COMMISSION,
    recent: recent.map((r) => ({
      id: r.id,
      plan: r.plan,
      status: r.status,
      monthlyCommission: Number(r.monthly_commission),
      createdAt: r.created_at,
      lastPaidAt: r.last_paid_at,
    })),
    monthlyEarnings: monthly.map((m) => ({ month: m.month, amount: Number(m.amount) })),
    payouts: payouts.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      status: p.status,
      method: p.payout_method,
      destination: p.payout_dest,
      requestedAt: p.requested_at,
      paidAt: p.paid_at,
    })),
  });
}

async function requestPayout(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const body = parseBody(event);
  const method = (body.method || 'paypal').toString().toLowerCase();
  const destination = (body.destination || body.paypalEmail || body.cryptoAddress || '').toString().trim();
  if (!destination) return error(400, 'Payout destination required (PayPal email or crypto address)');

  const aff = await sql()`SELECT id, pending_payout FROM affiliates WHERE user_id = ${user.id}`;
  if (aff.length === 0) return error(404, 'No affiliate account');

  const pending = Number(aff[0].pending_payout);
  if (pending < PAYOUT_THRESHOLD) {
    return error(400, `Minimum payout threshold is $${PAYOUT_THRESHOLD.toFixed(2)} (current: $${pending.toFixed(2)})`);
  }

  const amount = pending;
  const inserted = await sql()`
    INSERT INTO payouts (affiliate_id, amount, status, payout_method, payout_dest)
    VALUES (${aff[0].id}, ${amount}, 'PENDING', ${method}, ${destination})
    RETURNING id`;
  // Hold the amount: move pending_payout aside so it can't be requested twice.
  await sql()`UPDATE affiliates SET pending_payout = 0 WHERE id = ${aff[0].id}`;

  console.log(`[AFFILIATE_PAYOUT_REQUEST] payout=${inserted[0].id} affiliate=${aff[0].id} amount=$${amount.toFixed(2)} method=${method} dest=${destination}`);
  return json(201, { requested: true, amount, payoutId: inserted[0].id });
}

async function leaderboard(_event) {
  const rows = await sql()`
    SELECT code, active_referrals, lifetime_payout
    FROM affiliates
    ORDER BY active_referrals DESC, lifetime_payout DESC, created_at ASC
    LIMIT 10`;
  return json(200, {
    leaders: rows.map((r) => ({
      code: r.code,
      activeReferrals: r.active_referrals,
      lifetimePayout: Number(r.lifetime_payout),
    })),
  });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'affiliate');
    const method = event.httpMethod;

    if (method === 'POST' && path === '/join') return await join(event);
    if (method === 'GET' && path === '/dashboard') return await dashboard(event);
    if (method === 'POST' && path === '/payout') return await requestPayout(event);
    if (method === 'GET' && path === '/leaderboard') return await leaderboard(event);

    return notFound();
  } catch (err) {
    console.error('affiliate handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
