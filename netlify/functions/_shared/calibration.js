// Calibration helper shared by predictions.js (apply to live cards) and
// history.js (chart calibration drift). Buckets raw model confidence into
// 50-60, 60-70, 70-80, 80-90, 90-100 and applies the per-bucket adjustment
// computed nightly by agent-accuracy from settled predictions.

const { sql } = require('./db');

// Bucket a raw confidence (0-100) into the canonical 5-bucket label.
// Returns null for confidence < 50 — the model never emits below 50, so we
// don't carry a bucket for it.
function bucketFor(rawConfidence) {
  const c = Number(rawConfidence);
  if (!Number.isFinite(c)) return null;
  if (c < 50) return null;
  if (c < 60) return '50-60';
  if (c < 70) return '60-70';
  if (c < 80) return '70-80';
  if (c < 90) return '80-90';
  return '90-100';
}

function bucketCenter(bucket) {
  return (
    {
      '50-60': 0.55,
      '60-70': 0.65,
      '70-80': 0.75,
      '80-90': 0.85,
      '90-100': 0.95,
    }[bucket] || null
  );
}

const BUCKET_LABELS = ['50-60', '60-70', '70-80', '80-90', '90-100'];

// Loads all current adjustments from the DB once per function invocation.
// Returns { over: { '50-60': 0.91, ... }, btts: { ... } }
// Empty objects on error so callers stay resilient.
async function loadAdjustments() {
  try {
    const rows = await sql()`
      SELECT dimension, dimension_value, weight_adjustment
      FROM accuracy_model
      WHERE dimension IN ('CONFIDENCE_BUCKET_OVER', 'CONFIDENCE_BUCKET_BTTS')`;
    const out = { over: {}, btts: {} };
    for (const r of rows) {
      const key = r.dimension === 'CONFIDENCE_BUCKET_OVER' ? 'over' : 'btts';
      out[key][r.dimension_value] = Number(r.weight_adjustment) || 1;
    }
    return out;
  } catch {
    return { over: {}, btts: {} };
  }
}

// Apply the bucket's adjustment to a raw confidence. Returns a calibrated
// confidence (0-100 integer). Falls back to raw if no adjustment exists or
// the bucket is unrecognised.
//
// adjustment = actual_hit_rate / bucket_center, so:
//   calibrated_prob = bucket_center * adjustment = actual_hit_rate
// expressed as a 0-100 percentage.
function calibrate(rawConfidence, market /* 'over' | 'btts' */, adjustments) {
  if (rawConfidence == null) return rawConfidence;
  const bucket = bucketFor(rawConfidence);
  if (!bucket) return rawConfidence;
  const adj =
    adjustments && adjustments[market] && adjustments[market][bucket];
  if (!adj || adj === 1) return rawConfidence;
  const center = bucketCenter(bucket);
  if (!center) return rawConfidence;
  const calibrated = center * adj * 100;
  return Math.round(Math.max(0, Math.min(100, calibrated)));
}

// ============================================================
// Per-league, per-market live calibration.
// ============================================================
//
// The bucket logic above ('50-60' / '60-70' / etc. with bucket-centre
// multipliers) is great for the dashboard's "raw 80% / calibrated 64%"
// chip but it's slow to converge — five buckets per market means each
// only sees ~1/5 of the data. The new `calibration` table tracks ONE
// scalar correction factor per (league, market) instead:
//
//   correction_factor = actual_win_rate / mean_confidence
//                       (clamped to [0.5, 2.0])
//
// On every settle (agent-results.js) we recompute mean_confidence and
// actual_win_rate from scratch off the predictions table — small enough
// numbers that we don't need an incremental algorithm. The scan reads
// the factor on insert via getCalibrationFactor() and stores the
// multiplied value into calibrated_over_confidence /
// calibrated_btts_confidence so the dashboard reads it directly.
//
// Until a (league, market) bucket has at least 10 settled predictions
// the factor is forced to 1.0 (no calibration) — we don't want one
// settled match to swing every future pick by 30%.

const MIN_SAMPLES = 10;

function clampFactor(n) {
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.5, Math.min(2.0, n));
}

// Pure helper for applying a factor to a raw confidence. Centralised so
// the scan, the /week shaper, and any future call site all agree on the
// 50–95 clamp. (95 ceiling matches the model's 85% cap with a little
// headroom — calibration can lift it slightly when the model is
// systematically under-confident on a market.)
function applyFactor(rawConfidence, factor) {
  if (rawConfidence == null || !Number.isFinite(Number(rawConfidence))) return null;
  const f = Number.isFinite(Number(factor)) ? Number(factor) : 1;
  const out = Math.round(Number(rawConfidence) * f);
  return Math.max(50, Math.min(95, out));
}

// Returns the current correction factor for a (league, market) pair.
// Defaults to 1.0 if the row doesn't exist yet or has fewer than
// MIN_SAMPLES settled predictions. Errors are non-fatal — we return
// 1.0 and let the caller continue without calibration.
async function getCalibrationFactor(league, market) {
  if (!league || !market) return 1;
  try {
    const rows = await sql()`
      SELECT correction_factor, sample_count
      FROM calibration
      WHERE league = ${league} AND market = ${market}
      LIMIT 1`;
    if (!rows.length) return 1;
    const r = rows[0];
    if (Number(r.sample_count) < MIN_SAMPLES) return 1;
    const f = Number(r.correction_factor);
    return Number.isFinite(f) ? clampFactor(f) : 1;
  } catch (err) {
    console.warn(`[calibration] getCalibrationFactor(${league},${market}) failed: ${err.message}`);
    return 1;
  }
}

// Recompute and persist the (league, market) calibration row. Called
// from agent-results.js for every settled prediction.
//   wasCorrect       — boolean for this just-settled prediction
//   confidenceUsed   — raw confidence we shipped (0-100)
//
// We deliberately recompute mean/actual from the full settled-rows
// scan on every call. Two reasons:
//   1. Numerical stability — incremental update of a running average
//      drifts after a few thousand rows; a full sum is exact.
//   2. Cost — we settle 1–2 fixtures every couple of hours, never a
//      flood. The full scan is trivially cheap.
async function updateCalibration(league, market, wasCorrect, confidenceUsed) {
  if (!league || !market) return null;
  if (typeof wasCorrect !== 'boolean') return null;
  if (!Number.isFinite(Number(confidenceUsed))) return null;
  try {
    let stats;
    if (market === 'over') {
      stats = await sql()`
        SELECT
          COUNT(*)::int                                                AS sample_count,
          AVG(over_confidence)::float                                  AS mean_confidence,
          (SUM(CASE WHEN over_hit THEN 1 ELSE 0 END)::float
            / NULLIF(COUNT(*), 0))                                     AS actual_win_rate
        FROM predictions
        WHERE league = ${league} AND over_hit IS NOT NULL`;
    } else if (market === 'btts') {
      stats = await sql()`
        SELECT
          COUNT(*)::int                                                AS sample_count,
          AVG(btts_confidence)::float                                  AS mean_confidence,
          (SUM(CASE WHEN btts_hit THEN 1 ELSE 0 END)::float
            / NULLIF(COUNT(*), 0))                                     AS actual_win_rate
        FROM predictions
        WHERE league = ${league} AND btts_hit IS NOT NULL`;
    } else {
      return null;
    }
    const row = stats && stats[0];
    if (!row) return null;
    const sampleCount = Number(row.sample_count) || 0;
    // mean_confidence comes back as a 0-100 percentage from the DB;
    // actual_win_rate comes back 0-1. Convert mean to 0-1 for the ratio.
    const meanConfPct = Number(row.mean_confidence) || 0;
    const meanConfFrac = meanConfPct / 100;
    const winRate = Number(row.actual_win_rate);

    let correctionFactor = 1;
    if (sampleCount >= MIN_SAMPLES && meanConfFrac > 0 && Number.isFinite(winRate)) {
      correctionFactor = clampFactor(winRate / meanConfFrac);
    }

    await sql()`
      INSERT INTO calibration (league, market, correction_factor, sample_count, mean_confidence, actual_win_rate, updated_at)
      VALUES (${league}, ${market}, ${correctionFactor}, ${sampleCount}, ${meanConfPct}, ${winRate}, NOW())
      ON CONFLICT (league, market) DO UPDATE SET
        correction_factor = EXCLUDED.correction_factor,
        sample_count      = EXCLUDED.sample_count,
        mean_confidence   = EXCLUDED.mean_confidence,
        actual_win_rate   = EXCLUDED.actual_win_rate,
        updated_at        = NOW()`;

    // wasCorrect / confidenceUsed are accepted so callers don't have to
    // recompute them, but we don't use them in the recompute path — the
    // full DB scan already includes the just-settled row.
    void wasCorrect; void confidenceUsed;
    return { league, market, correctionFactor, sampleCount, meanConfidence: meanConfPct, actualWinRate: winRate };
  } catch (err) {
    console.warn(`[calibration] updateCalibration(${league},${market}) failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  // Legacy bucket-based API — kept exporting so predictions.js and
  // history.js continue to work without changes.
  bucketFor,
  bucketCenter,
  loadAdjustments,
  calibrate,
  BUCKET_LABELS,
  // New per-(league, market) scalar API.
  getCalibrationFactor,
  updateCalibration,
  applyFactor,
};
