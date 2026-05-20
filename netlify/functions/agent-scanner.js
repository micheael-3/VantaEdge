// agent-scanner — main brain of the autonomous system.
//
// Runs every 30 minutes on Netlify cron. Round-robins through 3 leagues per
// run (stays under the 10s budget) and:
//   1. takes a current odds snapshot per fixture
//   2. classifies movement vs the opening line
//   3. emits VALUE_APPEARED / SHARP_MOVE alerts
//   4. flags is_sharp_move on the latest prediction row for that fixture
//
// We deliberately do NOT re-run Claude analysis on every cycle to keep
// the function under the time budget. agent-best-bet (7am daily) and the
// user-facing /api/predictions path provide deeper analysis on demand.

const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const football = require('./_shared/football');
const oddsService = require('./_shared/odds');
const { calculateEV } = require('./_shared/ev');
const {
  LEAGUE_IDS,
  nextLeagueBatch,
  classifyMovement,
  getOpeningOdds,
  recordSnapshot,
  markRun,
  setState,
} = require('./_shared/agent');
const { createAgentAlert } = require('./_shared/alerts');

const SCHEDULE = '*/30 * * * *';
const PER_RUN_LEAGUE_BUDGET = 3;
const PER_RUN_FIXTURE_BUDGET = 12; // hard cap so one heavy league doesn't time us out

function isAuthorised(event) {
  if (!event.headers) return false;
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

function todayDateStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function processFixture(fixture, league, oddsBundle, report) {
  const fixtureId = fixture.fixture && fixture.fixture.id;
  if (!fixtureId) return;
  const homeName = fixture.teams && fixture.teams.home && fixture.teams.home.name;
  const awayName = fixture.teams && fixture.teams.away && fixture.teams.away.name;
  if (!homeName || !awayName) return;

  const matchOdds = oddsService.findOddsForFixture(oddsBundle, fixture);
  if (!matchOdds) return; // no odds for this fixture today; skip silently

  // Most recent saved prediction for the fixture (latest analysis we have).
  const pred = await sql()`
    SELECT id, over_line, over_confidence, btts, btts_confidence,
           best_over_odds, best_btts_odds, is_sharp_move
    FROM predictions
    WHERE fixture_id = ${fixtureId}
    ORDER BY created_at DESC
    LIMIT 1`;
  const latestPrediction = pred[0] || null;

  // OVER market processing
  const overLine = latestPrediction ? latestPrediction.over_line : 2.5;
  const bestOver = (() => {
    const totals = matchOdds.odds.totals || [];
    let exact = totals.filter((t) => Math.abs(t.line - overLine) < 0.01);
    if (exact.length === 0 && totals.length > 0) {
      const sorted = [...totals].sort((a, b) => Math.abs(a.line - overLine) - Math.abs(b.line - overLine));
      const closest = sorted[0].line;
      exact = totals.filter((t) => Math.abs(t.line - closest) < 0.01);
    }
    if (exact.length === 0) return null;
    let best = exact[0];
    for (const t of exact) if (t.overOdds > best.overOdds) best = t;
    return best;
  })();

  if (bestOver) {
    await recordSnapshot(fixtureId, league.name, 'OVER', bestOver.line, bestOver.overOdds, bestOver.bookmaker);
    const opening = await getOpeningOdds(fixtureId, 'OVER');
    if (opening) {
      const movementPct = ((bestOver.overOdds - Number(opening.odds)) / Number(opening.odds)) * 100;
      const windowMins = Math.round((Date.now() - new Date(opening.snapshot_at).getTime()) / 60000);
      const significance = classifyMovement(movementPct, windowMins);
      if (significance) {
        const isSharp = significance === 'SHARP';
        await sql()`
          INSERT INTO odds_movements
            (fixture_id, league, home_team, away_team, market, line, opening_odds, current_odds, movement_pct, bookmaker, significance, is_sharp_move)
          VALUES
            (${fixtureId}, ${league.name}, ${homeName}, ${awayName}, 'OVER', ${bestOver.line}, ${Number(opening.odds)}, ${bestOver.overOdds}, ${Math.round(movementPct * 10) / 10}, ${bestOver.bookmaker}, ${significance}, ${isSharp})`;
        if (isSharp) {
          report.sharpMoves += 1;
          if (latestPrediction) {
            await sql()`
              UPDATE predictions
              SET is_sharp_move = TRUE,
                  sharp_move_data = ${JSON.stringify({ market: 'OVER', movementPct, windowMins, bookmaker: bestOver.bookmaker, openingOdds: Number(opening.odds), currentOdds: bestOver.overOdds })}::jsonb
              WHERE id = ${latestPrediction.id}`;
          }
          await createAgentAlert({
            type: 'SHARP_MOVE',
            fixtureId,
            league: league.name,
            message: `⚡ Sharp money — ${homeName} vs ${awayName}: Over ${bestOver.line} odds moved ${movementPct.toFixed(1)}% in ${windowMins} mins`,
            severity: 'HIGH',
            data: { market: 'OVER', movementPct, windowMins, bookmaker: bestOver.bookmaker, line: bestOver.line, openingOdds: Number(opening.odds), currentOdds: bestOver.overOdds, homeTeam: homeName, awayTeam: awayName },
          });
        }
      }
    }

    // Cheap +EV check using the existing latest prediction's confidence.
    if (latestPrediction && Number.isFinite(Number(latestPrediction.over_confidence))) {
      const ev = calculateEV(Number(latestPrediction.over_confidence), bestOver.overOdds);
      if (ev.edge >= 8 && Number(latestPrediction.over_confidence) >= 65) {
        await createAgentAlert({
          type: 'VALUE_APPEARED',
          fixtureId,
          league: league.name,
          message: `🟢 +EV — ${homeName} vs ${awayName}: Over ${bestOver.line} @ ${bestOver.overOdds.toFixed(2)} (${ev.edge >= 0 ? '+' : ''}${ev.edge}% edge)`,
          severity: 'MEDIUM',
          data: { market: 'OVER', edge: ev.edge, valueBadge: ev.valueBadge, confidence: latestPrediction.over_confidence, odds: bestOver.overOdds, bookmaker: bestOver.bookmaker, line: bestOver.line, homeTeam: homeName, awayTeam: awayName },
        });
        report.valueAlerts += 1;
      }
    }
  }

  // BTTS market processing — lighter, just snapshot + sharp-move detection
  const bttsCall = latestPrediction && latestPrediction.btts ? latestPrediction.btts.toUpperCase() : 'YES';
  const btts = matchOdds.odds.btts || [];
  if (btts.length > 0) {
    const key = bttsCall === 'NO' ? 'noOdds' : 'yesOdds';
    let best = btts[0];
    for (const b of btts) if (b[key] > best[key]) best = b;
    const bttsOdds = best[key];
    await recordSnapshot(fixtureId, league.name, 'BTTS', null, bttsOdds, best.bookmaker);

    const opening = await getOpeningOdds(fixtureId, 'BTTS');
    if (opening) {
      const movementPct = ((bttsOdds - Number(opening.odds)) / Number(opening.odds)) * 100;
      const windowMins = Math.round((Date.now() - new Date(opening.snapshot_at).getTime()) / 60000);
      const significance = classifyMovement(movementPct, windowMins);
      if (significance === 'SHARP') {
        await sql()`
          INSERT INTO odds_movements
            (fixture_id, league, home_team, away_team, market, opening_odds, current_odds, movement_pct, bookmaker, significance, is_sharp_move)
          VALUES
            (${fixtureId}, ${league.name}, ${homeName}, ${awayName}, 'BTTS', ${Number(opening.odds)}, ${bttsOdds}, ${Math.round(movementPct * 10) / 10}, ${best.bookmaker}, ${significance}, TRUE)`;
        report.sharpMoves += 1;
        if (latestPrediction) {
          await sql()`UPDATE predictions SET is_sharp_move = TRUE WHERE id = ${latestPrediction.id}`;
        }
        await createAgentAlert({
          type: 'SHARP_MOVE',
          fixtureId,
          league: league.name,
          message: `⚡ Sharp money — ${homeName} vs ${awayName}: BTTS ${bttsCall} moved ${movementPct.toFixed(1)}% in ${windowMins} mins`,
          severity: 'HIGH',
          data: { market: 'BTTS', side: bttsCall, movementPct, windowMins, bookmaker: best.bookmaker, openingOdds: Number(opening.odds), currentOdds: bttsOdds, homeTeam: homeName, awayTeam: awayName },
        });
      }
    }
  }
}

async function runScan({ leaguesArg } = {}) {
  const report = {
    leaguesProcessed: 0,
    fixturesScanned: 0,
    snapshotsTaken: 0,
    sharpMoves: 0,
    valueAlerts: 0,
    errors: 0,
    durationMs: 0,
  };
  const t0 = Date.now();

  // Either an explicit list (manual trigger) or the next round-robin batch.
  let batch;
  if (Array.isArray(leaguesArg) && leaguesArg.length) batch = leaguesArg;
  else ({ batch } = await nextLeagueBatch(PER_RUN_LEAGUE_BUDGET));

  const today = todayDateStr();

  outer: for (const leagueId of batch) {
    const league = require('./_shared/tier').LEAGUES[leagueId];
    if (!league) continue;
    report.leaguesProcessed += 1;

    // Fetch today + tomorrow concurrently (cheap thanks to cache).
    let allFixtures = [];
    try {
      const [todayFx, tomorrowFx] = await Promise.all([
        football.getFixturesByDate(leagueId, today, 300),
        football.getFixturesByDate(leagueId, addDay(today, 1), 3600),
      ]);
      allFixtures = [...(todayFx || []), ...(tomorrowFx || [])];
    } catch (e) {
      report.errors += 1;
      console.error(`[agent-scanner] fixture fetch failed for ${leagueId}:`, e.message);
      continue;
    }
    if (allFixtures.length === 0) continue;

    let oddsBundle = null;
    try {
      oddsBundle = await oddsService.getMatchOdds(leagueId);
    } catch (e) {
      report.errors += 1;
      console.error(`[agent-scanner] odds fetch failed for ${leagueId}:`, e.message);
      continue;
    }
    if (!oddsBundle || oddsBundle.disabled || oddsBundle.quotaExhausted) continue;

    for (const fx of allFixtures) {
      if (report.fixturesScanned >= PER_RUN_FIXTURE_BUDGET) break outer;
      try {
        await processFixture(fx, league, oddsBundle, report);
        report.fixturesScanned += 1;
        report.snapshotsTaken += 1;
      } catch (e) {
        report.errors += 1;
        console.error(`[agent-scanner] fixture ${fx.fixture && fx.fixture.id} failed:`, e.message);
      }
    }
  }

  report.durationMs = Date.now() - t0;
  await markRun('scanner_last_run');
  await setState('scanner_last_report', { ...report, at: new Date().toISOString() });
  console.log('[agent-scanner] report:', JSON.stringify(report));
  return report;
}

function addDay(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

exports.handler = async (event) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event && event.httpMethod && event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
      // Scheduled invocations may not include httpMethod.
      return error(405, 'Method not allowed');
    }
    if (event && event.headers && !isAuthorised(event)) {
      // Manual / admin triggers must auth; scheduled is auto-allowed above.
      return error(401, 'UNAUTHORIZED');
    }
    const qs = (event && event.queryStringParameters) || {};
    const leagues = qs.leagues
      ? qs.leagues.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean)
      : null;
    const report = await runScan({ leaguesArg: leagues });
    return event ? json(200, report) : report;
  } catch (err) {
    console.error('agent-scanner handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.runScan = runScan;
exports.config = { schedule: SCHEDULE };
