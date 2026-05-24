// agent-results — replaces the old results.js cron.
// Same settlement engine, plus:
//   • emits RESULT_SETTLED alerts
//   • updates accuracy_model totals as it goes
//   • cascades the result to linked bankroll_entries
//
// Schedule: every 2 hours.

const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const football = require('./_shared/football');
const { settleEntriesForPrediction } = require('./_shared/bankroll');
const { createAgentAlert } = require('./_shared/alerts');
const { confidenceBucket, markRun, setState } = require('./_shared/agent');
const { updateCalibration } = require('./_shared/calibration');

const SCHEDULE = '0 */2 * * *';

const TERMINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
const VOID_STATUSES = new Set(['CANC', 'ABD', 'PST']);

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

function ninetyMinutesAgoIso() {
  const d = new Date();
  d.setUTCMinutes(d.getUTCMinutes() - 90);
  return d.toISOString();
}

function computeHits(fixture, overLine, bttsCall) {
  const home = fixture && fixture.goals && fixture.goals.home;
  const away = fixture && fixture.goals && fixture.goals.away;
  if (home == null || away == null) return null;
  const totalGoals = Number(home) + Number(away);
  const overHit = totalGoals > Number(overLine);
  const bothScored = Number(home) > 0 && Number(away) > 0;
  const isYes = String(bttsCall || 'YES').toUpperCase() === 'YES';
  const bttsHit = isYes ? bothScored : !bothScored;
  return { totalGoals, overHit, bttsHit, home: Number(home), away: Number(away) };
}

// Bump an accuracy_model row. Insert if missing, else add to running totals.
async function bumpAccuracy(dimension, value, hit) {
  if (!value) return;
  await sql()`
    INSERT INTO accuracy_model (dimension, dimension_value, total_predictions, hits, accuracy, weight_adjustment, last_updated)
    VALUES (${dimension}, ${value}, 1, ${hit ? 1 : 0}, ${hit ? 100 : 0}, 0, NOW())
    ON CONFLICT (dimension, dimension_value) DO UPDATE
      SET total_predictions = accuracy_model.total_predictions + 1,
          hits = accuracy_model.hits + ${hit ? 1 : 0},
          accuracy = ((accuracy_model.hits + ${hit ? 1 : 0})::float8 / (accuracy_model.total_predictions + 1)) * 100,
          last_updated = NOW()`;
}

async function settleBatch({ dryRun = false } = {}) {
  const since = ninetyMinutesAgoIso();
  const rows = await sql()`
    SELECT id, user_id, league, fixture_id, kickoff,
           over_line, over_confidence, btts, btts_confidence,
           is_sharp_move
    FROM predictions
    WHERE over_hit IS NULL
      AND kickoff <= ${since}
    ORDER BY kickoff ASC
    LIMIT 500`;

  const byFixture = new Map();
  for (const r of rows) {
    if (!byFixture.has(r.fixture_id)) byFixture.set(r.fixture_id, []);
    byFixture.get(r.fixture_id).push(r);
  }

  const report = {
    candidatesUnsettled: rows.length,
    fixturesQueried: 0,
    fixturesSettled: 0,
    fixturesPendingFt: 0,
    fixturesVoided: 0,
    fixturesMissingScore: 0,
    fixturesErrored: 0,
    predictionsUpdated: 0,
    bankrollEntriesSettled: 0,
    alertsEmitted: 0,
    durationMs: 0,
  };
  const t0 = Date.now();

  for (const [fixtureId, preds] of byFixture.entries()) {
    report.fixturesQueried += 1;
    let fixture;
    try {
      fixture = await football.getFixtureById(fixtureId);
    } catch (err) {
      report.fixturesErrored += 1;
      console.error(`[agent-results] fixture ${fixtureId} fetch failed:`, err.message);
      continue;
    }
    if (!fixture) {
      report.fixturesMissingScore += 1;
      continue;
    }
    const statusShort = fixture.fixture && fixture.fixture.status && fixture.fixture.status.short;
    if (VOID_STATUSES.has(statusShort)) {
      report.fixturesVoided += 1;
      continue;
    }
    if (!TERMINAL_STATUSES.has(statusShort)) {
      report.fixturesPendingFt += 1;
      continue;
    }

    const homeName = fixture.teams && fixture.teams.home && fixture.teams.home.name;
    const awayName = fixture.teams && fixture.teams.away && fixture.teams.away.name;

    for (const p of preds) {
      const calc = computeHits(fixture, p.over_line, p.btts);
      if (!calc) {
        report.fixturesMissingScore += 1;
        continue;
      }
      if (!dryRun) {
        // accuracy_score is 1.0 if both markets hit, 0.5 if one hits,
        // 0.0 if both miss. Saved alongside the hit flags so /history
        // and the persona-state engine can read it in a single query.
        // If the column doesn't exist yet (migration not run) we fall
        // back to the hit-flags-only UPDATE so the settle still happens.
        const accuracyScore =
          (calc.overHit ? 0.5 : 0) + (calc.bttsHit ? 0.5 : 0);
        try {
          await sql()`
            UPDATE predictions
            SET over_hit = ${calc.overHit},
                btts_hit = ${calc.bttsHit},
                accuracy_score = ${accuracyScore}
            WHERE id = ${p.id}`;
        } catch (err) {
          if (err && (err.code === '42703' || /column .* does not exist/i.test(err.message || ''))) {
            console.warn('[agent-results] accuracy_score column missing — settling without it. Run run-migration.sql.');
            await sql()`
              UPDATE predictions
              SET over_hit = ${calc.overHit}, btts_hit = ${calc.bttsHit}
              WHERE id = ${p.id}`;
          } else {
            throw err;
          }
        }
        // Live calibration update — recomputes mean_confidence /
        // actual_win_rate from the full settled set and writes the new
        // correction_factor. Per-(league, market). Best-effort; a
        // failure here (e.g. calibration table missing) doesn't block
        // the settle — updateCalibration logs and returns null on its
        // own when it can't write.
        try {
          await Promise.all([
            updateCalibration(p.league, 'over', !!calc.overHit, Number(p.over_confidence)),
            updateCalibration(p.league, 'btts', !!calc.bttsHit, Number(p.btts_confidence)),
          ]);
        } catch (e) {
          console.error(`[agent-results] calibration update failed for ${p.id}:`, e.message);
        }
        try {
          const settled = await settleEntriesForPrediction(p.id);
          if (settled.length) report.bankrollEntriesSettled += settled.length;
        } catch (e) {
          console.error(`[agent-results] bankroll settle failed for ${p.id}:`, e.message);
        }
        // Update accuracy_model incrementally — agent-accuracy at 3am does a
        // full rebuild so any drift here is normalised every 24 hours.
        try {
          await bumpAccuracy('LEAGUE', p.league, calc.overHit);
          await bumpAccuracy('MARKET', 'OVER', calc.overHit);
          await bumpAccuracy('MARKET', 'BTTS', calc.bttsHit);
          await bumpAccuracy('CONFIDENCE_BUCKET', confidenceBucket(Number(p.over_confidence)), calc.overHit);
          await bumpAccuracy('SHARP_MOVE', p.is_sharp_move ? 'YES' : 'NO', calc.overHit);
        } catch (e) {
          console.error(`[agent-results] accuracy bump failed:`, e.message);
        }
        // Dedupe RESULT_SETTLED alerts per fixture. If multiple
        // prediction rows exist for the same fixture (re-scan case),
        // emitting one alert per row would email the user N times for
        // the same match. Check agent_alerts first; only insert if
        // there isn't already a RESULT_SETTLED row for this fixture.
        try {
          const existing = await sql()`
            SELECT 1 FROM agent_alerts
            WHERE type = 'RESULT_SETTLED' AND fixture_id = ${fixtureId}
            LIMIT 1`;
          if (existing.length === 0) {
            await createAgentAlert({
              type: 'RESULT_SETTLED',
              fixtureId,
              league: p.league,
              message: `${calc.overHit ? '✓' : '✗'} ${homeName} ${calc.home}-${calc.away} ${awayName} · Over ${p.over_line} ${calc.overHit ? 'HIT' : 'MISSED'}`,
              severity: 'INFO',
              data: {
                homeTeam: homeName,
                awayTeam: awayName,
                homeGoals: calc.home,
                awayGoals: calc.away,
                overLine: p.over_line,
                overHit: calc.overHit,
                bttsCall: p.btts,
                bttsHit: calc.bttsHit,
              },
            });
            report.alertsEmitted += 1;
          }
        } catch (e) {
          console.error(`[agent-results] alert emit failed:`, e.message);
        }
      }
      report.predictionsUpdated += 1;
    }
    report.fixturesSettled += 1;
  }

  report.durationMs = Date.now() - t0;
  await markRun('results_last_run');
  await setState('results_last_report', { ...report, at: new Date().toISOString() });
  console.log('[agent-results] batch report:', JSON.stringify(report));
  return report;
}

exports.handler = async (event) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'agent-results');
    const method = event && event.httpMethod;
    if (method === 'POST' && (path === '/update' || path === '/')) {
      if (!isAuthorised(event)) return error(401, 'UNAUTHORIZED');
      const qs = (event && event.queryStringParameters) || {};
      const dryRun = qs.dry === '1' || qs.dry === 'true';
      const report = await settleBatch({ dryRun });
      return json(200, report);
    }
    if (!event || !event.httpMethod) {
      // Scheduled invocation — no auth needed, runs directly.
      const report = await settleBatch();
      return json(200, report);
    }
    return notFound();
  } catch (err) {
    console.error('agent-results handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.config = { schedule: SCHEDULE };
