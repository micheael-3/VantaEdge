// agent-alerts — 15-minute fanout pass.
//
// Pops unprocessed agent_alerts, creates user_alerts rows for the right tier
// audience, and fires emails for SHARP_MOVE (paid users with sharp_move_alerts
// = true) and BEST_BET_SELECTED (all paid users with email_notifications).

const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');
const { fanoutToUsers, tiersForAlert } = require('./_shared/alerts');
const { send, isConfigured: emailConfigured } = require('./_shared/email');
const { markRun, setState } = require('./_shared/agent');

const SCHEDULE = '*/15 * * * *';
const PER_RUN_ALERT_BUDGET = 50;

function isAuthorised(event) {
  if (!event || !event.headers) return false;
  const h = event.headers;
  const scheduled =
    h['x-nf-event'] === 'schedule' ||
    h['netlify-invocation-source'] === 'schedule' ||
    h['x-netlify-event'] === 'schedule';
  if (scheduled) return true;
  const auth = h.authorization || h.Authorization || '';
  const provided = auth.replace(/^Bearer\s+/i, '').trim();
  return !!process.env.ADMIN_PASSWORD && provided === process.env.ADMIN_PASSWORD;
}

function siteUrl() {
  return (process.env.URL || 'http://localhost:8888').replace(/\/+$/, '');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSharpMoveHtml(alert, dashboardUrl) {
  const d = alert.data || {};
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0f;color:#e8e8ec;font-family:'Inter',system-ui,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0f;">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="600" style="max-width:600px;">
      <tr><td style="padding:0 0 18px;">
        <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:20px;">
          Vanta<span style="color:#6ee7b7;">·</span>Edge
        </div>
      </td></tr>
      <tr><td>
        <div style="font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#fbbf24;">
          ⚡ Sharp money alert
        </div>
        <h1 style="font-family:'Syne',sans-serif;font-weight:700;font-size:28px;line-height:1.15;color:#e8e8ec;margin:6px 0 12px;letter-spacing:-0.02em;">
          ${esc(d.homeTeam || '')} <span style="color:#5a5a68;font-weight:400;font-size:18px;">vs</span> ${esc(d.awayTeam || '')}
        </h1>
        <p style="color:#9696a3;font-size:15px;line-height:1.6;margin:0 0 18px;">
          Professional money has moved the ${esc(d.market || '')}${d.line ? ` ${esc(d.line)}` : ''} line
          <strong style="color:#fbbf24;">${esc(d.movementPct ? d.movementPct.toFixed(1) : '?')}%</strong>
          in the last <strong>${esc(d.windowMins || '?')} minutes</strong>.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#111118;border:1px solid rgba(251,191,36,0.4);border-radius:14px;padding:18px;">
          <tr><td style="padding:6px 0;color:#9696a3;font-family:'DM Mono',monospace;font-size:13px;">Opening odds</td>
              <td align="right" style="padding:6px 0;font-family:'DM Mono',monospace;font-size:13px;color:#e8e8ec;">${esc(d.openingOdds || '—')}</td></tr>
          <tr><td style="padding:6px 0;color:#9696a3;font-family:'DM Mono',monospace;font-size:13px;">Current odds</td>
              <td align="right" style="padding:6px 0;font-family:'DM Mono',monospace;font-size:13px;color:#6ee7b7;">${esc(d.currentOdds || '—')} <span style="color:#5a5a68;">@ ${esc(d.bookmaker || '')}</span></td></tr>
        </table>
        <p style="color:#9696a3;font-size:14px;margin:18px 0;">
          This pattern indicates sharp bettor activity — odds will likely continue to move. Act quickly.
        </p>
        <a href="${esc(dashboardUrl)}" style="display:inline-block;padding:12px 22px;background:#6ee7b7;color:#052e1f;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px;">
          View Full Analysis
        </a>
      </td></tr>
      <tr><td style="padding-top:32px;border-top:1px solid #2a2a38;margin-top:32px;color:#5a5a68;font-size:11px;font-family:'DM Mono',monospace;line-height:1.6;">
        You're receiving this because sharp-move alerts are enabled in your Settings.
        Bet responsibly. 18+.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

async function processAlert(alert, report) {
  // Fan out to user inboxes.
  const inserted = await fanoutToUsers(alert);
  report.userAlertsCreated += inserted;

  // Email path — only if configured + targeted user-level toggle is on.
  if (emailConfigured() && (alert.type === 'SHARP_MOVE' || alert.type === 'BEST_BET_SELECTED')) {
    const tiers = tiersForAlert(alert);
    let recipients = [];
    if (alert.type === 'SHARP_MOVE') {
      recipients = await sql()`
        SELECT id, email FROM users
        WHERE tier = ANY(${tiers})
          AND email_notifications = TRUE
          AND sharp_move_alerts = TRUE`;
    } else {
      recipients = await sql()`
        SELECT id, email FROM users
        WHERE tier = ANY(${tiers}) AND email_notifications = TRUE`;
    }
    const dashboardUrl = `${siteUrl()}/dashboard`;
    const html =
      alert.type === 'SHARP_MOVE'
        ? buildSharpMoveHtml(alert, dashboardUrl)
        : null;
    if (html) {
      const subject =
        alert.type === 'SHARP_MOVE'
          ? `⚡ Sharp Money Alert — ${(alert.data && alert.data.homeTeam) || 'Match'} vs ${(alert.data && alert.data.awayTeam) || ''}`
          : '⭐ Best Bet of the Day';
      for (const u of recipients) {
        const r = await send({ to: u.email, subject, html });
        if (r.ok) report.emailsSent += 1;
        else if (!r.skipped) report.emailErrors += 1;
        try {
          await sql()`
            INSERT INTO email_log (user_id, type, status, detail)
            VALUES (${u.id}, ${alert.type}, ${r.ok ? 'SENT' : 'FAILED'}, ${r.id || r.reason || null})`;
        } catch {
          /* swallow */
        }
      }
    }
  }

  await sql()`UPDATE agent_alerts SET processed = TRUE WHERE id = ${alert.id}`;
}

async function runFanout() {
  const report = {
    alertsProcessed: 0,
    userAlertsCreated: 0,
    emailsSent: 0,
    emailErrors: 0,
    durationMs: 0,
  };
  const t0 = Date.now();

  const pending = await sql()`
    SELECT id, type, fixture_id, league, message, data, severity, created_at
    FROM agent_alerts
    WHERE processed = FALSE
    ORDER BY created_at ASC
    LIMIT ${PER_RUN_ALERT_BUDGET}`;

  for (const a of pending) {
    try {
      await processAlert(a, report);
      report.alertsProcessed += 1;
    } catch (e) {
      console.error(`[agent-alerts] alert ${a.id} failed:`, e.message);
    }
  }

  report.durationMs = Date.now() - t0;
  await markRun('alerts_last_run');
  await setState('alerts_last_report', { ...report, at: new Date().toISOString() });
  console.log('[agent-alerts] report:', JSON.stringify(report));
  return report;
}

exports.handler = async (event) => {
  try {
    if (event && event.headers && !isAuthorised(event) && event.httpMethod) {
      return error(401, 'UNAUTHORIZED');
    }
    const report = await runFanout();
    return event ? json(200, report) : report;
  } catch (err) {
    console.error('agent-alerts handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.config = { schedule: SCHEDULE };
