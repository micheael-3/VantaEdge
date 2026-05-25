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
const { getCalibrationFactor, applyFactor } = require('./_shared/calibration');

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
  // Clean sheet block from API-Football: { total, home, away }. Used
  // downstream to cap BTTS confidence per the external validation
  // report ("a team with 40%+ clean sheet rate shouldn't have BTTS
  // confidence >60%").
  const cs = stats.clean_sheet || {};
  const fixtures = stats.fixtures || {};
  const played = (fixtures.played && fixtures.played.total) || null;
  // played.home / played.away if we want per-venue rates later.
  const playedHome = fixtures.played && fixtures.played.home;
  const playedAway = fixtures.played && fixtures.played.away;
  const csTotal = num(cs.total);
  const csHome = num(cs.home);
  const csAway = num(cs.away);
  const cleanSheetRate = played && csTotal != null ? csTotal / played : null;
  const cleanSheetRateHome = playedHome && csHome != null ? csHome / playedHome : null;
  const cleanSheetRateAway = playedAway && csAway != null ? csAway / playedAway : null;
  // Log the season the upstream call actually used. The /teams/statistics
  // response echoes back `league.season` — we surface it here so the
  // diagnostic logs can prove we're pulling 2026 data, not 2025. This
  // is the explicit "filter to 2026 only" verification the external
  // validation asked for.
  const seasonEcho =
    (stats.league && stats.league.season) ||
    (stats.parameters && stats.parameters.season) ||
    null;
  console.log(
    `[scan-bg gpg] ${teamLabel || ''} season=${seasonEcho} played=${played} ` +
      `goals.for.average=${JSON.stringify(fAvg)} goals.against.average=${JSON.stringify(aAvg)} ` +
      `cleanSheet=${csTotal}/${played} (${cleanSheetRate != null ? (cleanSheetRate * 100).toFixed(0) : 'n/a'}%)`,
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
    // Clean sheet rates — surfaced to Sonnet so the prompt's BTTS-cap
    // rule has data to act on, and stored in match_data for the debug
    // endpoint.
    cleanSheets: csTotal,
    cleanSheetRate: cleanSheetRate != null ? Math.round(cleanSheetRate * 100) / 100 : null,
    cleanSheetRateHome: cleanSheetRateHome != null ? Math.round(cleanSheetRateHome * 100) / 100 : null,
    cleanSheetRateAway: cleanSheetRateAway != null ? Math.round(cleanSheetRateAway * 100) / 100 : null,
    matchesPlayed: played,
    // Echo back the season API-Football actually used. If this comes
    // out as 2025 when the upcoming fixture is 2026, that's the season-
    // mismatch the validation report flagged for Portland / Colorado.
    seasonUsed: seasonEcho,
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

// Compute H2H goals/match stats across the last-N meetings. Returns
// { avg, median, samples, display } or null when no usable data.
// Median is what we send Sonnet because a single 6-1 outlier in an
// 8-game window shifts mean by ~1 goal/match but barely moves the
// median. The legacy `display` string ("3.2 G/M") is kept so the
// existing dashboard rendering path doesn't have to change.
function h2hStatsFrom(h2hList) {
  if (!Array.isArray(h2hList) || h2hList.length === 0) return null;
  const FINISHED = new Set(['FT', 'AET', 'PEN']);
  const totals = [];
  for (const g of h2hList) {
    const status = g && g.fixture && g.fixture.status && g.fixture.status.short;
    if (!FINISHED.has(status)) continue;
    const home = g.goals && g.goals.home;
    const away = g.goals && g.goals.away;
    if (home == null || away == null) continue;
    totals.push(Number(home) + Number(away));
  }
  if (totals.length === 0) return null;
  const sorted = totals.slice().sort((a, b) => a - b);
  const sum = totals.reduce((a, b) => a + b, 0);
  const mean = sum / totals.length;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return {
    avg: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    samples: totals.length,
    // Keep a human display string so legacy callers / DB-stored strings
    // remain unchanged in shape. Prefer median when sample is small
    // (<=5) because that's where outliers do the most damage.
    display: `${(totals.length <= 5 ? median : mean).toFixed(1)} G/M`,
  };
}

// Legacy adaptor so any other code-path that still expects the old
// "3.2 G/M" string from h2hAverageString keeps working.
function h2hAverageString(h2hList) {
  const s = h2hStatsFrom(h2hList);
  return s ? s.display : null;
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

  // Form arrays — home-only / away-only first (because the venue split
  // is the more predictive signal), but TOP UP with any-venue games
  // when either side returns fewer than 5 entries. Early-season fixtures
  // are the classic offender: a team might have played 7 games total
  // but only 3 of them away, so the away-only array gives us a 3-dot
  // form. We dedupe by fixture id before slicing back to 5.
  const homeAwayForm = football.extractFormForTeam(homeLast, homeId);
  const awayAwayForm = football.extractFormForTeam(awayLast, awayId);
  // extractFormForTeam now always returns a 5-element array padded with
  // null. "Has enough" means at least 5 non-null entries. When the
  // venue-only array has fewer than 5 real games we top up from the
  // any-venue array, which usually has 7-10 games for an MLS team.
  function realCount(arr) {
    return Array.isArray(arr) ? arr.filter((v) => v != null).length : 0;
  }
  function topUpForm(primary, anyVenueArr, teamId, label) {
    if (realCount(primary) >= 5) return primary;
    const anyForm = football.extractFormForTeam(anyVenueArr, teamId);
    if (realCount(anyForm) > realCount(primary)) {
      console.log(
        `[scan-bg form] ${label} venue-only had ${realCount(primary)} real entries, any-venue has ${realCount(anyForm)}; using any-venue.`,
      );
      return anyForm;
    }
    return primary;
  }
  const homeForm = topUpForm(homeAwayForm, homeAnyVenue, homeId, `home(${fx.teams.home.name})`);
  const awayForm = topUpForm(awayAwayForm, awayAnyVenue, awayId, `away(${fx.teams.away.name})`);
  console.log(
    `[scan-bg form] fixture=${fx.fixture && fx.fixture.id} ` +
      `home(${fx.teams.home.name})=[${homeForm.join(',')}] ` +
      `away(${fx.teams.away.name})=[${awayForm.join(',')}]`,
  );

  return {
    homeId, awayId,
    homeForm,
    awayForm,
    // Rest days from ANY-VENUE games — the real fix to the "7 days rest
    // when they played 2 days ago at the other ground" bug.
    homeRest: restDaysFromAnyVenue(homeAnyVenue),
    awayRest: restDaysFromAnyVenue(awayAnyVenue),
    homeStats, awayStats,
    homeGpg: gpgFromStats(homeStats, `home(${fx.teams.home.name})`),
    awayGpg: gpgFromStats(awayStats, `away(${fx.teams.away.name})`),
    h2h: h2hAverageString(h2hList),
    h2hStats: h2hStatsFrom(h2hList),
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

async function insertPredictionForUserId(adminUserId, fx, league, analysis, oddsData, matchData, calibration) {
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

  // Compute calibrated confidence using the per-(league, market) factor
  // resolved once at the top of runScan. Returns null when raw confidence
  // is null (defensive — by this point analysis.over.confidence is always
  // a number, but the helper clamps + integerises for us either way).
  const overFactor = (calibration && calibration.over) || 1;
  const bttsFactor = (calibration && calibration.btts) || 1;
  const calibratedOver = applyFactor(analysis.over.confidence, overFactor);
  const calibratedBtts = applyFactor(analysis.btts.confidence, bttsFactor);

  // Debate transcript from the 3-agent ensemble. analysis.debate is set
  // by claude.js. Persist as a single JSONB blob so the dashboard can
  // pull the three tabs (verdict / analysis / risks).
  const debatePayload = analysis.debate || null;

  // Contrarian detection — does the AI's call go against the obvious
  // surface stats? Three triggers per spec; any one is enough.
  //   1. Over UNDER when both teams average > 2.5 goals each.
  //   2. BTTS NO when both teams scored in 4+ of last 5.
  //   3. Confidence > 75 on either market when sign of (totalAvg − 2.5)
  //      conflicts with the over_line vote.
  // PRO users see the full reasoning in Show Analysis; everyone sees a
  // small amber "CONTRARIAN PICK" badge.
  function bothScoredCount(scores) {
    if (!Array.isArray(scores)) return 0;
    let n = 0;
    for (const s of scores) {
      const m = String(s).match(/(\d+)\s*[-–]\s*(\d+)/);
      if (m && Number(m[1]) > 0 && Number(m[2]) > 0) n += 1;
    }
    return n;
  }
  const homeAvgFor = matchData && matchData.home && matchData.home.goalsPerGame && matchData.home.goalsPerGame.avgFor;
  const awayAvgFor = matchData && matchData.away && matchData.away.goalsPerGame && matchData.away.goalsPerGame.avgFor;
  const homeRecentScored = matchData && matchData.home && bothScoredCount(matchData.home.lastFiveScores);
  const awayRecentScored = matchData && matchData.away && bothScoredCount(matchData.away.lastFiveScores);
  const overIsUnderSide = Number(analysis.over.line) <= 1.5;
  const bothHighScoring = Number(homeAvgFor) > 2.5 && Number(awayAvgFor) > 2.5;
  const bttsNo = String(analysis.btts.prediction || '').toUpperCase() === 'NO';
  const bothScoringStreak = homeRecentScored >= 4 && awayRecentScored >= 4;
  const overConf = Number(analysis.over.confidence) || 0;
  const bttsConf = Number(analysis.btts.confidence) || 0;
  const isContrarian =
    (overIsUnderSide && bothHighScoring) ||
    (bttsNo && bothScoringStreak) ||
    (overConf >= 75 && bothHighScoring && overIsUnderSide) ||
    (bttsConf >= 75 && bothScoringStreak && bttsNo);
  if (isContrarian) {
    console.log(
      `[scan-bg contrarian] fixture=${fx.fixture && fx.fixture.id} ` +
        `${fx.teams.home.name} vs ${fx.teams.away.name} ` +
        `over=${analysis.over.line}@${overConf}% btts=${analysis.btts.prediction}@${bttsConf}% ` +
        `homeAvg=${homeAvgFor} awayAvg=${awayAvgFor} ` +
        `homeBTS5=${homeRecentScored} awayBTS5=${awayRecentScored}`,
    );
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
        // Persist the code-level enforcement record + data quality
        // breakdown so /api/admin/quality-log can render
        // "why was this confidence capped?" without a re-run.
        enforcements: (analysis && Array.isArray(analysis.enforcements) && analysis.enforcements.length)
          ? analysis.enforcements
          : null,
        qualityScore: matchData.qualityScore != null ? matchData.qualityScore : null,
        qualityMissing: Array.isArray(matchData.qualityMissing) && matchData.qualityMissing.length
          ? matchData.qualityMissing
          : null,
        maxConfidence: matchData.maxConfidence != null ? matchData.maxConfidence : null,
      }
    : null;

  // 50/50 SKIP GUARD —
  // If both Over and BTTS confidence round to exactly 50, the model
  // gave us no real signal (this is the classic fallback shape from a
  // failed JSON parse or a hedged adjudicator output). Persisting such
  // a row pollutes the dashboard with "OVER 2.5 · 50%" cards that
  // never resolve into a useful pick. Skip the INSERT entirely and
  // log so we can spot a recurring failure mode in Netlify logs.
  // ON CONFLICT semantics are preserved: an existing row for this
  // fixture stays as-is rather than being overwritten with garbage.
  const overConfRounded = Math.round(Number(analysis.over.confidence) || 0);
  const bttsConfRounded = Math.round(Number(analysis.btts.confidence) || 0);
  if (overConfRounded === 50 && bttsConfRounded === 50) {
    console.warn(
      `[scan-bg skip-5050] fixture=${fx.fixture && fx.fixture.id} ` +
        `${fx.teams.home.name} vs ${fx.teams.away.name} — ` +
        `model returned 50/50 (no signal). Row NOT inserted; previous ` +
        `row (if any) preserved.`,
    );
    return;
  }

  // Stored against the system "scan" user — when a real user requests
  // /api/predictions/week we read these shared rows by league + kickoff
  // window (no user_id filter).
  //
  // Try INSERT with the new self-learning columns. On 42703 (column
  // doesn't exist — migration not run yet) fall back to the legacy
  // INSERT so the scan still completes; the new columns just won't
  // populate until run-migration.sql is applied.
  try {
    // ON CONFLICT (fixture_id) DO UPDATE — one row per fixture in the
    // shared MLS scan model. If a Force Rescan or re-run touches the
    // same fixture, the existing row gets refreshed instead of growing
    // a sibling. UPDATE intentionally preserves over_hit/btts_hit/
    // settled_at/accuracy_score/home_goals/away_goals so a re-scan
    // after a match is settled doesn't blow the result away.
    await sql()`
      INSERT INTO predictions
        (user_id, league, fixture_id, home_team, away_team, kickoff,
         over_line, over_confidence, btts, btts_confidence,
         ev_edge_over, ev_edge_btts, kelly_over, kelly_btts,
         best_over_odds, best_over_bookmaker, best_btts_odds, best_btts_bookmaker,
         auto_ev_over, auto_ev_btts, match_data,
         debate_json, calibrated_over_confidence, calibrated_btts_confidence,
         sport, is_contrarian)
      VALUES
        (${adminUserId}, ${league.name}, ${fx.fixture.id}, ${fx.teams.home.name}, ${fx.teams.away.name},
         ${fx.fixture.date}, ${analysis.over.line}, ${Math.round(analysis.over.confidence)},
         ${analysis.btts.prediction}, ${Math.round(analysis.btts.confidence)},
         ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null},
         ${kellyOverAuto}, ${kellyBttsAuto},
         ${oddsData ? oddsData.bestOverOdds : null}, ${oddsData ? oddsData.bestOverBookmaker : null},
         ${oddsData ? oddsData.bestBttsOdds : null}, ${oddsData ? oddsData.bestBttsBookmaker : null},
         ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null},
         ${mdPayload ? JSON.stringify(mdPayload) : null}::jsonb,
         ${debatePayload ? JSON.stringify(debatePayload) : null}::jsonb,
         ${calibratedOver}, ${calibratedBtts},
         ${(league.name || 'MLS').toLowerCase()}, ${isContrarian})
      ON CONFLICT (fixture_id) DO UPDATE SET
        league = EXCLUDED.league,
        home_team = EXCLUDED.home_team,
        away_team = EXCLUDED.away_team,
        kickoff = EXCLUDED.kickoff,
        over_line = EXCLUDED.over_line,
        over_confidence = EXCLUDED.over_confidence,
        btts = EXCLUDED.btts,
        btts_confidence = EXCLUDED.btts_confidence,
        ev_edge_over = EXCLUDED.ev_edge_over,
        ev_edge_btts = EXCLUDED.ev_edge_btts,
        kelly_over = EXCLUDED.kelly_over,
        kelly_btts = EXCLUDED.kelly_btts,
        best_over_odds = EXCLUDED.best_over_odds,
        best_over_bookmaker = EXCLUDED.best_over_bookmaker,
        best_btts_odds = EXCLUDED.best_btts_odds,
        best_btts_bookmaker = EXCLUDED.best_btts_bookmaker,
        auto_ev_over = EXCLUDED.auto_ev_over,
        auto_ev_btts = EXCLUDED.auto_ev_btts,
        match_data = EXCLUDED.match_data,
        debate_json = EXCLUDED.debate_json,
        calibrated_over_confidence = EXCLUDED.calibrated_over_confidence,
        calibrated_btts_confidence = EXCLUDED.calibrated_btts_confidence,
        sport = EXCLUDED.sport,
        is_contrarian = EXCLUDED.is_contrarian`;
  } catch (err) {
    if (err && (err.code === '42703' || /column .* does not exist/i.test(err.message || ''))) {
      console.warn('[scan-bg] self-learning columns missing on predictions table — inserting without them. Run run-migration.sql.');
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
    } else {
      throw err;
    }
  }
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

  // 4a. Per-(league, market) calibration factors — single pair of DB
  //     reads per scan, then we pass them into every insert call. Factor
  //     defaults to 1.0 (no adjustment) until ≥10 settled samples exist.
  let calibration = { over: 1, btts: 1 };
  try {
    const [overF, bttsF] = await Promise.all([
      getCalibrationFactor(league.name, 'over'),
      getCalibrationFactor(league.name, 'btts'),
    ]);
    calibration = { over: overF, btts: bttsF };
    console.log(`[scan-bg] calibration loaded league=${league.name} over=${overF} btts=${bttsF}`);
  } catch (err) {
    console.error('[scan-bg] calibration load failed:', err.message);
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

      const homeCsRate = homeGpg.cleanSheetRate;
      const awayCsRate = awayGpg.cleanSheetRate;

      // Clean payload Sonnet 4.5 sees. Adds the per-team clean-sheet
      // rate (so the prompt's BTTS-cap rule has data to act on) and
      // sends MEDIAN H2H instead of mean (median is outlier-resistant —
      // an 8-game window with one 6-1 blowout has a sane median but
      // an inflated mean).
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
          // Clean-sheet rate (0..1) — overall and per-venue. The prompt
          // explicitly references this for the BTTS cap.
          cleanSheetRate: homeCsRate,
          cleanSheetRateHome: homeGpg.cleanSheetRateHome,
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
          cleanSheetRate: awayCsRate,
          cleanSheetRateAway: awayGpg.cleanSheetRateAway,
          lastFiveAwayScores: detail.awayLastFiveAwayScores,
          leaguePosition: detail.awayStanding && detail.awayStanding.position,
          seasonRecord: detail.awayStanding && detail.awayStanding.record,
          seasonPoints: detail.awayStanding && detail.awayStanding.points,
          seasonGoalsFor: detail.awayStanding && detail.awayStanding.goalsFor,
          seasonGoalsAgainst: detail.awayStanding && detail.awayStanding.goalsAgainst,
        },
        h2h: {
          // medianGoalsPerGame is the headline figure now. avgGoalsPerGame
          // and samples are exposed so the model can downweight when
          // the sample is small.
          medianGoalsPerGame: detail.h2hStats ? detail.h2hStats.median : null,
          avgGoalsPerGame: detail.h2hStats ? detail.h2hStats.avg : null,
          samples: detail.h2hStats ? detail.h2hStats.samples : 0,
          lastResults: detail.h2hScores,
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
        // New: median + samples for the debug endpoint and any future
        // UI that wants to surface "8 H2H meetings, median 2.5 goals".
        h2hStats: detail.h2hStats || null,
        referee: detail.referee || null,
        // Diagnostic: which season API-Football echoed back on
        // /teams/statistics. Visible in /api/admin/debug-fixture
        // so we can prove (or disprove) the "filter to 2026" question
        // raised in the external validation report.
        seasonUsed:
          (detail.homeGpg && detail.homeGpg.seasonUsed) ||
          (detail.awayGpg && detail.awayGpg.seasonUsed) ||
          detectedSeason ||
          null,
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

      // ----------------------------------------------------------
      // DATA QUALITY SCORE — 0..6. Each signal we have a real value
      // for counts 1. The score drives:
      //   - HARD SKIP when < 3 (don't waste a Claude call)
      //   - per-match maxConfidence cap passed to Claude
      //     (5 → 65 default, 5 → 72, 6 → 78)
      // The score is also persisted on match_data so the admin
      // quality log can surface "why was this confidence low?"
      // ----------------------------------------------------------
      const realFormCount = (arr) =>
        Array.isArray(arr) ? arr.filter((v) => v != null).length : 0;
      const homeAvgFor = matchData.home && matchData.home.goalsPerGame && Number(matchData.home.goalsPerGame.avgFor);
      const awayAvgFor = matchData.away && matchData.away.goalsPerGame && Number(matchData.away.goalsPerGame.avgFor);
      const h2hAvgGoals = matchData.h2h && Number(matchData.h2h.avgTotalGoals);
      const refName = matchData.referee && matchData.referee.name;
      const dataQuality = {
        hasHomeForm: realFormCount(matchData.home && matchData.home.form) >= 3,
        hasAwayForm: realFormCount(matchData.away && matchData.away.form) >= 3,
        hasHomeGoals: Number.isFinite(homeAvgFor) && homeAvgFor > 0,
        hasAwayGoals: Number.isFinite(awayAvgFor) && awayAvgFor > 0,
        hasH2H: Number.isFinite(h2hAvgGoals) && h2hAvgGoals > 0,
        hasReferee: !!refName && refName !== 'Not announced',
      };
      const qualityScore = Object.values(dataQuality).filter(Boolean).length;
      console.log(
        `[scan-bg quality] fixture=${fx.fixture && fx.fixture.id} ` +
          `${fx.teams.home.name} vs ${fx.teams.away.name} ` +
          `score=${qualityScore}/6 ` +
          `missing=[${Object.entries(dataQuality).filter(([, v]) => !v).map(([k]) => k).join(',') || 'none'}]`,
      );
      if (qualityScore < 3) {
        console.warn(
          `[scan-bg quality-skip] fixture=${fx.fixture && fx.fixture.id} ` +
            `— quality ${qualityScore}/6 below threshold. NOT calling Claude.`,
        );
        continue;
      }
      let maxConfidence = 65;
      if (qualityScore === 5) maxConfidence = 72;
      if (qualityScore === 6) maxConfidence = 78;

      // Persist on match_data so /api/admin/quality-log can read it
      // and the admin can see why a confidence was capped.
      matchData.qualityScore = qualityScore;
      matchData.qualityMissing = Object.entries(dataQuality)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      matchData.maxConfidence = maxConfidence;

      // Claude call. A ClaudeAnalysisError (auth/rate-limit/non-JSON/
      // missing-required-fields) is now a HARD SKIP — we no longer
      // silently save a synthetic 50% row. The user sees fewer rows
      // when OpenRouter is unhealthy; they don't see fake picks
      // disguised as real ones. We hand Claude the CLEAN payload
      // (no internal IDs, no raw API objects); matchData is what we
      // persist for the dashboard. maxConfidence flows through to
      // the post-enforcement clamp inside claude.js.
      let analysis;
      try {
        analysis = await analyseMatch(claudePayload, false, false, { maxConfidence });
        // Verbose log of every Claude verdict so we can audit whether the
        // model is ever calling BTTS NO. Earlier reports showed every
        // pick coming back as YES — the prompt now has an explicit
        // "MUST predict NO when …" rule, and this log proves it.
        console.log(
          `[scan-bg verdict] fixture=${fx.fixture && fx.fixture.id} ` +
            `${fx.teams.home.name} vs ${fx.teams.away.name} ` +
            `OVER=${analysis.over.line}@${analysis.over.confidence}% ` +
            `BTTS=${analysis.btts.prediction}@${analysis.btts.confidence}% ` +
            `risk=${analysis.riskScore ?? 'n/a'}`,
        );
        // Server-side BTTS cap. If either team has a clean-sheet rate
        // of 40%+, BTTS confidence shouldn't exceed 60% — a team that
        // shuts out 4 in 10 games can't be in a 70% BTTS-YES.
        // The prompt also tells Sonnet this rule, but enforcing it
        // here guarantees the contract even if the model drifts.
        const CS_THRESHOLD = 0.40;
        const CS_CAP = 60;
        const homeCsHigh = typeof homeCsRate === 'number' && homeCsRate >= CS_THRESHOLD;
        const awayCsHigh = typeof awayCsRate === 'number' && awayCsRate >= CS_THRESHOLD;
        const btts = analysis.btts || {};
        const isYes = String(btts.prediction || '').toUpperCase() === 'YES';
        // Only cap the YES side — high clean-sheet rate is a NO signal,
        // so a BTTS NO prediction with high confidence is internally
        // consistent and shouldn't be capped.
        if (isYes && (homeCsHigh || awayCsHigh) && typeof btts.confidence === 'number' && btts.confidence > CS_CAP) {
          const before = btts.confidence;
          analysis.btts.confidence = CS_CAP;
          analysis.btts.reasoning =
            `${analysis.btts.reasoning || ''}\n[Auto-capped to ${CS_CAP}% — ${
              homeCsHigh ? `${fx.teams.home.name} keeps clean sheets in ${(homeCsRate * 100).toFixed(0)}% of games` : ''
            }${homeCsHigh && awayCsHigh ? '; ' : ''}${
              awayCsHigh ? `${fx.teams.away.name} keeps clean sheets in ${(awayCsRate * 100).toFixed(0)}% of games` : ''
            }]`.trim();
          console.log(
            `[scan-bg btts-cap] fixture=${fx.fixture && fx.fixture.id} ` +
              `${fx.teams.home.name} vs ${fx.teams.away.name} ` +
              `home-cs=${homeCsRate} away-cs=${awayCsRate} ` +
              `BTTS YES capped ${before}% -> ${CS_CAP}%`,
          );
        }
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

      // Defensive belt-and-braces: never persist a row where the model
      // returned exactly 50/50. claude.js currently throws on failure
      // instead of returning a synthetic 50/50, but if a future change
      // re-introduces a fallback path this guard stops it polluting
      // the calibration data. Skip — don't insert.
      if (
        Number(analysis.over.confidence) === 50 &&
        Number(analysis.btts.confidence) === 50
      ) {
        console.warn(
          `[scan-bg] SKIP fixture=${fx.fixture && fx.fixture.id} ${fx.teams.home.name} vs ${fx.teams.away.name} — AI returned 50/50 placeholder.`,
        );
        skippedClaude += 1;
        continue;
      }

      let oddsData = null;
      try {
        const matchedOdds = oddsService.findOddsForFixture(leagueOdds, fx);
        if (matchedOdds) oddsData = oddsService.buildOddsData(matchedOdds, analysis);
      } catch (err) {
        console.error('[scan-bg] odds match failed:', err.message);
      }

      await insertPredictionForUserId(ownerId, fx, league, analysis, oddsData, matchData, calibration);
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
