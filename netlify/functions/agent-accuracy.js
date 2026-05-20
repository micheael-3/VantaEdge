// agent-accuracy — daily 3am full rebuild of the accuracy_model.
//
// agent-results bumps counters incrementally as predictions settle, but small
// integer drift accumulates and weight_adjustment isn't recomputed there.
// This run recomputes accuracy + weight_adjustment from scratch off the
// settled-predictions table so the model self-tunes nightly.

const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');
const { confidenceBucket, markRun, setState } = require('./_shared/agent');
const { createAgentAlert } = require('./_shared/alerts');

const SCHEDULE = '0 3 * * *';

function weightFor(accuracy, sampleSize) {
  if (sampleSize < 8) return 0;            // too small to tune on
  if (accuracy > 70) return 5;
  if (accuracy >= 60) return 0;
  if (accuracy >= 50) return -5;
  return -10;
}

function isAuthorised(event) {
  if (!event || !event.headers) return false;
  const h = event.headers;
  const scheduled =
    h['x-nf-event'] === 'schedule' ||
    h['netlify-invocation-source'] === 'schedule' ||
    h['x-netlify-event'] === 'schedule';
  if (scheduled) return true;
  const auth = h.authorization || h.Authorization || '';
  const provided = auth.replace(/^Bearer\s+/i, '').trim();
  return !!process.env.ADMIN_PASSWORD && provided === process.env.ADMIN_PASSWORD;
}

async function rebuild() {
  const report = {
    totalSettled: 0,
    dimensionsUpdated: 0,
    bestLeague: null,
    worstLeague: null,
    durationMs: 0,
  };
  const t0 = Date.now();

  // Pull settled rows. Only count rows with a non-null hit.
  const overRows = await sql()`
    SELECT league, over_confidence, is_sharp_move, over_hit
    FROM predictions WHERE over_hit IS NOT NULL`;
  const bttsRows = await sql()`
    SELECT league, btts, btts_confidence, btts_hit
    FROM predictions WHERE btts_hit IS NOT NULL`;
  report.totalSettled = overRows.length + bttsRows.length;

  // Tally by dimension.
  const tallies = new Map();
  function bump(dim, val, hit) {
    if (!val) return;
    const key = `${dim}::${val}`;
    const entry = tallies.get(key) || { dimension: dim, value: val, hits: 0, total: 0 };
    entry.total += 1;
    if (hit) entry.hits += 1;
    tallies.set(key, entry);
  }

  for (const r of overRows) {
    bump('LEAGUE', r.league, r.over_hit);
    bump('MARKET', 'OVER', r.over_hit);
    bump('CONFIDENCE_BUCKET', confidenceBucket(Number(r.over_confidence)), r.over_hit);
    bump('SHARP_MOVE', r.is_sharp_move ? 'YES' : 'NO', r.over_hit);
  }
  for (const r of bttsRows) {
    bump('LEAGUE', r.league, r.btts_hit);
    bump('MARKET', 'BTTS', r.btts_hit);
    bump('CONFIDENCE_BUCKET', confidenceBucket(Number(r.btts_confidence)), r.btts_hit);
    bump('SHARP_MOVE', r.is_sharp_move ? 'YES' : 'NO', r.btts_hit);
  }

  // Wipe and reinsert — single transaction would be nicer but Neon HTTP
  // doesn't support multi-statement transactions cleanly. Acceptable since
  // this runs at 3am with no readers.
  await sql()`DELETE FROM accuracy_model`;

  const leagueAcc = {};
  for (const e of tallies.values()) {
    const accuracy = e.total ? Math.round((e.hits / e.total) * 1000) / 10 : 0;
    const weight = weightFor(accuracy, e.total);
    await sql()`
      INSERT INTO accuracy_model
        (dimension, dimension_value, total_predictions, hits, accuracy, weight_adjustment, last_updated)
      VALUES (${e.dimension}, ${e.value}, ${e.total}, ${e.hits}, ${accuracy}, ${weight}, NOW())`;
    report.dimensionsUpdated += 1;
    if (e.dimension === 'LEAGUE') leagueAcc[e.value] = { accuracy, total: e.total };
  }

  // Identify best / worst leagues (min 8 samples).
  let best = null;
  let worst = null;
  for (const [league, stats] of Object.entries(leagueAcc)) {
    if (stats.total < 8) continue;
    if (!best || stats.accuracy > best.accuracy) best = { league, accuracy: stats.accuracy };
    if (!worst || stats.accuracy < worst.accuracy) worst = { league, accuracy: stats.accuracy };
  }
  report.bestLeague = best;
  report.worstLeague = worst;

  // Emit an accuracy update alert (EDGE-tier only via the fanout policy).
  if (report.totalSettled > 0) {
    try {
      await createAgentAlert({
        type: 'ACCURACY_UPDATE',
        message: `Accuracy model rebuilt — ${report.totalSettled} settled markets, ${report.dimensionsUpdated} dimensions tuned`,
        severity: 'INFO',
        data: { ...report, bestLeague: best, worstLeague: worst },
      });
    } catch (e) {
      console.error('[agent-accuracy] alert emit failed:', e.message);
    }
  }

  report.durationMs = Date.now() - t0;
  await markRun('accuracy_last_run');
  await setState('accuracy_last_report', { ...report, at: new Date().toISOString() });
  console.log('[agent-accuracy] report:', JSON.stringify(report));
  return report;
}

exports.handler = async (event) => {
  try {
    if (event && event.headers && !isAuthorised(event) && event.httpMethod) {
      return error(401, 'UNAUTHORIZED');
    }
    const report = await rebuild();
    return event ? json(200, report) : report;
  } catch (err) {
    console.error('agent-accuracy handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.rebuild = rebuild;
exports.config = { schedule: SCHEDULE };
