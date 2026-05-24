// agent-patterns — Monday 5 AM Cyprus.
//
// Mines the last 90 days of settled predictions for statistical patterns.
// For each (sport, dimension, value) group with at least 10 samples we
// compute the over-hit rate and compare it to the sport's overall over-
// hit rate. Groups whose hit rate differs from the average by more than
// 10 percentage points are stored as PatternInsights — and if the gap
// is big enough (>= 15pts) we also auto-create a corresponding
// learned_rule so the Analyst sees it on the next scan.
//
// Dimensions mined (all sport-agnostic except the kickoff-time bucket
// which is universally useful):
//   day_of_week      — 0..6, Asia/Nicosia
//   referee          — referee name from match_data.referee
//   rest_band        — 0-3 / 4-7 / 8+ days
//   home_position    — top-third / mid-third / bottom-third of league table
//   kickoff_band     — early / midday / evening / late
//
// Future sports add new mineable dimensions by extending dimensionsFor()
// based on sport.type.

const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');
const { markRun, setState } = require('./_shared/agent');
const { activeSports } = require('./_shared/sports');
const { insertRule } = require('./_shared/learned-rules');

const SCHEDULE = '0 5 * * 1';

const MIN_SAMPLE = 10;
const ALERT_DELTA_PCT = 10;  // surface as insight
const RULE_DELTA_PCT = 15;   // auto-promote to learned_rule

function isMissingTableErr(err) {
  return err && (err.code === '42P01' || /relation .* does not exist/i.test(err.message || ''));
}

// Cyprus day-of-week. Inline (not pulled from _shared/dates) so this
// file can run even on a stripped bundle.
function cyprusDay(iso) {
  try {
    const wd = new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Nicosia', weekday: 'short' });
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd];
  } catch { return null; }
}

function cyprusHour(iso) {
  try {
    const h = new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Nicosia', hour: '2-digit', hour12: false });
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function kickoffBand(h) {
  if (h == null) return null;
  if (h < 12) return 'early';
  if (h < 17) return 'midday';
  if (h < 21) return 'evening';
  return 'late';
}

function restBand(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return null;
  if (n <= 3) return '0-3';
  if (n <= 7) return '4-7';
  return '8+';
}

// Pull every dimension (key + label) we can extract from one settled row.
function dimensionsFor(p, md) {
  const out = [];
  // day-of-week
  const dow = cyprusDay(p.kickoff);
  if (dow != null) out.push(['day_of_week', String(dow)]);
  // kickoff band
  const kb = kickoffBand(cyprusHour(p.kickoff));
  if (kb) out.push(['kickoff_band', kb]);
  // referee
  const ref = md && md.referee && md.referee.name;
  if (ref) out.push(['referee', String(ref).slice(0, 80)]);
  // home rest
  const homeRest = md && md.home && md.home.restDays;
  const rb = restBand(homeRest);
  if (rb) out.push(['home_rest', rb]);
  // home league position third
  const pos = md && md.home && md.home.standing && md.home.standing.position;
  const totalTeams = md && md.home && md.home.standing && md.home.standing.totalTeams;
  if (pos && totalTeams) {
    const third = pos <= totalTeams / 3 ? 'top' : pos <= (2 * totalTeams) / 3 ? 'mid' : 'bottom';
    out.push(['home_position', third]);
  }
  return out;
}

async function mineSport(sport) {
  let rows;
  try {
    rows = await sql()`
      SELECT id, kickoff, over_hit, btts_hit, match_data
      FROM predictions
      WHERE LOWER(league) = ${sport.name.toLowerCase()}
        AND over_hit IS NOT NULL
        AND settled_at IS NOT NULL
        AND settled_at >= NOW() - INTERVAL '90 days'`;
  } catch (err) {
    if (isMissingTableErr(err)) {
      return { sport: sport.id, skipped: 'predictions table missing', insights: 0, rules: 0 };
    }
    return { sport: sport.id, error: err.message };
  }

  if (rows.length < MIN_SAMPLE) {
    return { sport: sport.id, samples: rows.length, skipped: 'too few samples', insights: 0, rules: 0 };
  }

  // Overall hit rate baseline.
  const overall =
    rows.filter((r) => r.over_hit === true).length / rows.length;

  // Group by (dimension, value).
  const groups = new Map(); // 'dim::val' → { dim, val, total, hits }
  for (const r of rows) {
    let md = {};
    try { md = typeof r.match_data === 'string' ? JSON.parse(r.match_data) : (r.match_data || {}); }
    catch { /* skip */ }
    for (const [dim, val] of dimensionsFor(r, md)) {
      const key = `${dim}::${val}`;
      const g = groups.get(key) || { dim, val, total: 0, hits: 0 };
      g.total += 1;
      if (r.over_hit === true) g.hits += 1;
      groups.set(key, g);
    }
  }

  // Wipe previous insights for this sport so the Admin tab shows fresh
  // numbers each week. Best-effort.
  try {
    await sql()`DELETE FROM pattern_insights WHERE LOWER(sport) = ${sport.id.toLowerCase()}`;
  } catch { /* ignore */ }

  const out = { sport: sport.id, league: sport.name, samples: rows.length, insights: 0, rules: 0, errors: [] };

  for (const g of groups.values()) {
    if (g.total < MIN_SAMPLE) continue;
    const hitRate = g.hits / g.total;
    const deltaPct = (hitRate - overall) * 100;
    if (Math.abs(deltaPct) < ALERT_DELTA_PCT) continue;

    const direction = deltaPct > 0 ? 'over hits MORE often' : 'over hits LESS often';
    const insight = `When ${g.dim} = ${g.val}, Over ${direction} than average (${(hitRate * 100).toFixed(0)}% vs ${(overall * 100).toFixed(0)}%, n=${g.total}).`;
    try {
      await sql()`
        INSERT INTO pattern_insights
          (sport, league, dimension, dimension_value, sample_count, hit_rate, overall_hit_rate, delta, insight)
        VALUES
          (${sport.id}, ${sport.name}, ${g.dim}, ${g.val}, ${g.total},
           ${hitRate}, ${overall}, ${deltaPct}, ${insight})`;
      out.insights += 1;
    } catch (e) {
      out.errors.push({ stage: 'insert-insight', dim: g.dim, val: g.val, error: e.message });
      continue;
    }

    // Strong patterns become rules. Express the condition + adjustment
    // in the same machine-style language the autopsy uses.
    if (Math.abs(deltaPct) >= RULE_DELTA_PCT) {
      const condition = `${g.dim} = ${g.val}`;
      const adjustment = deltaPct > 0
        ? `historically Over wins +${deltaPct.toFixed(0)}pts more often here — be more willing to call Over`
        : `historically Over wins ${deltaPct.toFixed(0)}pts less often here — be more cautious about Over`;
      const ruleId = await insertRule({
        sport: sport.id,
        league: sport.name,
        condition,
        adjustment,
        confidence: Math.min(100, Math.round(70 + Math.abs(deltaPct))),
        source: 'pattern',
      });
      if (ruleId) out.rules += 1;
    }
  }

  return out;
}

async function run() {
  const t0 = Date.now();
  const reports = [];
  for (const sport of activeSports()) {
    try {
      reports.push(await mineSport(sport));
    } catch (err) {
      reports.push({ sport: sport.id, error: err.message });
    }
  }
  const report = { durationMs: Date.now() - t0, sports: reports };
  try {
    await markRun('patterns_last_run');
    await setState('patterns_last_report', { ...report, at: new Date().toISOString() });
  } catch { /* state table optional */ }
  console.log('[agent-patterns] report:', JSON.stringify(report));
  return report;
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

exports.handler = async (event) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event && event.httpMethod && !isAuthorised(event)) return error(401, 'UNAUTHORIZED');
    const report = await run();
    return event ? json(200, report) : report;
  } catch (err) {
    console.error('[agent-patterns] fatal:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.run = run;
exports.config = { schedule: SCHEDULE };
