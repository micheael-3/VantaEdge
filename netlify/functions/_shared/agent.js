// Shared utilities for the autonomous agent system.

const { sql } = require('./db');

const LEAGUE_IDS = [253, 78, 88, 40, 61, 179, 140, 39];

// ---------- agent_state key/value helpers ----------
async function getState(key) {
  const rows = await sql()`SELECT value FROM agent_state WHERE key = ${key}`;
  return rows[0] ? rows[0].value : null;
}

async function setState(key, value) {
  await sql()`
    INSERT INTO agent_state (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()`;
}

// Round-robin: returns the next slice of `size` league ids starting from the
// stored offset, advancing the offset for next time. Scanner pages through
// all 8 leagues across multiple runs to stay within the 10s function budget.
async function nextLeagueBatch(size = 3) {
  const state = await getState('scanner_offset');
  let offset = state && Number.isInteger(state.offset) ? state.offset : 0;
  if (offset >= LEAGUE_IDS.length) offset = 0;
  const batch = [];
  for (let i = 0; i < size; i++) {
    batch.push(LEAGUE_IDS[(offset + i) % LEAGUE_IDS.length]);
  }
  const nextOffset = (offset + size) % LEAGUE_IDS.length;
  await setState('scanner_offset', { offset: nextOffset });
  return { batch, offset, nextOffset };
}

// ---------- Sharp-move classification ----------
//
// Movement is signed: negative = odds dropped (market thinks side is MORE
// likely). Use the absolute value for severity.
function classifyMovement(movementPct, windowMins) {
  const abs = Math.abs(movementPct);
  if (windowMins <= 10 && abs >= 10) return 'SHARP';
  if (abs >= 20) return 'SHARP';
  if (abs >= 15) return 'HIGH';
  if (abs >= 10) return 'MEDIUM';
  if (abs >= 5) return 'LOW';
  return null;
}

// ---------- Accuracy-weighted confidence ----------
//
// Sums adjustments across LEAGUE / MARKET / CONFIDENCE_BUCKET / SHARP_MOVE /
// REFEREE / WEATHER and applies to the raw Claude confidence.
function confidenceBucket(conf) {
  if (conf >= 80) return '80+';
  if (conf >= 70) return '70-80';
  if (conf >= 60) return '60-70';
  if (conf >= 50) return '50-60';
  return '<50';
}

async function applyAccuracyWeights(claudeConfidence, ctx) {
  const bucket = confidenceBucket(claudeConfidence);
  const league = ctx.league || '';
  const market = ctx.market || '';
  const sharp = ctx.isSharpMove === true ? 'YES' : 'NO';
  const referee = ctx.referee || '';
  const weather = ctx.weatherCondition || '';

  let sumAdjustment = 0;
  try {
    const rows = await sql()`
      SELECT weight_adjustment FROM accuracy_model
      WHERE (dimension = 'LEAGUE'            AND dimension_value = ${league})
         OR (dimension = 'MARKET'            AND dimension_value = ${market})
         OR (dimension = 'CONFIDENCE_BUCKET' AND dimension_value = ${bucket})
         OR (dimension = 'SHARP_MOVE'        AND dimension_value = ${sharp})
         OR (dimension = 'REFEREE'           AND dimension_value = ${referee})
         OR (dimension = 'WEATHER'           AND dimension_value = ${weather})`;
    sumAdjustment = rows.reduce((acc, r) => acc + Number(r.weight_adjustment || 0), 0);
  } catch (e) {
    // Table missing or empty — return base value.
  }
  const adjusted = claudeConfidence + sumAdjustment;
  return Math.max(20, Math.min(95, adjusted));
}

// ---------- Opening odds helper ----------
// Returns the first snapshot for this fixture/market in the last 24h
// (treating that as "today's opening line"). Used by the scanner to compute
// total movement vs the line we first saw.
async function getOpeningOdds(fixtureId, market) {
  const rows = await sql()`
    SELECT odds, snapshot_at
    FROM odds_snapshots
    WHERE fixture_id = ${fixtureId}
      AND market = ${market}
      AND snapshot_at >= NOW() - INTERVAL '24 hours'
    ORDER BY snapshot_at ASC
    LIMIT 1`;
  return rows[0] || null;
}

// Returns the latest snapshot in the last N minutes (or null) — used for the
// short-window sharp-move detector (agent-odds-monitor).
async function getRecentSnapshot(fixtureId, market, withinMinutes) {
  const rows = await sql()`
    SELECT odds, snapshot_at
    FROM odds_snapshots
    WHERE fixture_id = ${fixtureId}
      AND market = ${market}
      AND snapshot_at >= NOW() - (${withinMinutes} * INTERVAL '1 minute')
    ORDER BY snapshot_at DESC
    LIMIT 1`;
  return rows[0] || null;
}

async function recordSnapshot(fixtureId, league, market, line, odds, bookmaker) {
  await sql()`
    INSERT INTO odds_snapshots (fixture_id, league, market, line, odds, bookmaker)
    VALUES (${fixtureId}, ${league}, ${market}, ${line}, ${odds}, ${bookmaker})`;
}

// ---------- Public status snapshot ----------
async function buildAgentStatus() {
  const lastScannerStateRaw = await getState('scanner_last_run');
  const lastOddsMonitorRaw = await getState('odds_monitor_last_run');
  const lastResultsRaw = await getState('results_last_run');
  const lastAccuracyRaw = await getState('accuracy_last_run');
  const lastAlertsRaw = await getState('alerts_last_run');
  const lastBestBetRaw = await getState('best_bet_last_run');

  const lastScan = lastScannerStateRaw && lastScannerStateRaw.at ? lastScannerStateRaw.at : null;
  const matchesToday = await sql()`
    SELECT COUNT(*)::int AS n
    FROM odds_snapshots
    WHERE snapshot_at >= NOW() - INTERVAL '24 hours'`;
  const alertsToday = await sql()`
    SELECT COUNT(*)::int AS n
    FROM agent_alerts
    WHERE created_at >= NOW() - INTERVAL '24 hours'`;

  let status = 'OFFLINE';
  if (lastScan) {
    const ageMs = Date.now() - new Date(lastScan).getTime();
    if (ageMs < 35 * 60 * 1000) status = 'ACTIVE';
    else if (ageMs < 90 * 60 * 1000) status = 'LATE';
  }

  return {
    status,
    lastScannerRun: lastScan,
    lastOddsMonitorRun: lastOddsMonitorRaw && lastOddsMonitorRaw.at,
    lastResultsRun: lastResultsRaw && lastResultsRaw.at,
    lastAccuracyRun: lastAccuracyRaw && lastAccuracyRaw.at,
    lastAlertsRun: lastAlertsRaw && lastAlertsRaw.at,
    lastBestBetRun: lastBestBetRaw && lastBestBetRaw.at,
    matchesMonitored: Number(matchesToday[0] && matchesToday[0].n) || 0,
    alertsToday: Number(alertsToday[0] && alertsToday[0].n) || 0,
  };
}

async function markRun(key) {
  await setState(key, { at: new Date().toISOString() });
}

module.exports = {
  LEAGUE_IDS,
  getState,
  setState,
  nextLeagueBatch,
  classifyMovement,
  confidenceBucket,
  applyAccuracyWeights,
  getOpeningOdds,
  getRecentSnapshot,
  recordSnapshot,
  buildAgentStatus,
  markRun,
};
