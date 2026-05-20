const crypto = require('crypto');
const { sql } = require('./_shared/db');
const { json, error, notFound, parseRaw, subPath } = require('./_shared/response');
const { COMMISSION } = require('./_shared/affiliate');

// NOTE: product identifiers intentionally kept as `vantaedge_*` because they
// are external RevenueCat SKU keys — renaming would break active subscriptions.
const PRODUCT_TO_TIER = {
  vantaedge_analyst_monthly: 'ANALYST',
  vantaedge_edge_monthly: 'EDGE',
};

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifySignature(event) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const headers = event.headers || {};
  const headerAuth = headers.authorization || headers.Authorization || headers['x-revenuecat-signature'] || '';
  if (!headerAuth) return false;
  const provided = headerAuth.replace(/^Bearer\s+/i, '').trim();
  return timingSafeEqual(provided, secret);
}

async function creditCommissionForPurchase(user, plan) {
  if (!user.referred_by || !COMMISSION[plan]) return;
  const affRows = await sql()`SELECT id FROM affiliates WHERE code = ${user.referred_by}`;
  if (affRows.length === 0) return;
  const affiliateId = affRows[0].id;
  const commission = COMMISSION[plan];

  // Has this referral been seen before?
  const existing = await sql()`SELECT id, status, plan FROM referrals WHERE referred_user_id = ${user.id}`;

  if (existing.length === 0) {
    // New referral — credit and bump counters.
    await sql()`
      INSERT INTO referrals (affiliate_id, referred_user_id, plan, status, monthly_commission, last_paid_at)
      VALUES (${affiliateId}, ${user.id}, ${plan}, 'ACTIVE', ${commission}, NOW())`;
    await sql()`
      UPDATE affiliates
      SET total_referrals  = total_referrals + 1,
          active_referrals = active_referrals + 1,
          total_earned     = total_earned + ${commission},
          pending_payout   = pending_payout + ${commission}
      WHERE id = ${affiliateId}`;
    console.log(`[AFFILIATE_COMMISSION] new referral, affiliate=${affiliateId} user=${user.id} plan=${plan} +$${commission}`);
    return;
  }

  const ref = existing[0];
  // Resubscription after a cancel or plan change on the way in.
  const wasInactive = ref.status !== 'ACTIVE';
  await sql()`
    UPDATE referrals
    SET status = 'ACTIVE', plan = ${plan}, monthly_commission = ${commission}, last_paid_at = NOW()
    WHERE id = ${ref.id}`;
  if (wasInactive) {
    await sql()`
      UPDATE affiliates
      SET active_referrals = active_referrals + 1,
          total_earned     = total_earned + ${commission},
          pending_payout   = pending_payout + ${commission}
      WHERE id = ${affiliateId}`;
  } else {
    // Plan change while active: pay the new commission for this month.
    await sql()`
      UPDATE affiliates
      SET total_earned   = total_earned + ${commission},
          pending_payout = pending_payout + ${commission}
      WHERE id = ${affiliateId}`;
  }
  console.log(`[AFFILIATE_COMMISSION] reactivation, affiliate=${affiliateId} user=${user.id} plan=${plan} +$${commission}`);
}

async function creditCommissionForRenewal(user, plan) {
  if (!user.referred_by || !COMMISSION[plan]) return;
  const affRows = await sql()`SELECT id FROM affiliates WHERE code = ${user.referred_by}`;
  if (affRows.length === 0) return;
  const affiliateId = affRows[0].id;
  const commission = COMMISSION[plan];

  const refs = await sql()`SELECT id FROM referrals WHERE referred_user_id = ${user.id}`;
  if (refs.length === 0) {
    // RENEWAL without an INITIAL_PURCHASE on record — treat as new active.
    await creditCommissionForPurchase(user, plan);
    return;
  }
  await sql()`
    UPDATE referrals
    SET status = 'ACTIVE', plan = ${plan}, monthly_commission = ${commission}, last_paid_at = NOW()
    WHERE id = ${refs[0].id}`;
  await sql()`
    UPDATE affiliates
    SET total_earned   = total_earned + ${commission},
        pending_payout = pending_payout + ${commission}
    WHERE id = ${affiliateId}`;
  console.log(`[AFFILIATE_COMMISSION] renewal, affiliate=${affiliateId} user=${user.id} plan=${plan} +$${commission}`);
}

async function deactivateReferral(user) {
  const refs = await sql()`SELECT id, affiliate_id, status FROM referrals WHERE referred_user_id = ${user.id}`;
  if (refs.length === 0) return;
  const ref = refs[0];
  if (ref.status === 'CANCELLED') return;
  await sql()`UPDATE referrals SET status = 'CANCELLED' WHERE id = ${ref.id}`;
  await sql()`
    UPDATE affiliates
    SET active_referrals = GREATEST(active_referrals - 1, 0)
    WHERE id = ${ref.affiliate_id}`;
  console.log(`[AFFILIATE_COMMISSION] cancelled, affiliate=${ref.affiliate_id} user=${user.id}`);
}

async function revenuecat(event) {
  if (!verifySignature(event)) return error(401, 'invalid signature');

  let body;
  try {
    body = JSON.parse(parseRaw(event) || '{}');
  } catch {
    return error(400, 'invalid JSON');
  }

  const ev = body && body.event;
  if (!ev || !ev.type) return error(400, 'missing event');

  const productId = ev.product_id || (Array.isArray(ev.entitlement_ids) && ev.entitlement_ids[0]);
  const appUserId = ev.app_user_id;
  const aliases = Array.isArray(ev.aliases) ? ev.aliases : [];
  const lookupIds = [appUserId, ...aliases].filter(Boolean);

  let user = null;
  if (lookupIds.length) {
    const matches = await sql()`SELECT id, email, tier, referred_by FROM users WHERE revenuecat_id = ANY(${lookupIds})`;
    user = matches[0] || null;
  }
  if (!user && appUserId && appUserId.includes('@')) {
    const matches = await sql()`SELECT id, email, tier, referred_by FROM users WHERE email = ${appUserId.toLowerCase()}`;
    user = matches[0] || null;
  }
  if (!user) return json(200, { received: true, matched: false });

  const type = ev.type;
  let newTier = user.tier;
  if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL' || type === 'PRODUCT_CHANGE' || type === 'UNCANCELLATION') {
    newTier = PRODUCT_TO_TIER[productId] || newTier;
  } else if (type === 'CANCELLATION' || type === 'EXPIRATION') {
    newTier = 'FREE';
  }

  await sql()`
    UPDATE users
    SET tier = ${newTier},
        revenuecat_id = COALESCE(${appUserId}, revenuecat_id)
    WHERE id = ${user.id}`;

  // Affiliate commission tracking (only if the user was referred and the plan is paid).
  const planForCommission = PRODUCT_TO_TIER[productId];
  try {
    if (type === 'INITIAL_PURCHASE' || type === 'UNCANCELLATION' || type === 'PRODUCT_CHANGE') {
      if (planForCommission) await creditCommissionForPurchase(user, planForCommission);
    } else if (type === 'RENEWAL') {
      if (planForCommission) await creditCommissionForRenewal(user, planForCommission);
    } else if (type === 'CANCELLATION' || type === 'EXPIRATION') {
      await deactivateReferral(user);
    }
  } catch (err) {
    console.error('Affiliate commission update failed (webhook still acks):', err.message);
  }

  return json(200, { received: true });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'POST') return error(405, 'Method not allowed');
    const path = subPath(event, 'webhook');
    if (path === '/revenuecat') return await revenuecat(event);
    return notFound();
  } catch (err) {
    console.error('webhook handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
