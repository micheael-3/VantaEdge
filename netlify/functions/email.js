const crypto = require('crypto');
const { sql } = require('./_shared/db');
const { json, error, notFound, parseBody, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { send, renderDigestHtml, isConfigured } = require('./_shared/email');
const { TIER_LEAGUES, LEAGUES } = require('./_shared/tier');

const SCHEDULE = '0 7 * * *';

function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayDateString() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function siteUrl() {
  return (process.env.URL || 'http://localhost:8888').replace(/\/+$/, '');
}

async function ensureUnsubscribeToken(userId) {
  const [row] = await sql()`SELECT unsubscribe_token FROM users WHERE id = ${userId}`;
  if (row && row.unsubscribe_token) return row.unsubscribe_token;
  const token = crypto.randomBytes(24).toString('hex');
  await sql()`UPDATE users SET unsubscribe_token = ${token} WHERE id = ${userId}`;
  return token;
}

// ---- Build picks: top global picks from today's predictions table ----
async function getTopPicksForLeagues(allowedLeagueNames, limit = 3) {
  // High-confidence picks across EITHER market. Previously this only filtered
  // on over_confidence, so BTTS-only strong picks were silently dropped.
  const rows = await sql()`
    SELECT id, league, home_team, away_team, kickoff,
           over_line, over_confidence, btts, btts_confidence,
           ev_edge_over, ev_edge_btts, auto_ev_over, auto_ev_btts
    FROM predictions
    WHERE created_at >= ${startOfTodayIso()}
      AND league = ANY(${allowedLeagueNames})
      AND (over_confidence >= 65 OR btts_confidence >= 65)
    ORDER BY GREATEST(COALESCE(auto_ev_over, ev_edge_over, 0),
                      COALESCE(auto_ev_btts, ev_edge_btts, 0)) DESC NULLS LAST,
             GREATEST(over_confidence, btts_confidence) DESC
    LIMIT ${limit}`;

  return rows.map((r) => {
    const overEdge = r.auto_ev_over ?? r.ev_edge_over ?? null;
    const bttsEdge = r.auto_ev_btts ?? r.ev_edge_btts ?? null;
    // Score = 50% edge (when known) + 50% confidence. Falls back to pure
    // confidence comparison when neither side has an edge yet.
    const overScore = (overEdge != null ? overEdge * 0.5 : 0) + r.over_confidence * 0.5;
    const bttsScore = (bttsEdge != null ? bttsEdge * 0.5 : 0) + r.btts_confidence * 0.5;
    const useOver = overScore >= bttsScore;
    return {
      id: r.id,
      league: r.league,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      kickoff: r.kickoff,
      bet: useOver ? `OVER ${r.over_line}` : `BTTS ${r.btts}`,
      confidence: Math.round(useOver ? r.over_confidence : r.btts_confidence),
    };
  });
}

// ---- Send the digest to all opted-in paid users ----
async function sendDailyDigest({ dryRun = false } = {}) {
  if (!isConfigured()) {
    return { skipped: true, reason: 'RESEND_API_KEY not set' };
  }

  const users = await sql()`
    SELECT id, email, tier
    FROM users
    WHERE email_notifications = TRUE
      AND tier IN ('SCOUT', 'ANALYST', 'EDGE')`;

  const report = { total: users.length, sent: 0, failed: 0, skipped: 0, results: [] };
  const date = todayDateString();
  const dashUrl = `${siteUrl()}/dashboard`;

  for (const u of users) {
    const leagueIds = TIER_LEAGUES[u.tier] || [];
    const leagueNames = leagueIds.map((id) => LEAGUES[id] && LEAGUES[id].name).filter(Boolean);
    if (leagueNames.length === 0) {
      report.skipped += 1;
      continue;
    }

    const picks = await getTopPicksForLeagues(leagueNames, 3);
    if (picks.length === 0) {
      // Still send — the template renders an empty-state card. Skip if you'd
      // rather not bother users on empty days; for now we send anyway.
    }

    const token = await ensureUnsubscribeToken(u.id);
    const unsubscribeUrl = `${siteUrl()}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
    const html = renderDigestHtml({ date, picks, unsubscribeUrl, dashboardUrl: dashUrl });

    if (dryRun) {
      report.results.push({ userId: u.id, picks: picks.length, dryRun: true });
      continue;
    }

    const result = await send({
      to: u.email,
      subject: `Your Daily Edge — ${picks.length} value ${picks.length === 1 ? 'pick' : 'picks'}`,
      html,
    });

    if (result.ok) {
      report.sent += 1;
      await sql()`
        INSERT INTO email_log (user_id, type, status, detail)
        VALUES (${u.id}, 'DAILY_DIGEST', 'SENT', ${result.id || null})`;
      report.results.push({ userId: u.id, status: 'SENT', id: result.id });
    } else if (result.skipped) {
      report.skipped += 1;
    } else {
      report.failed += 1;
      await sql()`
        INSERT INTO email_log (user_id, type, status, detail)
        VALUES (${u.id}, 'DAILY_DIGEST', 'FAILED', ${result.reason || 'unknown'})`;
      report.results.push({ userId: u.id, status: 'FAILED', reason: result.reason });
    }
  }

  return report;
}

// ---- HTTP routes ----

async function handleSendDaily(event) {
  // Manual trigger requires admin password; the scheduled invocation includes
  // its own Netlify header so we accept that too.
  const isScheduled = !!(event.headers && (event.headers['x-nf-event'] === 'schedule' || event.headers['netlify-invocation-source'] === 'schedule'));
  if (!isScheduled) {
    const adminHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const provided = adminHeader.replace(/^Bearer\s+/i, '').trim();
    if (!process.env.ADMIN_PASSWORD || provided !== process.env.ADMIN_PASSWORD) {
      return error(401, 'UNAUTHORIZED');
    }
  }

  const qs = event.queryStringParameters || {};
  const dryRun = qs.dry === '1' || qs.dry === 'true';
  const report = await sendDailyDigest({ dryRun });
  return json(200, report);
}

async function handleUnsubscribe(event) {
  // Plain GET click from email — no auth, just the token.
  const qs = event.queryStringParameters || {};
  const token = qs.token;
  if (!token) return error(400, 'Missing token');
  const [row] = await sql()`
    UPDATE users SET email_notifications = FALSE
    WHERE unsubscribe_token = ${token}
    RETURNING id, email`;
  if (!row) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `<!doctype html><meta charset="utf-8"><title>VantaEdge — Unsubscribe</title>
<body style="background:#0a0a0f;color:#e8e8ec;font-family:system-ui,sans-serif;padding:60px 24px;text-align:center">
<h1 style="font-weight:700">Link expired or invalid</h1>
<p style="color:#9696a3">If you wanted to unsubscribe, sign in and toggle email notifications off in Settings.</p>
<a href="/settings" style="display:inline-block;margin-top:24px;padding:10px 18px;background:#6ee7b7;color:#052e1f;border-radius:8px;text-decoration:none;font-weight:600">Open Settings</a>
</body>`,
    };
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><meta charset="utf-8"><title>VantaEdge — Unsubscribed</title>
<body style="background:#0a0a0f;color:#e8e8ec;font-family:system-ui,sans-serif;padding:60px 24px;text-align:center">
<h1 style="font-weight:700;letter-spacing:-0.02em">You're unsubscribed</h1>
<p style="color:#9696a3">No more daily digests for ${row.email}. Re-enable any time from Settings.</p>
<a href="/dashboard" style="display:inline-block;margin-top:24px;padding:10px 18px;background:#6ee7b7;color:#052e1f;border-radius:8px;text-decoration:none;font-weight:600">Back to dashboard</a>
</body>`,
  };
}

async function handleToggle(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const body = parseBody(event);
  const enabled = !!body.enabled;
  await sql()`UPDATE users SET email_notifications = ${enabled} WHERE id = ${user.id}`;
  return json(200, { enabled });
}

async function handlePreview(event) {
  // Admin-only: see the email HTML rendered against the live picks.
  const adminHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const provided = adminHeader.replace(/^Bearer\s+/i, '').trim();
  if (!process.env.ADMIN_PASSWORD || provided !== process.env.ADMIN_PASSWORD) {
    return error(401, 'UNAUTHORIZED');
  }
  // Render against all 8 league names (most generous preview).
  const allNames = Object.values(LEAGUES).map((l) => l.name);
  const picks = await getTopPicksForLeagues(allNames, 3);
  const html = renderDigestHtml({
    date: todayDateString(),
    picks,
    unsubscribeUrl: `${siteUrl()}/api/email/unsubscribe?token=preview`,
    dashboardUrl: `${siteUrl()}/dashboard`,
  });
  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'email');
    const method = event.httpMethod;
    if (method === 'POST' && path === '/send-daily') return await handleSendDaily(event);
    if (method === 'GET' && path === '/unsubscribe') return await handleUnsubscribe(event);
    if (method === 'POST' && path === '/toggle') return await handleToggle(event);
    if (method === 'GET' && path === '/preview') return await handlePreview(event);
    return notFound();
  } catch (err) {
    console.error('email handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

// Netlify scheduled function metadata — this turns the function into a cron.
// "0 7 * * *" = 07:00 UTC daily.
exports.config = { schedule: SCHEDULE };
