// Wipe seeded / fake history data from the production DB.
//
// Usage: GET /api/admin/clear-history?key=<ADMIN_PASSWORD>
//
// Runs a series of DELETE statements (one table per try/catch so a missing
// table — say agent_alerts on an older schema — doesn't abort the rest).
// Returns a JSON report with rows deleted per table.

const { sql } = require('./_shared/db');

const TARGETS = [
  'predictions',
  'prediction_history',
  'accuracy_model',
  'best_bet',
  'agent_alerts',
  'user_alerts',
  'odds_snapshots',
  'odds_movements',
  'bankroll_entries',
  'scan_status',
];

// Execute a single raw SQL statement against Neon. The serverless driver's
// tagged-template callable also accepts a fake strings array as the first
// argument, which is the documented escape hatch for running unparameterised
// DDL/DML. We use that here.
async function execRaw(stmt) {
  const sqlFn = sql();
  const parts = [stmt];
  parts.raw = [stmt];
  return await sqlFn(parts);
}

exports.handler = async (event) => {
  // Outer try/catch: any unexpected throw (bad event shape, neon import
  // failure, AbortController fail) becomes a 500 with a real message
  // rather than a 502 empty body from Netlify's default handler.
  try {
  const params = event.queryStringParameters || {};
  const supplied = params.key || '';
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) {
    return jsonResp(500, { error: 'ADMIN_PASSWORD is not set on the server.' });
  }
  if (supplied !== expected) {
    return jsonResp(401, { error: 'Unauthorized. Append ?key=<ADMIN_PASSWORD> to the URL.' });
  }

  const results = [];
  let totalDeleted = 0;
  let okCount = 0;
  let failCount = 0;

  for (const table of TARGETS) {
    try {
      const stmt = `DELETE FROM ${table}`;
      const result = await execRaw(stmt);
      // neon serverless: row count typically in result.rowCount; some shapes return an array.
      const rows = result && result.rowCount != null ? Number(result.rowCount) : null;
      if (Number.isFinite(rows)) totalDeleted += rows;
      results.push({ ok: true, table, rowsDeleted: rows });
      okCount += 1;
    } catch (err) {
      results.push({ ok: false, table, error: err.message });
      failCount += 1;
    }
  }

  // After clearing, fire a fresh background scan so the dashboard
  // doesn't sit empty waiting for the cron tick. Same pattern as the
  // admin rescan endpoint: POST to predictions-scan-background with
  // the JWT_SECRET as the internal-call shared secret.
  let scanTriggered = false;
  try {
    const base = process.env.URL || process.env.DEPLOY_URL || '';
    const secret = process.env.JWT_SECRET || '';
    if (base && secret) {
      // Monday of current week (UTC).
      const now = new Date();
      const day = now.getUTCDay();
      const mondayOffset = day === 0 ? -6 : 1 - day; // Sunday → -6, Mon → 0, Tue → -1...
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + mondayOffset);
      const weekStart = monday.toISOString().slice(0, 10);

      const url = `${base}/.netlify/functions/predictions-scan-background`;
      // Fire and forget — don't await. Background functions return 202.
      // We use a synthetic AbortController to bail after 2s so the caller
      // doesn't hang if Netlify is slow to ack.
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 2000);
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-scan-secret': secret,
        },
        body: JSON.stringify({ leagueId: 253, weekStart }),
        signal: ctrl.signal,
      }).catch(() => {}).finally(() => clearTimeout(to));
      scanTriggered = true;
    }
  } catch (err) {
    console.warn('[clear-history] failed to trigger background scan:', err.message);
  }

  return jsonResp(200, {
    summary: { total: TARGETS.length, ok: okCount, failed: failCount, totalDeleted },
    scanTriggered,
    results,
  });
  } catch (err) {
    console.error('[admin-clear-history] fatal:', err);
    return jsonResp(500, { error: err.message || 'Internal error' });
  }
};

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
