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
  'agent_alerts',
  'user_alerts',
  'odds_snapshots',
  'odds_movements',
  'bankroll_entries',
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

  return jsonResp(200, {
    summary: { total: TARGETS.length, ok: okCount, failed: failCount, totalDeleted },
    results,
  });
};

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
