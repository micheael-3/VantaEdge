// User-facing alerts API.
//
//   GET  /api/alerts          → last 50 user_alerts joined with agent_alerts
//                                + unread count + last20 public feed
//   POST /api/alerts/read     → mark all of the user's alerts read
//   GET  /api/alerts/feed     → 20-item public-ish feed used by Live Activity
//                                (logged-in users only)

const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { recentAlertsForFeed } = require('./_shared/alerts');

async function listForUser(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const rows = await sql()`
    SELECT ua.id AS user_alert_id, ua.read, ua.created_at AS delivered_at,
           a.id AS alert_id, a.type, a.fixture_id, a.league, a.message, a.data,
           a.severity, a.created_at
    FROM user_alerts ua
    JOIN agent_alerts a ON a.id = ua.alert_id
    WHERE ua.user_id = ${user.id}
    ORDER BY a.created_at DESC
    LIMIT 50`;
  const [{ n: unread }] = await sql()`
    SELECT COUNT(*)::int AS n FROM user_alerts
    WHERE user_id = ${user.id} AND read = FALSE`;
  return json(200, {
    unread: Number(unread) || 0,
    alerts: rows.map((r) => ({
      userAlertId: r.user_alert_id,
      alertId: r.alert_id,
      read: r.read,
      type: r.type,
      fixtureId: r.fixture_id,
      league: r.league,
      message: r.message,
      data: r.data,
      severity: r.severity,
      createdAt: r.created_at,
    })),
  });
}

async function markAllRead(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  await sql()`
    UPDATE user_alerts SET read = TRUE
    WHERE user_id = ${user.id} AND read = FALSE`;
  return json(200, { ok: true });
}

async function feed(event) {
  // Logged-in users only — the feed reveals match info that's restricted to
  // paid tiers via the upstream alert content. We still require auth so we
  // don't leak data to anonymous traffic.
  const { res } = await requireUser(event);
  if (res) return res;
  const alerts = await recentAlertsForFeed(20);
  return json(200, { alerts });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'alerts');
    const method = event.httpMethod;
    if (method === 'GET' && (path === '/' || path === '')) return await listForUser(event);
    if (method === 'GET' && path === '/feed') return await feed(event);
    if (method === 'POST' && path === '/read') return await markAllRead(event);
    return notFound();
  } catch (err) {
    console.error('alerts handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
