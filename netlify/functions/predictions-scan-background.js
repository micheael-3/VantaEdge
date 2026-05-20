// predictions-scan-background — Netlify Background Function.
//
// Filename suffix `-background` enables Netlify's 15-minute async tier.
// The HTTP invocation returns 202 immediately; the body of this handler
// runs to completion in the background. The frontend never reads the
// response — it polls scan_status via /api/predictions/week.
//
// Trigger: internal POST from predictions.handleWeek() or admin rescan.
// Body:    { leagueId, weekStart } — weekStart is the Monday YYYY-MM-DD.
// Auth:    header x-internal-scan-secret must match JWT_SECRET (decided
//          because JWT_SECRET is always present in the env; WHOP_WEBHOOK_SECRET
//          is optional and not set in dev). Anyone who could read JWT_SECRET
//          could already forge a session, so reusing it as the internal
//          shared secret doesn't broaden the trust boundary.

const { sql } = require('./_shared/db');
const football = require('./_shared/football');
const { analyseMatch } = require('./_shared/claude');
const { calculateEV, calculateKelly } = require('./_shared/ev');
const oddsService = require('./_shared/odds');
const { LEAGUES } = require('./_shared/tier');

const MLS_LEAGUE_ID = 253;

function todayDateStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addDaysStr(baseDateStr, days) {
  const d = new Date(`${baseDateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function restDaysFromForm(formFixtures) {
  if (!Array.isArray(formFixtures) || formFixtures.length === 0) return null;
  const sorted = formFixtures.slice().sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  const lastPlayed = sorted.find((f) => new Date(f.fixture.date) < new Date());
  if (!lastPlayed) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(lastPlayed.fixture.date).getTime()) / 86400000));
}

function gpgFromStats(stats) {
  if (!stats || !stats.goals) return null;
  const f = stats.goals.for && stats.goals.for.average && stats.goals.for.average.total;
  const a = stats.goals.against && stats.goals.against.average && stats.goals.against.average.total;
  return {
    avgFor: f != null ? Number(f) : null,
    avgAgainst: a != null ? Number(a) : null,
  };
}

function isAuthorised(event) {
  const h = (event && event.headers) || {};
  const provided = h['x-internal-scan-secret'] || h['X-Internal-Scan-Secret'] || '';
  const expected = process.env.JWT_SECRET || '';
  return !!expected && provided === expected;
}

function scanIdFor(leagueId, weekStart) {
  return `league-${leagueId}-week-${weekStart}`;
}

async function upsertScanStatus(id, leagueId, weekStart, fields) {
  // Insert if missing, otherwise update changed fields. Done in one trip.
  const status = fields.status || 'scanning';
  const total = fields.total != null ? fields.total : 0;
  const done = fields.done != null ? fields.done : 0;
  const errorMsg = fields.error != null ? fields.error : null;
  await sql()`
    INSERT INTO scan_status (id, league_id, week_start, status, total, done, error, started_at, updated_at)
    VALUES (${id}, ${leagueId}, ${weekStart}, ${status}, ${total}, ${done}, ${errorMsg}, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
      SET status     = EXCLUDED.status,
          total      = EXCLUDED.total,
          done       = EXCLUDED.done,
          error      = EXCLUDED.error,
          updated_at = NOW()`;
}

async function bumpProgress(id, done) {
  await sql()`UPDATE scan_status SET done = ${done}, updated_at = NOW() WHERE id = ${id}`;
}

async function setFinalStatus(id, status, errorMsg) {
  await sql()`UPDATE scan_status SET status = ${status}, error = ${errorMsg || null}, updated_at = NOW() WHERE id = ${id}`;
}

// Fetch the 4 per-fixture detail calls in parallel.
async function fetchFixtureDetail(fx, leagueId) {
  const homeId = fx.teams.home.id;
  const awayId = fx.teams.away.id;
  const [homeLast, awayLast, homeStats, awayStats] = await Promise.all([
    football.getTeamLastHomeGames(homeId, leagueId),
    football.getTeamLastAwayGames(awayId, leagueId),
    football.getTeamStats(homeId, leagueId),
    football.getTeamStats(awayId, leagueId),
  ]);
  return {
    homeId, awayId,
    homeForm: football.extractFormForTeam(homeLast, homeId),
    awayForm: football.extractFormForTeam(awayLast, awayId),
    homeRest: restDaysFromForm(homeLast),
    awayRest: restDaysFromForm(awayLast),
    homeStats, awayStats,
    homeGpg: gpgFromStats(homeStats),
    awayGpg: gpgFromStats(awayStats),
  };
}

async function fetchFixturesForWeek(leagueId, weekStart, weekEnd) {
  // candidateSeasonsForDate returns the right season for the week. Try
  // each candidate season; first non-empty list wins.
  const seasons = football.candidateSeasonsForDate(weekStart);
  for (const season of seasons) {
    try {
      const list = await football.apiGet('/fixtures', {
        league: leagueId,
        season,
        from: weekStart,
        to: weekEnd,
      }, { tag: `weekScan league=${leagueId} ${weekStart}..${weekEnd} s${season}` });
      if (Array.isArray(list) && list.length) {
        console.log(`[scan-bg] week ${weekStart}..${weekEnd} league=${leagueId} season=${season} → ${list.length} fixtures`);
        return { fixtures: list, season };
      }
    } catch (err) {
      console.error(`[scan-bg] /fixtures from-to season=${season} failed: ${err.message}`);
    }
  }
  return { fixtures: [], season: seasons[0] || null };
}

async function insertPredictionForUserId(adminUserId, fx, league, analysis, oddsData) {
  let autoEvOver = null;
  let autoEvBtts = null;
  let kellyOverAuto = 0;
  let kellyBttsAuto = 0;
  if (oddsData && oddsData.bestOverOdds) {
    autoEvOver = calculateEV(analysis.over.confidence, oddsData.bestOverOdds);
    kellyOverAuto = calculateKelly(analysis.over.confidence, oddsData.bestOverOdds);
  }
  if (oddsData && oddsData.bestBttsOdds) {
    autoEvBtts = calculateEV(analysis.btts.confidence, oddsData.bestBttsOdds);
    kellyBttsAuto = calculateKelly(analysis.btts.confidence, oddsData.bestBttsOdds);
  }

  // Stored against the system "scan" user — when a real user requests
  // /api/predictions/week we either fan these rows out per user or read
  // shared rows. We chose: store a single shared row (user_id = NULL not
  // permitted by schema). Instead we re-use the FIRST admin user we find
  // as the "scan owner". This keeps the existing predictions schema
  // unchanged.
  await sql()`
    INSERT INTO predictions
      (user_id, league, fixture_id, home_team, away_team, kickoff,
       over_line, over_confidence, btts, btts_confidence,
       ev_edge_over, ev_edge_btts, kelly_over, kelly_btts,
       best_over_odds, best_over_bookmaker, best_btts_odds, best_btts_bookmaker,
       auto_ev_over, auto_ev_btts)
    VALUES
      (${adminUserId}, ${league.name}, ${fx.fixture.id}, ${fx.teams.home.name}, ${fx.teams.away.name},
       ${fx.fixture.date}, ${analysis.over.line}, ${Math.round(analysis.over.confidence)},
       ${analysis.btts.prediction}, ${Math.round(analysis.btts.confidence)},
       ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null},
       ${kellyOverAuto}, ${kellyBttsAuto},
       ${oddsData ? oddsData.bestOverOdds : null}, ${oddsData ? oddsData.bestOverBookmaker : null},
       ${oddsData ? oddsData.bestBttsOdds : null}, ${oddsData ? oddsData.bestBttsBookmaker : null},
       ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null})`;
}

async function pickScanOwnerUserId() {
  // Use the first admin if present; fall back to the oldest user. Predictions
  // are shared across all users in this weekly model — the user_id column
  // is just a placeholder owner.
  const rows = await sql()`SELECT id FROM users WHERE is_admin = TRUE ORDER BY created_at ASC LIMIT 1`;
  if (rows.length) return rows[0].id;
  const fb = await sql()`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`;
  return fb.length ? fb[0].id : null;
}

async function runScan(leagueId, weekStart) {
  const weekEnd = addDaysStr(weekStart, 6);
  const id = scanIdFor(leagueId, weekStart);
  const league = LEAGUES[leagueId];
  if (!league) {
    await setFinalStatus(id, 'error', `Unknown league ${leagueId}`);
    return;
  }

  await upsertScanStatus(id, leagueId, weekStart, { status: 'scanning', total: 0, done: 0, error: null });

  // 1. ONE fixtures call for the whole week.
  const { fixtures: weekFixtures } = await fetchFixturesForWeek(leagueId, weekStart, weekEnd);

  // 2. Drop fixtures that already have prediction rows for this fixture_id
  //    (idempotent re-scans skip work the previous run completed).
  const ids = weekFixtures.map((fx) => fx.fixture && fx.fixture.id).filter(Boolean);
  let existingIds = new Set();
  if (ids.length) {
    try {
      const existing = await sql()`
        SELECT DISTINCT fixture_id FROM predictions WHERE fixture_id = ANY(${ids})`;
      existingIds = new Set(existing.map((r) => Number(r.fixture_id)));
    } catch (e) {
      console.error('[scan-bg] existing lookup failed:', e.message);
    }
  }
  const todoFixtures = weekFixtures.filter((fx) => fx.fixture && !existingIds.has(Number(fx.fixture.id)));
  console.log(`[scan-bg] todo=${todoFixtures.length} of ${weekFixtures.length} (skipped ${weekFixtures.length - todoFixtures.length} already-stored)`);

  await upsertScanStatus(id, leagueId, weekStart, {
    status: 'scanning',
    total: todoFixtures.length,
    done: 0,
    error: null,
  });

  if (todoFixtures.length === 0) {
    await setFinalStatus(id, 'complete', null);
    return;
  }

  // 3. Resolve the scan-owner user_id (predictions schema requires NOT NULL).
  const ownerId = await pickScanOwnerUserId();
  if (!ownerId) {
    await setFinalStatus(id, 'error', 'No users exist to own the scan');
    return;
  }

  // 4. Optional league odds — one call, reused for every fixture.
  let leagueOdds = null;
  try {
    leagueOdds = await oddsService.getMatchOdds(leagueId);
  } catch (err) {
    console.error('[scan-bg] odds fetch failed:', err.message);
  }

  let done = 0;
  for (let i = 0; i < todoFixtures.length; i++) {
    const fx = todoFixtures[i];

    // Throttle: 1s between fixtures, skip the first to keep total time tight.
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    try {
      const detail = await fetchFixtureDetail(fx, leagueId);
      const matchData = {
        league: league.name,
        kickoff: fx.fixture.date,
        venue: (fx.fixture && fx.fixture.venue && fx.fixture.venue.city) || null,
        home: {
          id: detail.homeId,
          name: fx.teams.home.name,
          form: detail.homeForm,
          restDays: detail.homeRest,
          stats: detail.homeStats,
          goalsPerGame: detail.homeGpg,
        },
        away: {
          id: detail.awayId,
          name: fx.teams.away.name,
          form: detail.awayForm,
          restDays: detail.awayRest,
          stats: detail.awayStats,
          goalsPerGame: detail.awayGpg,
        },
      };
      const analysis = await analyseMatch(matchData, false, false);

      let oddsData = null;
      try {
        const matchedOdds = oddsService.findOddsForFixture(leagueOdds, fx);
        if (matchedOdds) oddsData = oddsService.buildOddsData(matchedOdds, analysis);
      } catch (err) {
        console.error('[scan-bg] odds match failed:', err.message);
      }

      await insertPredictionForUserId(ownerId, fx, league, analysis, oddsData);
    } catch (err) {
      console.error(`[scan-bg] fixture ${fx.fixture && fx.fixture.id} failed: ${err.message}`);
    } finally {
      done += 1;
      try {
        await bumpProgress(id, done);
      } catch (e) {
        console.error('[scan-bg] progress update failed:', e.message);
      }
    }
  }

  await setFinalStatus(id, 'complete', null);
  console.log(`[scan-bg] complete league=${leagueId} week=${weekStart}..${weekEnd} processed=${done}`);
}

exports.handler = async (event) => {
  // Netlify Background Functions return 202 immediately. We still run the
  // full body. Auth check happens here — unauthenticated calls get 401 fast.
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (!isAuthorised(event)) {
      console.warn('[scan-bg] unauthorised invocation');
      return { statusCode: 401, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
    }

    let body = {};
    try {
      body = event && event.body
        ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
        : {};
    } catch (e) {
      console.error('[scan-bg] bad body:', e.message);
    }
    const leagueId = parseInt(body.leagueId, 10) || MLS_LEAGUE_ID;
    const weekStart = typeof body.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)
      ? body.weekStart
      : null;
    if (!weekStart) {
      return { statusCode: 400, body: JSON.stringify({ error: 'weekStart required (YYYY-MM-DD)' }) };
    }

    console.log(`[scan-bg] starting league=${leagueId} weekStart=${weekStart}`);
    await runScan(leagueId, weekStart);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[scan-bg] fatal:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'fatal' }) };
  }
};

exports.runScan = runScan;
