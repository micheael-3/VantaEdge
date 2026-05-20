// agent-odds-monitor — fast 10-minute loop, today-only.
//
// Lighter than the scanner: only looks at fixtures kicking off in the next
// 12 hours and only fires when there's a sharp swing vs the snapshot from
// ~10 minutes ago. Doesn't touch the predictions table — it just snapshots
// and alerts. Heavy re-analysis happens in agent-scanner / agent-best-bet.

const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');
const football = require('./_shared/football');
const oddsService = require('./_shared/odds');
const {
  LEAGUE_IDS,
  classifyMovement,
  getRecentSnapshot,
  recordSnapshot,
  markRun,
  setState,
} = require('./_shared/agent');
const { createAgentAlert } = require('./_shared/alerts');

const SCHEDULE = '*/10 * * * *';
const PER_RUN_FIXTURE_BUDGET = 16;

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

function todayDateStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isImminent(kickoffIso) {
  if (!kickoffIso) return false;
  const t = new Date(kickoffIso).getTime();
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return t > now - 30 * 60 * 1000 && t < now + 12 * 60 * 60 * 1000;
}

async function checkFixture(fx, league, oddsBundle, report) {
  const fixtureId = fx.fixture && fx.fixture.id;
  if (!fixtureId) return;
  const homeName = fx.teams.home.name;
  const awayName = fx.teams.away.name;
  const matchOdds = oddsService.findOddsForFixture(oddsBundle, fx);
  if (!matchOdds) return;

  // OVER
  const totals = matchOdds.odds.totals || [];
  if (totals.length > 0) {
    let best = totals[0];
    for (const t of totals) if (t.overOdds > best.overOdds) best = t;
    await recordSnapshot(fixtureId, league.name, 'OVER', best.line, best.overOdds, best.bookmaker);
    report.snapshots += 1;
    const recent = await getRecentSnapshot(fixtureId, 'OVER', 12);
    if (recent && recent.snapshot_at && Number(recent.odds) > 0) {
      // recent is the one we just inserted if no older one exists, so skip if too close.
      const ageMin = (Date.now() - new Date(recent.snapshot_at).getTime()) / 60000;
      if (ageMin >= 1) {
        const movementPct = ((best.overOdds - Number(recent.odds)) / Number(recent.odds)) * 100;
        const significance = classifyMovement(movementPct, ageMin);
        if (significance === 'SHARP') {
          await sql()`
            INSERT INTO odds_movements
              (fixture_id, league, home_team, away_team, market, line, opening_odds, current_odds, movement_pct, bookmaker, significance, is_sharp_move)
            VALUES
              (${fixtureId}, ${league.name}, ${homeName}, ${awayName}, 'OVER', ${best.line}, ${Number(recent.odds)}, ${best.overOdds}, ${Math.round(movementPct * 10) / 10}, ${best.bookmaker}, 'SHARP', TRUE)`;
          await sql()`UPDATE predictions SET is_sharp_move = TRUE WHERE fixture_id = ${fixtureId}`;
          await createAgentAlert({
            type: 'SHARP_MOVE',
            fixtureId,
            league: league.name,
            message: `⚡ Sharp money — ${homeName} vs ${awayName}: Over ${best.line} moved ${movementPct.toFixed(1)}% in ${Math.round(ageMin)} mins`,
            severity: 'HIGH',
            data: { market: 'OVER', movementPct, windowMins: Math.round(ageMin), bookmaker: best.bookmaker, line: best.line, openingOdds: Number(recent.odds), currentOdds: best.overOdds, homeTeam: homeName, awayTeam: awayName },
          });
          report.sharpMoves += 1;
        }
      }
    }
  }
}

async function runMonitor() {
  const report = { fixturesChecked: 0, snapshots: 0, sharpMoves: 0, errors: 0, durationMs: 0 };
  const t0 = Date.now();
  const today = todayDateStr();

  outer: for (const leagueId of LEAGUE_IDS) {
    const league = require('./_shared/tier').LEAGUES[leagueId];
    if (!league) continue;

    let fixtures = [];
    try {
      fixtures = await football.getFixturesByDate(leagueId, today, 300);
    } catch (e) {
      report.errors += 1;
      continue;
    }
    if (!fixtures || fixtures.length === 0) continue;

    const imminent = fixtures.filter((f) => isImminent(f.fixture && f.fixture.date));
    if (imminent.length === 0) continue;

    let oddsBundle = null;
    try {
      oddsBundle = await oddsService.getMatchOdds(leagueId);
    } catch (e) {
      report.errors += 1;
      continue;
    }
    if (!oddsBundle || oddsBundle.disabled || oddsBundle.quotaExhausted) continue;

    for (const fx of imminent) {
      if (report.fixturesChecked >= PER_RUN_FIXTURE_BUDGET) break outer;
      try {
        await checkFixture(fx, league, oddsBundle, report);
        report.fixturesChecked += 1;
      } catch (e) {
        report.errors += 1;
        console.error(`[agent-odds-monitor] fixture ${fx.fixture && fx.fixture.id} failed:`, e.message);
      }
    }
  }

  report.durationMs = Date.now() - t0;
  await markRun('odds_monitor_last_run');
  await setState('odds_monitor_last_report', { ...report, at: new Date().toISOString() });
  console.log('[agent-odds-monitor] report:', JSON.stringify(report));
  return report;
}

exports.handler = async (event) => {
  try {
    if (event && event.headers && !isAuthorised(event)) {
      return error(401, 'UNAUTHORIZED');
    }
    const report = await runMonitor();
    return event ? json(200, report) : report;
  } catch (err) {
    console.error('agent-odds-monitor handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.runMonitor = runMonitor;
exports.config = { schedule: SCHEDULE };
