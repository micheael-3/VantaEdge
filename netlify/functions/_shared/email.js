// FastScore — email delivery via Resend (resend.com).
//
// Returns { skipped: true } cleanly when RESEND_API_KEY is missing so the
// rest of the app keeps working. Uses the REST API directly (no extra dep).

const axios = require('axios');

const RESEND_URL = 'https://api.resend.com/emails';
const FROM_DEFAULT = 'FastScore <onboarding@resend.dev>';

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

async function send({ to, subject, html, from }) {
  if (!isConfigured()) {
    return { skipped: true, reason: 'RESEND_API_KEY not set' };
  }
  if (!to || !subject || !html) {
    return { ok: false, reason: 'Missing to/subject/html' };
  }
  try {
    const res = await axios.post(
      RESEND_URL,
      {
        from: from || process.env.RESEND_FROM || FROM_DEFAULT,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 12000,
        validateStatus: () => true,
      },
    );
    if (res.status >= 400) {
      return { ok: false, status: res.status, reason: JSON.stringify(res.data).slice(0, 300) };
    }
    return { ok: true, id: res.data && res.data.id };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ---------- HTML template ----------

const COLORS = {
  bg:     '#0a0a0f',
  card:   '#111118',
  raised: '#16161f',
  border: '#2a2a38',
  text:   '#e8e8ec',
  dim:    '#9696a3',
  faint:  '#5a5a68',
  mint:   '#6ee7b7',
  red:    '#f87171',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtKickoff(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
  } catch {
    return String(iso);
  }
}

function valueBadge(confidence) {
  if (confidence >= 75) return { label: 'STRONG VALUE', color: COLORS.mint };
  if (confidence >= 65) return { label: 'VALUE', color: COLORS.mint };
  return { label: 'MARGINAL', color: COLORS.faint };
}

function renderPickCard(pick) {
  const badge = valueBadge(pick.confidence || 0);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 16px; background: ${COLORS.card}; border: 1px solid ${COLORS.border}; border-radius: 14px;">
      <tr>
        <td style="padding: 20px 22px;">
          <div style="font-family: 'DM Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: ${COLORS.dim};">
            ${esc(pick.league)} &middot; ${esc(fmtKickoff(pick.kickoff))}
          </div>
          <div style="font-family: 'Syne', system-ui, sans-serif; font-weight: 700; font-size: 20px; letter-spacing: -0.015em; color: ${COLORS.text}; margin-top: 8px;">
            ${esc(pick.homeTeam)} <span style="color: ${COLORS.faint}; font-weight: 400; font-size: 13px;">vs</span> ${esc(pick.awayTeam)}
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 14px;">
            <tr>
              <td>
                <span style="display: inline-block; padding: 5px 11px; border-radius: 999px; background: rgba(110, 231, 183, 0.12); border: 1px solid rgba(110, 231, 183, 0.4); color: ${COLORS.mint}; font-family: 'DM Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: 0.04em;">
                  ${esc(pick.bet)}
                </span>
                <span style="display: inline-block; margin-left: 8px; padding: 4px 9px; border-radius: 4px; background: rgba(110, 231, 183, 0.08); border: 1px solid rgba(110, 231, 183, 0.3); color: ${badge.color}; font-family: 'DM Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;">
                  ${esc(badge.label)}
                </span>
              </td>
              <td align="right" style="font-family: 'DM Mono', ui-monospace, monospace; font-size: 18px; font-weight: 500; color: ${COLORS.mint};">
                ${esc(pick.confidence)}%
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function renderDigestHtml({ date, picks, unsubscribeUrl, dashboardUrl }) {
  const cards = picks.map(renderPickCard).join('');
  const niceDate = (() => {
    try {
      return new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return date; }
  })();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your Daily Edge — ${esc(niceDate)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${COLORS.bg}; color: ${COLORS.text}; font-family: 'Inter', system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${COLORS.bg};">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px;">
          <tr>
            <td style="padding: 0 0 24px;">
              <div style="font-family: 'Syne', system-ui, sans-serif; font-weight: 700; font-size: 22px; letter-spacing: -0.015em; color: ${COLORS.text};">
                FastScore
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 0 8px;">
              <div style="font-family: 'DM Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: ${COLORS.mint};">
                Daily digest &middot; ${esc(niceDate)}
              </div>
              <h1 style="font-family: 'Syne', system-ui, sans-serif; font-weight: 700; font-size: 32px; letter-spacing: -0.025em; line-height: 1.1; color: ${COLORS.text}; margin: 8px 0 4px;">
                Your Daily Edge
              </h1>
              <p style="color: ${COLORS.dim}; font-size: 15px; line-height: 1.55; margin: 8px 0 24px;">
                Today's top value bets identified by FastScore across your accessible leagues. Confidence-scored, sorted by EV edge.
              </p>
            </td>
          </tr>
          <tr>
            <td>
              ${cards.length ? cards : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${COLORS.card}; border: 1px dashed ${COLORS.border}; border-radius: 14px;"><tr><td style="padding: 32px 22px; text-align: center; color: ${COLORS.dim}; font-size: 14px;">No qualifying picks for your leagues today. Check the dashboard later for late additions.</td></tr></table>`}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 24px 0 8px;">
              <a href="${esc(dashboardUrl)}" style="display: inline-block; padding: 12px 22px; background: ${COLORS.mint}; color: #052e1f; border-radius: 8px; font-family: 'Inter', sans-serif; font-weight: 600; font-size: 14px; text-decoration: none;">
                Open dashboard
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 0 0; border-top: 1px solid ${COLORS.border}; margin-top: 32px;">
              <p style="color: ${COLORS.faint}; font-size: 12px; line-height: 1.6; font-family: 'DM Mono', ui-monospace, monospace; padding-top: 24px; margin: 0;">
                You're receiving this because you're a FastScore subscriber. Manage preferences in
                <a href="${esc(dashboardUrl)}/settings" style="color: ${COLORS.mint};">Settings</a>
                or
                <a href="${esc(unsubscribeUrl)}" style="color: ${COLORS.mint};">unsubscribe with one click</a>.
                Bet responsibly. 18+.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { send, renderDigestHtml, isConfigured };
