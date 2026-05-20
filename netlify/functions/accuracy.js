// EDGE-only accuracy intelligence endpoint.
//
//   GET /api/accuracy

const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { requireTier } = require('./_shared/tier');
const { getState } = require('./_shared/agent');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');
    const { res, user } = await requireUser(event);
    if (res) return res;
    const gate = requireTier(user, 'EDGE');
    if (gate) return gate;

    const rows = await sql()`
      SELECT dimension, dimension_value, total_predictions, hits, accuracy, weight_adjustment, last_updated
      FROM accuracy_model
      ORDER BY dimension ASC, accuracy DESC`;
    const grouped = {};
    for (const r of rows) {
      if (!grouped[r.dimension]) grouped[r.dimension] = [];
      grouped[r.dimension].push({
        value: r.dimension_value,
        total: Number(r.total_predictions),
        hits: Number(r.hits),
        accuracy: Number(r.accuracy),
        weightAdjustment: Number(r.weight_adjustment),
      });
    }

    // Rolling daily accuracy over the last 30 days from settled predictions.
    const rolling = await sql()`
      SELECT to_char(date_trunc('day', kickoff), 'YYYY-MM-DD') AS day,
             COUNT(*) FILTER (WHERE over_hit IS NOT NULL)::int AS settled,
             SUM(CASE WHEN over_hit = TRUE THEN 1 ELSE 0 END)::int AS hits
      FROM predictions
      WHERE kickoff >= NOW() - INTERVAL '30 days'
        AND over_hit IS NOT NULL
      GROUP BY 1
      ORDER BY 1 ASC`;

    const lastRun = await getState('accuracy_last_run');
    return json(200, {
      lastUpdated: lastRun && lastRun.at,
      dimensions: grouped,
      rolling: rolling.map((r) => ({
        date: r.day,
        settled: Number(r.settled) || 0,
        hits: Number(r.hits) || 0,
        accuracy: Number(r.settled) > 0 ? Math.round((Number(r.hits) / Number(r.settled)) * 1000) / 10 : 0,
      })),
    });
  } catch (err) {
    console.error('accuracy handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
