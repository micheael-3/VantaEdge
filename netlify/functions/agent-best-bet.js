// agent-best-bet — 7 AM daily best-bet picker.
//
// Picks the highest-scoring prediction from today's slate, stores it in
// the existing best_bet table (so the public /api/best-bet endpoint returns
// it instantly), emits a BEST_BET_SELECTED alert, and mails it to paid users
// with email_notifications on.

const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');
const { createAgentAlert } = require('./_shared/alerts');
const { send, isConfigured: emailConfigured } = require('./_shared/email');
const { markRun, setState } = require('./_shared/agent');

const SCHEDULE = '0 7 * * *';

const MIN_CONFIDENCE = 68;
const MIN_EV = 8;
const SHARP_MOVE_BONUS = 10;

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

function todayDateStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bestBetEmailHtml(bet, dashboardUrl) {
  const accuracyTag = bet.accuracyAdjustedConfidence != null
    ? `<span style="color:#5a5a68;font-size:11px;font-family:'DM Mono',monospace;">acc-adjusted</span>`
    : '';
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
        <div style="font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6ee7b7;">
          ⭐ Best bet of the day
        </div>
        <h1 style="font-family:'Syne',sans-serif;font-weight:700;font-size:30px;line-height:1.1;color:#e8e8ec;margin:8px 0 12px;letter-spacing:-0.02em;">
          ${esc(bet.homeTeam)} <span style="color:#5a5a68;font-weight:400;font-size:18px;">vs</span> ${esc(bet.awayTeam)}
        </h1>
        <p style="color:#9696a3;font-size:14px;margin:0 0 18px;font-family:'DM Mono',monospace;">
          ${esc(bet.league)}
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#111118;border:1px solid rgba(110,231,183,0.45);border-radius:14px;padding:18px;
                      box-shadow:0 0 0 1px rgba(110,231,183,0.18);">
          <tr>
            <td>
              <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(110,231,183,0.12);
                           border:1px solid rgba(110,231,183,0.45);color:#6ee7b7;font-family:'DM Mono',monospace;font-size:13px;">
                ${esc(bet.betType)} ${esc(bet.line || '')}
              </span>
            </td>
            <td align="right" style="font-family:'DM Mono',monospace;font-size:24px;color:#6ee7b7;font-weight:500;">
              ${esc(bet.confidence)}% ${accuracyTag}
            </td>
          </tr>
          ${bet.evEdge != null ? `
          <tr><td colspan="2" style="padding-top:14px;color:#9696a3;font-family:'DM Mono',monospace;font-size:13px;">
            Edge: <strong style="color:#6ee7b7;">+${esc(Number(bet.evEdge).toFixed(1))}%</strong>
            ${bet.bookmaker ? ` · ${esc(bet.bookmaker)}` : ''}
          </td></tr>` : ''}
        </table>
        <a href="${esc(dashboardUrl)}" style="display:inline-block;margin-top:24px;padding:12px 22px;background:#6ee7b7;color:#052e1f;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px;">
          Open dashboard
        </a>
      </td></tr>
      <tr><td style="padding-top:32px;border-top:1px solid #2a2a38;margin-top:32px;color:#5a5a68;font-size:11px;font-family:'DM Mono',monospace;line-height:1.6;">
        Manage preferences in Settings. Bet responsibly. 18+.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

async function pickAndEmail() {
  const report = { picked: false, emailsSent: 0, durationMs: 0 };
  const t0 = Date.now();
  const today = todayDateStr();

  // Score: confidence 0.5, EV edge 0.3, accuracy delta 0.2, +10 if sharp.
  // Accuracy delta = accuracy_adjusted_confidence - over_confidence (signed).
  const rows = await sql()`
    SELECT id, league, home_team, away_team, kickoff,
           over_line, over_confidence, btts, btts_confidence,
           best_over_odds, best_over_bookmaker,
           best_btts_odds, best_btts_bookmaker,
           ev_edge_over, ev_edge_btts, auto_ev_over, auto_ev_btts,
           accuracy_adjusted_confidence, is_sharp_move
    FROM predictions
    WHERE created_at >= ${startOfTodayIso()}
      AND over_confidence >= ${MIN_CONFIDENCE}
      AND (auto_ev_over >= ${MIN_EV} OR ev_edge_over >= ${MIN_EV})
    ORDER BY (over_confidence * 0.5
              + GREATEST(COALESCE(auto_ev_over, 0), COALESCE(ev_edge_over, 0)) * 0.3
              + COALESCE(accuracy_adjusted_confidence - over_confidence, 0) * 0.2
              + (CASE WHEN is_sharp_move THEN ${SHARP_MOVE_BONUS} ELSE 0 END)) DESC
    LIMIT 1`;

  if (rows.length === 0) {
    console.log('[agent-best-bet] no qualifying picks today');
    await markRun('best_bet_last_run');
    await setState('best_bet_last_report', { ...report, at: new Date().toISOString() });
    return report;
  }

  const p = rows[0];
  const edge = p.auto_ev_over ?? p.ev_edge_over ?? null;
  const score = Number(p.over_confidence) * 0.5
              + (Math.max(Number(p.auto_ev_over) || 0, Number(p.ev_edge_over) || 0)) * 0.3
              + (p.accuracy_adjusted_confidence != null ? (Number(p.accuracy_adjusted_confidence) - Number(p.over_confidence)) * 0.2 : 0)
              + (p.is_sharp_move ? SHARP_MOVE_BONUS : 0);

  await sql()`
    UPDATE predictions SET agent_score = ${score} WHERE id = ${p.id}`;

  // Replace today's best_bet row (one per day by spec).
  await sql()`DELETE FROM best_bet WHERE date = ${today}`;
  await sql()`
    INSERT INTO best_bet (date, prediction_id, league, home_team, away_team, bet_type,
                          line, confidence, ev_edge, score, kickoff)
    VALUES (${today}, ${p.id}, ${p.league}, ${p.home_team}, ${p.away_team}, 'OVER',
            ${p.over_line}, ${p.over_confidence}, ${edge}, ${score}, ${p.kickoff})`;

  const bet = {
    fixtureId: p.id,
    league: p.league,
    homeTeam: p.home_team,
    awayTeam: p.away_team,
    betType: 'OVER',
    line: p.over_line,
    confidence: p.over_confidence,
    accuracyAdjustedConfidence: p.accuracy_adjusted_confidence,
    evEdge: edge,
    bookmaker: p.best_over_bookmaker,
    isSharpMove: p.is_sharp_move,
  };

  report.picked = true;
  report.bet = { ...bet };

  await createAgentAlert({
    type: 'BEST_BET_SELECTED',
    fixtureId: null,
    league: p.league,
    message: `⭐ Best bet today: ${p.home_team} vs ${p.away_team} — OVER ${p.over_line} @ ${p.over_confidence}% confidence`,
    severity: 'HIGH',
    data: bet,
  });

  // Mail to all paid users with email_notifications on.
  if (emailConfigured()) {
    const recipients = await sql()`
      SELECT id, email FROM users
      WHERE tier IN ('ANALYST', 'EDGE') AND email_notifications = TRUE`;
    const html = bestBetEmailHtml(bet, `${(process.env.URL || '').replace(/\/+$/, '')}/dashboard`);
    for (const u of recipients) {
      const r = await send({
        to: u.email,
        subject: `⭐ Best Bet Today — ${p.home_team} vs ${p.away_team}`,
        html,
      });
      if (r.ok) report.emailsSent += 1;
      try {
        await sql()`
          INSERT INTO email_log (user_id, type, status, detail)
          VALUES (${u.id}, 'BEST_BET', ${r.ok ? 'SENT' : 'FAILED'}, ${r.id || r.reason || null})`;
      } catch { /* swallow */ }
    }
  }

  report.durationMs = Date.now() - t0;
  await markRun('best_bet_last_run');
  await setState('best_bet_last_report', { ...report, at: new Date().toISOString() });
  console.log('[agent-best-bet] report:', JSON.stringify(report));
  return report;
}

exports.handler = async (event) => {
  try {
    if (event && event.headers && !isAuthorised(event) && event.httpMethod) {
      return error(401, 'UNAUTHORIZED');
    }
    const report = await pickAndEmail();
    return event ? json(200, report) : report;
  } catch (err) {
    console.error('agent-best-bet handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.config = { schedule: SCHEDULE };
