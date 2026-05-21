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

module.exports = {
  bucketFor,
  bucketCenter,
  loadAdjustments,
  calibrate,
  BUCKET_LABELS,
};
