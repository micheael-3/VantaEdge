// GET /api/intelligence
//
// Composite "how smart is FastScore right now?" score for the dashboard
// + admin Intelligence tab. Public (no auth) — the number is just a
// vanity / trust metric, not gated data.
//
// Score formula per spec:
//   Base                          100
//   +2 per settled prediction     up to 400
//   +20 per active learned rule   up to 200
//   +50 per week of calibration   up to 300
//   +accuracy bonus               (overallAccuracy − 50) × 10, max 250
//   Total cap                     1150
//
// All COUNTS work with empty-table fallbacks (42P01) so the endpoint
// always returns a sane number even on a half-migrated DB.

const { sql } = require('./_shared/db');
const { json, error, methodNotAllowed } = require('./_shared/response');

function isMissingTableErr(err) {
  return err && (err.code === '42P01' || /relation .* does not exist/i.test(err.message || ''));
}

async function safeCount(query, defaultValue = 0) {
  try {
    const rows = await query();
    return Number((rows[0] && (rows[0].n ?? rows[0].count)) || 0);
  } catch (err) {
    if (isMissingTableErr(err)) return defaultValue;
    console.warn('[intelligence] count failed:', err.message);
    return defaultValue;
  }
}

async function computeIntelligence() {
  // Settled predictions — every row with a hit boolean, regardless of
  // whether the AI prediction was real (confidence>0) or recovered.
  // For the score we want depth-of-experience, not just real AI hits.
  const settledCount = await safeCount(() => sql()`
    SELECT COUNT(*)::int AS n FROM predictions
    WHERE over_hit IS NOT NULL`);

  // Learned rules currently active.
  const rulesCount = await safeCount(() => sql()`
    SELECT COUNT(*)::int AS n FROM learned_rules WHERE active = TRUE`);

  // Weeks of calibration — measured as the number of calibration rows
  // with sample_count >= 10 (live calibration only kicks in at that
  // threshold). Plus a continuous-weeks-active proxy from the earliest
  // calibration row's age.
  let calibrationWeeks = 0;
  try {
    const rows = await sql()`
      SELECT MIN(updated_at) AS first_seen,
             COUNT(*) FILTER (WHERE sample_count >= 10)::int AS strong_buckets
      FROM calibration`;
    const first = rows[0] && rows[0].first_seen;
    if (first) {
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(first).getTime()) / 86400000));
      calibrationWeeks = Math.floor(ageDays / 7);
    }
    void rows[0] && rows[0].strong_buckets; // strong_buckets is informational
  } catch (err) {
    if (!isMissingTableErr(err)) console.warn('[intelligence] calibration query failed:', err.message);
  }

  // Overall accuracy across confidence-eligible (>=60) settled rows —
  // matches the History page's hit-rate definition. Falls back to 0 on
  // missing data.
  let overallAccuracy = 0;
  try {
    const rows = await sql()`
      SELECT
        COUNT(*) FILTER (WHERE over_hit = TRUE OR btts_hit = TRUE)::float
          / NULLIF(
              COUNT(*) FILTER (WHERE over_hit IS NOT NULL OR btts_hit IS NOT NULL),
              0
            ) AS rate
      FROM predictions
      WHERE (over_confidence >= 60 OR btts_confidence >= 60)`;
    if (rows[0] && Number.isFinite(Number(rows[0].rate))) {
      overallAccuracy = Math.round(Number(rows[0].rate) * 1000) / 10;
    }
  } catch (err) {
    if (!isMissingTableErr(err)) console.warn('[intelligence] accuracy query failed:', err.message);
  }

  // Compose the score.
  const settledPoints = Math.min(400, settledCount * 2);
  const rulesPoints = Math.min(200, rulesCount * 20);
  const calibrationPoints = Math.min(300, calibrationWeeks * 50);
  const accuracyBonus = Math.max(0, Math.min(250, (overallAccuracy - 50) * 10));
  const score = Math.round(100 + settledPoints + rulesPoints + calibrationPoints + accuracyBonus);

  // Trend — look at the last 14 days vs the prior 14 days. Simple,
  // honest, no clever weighting.
  let trend = 'stable';
  try {
    const rows = await sql()`
      SELECT
        (SUM(CASE WHEN over_hit = TRUE THEN 1 ELSE 0 END) FILTER (
          WHERE settled_at >= NOW() - INTERVAL '14 days'
        )::float /
         NULLIF(COUNT(*) FILTER (
          WHERE settled_at >= NOW() - INTERVAL '14 days' AND over_hit IS NOT NULL
         ), 0)) AS recent,
        (SUM(CASE WHEN over_hit = TRUE THEN 1 ELSE 0 END) FILTER (
          WHERE settled_at >= NOW() - INTERVAL '28 days'
            AND settled_at <  NOW() - INTERVAL '14 days'
        )::float /
         NULLIF(COUNT(*) FILTER (
          WHERE settled_at >= NOW() - INTERVAL '28 days'
            AND settled_at <  NOW() - INTERVAL '14 days'
            AND over_hit IS NOT NULL
         ), 0)) AS prior
      FROM predictions
      WHERE over_confidence >= 60`;
    const r = rows[0] || {};
    if (Number.isFinite(Number(r.recent)) && Number.isFinite(Number(r.prior))) {
      const diff = Number(r.recent) - Number(r.prior);
      if (diff > 0.05) trend = 'improving';
      else if (diff < -0.05) trend = 'declining';
    }
  } catch { /* leave trend = stable */ }

  return {
    score,
    settledPredictions: settledCount,
    learnedRules: rulesCount,
    calibrationWeeks,
    overallAccuracy,
    trend,
    breakdown: {
      base: 100,
      settledPoints,
      rulesPoints,
      calibrationPoints,
      accuracyBonus: Math.round(accuracyBonus),
      cap: 1150,
    },
  };
}

exports.handler = async (event) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event && event.httpMethod && event.httpMethod !== 'GET') return methodNotAllowed();
    const data = await computeIntelligence();
    return json(200, data);
  } catch (err) {
    console.error('intelligence handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.computeIntelligence = computeIntelligence;
