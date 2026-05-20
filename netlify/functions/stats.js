const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');

function startOfMonthIso() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Public stats for the landing page. No auth.
// "Value bets" = predictions with confidence >= 60 (matches MARGINAL+ threshold).
// "Strong value" = predictions with confidence >= 70 (matches STRONG_VALUE band).
async function publicStats() {
  const since = startOfMonthIso();
  let valueBetsThisMonth = 0;
  let avgConfidenceStrongValue = 0;
  try {
    const [row] = await sql()`
      SELECT
        COUNT(*) FILTER (
          WHERE (over_confidence >= 60 OR btts_confidence >= 60)
        )::int AS value_count,
        COALESCE(
          AVG(over_confidence) FILTER (WHERE over_confidence >= 70),
          0
        )::float8 AS avg_strong_conf
      FROM predictions
      WHERE created_at >= ${since}`;
    valueBetsThisMonth = Number(row.value_count || 0);
    avgConfidenceStrongValue = Math.round(Number(row.avg_strong_conf || 0));
  } catch (err) {
    console.error('publicStats query failed:', err.message);
  }

  return json(200, {
    valueBetsThisMonth,
    avgConfidenceStrongValue,
    leagues: 8,
  });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');
    const path = subPath(event, 'stats');
    if (path === '/public') return await publicStats();
    return notFound();
  } catch (err) {
    console.error('stats handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
