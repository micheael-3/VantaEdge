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
const { cyprusDateStr, addDaysStr } = require('./_shared/dates');

const MLS_LEAGUE_ID = 253;

// Server-side "today" used to be UTC. For a cron that exists to serve
// Cyprus users, we anchor today in Asia/Nicosia so any "starts today"
// math lines up with the dashboard's date strip.
function todayDateStr() {
  return cyprusDateStr(new Date());
}

function restDaysFromForm(formFixtures) {
  if (!Array.isArray(formFixtures) || formFixtures.length === 0) return null;
  const sorted = formFixtures.slice().sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  const lastPlayed = sorted.find((f) => new Date(f.fixture.date) < new Date());
  if (!lastPlayed) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(lastPlayed.fixture.date).getTime()) / 86400000));
}

// Pull goals-per-game from API-Football's /teams/statistics shape.
// We KEEP null when data is missing — saving 0 instead would silently
// tell the model "this team scores zero on average", which would shift
// every prediction Under and poison the calibration buckets. The
// scan's validation step downstream lets us mark these rows with a
// statsConfidence flag instead of pretending the data is complete.
function gpgFromStats(stats, teamLabel) {
  if (!stats || !stats.goals) {
    console.log(`[scan-bg gpg] ${teamLabel || ''} stats=null/missing — returning null GPG`);
    return null;
  }
  const fAvg = stats.goals.for && stats.goals.for.average;
  const aAvg = stats.goals.against && stats.goals.against.average;
  const f = fAvg && fAvg.total;
  const a = aAvg && aAvg.total;
  console.log(
    `[scan-bg gpg] ${teamLabel || ''} raw goals.for.average=${JSON.stringify(fAvg)} ` +
      `goals.against.average=${JSON.stringify(aAvg)} -> for=${f} against=${a}`,
  );
  return {
    avgFor: f != null && f !== '' ? Number(f) : null,
    avgAgainst: a != null && a !== '' ? Number(a) : null,
  };
}

// Classify how confident we are in the row we're about to write.
//   'full'    — names+kickoff+stats+form (>=3 each side) all present
//   'partial' — names+kickoff present, but stats or form is thin
//   'invalid' — names or kickoff missing → reject, do not insert
// Surfaced into match_data so the UI and the calibration engine can
// downweight or hide low-confidence rows.
function classifyMatchData(matchData, fx) {
  const issues = [];
  if (!matchData.home || !matchData.home.name) issues.push('home_name_missing');
  if (!matchData.away || !matchData.away.name) issues.push('away_name_missing');
  // Kickoff sanity — must be a parseable date within the next 14 days
  // (scan only ever fetches a 7-day window, the extra week is slack).
  const k = matchData.kickoff ? new Date(matchData.kickoff) : null;
  if (!k || Number.isNaN(k.getTime())) {
    issues.push('kickoff_unparseable');
  } else {
    const ageDays = (k.getTime() - Date.now()) / 86400000;
    if (ageDays < -1 || ageDays > 14) issues.push(`kickoff_out_of_window(${ageDays.toFixed(1)}d)`);
  }
  const fatal = issues.length > 0;

  // Soft signals — they don't block the insert, just lower confidence.
  const soft = [];
  const homeGpg = matchData.home && matchData.home.goalsPerGame;
  const awayGpg = matchData.away && matchData.away.goalsPerGame;
  const statsMissing =
    !homeGpg || homeGpg.avgFor == null || homeGpg.avgAgainst == null ||
    !awayGpg || awayGpg.avgFor == null || awayGpg.avgAgainst == null;
  if (statsMissing) soft.push('stats_partial');
  const homeForm = (matchData.home && matchData.home.form) || [];
  const awayForm = (matchData.away && matchData.away.form) || [];
  if (homeForm.length < 3 || awayForm.length < 3) soft.push('form_thin');

  let confidence;
  if (fatal) confidence = 'invalid';
  else if (soft.length === 0) confidence = 'full';
  else confidence = 'partial';

  if (fatal || soft.length) {
    console.log(
      `[scan-bg validate] fixture=${fx && fx.fixture && fx.fixture.id} ` +
        `${matchData.home && matchData.home.name} vs ${matchData.away && matchData.away.name} ` +
        `confidence=${confidence} issues=${[...issues, ...soft].join(',')}`,
    );
  }
  return { confidence, issues: [...issues, ...soft] };
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

// Scan-status writes are best-effort. If the scan_status table doesn't
// exist yet (migration not run), the scan still completes and writes to
// the predictions table — we just lose progress tracking for that run.
function isMissingTableErr(err) {
  return err && (err.code === '42P01' || /relation "?scan_status"? does not exist/i.test(err.message || ''));
}

async function upsertScanStatus(id, leagueId, weekStart, fields) {
  const status = fields.status || 'scanning';
  const total = fields.total != null ? fields.total : 0;
  const done = fields.done != null ? fields.done : 0;
  const errorMsg = fields.error != null ? fields.error : null;
  try {
    await sql()`
      INSERT INTO scan_status (id, league_id, week_start, status, total, done, error, started_at, updated_at)
      VALUES (${id}, ${leagueId}, ${weekStart}, ${status}, ${total}, ${done}, ${errorMsg}, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
        SET status     = EXCLUDED.status,
            total      = EXCLUDED.total,
            done       = EXCLUDED.done,
            error      = EXCLUDED.error,
            updated_at = NOW()`;
  } catch (err) {
    if (isMissingTableErr(err)) {
      console.warn('[scan-bg] scan_status table missing — progress tracking disabled for this run.');
      return;
    }
    throw err;
  }
}

async function bumpProgress(id, done) {
  try {
    await sql()`UPDATE scan_status SET done = ${done}, updated_at = NOW() WHERE id = ${id}`;
  } catch (err) {
    if (isMissingTableErr(err)) return;
    throw err;
  }
}

async function setFinalStatus(id, status, errorMsg) {
  try {
    await sql()`UPDATE scan_status SET status = ${status}, error = ${errorMsg || null}, updated_at = NOW() WHERE id = ${id}`;
  } catch (err) {
    if (isMissingTableErr(err)) return;
    throw err;
  }
}

// Fetch the 4 per-fixture detail calls in parallel.
// Compute average goals per match across the last-5 H2H meetings.
// Returns a display string like "3.2 G/M" or null if no data.
function h2hAverageString(h2hList) {
  if (!Array.isArray(h2hList) || h2hList.length === 0) return null;
  let totalGoals = 0;
  let counted = 0;
  for (const g of h2hList) {
    const home = g && g.goals && g.goals.home;
    const away = g && g.goals && g.goals.away;
    if (home == null || away == null) continue;
    totalGoals += Number(home) + Number(away);
    counted += 1;
  }
  if (counted === 0) return null;
  const avg = totalGoals / counted;
  return `${avg.toFixed(1)} G/M`;
}

async function fetchFixtureDetail(fx, leagueId, season) {
  const homeId = fx.teams.home.id;
  const awayId = fx.teams.away.id;
  // Referee name comes from the fixture envelope when API-Football has
  // appointed one. Often empty until ~48h before kickoff, in which case
  // we leave the field null and the UI surfaces "Unknown". When present,
  // we layer the per-ref goals/game tendency so the stats grid can show
  // a real "This referee averages 2.8 goals per game" line.
  const refName = fx && fx.fixture && typeof fx.fixture.referee === 'string'
    ? fx.fixture.referee.trim() || null
    : null;
  // 5 parallel calls per fixture: last home, last away, both team stats,
  // plus H2H. The H2H call lets the dashboard render a real "H2H 3.2 G/M"
  // figure instead of an em-dash. Season is threaded in explicitly so
  // last-N games are pulled from the SAME season as the upcoming fixture
  // — without it the env-default SEASON would silently pull the previous
  // season's games and break rest-days (last played would be months ago).
  const [homeLast, awayLast, homeStats, awayStats, h2hList, refStats] = await Promise.all([
    football.getTeamLastHomeGames(homeId, leagueId, season),
    football.getTeamLastAwayGames(awayId, leagueId, season),
    // Same-season aggregates: scored/conceded averages, BTTS rate, etc.
    // Without this the card would read last year's numbers.
    football.getTeamStats(homeId, leagueId, season),
    football.getTeamStats(awayId, leagueId, season),
    football.getH2H(homeId, awayId),
    refName ? football.getRefereeStats(refName) : Promise.resolve(null),
  ]);
  return {
    homeId, awayId,
    homeForm: football.extractFormForTeam(homeLast, homeId),
    awayForm: football.extractFormForTeam(awayLast, awayId),
    homeRest: restDaysFromForm(homeLast),
    awayRest: restDaysFromForm(awayLast),
    homeStats, awayStats,
    homeGpg: gpgFromStats(homeStats, `home(${fx.teams.home.name})`),
    awayGpg: gpgFromStats(awayStats, `away(${fx.teams.away.name})`),
    h2h: h2hAverageString(h2hList),
    referee: refName
      ? {
          name: refName,
          avgGoalsPerGame: refStats && typeof refStats.avgGoalsPerGame === 'number'
            ? refStats.avgGoalsPerGame
            : null,
        }
      : null,
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

async function insertPredictionForUserId(adminUserId, fx, league, analysis, oddsData, matchData) {
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

  // match_data JSON carries everything the UI needs that isn't already
  // a top-level column: home/away form arrays, rest days, goals-per-game,
  // and the AI reasoning strings (so /week can render them without
  // re-running Claude).
  const mdPayload = matchData
    ? {
        home: matchData.home || null,
        away: matchData.away || null,
        venue: matchData.venue || null,
        h2h: matchData.h2h || null,
        // Persist the referee block alongside the rest of match_data so
        // /api/predictions/week can rehydrate it for the stats grid
        // without re-fetching. Null when no ref was assigned at scan time.
        referee: matchData.referee || null,
        // Data-quality flags from classifyMatchData. 'full' is the
        // good case; 'partial' means we shipped despite thin form or
        // missing stats — UI can downweight these visually. 'invalid'
        // rows are filtered upstream and never reach insert.
        dataConfidence: matchData.dataConfidence || null,
        dataIssues: matchData.dataIssues && matchData.dataIssues.length ? matchData.dataIssues : null,
        reasoning: {
          over: (analysis.over && analysis.over.reasoning) || null,
          btts: (analysis.btts && analysis.btts.reasoning) || null,
        },
        aiStatus: analysis.aiStatus || 'ok',
        aiReason: analysis.aiReason || null,
      }
    : null;

  // Stored against the system "scan" user — when a real user requests
  // /api/predictions/week we read these shared rows by league + kickoff
  // window (no user_id filter).
  await sql()`
    INSERT INTO predictions
      (user_id, league, fixture_id, home_team, away_team, kickoff,
       over_line, over_confidence, btts, btts_confidence,
       ev_edge_over, ev_edge_btts, kelly_over, kelly_btts,
       best_over_odds, best_over_bookmaker, best_btts_odds, best_btts_bookmaker,
       auto_ev_over, auto_ev_btts, match_data)
    VALUES
      (${adminUserId}, ${league.name}, ${fx.fixture.id}, ${fx.teams.home.name}, ${fx.teams.away.name},
       ${fx.fixture.date}, ${analysis.over.line}, ${Math.round(analysis.over.confidence)},
       ${analysis.btts.prediction}, ${Math.round(analysis.btts.confidence)},
       ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null},
       ${kellyOverAuto}, ${kellyBttsAuto},
       ${oddsData ? oddsData.bestOverOdds : null}, ${oddsData ? oddsData.bestOverBookmaker : null},
       ${oddsData ? oddsData.bestBttsOdds : null}, ${oddsData ? oddsData.bestBttsBookmaker : null},
       ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null},
       ${mdPayload ? JSON.stringify(mdPayload) : null}::jsonb)`;
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

  // 1. ONE fixtures call for the whole week. We capture the detected
  //    season too — it's threaded down to fetchFixtureDetail so the
  //    last-N team games come from the SAME season as the fixtures we
  //    just resolved (rest-days correctness).
  const { fixtures: weekFixtures, season: detectedSeason } = await fetchFixturesForWeek(leagueId, weekStart, weekEnd);

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
      const detail = await fetchFixtureDetail(fx, leagueId, detectedSeason);
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
        h2h: detail.h2h, // average goals-per-match string, e.g. "3.2 G/M"
        // Referee + per-ref goals tendency. Null when API-Football hasn't
        // assigned a ref yet (typical until ~48h before kickoff) — the UI
        // surfaces "Not announced" with a soft note instead of an em-dash.
        referee: detail.referee || null,
      };
      // Validate BEFORE calling Claude — burning tokens on a row we're
      // going to throw away is wasteful, and a hard validation failure
      // (missing team name / unparseable kickoff) means the upstream
      // fetch returned garbage. Skip and move on.
      const validation = classifyMatchData(matchData, fx);
      if (validation.confidence === 'invalid') {
        console.error(
          `[scan-bg] SKIPPING fixture=${fx.fixture && fx.fixture.id} — invalid: ${validation.issues.join(',')}`,
        );
        continue;
      }
      matchData.dataConfidence = validation.confidence;
      matchData.dataIssues = validation.issues;
      const analysis = await analyseMatch(matchData, false, false);

      let oddsData = null;
      try {
        const matchedOdds = oddsService.findOddsForFixture(leagueOdds, fx);
        if (matchedOdds) oddsData = oddsService.buildOddsData(matchedOdds, analysis);
      } catch (err) {
        console.error('[scan-bg] odds match failed:', err.message);
      }

      await insertPredictionForUserId(ownerId, fx, league, analysis, oddsData, matchData);
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
