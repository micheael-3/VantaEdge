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
//
// Returns:
//   - legacy fields the existing hero pill uses
//   - new trust-signal fields (totalPredictions / accuracyPct / monthAccuracyPct)
async function publicStats() {
  const since = startOfMonthIso();
  let valueBetsThisMonth = 0;
  let avgConfidenceStrongValue = 0;
  let totalPredictions = 0;
  let settledMarkets = 0;
  let hits = 0;
  let monthSettled = 0;
  let monthHits = 0;
  const since_iso = '2026-05-01';
  try {
    // All-time totals — excluding rows we hid as low-confidence.
    const [a] = await sql()`
      SELECT
        COUNT(*)::int                                              AS total,
        SUM(CASE WHEN over_hit IS NOT NULL THEN 1 ELSE 0 END)::int AS over_settled,
        SUM(CASE WHEN over_hit = TRUE      THEN 1 ELSE 0 END)::int AS over_hits,
        SUM(CASE WHEN btts_hit IS NOT NULL THEN 1 ELSE 0 END)::int AS btts_settled,
        SUM(CASE WHEN btts_hit = TRUE      THEN 1 ELSE 0 END)::int AS btts_hits
      FROM predictions
      WHERE (over_confidence >= 60 OR btts_confidence >= 60)`;
    totalPredictions = Number(a.total || 0);
    settledMarkets = Number(a.over_settled || 0) + Number(a.btts_settled || 0);
    hits = Number(a.over_hits || 0) + Number(a.btts_hits || 0);

    // This-month accuracy.
    const [m] = await sql()`
      SELECT
        SUM(CASE WHEN over_hit IS NOT NULL THEN 1 ELSE 0 END)::int AS over_settled,
        SUM(CASE WHEN over_hit = TRUE      THEN 1 ELSE 0 END)::int AS over_hits,
        SUM(CASE WHEN btts_hit IS NOT NULL THEN 1 ELSE 0 END)::int AS btts_settled,
        SUM(CASE WHEN btts_hit = TRUE      THEN 1 ELSE 0 END)::int AS btts_hits
      FROM predictions
      WHERE created_at >= ${since}
        AND (over_confidence >= 60 OR btts_confidence >= 60)`;
    monthSettled = Number(m.over_settled || 0) + Number(m.btts_settled || 0);
    monthHits = Number(m.over_hits || 0) + Number(m.btts_hits || 0);

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

  const accuracyPct = settledMarkets > 0 ? Math.round((hits / settledMarkets) * 100) : 0;
  const monthAccuracyPct = monthSettled > 0 ? Math.round((monthHits / monthSettled) * 100) : 0;

  return json(200, {
    valueBetsThisMonth,
    avgConfidenceStrongValue,
    leagues: 8,
    totalPredictions,
    settledMarkets,
    hits,
    accuracyPct,
    monthAccuracyPct,
    since: since_iso,
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
