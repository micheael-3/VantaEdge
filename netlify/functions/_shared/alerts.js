// Agent alert creation + fanout to users.
//
// createAgentAlert      — inserts a row into agent_alerts (processed=false)
// fanoutToUsers         — turns an unprocessed alert into user_alerts rows
// recentAlertsForFeed   — read helper for the dashboard live-activity feed

const { sql } = require('./db');

const TYPES = new Set([
  'SHARP_MOVE',
  'VALUE_APPEARED',
  'VALUE_DISAPPEARED',
  'LINE_CHANGE',
  'RESULT_SETTLED',
  'ACCURACY_UPDATE',
  'BEST_BET_SELECTED',
]);

const SEVERITIES = new Set(['INFO', 'MEDIUM', 'HIGH']);

async function createAgentAlert({ type, fixtureId = null, league = null, message, data = null, severity = 'INFO' }) {
  if (!TYPES.has(type)) throw new Error(`Unknown alert type: ${type}`);
  if (!SEVERITIES.has(severity)) severity = 'INFO';
  if (!message) throw new Error('alert message required');
  const rows = await sql()`
    INSERT INTO agent_alerts (type, fixture_id, league, message, data, severity, processed)
    VALUES (${type}, ${fixtureId}, ${league}, ${message}, ${data ? JSON.stringify(data) : null}::jsonb, ${severity}, FALSE)
    RETURNING id, created_at`;
  return rows[0];
}

// Decide which users a given alert should land on.
//
// Tier policy:
//   HIGH severity / SHARP_MOVE / BEST_BET_SELECTED → all paid users
//   VALUE_APPEARED, MEDIUM → ANALYST + EDGE
//   INFO + RESULT_SETTLED → ANALYST + EDGE
//   ACCURACY_UPDATE → EDGE only (analytics-heavy)
function tiersForAlert(alert) {
  if (alert.severity === 'HIGH' || alert.type === 'SHARP_MOVE' || alert.type === 'BEST_BET_SELECTED') {
    return ['SCOUT', 'ANALYST', 'EDGE'];
  }
  if (alert.type === 'ACCURACY_UPDATE') return ['EDGE'];
  return ['ANALYST', 'EDGE'];
}

async function fanoutToUsers(alert) {
  const tiers = tiersForAlert(alert);
  // INSERT ... SELECT keeps the whole fanout in a single round-trip per alert.
  const inserted = await sql()`
    INSERT INTO user_alerts (user_id, alert_id)
    SELECT u.id, ${alert.id}
    FROM users u
    WHERE u.tier = ANY(${tiers})
    ON CONFLICT (user_id, alert_id) DO NOTHING
    RETURNING id`;
  return inserted.length;
}

// Dashboard "Live Activity" — public-ish feed for logged-in users.
async function recentAlertsForFeed(limit = 20) {
  const rows = await sql()`
    SELECT id, type, fixture_id, league, message, data, severity, created_at
    FROM agent_alerts
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    fixtureId: r.fixture_id,
    league: r.league,
    message: r.message,
    data: r.data,
    severity: r.severity,
    createdAt: r.created_at,
  }));
}

module.exports = { createAgentAlert, fanoutToUsers, recentAlertsForFeed, tiersForAlert, TYPES };
