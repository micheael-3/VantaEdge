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
// ---- Build weekly summary stats (last 7 days, global) ----
async function getWeeklyStats() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  try {
    // Exclude predictions we never surfaced (both confidences <60).
    const [row] = await sql()`
      SELECT
        SUM(CASE WHEN over_hit IS NOT NULL THEN 1 ELSE 0 END)::int  AS over_settled,
        SUM(CASE WHEN over_hit = TRUE     THEN 1 ELSE 0 END)::int  AS over_hits,
        SUM(CASE WHEN btts_hit IS NOT NULL THEN 1 ELSE 0 END)::int AS btts_settled,
        SUM(CASE WHEN btts_hit = TRUE     THEN 1 ELSE 0 END)::int AS btts_hits
      FROM predictions
      WHERE created_at >= ${sevenDaysAgo.toISOString()}
        AND (over_confidence >= 60 OR btts_confidence >= 60)`;
    const settled = (row.over_settled || 0) + (row.btts_settled || 0);
    const hits = (row.over_hits || 0) + (row.btts_hits || 0);
    const pct = settled > 0 ? Math.round((hits / settled) * 100) : 0;
    return { settled, hits, pct };
  } catch {
    return { settled: 0, hits: 0, pct: 0 };
  }
}

function renderWeeklyDigestHtml({ stats, dashboardUrl, unsubscribeUrl }) {
  // Reuses the daily digest's dark palette via inline styles. Single
  // table, no per-pick cards — keeps Monday short and skimmable.
  const headline = stats.settled > 0
    ? `${stats.hits} from ${stats.settled} correct (${stats.pct}%)`
    : 'No settled matches yet this week';
  return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Last week's AI picks</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;color:#e8e8ec;font-family:'Inter',system-ui,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0a0a0f;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;">
        <tr><td style="padding:0 0 24px;">
          <div style="font-family:'Syne',system-ui,sans-serif;font-weight:700;font-size:22px;letter-spacing:-0.015em;color:#e8e8ec;">FastScore</div>
        </td></tr>
        <tr><td style="padding:0 0 8px;">
          <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6ee7b7;">Weekly recap</div>
          <h1 style="font-family:'Syne',system-ui,sans-serif;font-weight:700;font-size:30px;letter-spacing:-0.025em;line-height:1.1;color:#e8e8ec;margin:8px 0 4px;">Last week's AI picks</h1>
          <p style="color:#9696a3;font-size:15px;line-height:1.55;margin:8px 0 24px;">${headline}. The first MLS matches of the new week kick off Saturday — open the dashboard for the latest analysis.</p>
        </td></tr>
        <tr><td style="background:#111118;border:1px solid #2a2a38;border-radius:14px;padding:24px;">
          <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:#9696a3;letter-spacing:0.04em;">Settled markets: <span style="color:#e8e8ec;">${stats.settled}</span></div>
          <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:#9696a3;letter-spacing:0.04em;margin-top:6px;">Hits: <span style="color:#6ee7b7;">${stats.hits}</span></div>
          <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:#9696a3;letter-spacing:0.04em;margin-top:6px;">Accuracy: <span style="color:#6ee7b7;">${stats.pct}%</span></div>
        </td></tr>
        <tr><td align="center" style="padding:24px 0 8px;">
          <a href="${dashboardUrl}" style="display:inline-block;padding:12px 22px;background:#6ee7b7;color:#052e1f;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;">Open dashboard</a>
        </td></tr>
        <tr><td style="padding:36px 0 0;border-top:1px solid #2a2a38;">
          <p style="color:#5a5a68;font-size:12px;line-height:1.6;font-family:'DM Mono',ui-monospace,monospace;padding-top:24px;margin:0;">
            <a href="${unsubscribeUrl}" style="color:#6ee7b7;">Unsubscribe</a> · Bet responsibly. 18+.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendWeeklyDigest({ dryRun = false } = {}) {
  if (!isConfigured()) {
    return { skipped: true, reason: 'RESEND_API_KEY not set' };
  }
  const users = await sql()`
    SELECT id, email, tier
    FROM users
    WHERE email_notifications = TRUE`;
  const stats = await getWeeklyStats();
  const subject = stats.settled > 0
    ? `Last week's AI picks · ${stats.hits}/${stats.settled} correct`
    : `Last week's AI picks`;
  const dashUrl = `${siteUrl()}/dashboard`;
  const report = { total: users.length, sent: 0, failed: 0, skipped: 0, stats };
  for (const u of users) {
    const token = await ensureUnsubscribeToken(u.id);
    const unsubscribeUrl = `${siteUrl()}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
    const html = renderWeeklyDigestHtml({ stats, dashboardUrl: dashUrl, unsubscribeUrl });
    if (dryRun) continue;
    const result = await send({ to: u.email, subject, html });
    if (result.ok) {
      report.sent += 1;
      await sql()`
        INSERT INTO email_log (user_id, type, status, detail)
        VALUES (${u.id}, 'WEEKLY_DIGEST', 'SENT', ${result.id || null})`;
    } else if (result.skipped) {
      report.skipped += 1;
    } else {
      report.failed += 1;
      await sql()`
        INSERT INTO email_log (user_id, type, status, detail)
        VALUES (${u.id}, 'WEEKLY_DIGEST', 'FAILED', ${result.reason || 'unknown'})`;
    }
  }
  return report;
}

async function sendDailyDigest({ dryRun = false } = {}) {
  if (!isConfigured()) {
    return { skipped: true, reason: 'RESEND_API_KEY not set' };
  }

  const users = await sql()`
    SELECT id, email, tier
    FROM users
    WHERE email_notifications = TRUE
      AND tier IN ('ANALYST', 'EDGE')`;

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
  // Monday branch: on scheduled invocations we ALSO send a weekly recap
  // digest in addition to the daily one. Both go out at 07:00 UTC. We
  // didn't add a separate cron entry to avoid juggling more schedules —
  // the daily run already fires every day.
  const isMonday = new Date().getUTCDay() === 1;
  const wantWeekly = qs.weekly === '1' || (isScheduled && isMonday);
  if (wantWeekly) {
    const weeklyReport = await sendWeeklyDigest({ dryRun });
    const dailyReport = await sendDailyDigest({ dryRun });
    return json(200, { weekly: weeklyReport, daily: dailyReport });
  }
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
      body: `<!doctype html><meta charset="utf-8"><title>FastScore — Unsubscribe</title>
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
    body: `<!doctype html><meta charset="utf-8"><title>FastScore — Unsubscribed</title>
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
    if (method === 'POST' && path === '/send-weekly') {
      // Manual weekly trigger — admin-gated.
      const adminHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
      const provided = adminHeader.replace(/^Bearer\s+/i, '').trim();
      if (!process.env.ADMIN_PASSWORD || provided !== process.env.ADMIN_PASSWORD) {
        return error(401, 'UNAUTHORIZED');
      }
      const qs = event.queryStringParameters || {};
      const dryRun = qs.dry === '1' || qs.dry === 'true';
      return json(200, await sendWeeklyDigest({ dryRun }));
    }
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
