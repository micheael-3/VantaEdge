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
const { analyseMatch, ClaudeAnalysisError } = require('./_shared/claude');
const { calculateEV, calculateKelly } = require('./_shared/ev');
const oddsService = require('./_shared/odds');
const { LEAGUES } = require('./_shared/tier');
const { cyprusDateStr, addDaysStr } = require('./_shared/dates');

// MIN_DATA_QUALITY env knob. Two modes:
//   'partial' (default) — full + partial rows are saved; invalid rows
//     hard-skip. Partial rows carry dataConfidence: 'partial' + dataIssues.
//   'full' — only fully-validated rows are saved. Partial rows are
//     skipped. Use this if you want to be aggressive about hiding any
//     thin-data picks; the cost is empty dashboards at season start or
//     for promoted/cup teams.
function minDataQuality() {
  const raw = (process.env.MIN_DATA_QUALITY || 'partial').toLowerCase();
  return raw === 'full' ? 'full' : 'partial';
}

const MLS_LEAGUE_ID = 253;

// Server-side "today" used to be UTC. For a cron that exists to serve
// Cyprus users, we anchor today in Asia/Nicosia so any "starts today"
// math lines up with the dashboard's date strip.
function todayDateStr() {
  return cyprusDateStr(new Date());
}

// Rest days based on the team's last games AT ANY VENUE. Previously
// this received a home-only or away-only fixtures array, so a team
// that played away 2 days ago and is hosting tomorrow would show
// ~14 days rest (the gap to their previous home match). Now we pass
// in the any-venue array so the calculation reflects reality.
function restDaysFromAnyVenue(anyVenueFixtures) {
  if (!Array.isArray(anyVenueFixtures) || anyVenueFixtures.length === 0) return null;
  // Only count finished matches as "rest" anchor — a postponed fixture
  // shouldn't count as "last played".
  const FINISHED = new Set(['FT', 'AET', 'PEN']);
  const finished = anyVenueFixtures.filter(
    (f) => f && f.fixture && FINISHED.has(f.fixture.status && f.fixture.status.short),
  );
  if (finished.length === 0) return null;
  const sorted = finished.slice().sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  const lastPlayed = sorted.find((f) => new Date(f.fixture.date) < new Date());
  if (!lastPlayed) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(lastPlayed.fixture.date).getTime()) / 86400000));
}

// Extract last-5 actual scorelines (oldest → newest) for the prompt.
// Sending real "2-1, 3-0, 1-1, 2-2, 0-1" gives Sonnet variance signal
// the W/D/L dots can't convey. Only finished matches.
function lastFiveScores(fixtures, teamId) {
  if (!Array.isArray(fixtures)) return [];
  const FINISHED = new Set(['FT', 'AET', 'PEN']);
  return fixtures
    .filter((f) => f && f.fixture && f.teams && f.goals && FINISHED.has(f.fixture.status && f.fixture.status.short))
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
    .slice(-5)
    .map((f) => {
      // Always orient as "us-them" regardless of home/away.
      const isHome = f.teams.home && f.teams.home.id === teamId;
      const my = isHome ? f.goals.home : f.goals.away;
      const their = isHome ? f.goals.away : f.goals.home;
      return `${my}-${their}`;
    });
}

// Pull goals-per-game from API-Football's /teams/statistics shape.
// We KEEP null when data is missing — saving 0 instead would silently
// tell the model "this team scores zero on average", which would shift
// every prediction Under and poison the calibration buckets. The
// scan's validation step downstream lets us mark these rows with a
// statsConfidence flag instead of pretending the data is complete.
// Pull goals-per-game from API-Football's /teams/statistics shape,
// keeping the per-venue splits (.home / .away) as well as .total.
// Home/away splits are more predictive than overall averages — we
// were throwing them away before. Still returns null (not 0) on
// missing data; the validation layer downstream flags it as partial.
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function gpgFromStats(stats, teamLabel) {
  if (!stats || !stats.goals) {
    console.log(`[scan-bg gpg] ${teamLabel || ''} stats=null/missing — returning null GPG`);
    return null;
  }
  const fAvg = (stats.goals.for && stats.goals.for.average) || {};
  const aAvg = (stats.goals.against && stats.goals.against.average) || {};
  console.log(
    `[scan-bg gpg] ${teamLabel || ''} raw goals.for.average=${JSON.stringify(fAvg)} ` +
      `goals.against.average=${JSON.stringify(aAvg)}`,
  );
  return {
    // Overall season averages.
    avgFor: num(fAvg.total),
    avgAgainst: num(aAvg.total),
    // Per-venue. avgForHome = goals scored when playing at home.
    // avgForAway = goals scored when playing away.
    avgForHome: num(fAvg.home),
    avgForAway: num(fAvg.away),
    avgAgainstHome: num(aAvg.home),
    avgAgainstAway: num(aAvg.away),
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

// Extract last-5 H2H actual scorelines (oldest → newest) from the
// home team's perspective. "3-2" means home won 3-2 in that meeting.
function h2hLastFiveScores(h2hList, homeId) {
  if (!Array.isArray(h2hList)) return [];
  const FINISHED = new Set(['FT', 'AET', 'PEN']);
  return h2hList
    .filter((f) => f && f.fixture && f.goals && FINISHED.has(f.fixture.status && f.fixture.status.short))
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
    .slice(-5)
    .map((f) => {
      const isHomeAtHome = f.teams && f.teams.home && f.teams.home.id === homeId;
      const homeG = isHomeAtHome ? f.goals.home : f.goals.away;
      const awayG = isHomeAtHome ? f.goals.away : f.goals.home;
      return `${homeG}-${awayG}`;
    });
}

async function fetchFixtureDetail(fx, leagueId, season, standings) {
  const homeId = fx.teams.home.id;
  const awayId = fx.teams.away.id;
  // Referee name comes from the fixture envelope when API-Football has
  // appointed one. Often empty until ~48h before kickoff, in which case
  // we leave the field null and the UI surfaces "Not announced".
  const refName = fx && fx.fixture && typeof fx.fixture.referee === 'string'
    ? fx.fixture.referee.trim() || null
    : null;
  // Parallel fetch: last home, last away, both team stats, H2H, ref,
  // PLUS any-venue last-N for rest-days correctness. The any-venue
  // call hits the same upstream cache key as getTeamStats's caller
  // since we pass last=10 — so it's effectively free after the first
  // hit. Season is threaded into every per-team helper so the data
  // aligns with the upcoming fixture's season, not the env default.
  const [homeLast, awayLast, homeAnyVenue, awayAnyVenue, homeStats, awayStats, h2hList, refStats] = await Promise.all([
    football.getTeamLastHomeGames(homeId, leagueId, season),
    football.getTeamLastAwayGames(awayId, leagueId, season),
    football.getTeamLastGamesAnyVenue(homeId, leagueId, season),
    football.getTeamLastGamesAnyVenue(awayId, leagueId, season),
    football.getTeamStats(homeId, leagueId, season),
    football.getTeamStats(awayId, leagueId, season),
    football.getH2H(homeId, awayId),
    refName ? football.getRefereeStats(refName) : Promise.resolve(null),
  ]);

  const homeStanding = football.pickStandingForTeam(standings, homeId);
  const awayStanding = football.pickStandingForTeam(standings, awayId);

  return {
    homeId, awayId,
    homeForm: football.extractFormForTeam(homeLast, homeId),
    awayForm: football.extractFormForTeam(awayLast, awayId),
    // Rest days from ANY-VENUE games — the real fix to the "7 days rest
    // when they played 2 days ago at the other ground" bug.
    homeRest: restDaysFromAnyVenue(homeAnyVenue),
    awayRest: restDaysFromAnyVenue(awayAnyVenue),
    homeStats, awayStats,
    homeGpg: gpgFromStats(homeStats, `home(${fx.teams.home.name})`),
    awayGpg: gpgFromStats(awayStats, `away(${fx.teams.away.name})`),
    h2h: h2hAverageString(h2hList),
    h2hScores: h2hLastFiveScores(h2hList, homeId),
    // Last-5 actual scorelines per team, home/away splits.
    homeLastFiveHomeScores: lastFiveScores(homeLast, homeId),
    awayLastFiveAwayScores: lastFiveScores(awayLast, awayId),
    homeStanding, awayStanding,
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

  // 5. League standings — ONE call, reused for every fixture in this
  //    scan. Adds position / record / season points to each side's
  //    matchData so Sonnet can factor "2nd vs 12th" mismatches.
  let standings = null;
  try {
    standings = await football.getLeagueStandings(leagueId, detectedSeason);
    if (standings && standings.byTeamId) {
      console.log(`[scan-bg] standings loaded — ${standings.byTeamId.size} teams in table (season ${standings.season})`);
    } else {
      console.log('[scan-bg] standings unavailable for this league/season — predictions will run without position context');
    }
  } catch (err) {
    console.error('[scan-bg] standings fetch failed:', err.message);
  }

  const strictMode = minDataQuality() === 'full';
  let done = 0;
  let skippedPartial = 0;
  let skippedClaude = 0;
  for (let i = 0; i < todoFixtures.length; i++) {
    const fx = todoFixtures[i];

    // Throttle: 1s between fixtures, skip the first to keep total time tight.
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    try {
      const detail = await fetchFixtureDetail(fx, leagueId, detectedSeason, standings);

      const homeGpg = detail.homeGpg || {};
      const awayGpg = detail.awayGpg || {};

      // Clean payload Sonnet 4.5 sees. This matches the shape referenced
      // by the new system prompt: home/away splits, last-5 scorelines,
      // league position, season record. Nothing else — no legacy fields,
      // no internal IDs, no raw API objects.
      const claudePayload = {
        match: `${fx.teams.home.name} vs ${fx.teams.away.name}`,
        league: league.name,
        kickoff: fx.fixture.date,
        homeTeam: {
          name: fx.teams.home.name,
          form: detail.homeForm,
          avgScoredHome: homeGpg.avgForHome,
          avgScoredTotal: homeGpg.avgFor,
          avgConcededHome: homeGpg.avgAgainstHome,
          avgConcededTotal: homeGpg.avgAgainst,
          lastFiveHomeScores: detail.homeLastFiveHomeScores,
          leaguePosition: detail.homeStanding && detail.homeStanding.position,
          seasonRecord: detail.homeStanding && detail.homeStanding.record,
          seasonPoints: detail.homeStanding && detail.homeStanding.points,
          seasonGoalsFor: detail.homeStanding && detail.homeStanding.goalsFor,
          seasonGoalsAgainst: detail.homeStanding && detail.homeStanding.goalsAgainst,
        },
        awayTeam: {
          name: fx.teams.away.name,
          form: detail.awayForm,
          avgScoredAway: awayGpg.avgForAway,
          avgScoredTotal: awayGpg.avgFor,
          avgConcededAway: awayGpg.avgAgainstAway,
          avgConcededTotal: awayGpg.avgAgainst,
          lastFiveAwayScores: detail.awayLastFiveAwayScores,
          leaguePosition: detail.awayStanding && detail.awayStanding.position,
          seasonRecord: detail.awayStanding && detail.awayStanding.record,
          seasonPoints: detail.awayStanding && detail.awayStanding.points,
          seasonGoalsFor: detail.awayStanding && detail.awayStanding.goalsFor,
          seasonGoalsAgainst: detail.awayStanding && detail.awayStanding.goalsAgainst,
        },
        h2h: {
          avgGoalsPerGame: detail.h2h,
          lastFiveResults: detail.h2hScores,
        },
        referee: detail.referee || null,
        restDays: {
          home: detail.homeRest,
          away: detail.awayRest,
        },
      };

      // Storage shape — what we persist to match_data JSONB so the
      // dashboard's shapeForFrontend (in predictions.js) can rehydrate
      // every field it needs without re-querying API-Football. Keeps
      // the legacy home/away shape the existing shaper reads, AND
      // tacks on the new homeTeam/awayTeam blocks so we can surface
      // standings/scorelines in the UI later without another scan.
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
          lastFiveScores: detail.homeLastFiveHomeScores,
          standing: detail.homeStanding,
        },
        away: {
          id: detail.awayId,
          name: fx.teams.away.name,
          form: detail.awayForm,
          restDays: detail.awayRest,
          stats: detail.awayStats,
          goalsPerGame: detail.awayGpg,
          lastFiveScores: detail.awayLastFiveAwayScores,
          standing: detail.awayStanding,
        },
        h2h: detail.h2h,
        h2hScores: detail.h2hScores,
        referee: detail.referee || null,
      };

      // Validate BEFORE calling Claude. invalid → hard skip. partial →
      // also skip in strict mode (MIN_DATA_QUALITY=full); otherwise
      // save with flag.
      const validation = classifyMatchData(matchData, fx);
      if (validation.confidence === 'invalid') {
        console.error(
          `[scan-bg] SKIPPING fixture=${fx.fixture && fx.fixture.id} — invalid: ${validation.issues.join(',')}`,
        );
        continue;
      }
      if (strictMode && validation.confidence !== 'full') {
        console.warn(
          `[scan-bg] STRICT MODE: skipping ${fx.fixture && fx.fixture.id} — confidence=${validation.confidence} issues=${validation.issues.join(',')}`,
        );
        skippedPartial += 1;
        continue;
      }
      matchData.dataConfidence = validation.confidence;
      matchData.dataIssues = validation.issues;

      // Claude call. A ClaudeAnalysisError (auth/rate-limit/non-JSON/
      // missing-required-fields) is now a HARD SKIP — we no longer
      // silently save a synthetic 50% row. The user sees fewer rows
      // when OpenRouter is unhealthy; they don't see fake picks
      // disguised as real ones. We hand Claude the CLEAN payload
      // (no internal IDs, no raw API objects); matchData is what we
      // persist for the dashboard.
      let analysis;
      try {
        analysis = await analyseMatch(claudePayload, false, false);
      } catch (claudeErr) {
        if (claudeErr instanceof ClaudeAnalysisError) {
          console.error(
            `[scan-bg] CLAUDE FAIL fixture=${fx.fixture && fx.fixture.id} — ${claudeErr.reason}. Skipping insert.`,
          );
          skippedClaude += 1;
          continue;
        }
        throw claudeErr;
      }

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
  console.log(
    `[scan-bg] complete league=${leagueId} week=${weekStart}..${weekEnd} ` +
      `processed=${done} skippedPartial=${skippedPartial} skippedClaude=${skippedClaude} ` +
      `strictMode=${strictMode}`,
  );
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
