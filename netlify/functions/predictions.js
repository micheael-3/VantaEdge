const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { LEAGUES, TIER_LEAGUES, tierRank } = require('./_shared/tier');
const { consumeRefresh } = require('./_shared/refresh-limit');
const football = require('./_shared/football');
const { analyseMatch } = require('./_shared/claude');
const { calculateEV, calculateKelly } = require('./_shared/ev');
const oddsService = require('./_shared/odds');
const weatherService = require('./_shared/weather');
const { loadAdjustments, calibrate } = require('./_shared/calibration');
const { cyprusDateStr, cyprusMonday } = require('./_shared/dates');

// Hardcoded for this MLS-only build. Every code path that used to take a
// league id now ignores anything other than 253.
const MLS_LEAGUE_ID = 253;

// ---------- Function-instance /quick response cache ----------
// Stores the full /quick response keyed by `${leagueId}|${date}`. Saves a
// stack of API-Football calls when two clients hit the same warm function
// instance within the TTL window. TTL = min(1h, time-until-midnight-UTC).
// Per-instance only — different warm instances don't share. That's fine.
const quickCache = new Map();
function quickCacheKey(leagueId, date) {
  return `${leagueId}|${date || 'auto'}`;
}
function quickCacheGet(key) {
  const hit = quickCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    quickCache.delete(key);
    return null;
  }
  return hit.value;
}
function quickCacheSet(key, value, dateStr) {
  let ttlMs = 3600 * 1000; // 1h cap
  if (dateStr) {
    try {
      const midnight = new Date(`${dateStr}T23:59:59Z`).getTime();
      const tillMidnight = midnight - Date.now();
      if (tillMidnight > 0 && tillMidnight < ttlMs) ttlMs = tillMidnight;
    } catch { /* fall through */ }
  }
  quickCache.set(key, { value, expires: Date.now() + ttlMs });
}

// ---------- Rate-limit detection + retry helper ----------
function isRateLimitErr(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  return msg.includes('429') ||
         msg.includes('rate limit') ||
         msg.includes('ratelimit') ||
         msg.includes('too many requests') ||
         msg.includes('exceeded the limit');
}

async function retryOnRateLimit(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isRateLimitErr(err)) throw err;
    console.warn('[predictions] rate limited — retrying once after 2s:', err.message);
    await new Promise((r) => setTimeout(r, 2000));
    return await fn();
  }
}

// Derive rest days from a team's recent fixtures list rather than making a
// separate /fixtures call. Falls back to null when no past games are present.
function restDaysFromForm(formFixtures) {
  if (!Array.isArray(formFixtures) || formFixtures.length === 0) return null;
  const sorted = formFixtures.slice().sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  const lastPlayed = sorted.find((f) => new Date(f.fixture.date) < new Date());
  if (!lastPlayed) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(lastPlayed.fixture.date).getTime()) / 86400000));
}

// ---------- Date helpers ----------
function todayDateStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addDaysStr(baseDateStr, days) {
  const d = new Date(`${baseDateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isoToDateStr(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function labelForDateStr(dateStr) {
  const today = todayDateStr();
  if (dateStr === today) return 'Today';
  if (dateStr === addDaysStr(today, 1)) return 'Tomorrow';
  if (dateStr === addDaysStr(today, -1)) return 'Yesterday';
  try {
    const d = new Date(`${dateStr}T12:00:00Z`);
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

// TTL chooser: 300s today, 3600s future, 86400s past.
function ttlForDate(dateStr) {
  const today = todayDateStr();
  if (dateStr === today) return 300;
  if (dateStr > today) return 3600;
  return 86400;
}

// Status codes from API-Football that mean the match is over with a final score.
const TERMINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

// Try a season on a specific date. Returns [] on any error so the cascade
// can keep going. All errors get logged in football.js / here.
async function tryDate(leagueId, dateStr, ttl, season) {
  try {
    const list = await football.getFixturesByDate(leagueId, dateStr, ttl, season);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error(`[predictions] cascade: ${dateStr} s${season} failed: ${err.message}`);
    return [];
  }
}

// Static fallback only used for the "recent matches" probe.
const RECENT_FALLBACK_SEASONS = (() => {
  const set = new Set([football.SEASON, football.SEASON + 1, football.SEASON - 1]);
  return Array.from(set);
})();

async function pickFixtures(leagueId, explicitDate) {
  const today = todayDateStr();
  const nowUTC = new Date().toISOString();
  console.log(`[predictions] pickFixtures start league=${leagueId} explicitDate=${explicitDate || 'none'} serverUTCnow=${nowUTC} serverUTCdate=${today}`);

  if (explicitDate) {
    const tryWindow = [explicitDate, addDaysStr(explicitDate, 1), addDaysStr(explicitDate, -1)];
    for (const candidate of tryWindow) {
      for (const season of football.candidateSeasonsForDate(candidate)) {
        const list = await tryDate(leagueId, candidate, ttlForDate(candidate), season);
        console.log(`[predictions] explicit-window league=${leagueId} candidate=${candidate} season=${season} → ${list.length}`);
        if (list.length) {
          return {
            fixtures: list,
            dateLabel: labelForDateStr(candidate),
            matchDate: candidate,
            isPast: candidate < today,
            isUpcoming: candidate > today,
            isToday: candidate === today,
            mode: candidate === explicitDate ? 'explicit' : 'explicit-window',
            seasonUsed: season,
          };
        }
      }
    }
    console.log(`[predictions] explicit-window empty league=${leagueId} explicitDate=${explicitDate}; falling through to cascade`);
  }

  // 1. Today UTC
  for (const season of football.candidateSeasonsForDate(today)) {
    const list = await tryDate(leagueId, today, 300, season);
    console.log(`[predictions] cascade league=${leagueId} TODAY ${today} season=${season} → ${list.length}`);
    if (list.length) {
      return { fixtures: list, dateLabel: 'Today', matchDate: today, isPast: false, isUpcoming: false, isToday: true, mode: 'today', seasonUsed: season };
    }
  }
  // 2. Tomorrow UTC
  const tomorrow = addDaysStr(today, 1);
  for (const season of football.candidateSeasonsForDate(tomorrow)) {
    const list = await tryDate(leagueId, tomorrow, 3600, season);
    console.log(`[predictions] cascade league=${leagueId} TOMORROW ${tomorrow} season=${season} → ${list.length}`);
    if (list.length) {
      return { fixtures: list, dateLabel: 'Tomorrow', matchDate: tomorrow, isPast: false, isUpcoming: true, isToday: false, mode: 'tomorrow', seasonUsed: season };
    }
  }
  // 3. Yesterday UTC
  const yesterday = addDaysStr(today, -1);
  for (const season of football.candidateSeasonsForDate(yesterday)) {
    const list = await tryDate(leagueId, yesterday, 86400, season);
    console.log(`[predictions] cascade league=${leagueId} YESTERDAY ${yesterday} season=${season} → ${list.length}`);
    if (list.length) {
      return { fixtures: list, dateLabel: 'Yesterday', matchDate: yesterday, isPast: true, isUpcoming: false, isToday: false, mode: 'yesterday', seasonUsed: season };
    }
  }
  // 4. Recent past
  for (const season of RECENT_FALLBACK_SEASONS) {
    try {
      const recent = await football.apiGet('/fixtures', { league: leagueId, season, last: 10 }, { tag: `recent s${season}` });
      console.log(`[predictions] cascade league=${leagueId} RECENT season=${season} → ${(recent || []).length}`);
      if (Array.isArray(recent) && recent.length) {
        return { fixtures: recent, dateLabel: 'Recent Matches', matchDate: null, isPast: true, isUpcoming: false, isToday: false, mode: 'recent', seasonUsed: season };
      }
    } catch (err) {
      console.error(`[predictions] recent s${season} failed: ${err.message}`);
    }
  }

  console.warn(`[predictions] cascade league=${leagueId} — empty across today/tomorrow/yesterday/recent`);
  return { fixtures: [], dateLabel: 'Recent Matches', matchDate: null, isPast: true, isUpcoming: false, isToday: false, mode: 'recent', seasonUsed: null };
}

// ---------- Shared fixture-detail helpers ----------

// Goals-per-game proxy from teams/statistics — cheap, no extra API call.
function gpgFromStats(stats) {
  if (!stats || !stats.goals) return null;
  const f = stats.goals.for && stats.goals.for.average && stats.goals.for.average.total;
  const a = stats.goals.against && stats.goals.against.average && stats.goals.against.average.total;
  return {
    avgFor: f != null ? Number(f) : null,
    avgAgainst: a != null ? Number(a) : null,
  };
}

// Compute the lean per-fixture detail (form + stats + rest days). Used by
// both /quick (returns to client) and /analyze (passes to Claude). All 4
// API-Football calls fire via Promise.all — total wall time is bound by
// the slowest of the four when cold, or 0ms when all are cached.
async function fetchFixtureDetail(fx, leagueId) {
  const homeId = fx.teams.home.id;
  const awayId = fx.teams.away.id;
  const [homeLast, awayLast, homeStats, awayStats] = await Promise.all([
    football.getTeamLastHomeGames(homeId, leagueId),
    football.getTeamLastAwayGames(awayId, leagueId),
    football.getTeamStats(homeId, leagueId),
    football.getTeamStats(awayId, leagueId),
  ]);
  const homeForm = football.extractFormForTeam(homeLast, homeId);
  const awayForm = football.extractFormForTeam(awayLast, awayId);
  const homeRest = restDaysFromForm(homeLast);
  const awayRest = restDaysFromForm(awayLast);
  const homeGpg = gpgFromStats(homeStats);
  const awayGpg = gpgFromStats(awayStats);
  return {
    homeId, awayId,
    homeForm, awayForm,
    homeRest, awayRest,
    homeStats, awayStats,
    homeGpg, awayGpg,
  };
}

function buildActualResult(fx, analysis) {
  const statusShort = fx.fixture && fx.fixture.status && fx.fixture.status.short;
  const homeGoals = fx.goals && fx.goals.home;
  const awayGoals = fx.goals && fx.goals.away;
  if (!TERMINAL_STATUSES.has(statusShort) || homeGoals == null || awayGoals == null) return null;
  const total = Number(homeGoals) + Number(awayGoals);
  const bothScored = Number(homeGoals) > 0 && Number(awayGoals) > 0;
  const overLine = analysis && analysis.over ? Number(analysis.over.line) : null;
  const overHit = overLine != null ? total > overLine : null;
  const bttsCall = String(analysis && analysis.btts && analysis.btts.prediction || 'YES').toUpperCase();
  const bttsHit = analysis ? (bttsCall === 'YES' ? bothScored : !bothScored) : null;
  return {
    status: 'FT',
    homeGoals: Number(homeGoals),
    awayGoals: Number(awayGoals),
    totalGoals: total,
    bothScored,
    overHit,
    bttsHit,
  };
}

// ---------- /week — weekly Monday-Sunday read endpoint ----------
//
// Reads the predictions table for the current calendar week (Mon-Sun) and
// the scan_status row. If no rows exist yet and the scan isn't already
// running, fires off the background scan and returns scanning:true so the
// frontend can show a progress UI while polling.
// Cyprus-local week boundary. The previous version computed Monday in
// UTC, which meant a Cyprus user looking at the dashboard at 01:30 AM
// Monday Cyprus time (= 23:30 UTC Sunday) would get LAST week's data
// because UTC still thought it was Sunday. cyprusMonday() does the
// math in Asia/Nicosia so the week boundary matches the user's reality.
function mondayOf(date) {
  return cyprusMonday(date);
}

function shapeForFrontend(row, adjustments) {
  // Shape a `predictions` row into the same fixture object the dashboard
  // MatchCard reads. Predictions are stored as integers/strings; we
  // wrap them in the legacy { line, confidence, prediction } objects.
  //
  // The `match_data` JSONB column carries the contextual data the UI
  // needs (form, rest, goals-per-game, AI reasoning) that isn't already
  // a top-level column. Parse it once and spread the fields into the
  // home/away objects so MatchCard reads them naturally.
  let md = {};
  if (row.match_data) {
    try {
      md = typeof row.match_data === 'string' ? JSON.parse(row.match_data) : row.match_data;
    } catch {
      md = {};
    }
  }
  const mdHome = (md && md.home) || {};
  const mdAway = (md && md.away) || {};
  const reasoning = (md && md.reasoning) || {};

  return {
    id: row.id,
    fixtureId: row.fixture_id,
    league: row.league,
    kickoff: row.kickoff,
    home: {
      id: mdHome.id || null,
      name: row.home_team,
      form: mdHome.form || null,
      restDays: mdHome.restDays != null ? mdHome.restDays : null,
      goalsPerGame: mdHome.goalsPerGame || null,
      // New: last-5 actual scorelines + league position object.
      // Populated by scans from the data-quality fix forward; will be
      // null for rows from the previous prompt/storage shape.
      lastFiveScores: mdHome.lastFiveScores || null,
      standing: mdHome.standing || null,
    },
    away: {
      id: mdAway.id || null,
      name: row.away_team,
      form: mdAway.form || null,
      restDays: mdAway.restDays != null ? mdAway.restDays : null,
      goalsPerGame: mdAway.goalsPerGame || null,
      lastFiveScores: mdAway.lastFiveScores || null,
      standing: mdAway.standing || null,
    },
    predictions: {
      over: {
        line: row.over_line,
        confidence: row.over_confidence,
        calibratedConfidence:
          adjustments && row.over_confidence != null
            ? calibrate(row.over_confidence, 'over', adjustments)
            : null,
        reasoning: reasoning.over || null,
      },
      btts: {
        prediction: row.btts,
        confidence: row.btts_confidence,
        calibratedConfidence:
          adjustments && row.btts_confidence != null
            ? calibrate(row.btts_confidence, 'btts', adjustments)
            : null,
        reasoning: reasoning.btts || null,
      },
      firstHalf: null,
      asianHandicap: null,
    },
    h2h: (md && md.h2h) || null,
    // Referee block from match_data: { name, avgGoalsPerGame } or null.
    // The stats grid reads fixture.referee.name and .avgGoalsPerGame to
    // render the "Referee" block — without surfacing it here the card
    // always shows "Unknown".
    referee: (md && md.referee) || null,
    // Data-quality fields set by the weekly scan's classifyMatchData.
    // 'full' | 'partial' | 'invalid' (invalid rows shouldn't reach the
    // DB but we surface anyway). issues is a string[] of flag names.
    dataConfidence: (md && md.dataConfidence) || null,
    dataIssues: (md && md.dataIssues) || null,
    actualResult: row.over_hit != null || row.btts_hit != null ? {
      status: 'FT',
      overHit: row.over_hit,
      bttsHit: row.btts_hit,
    } : null,
    ev: {
      over: row.ev_edge_over != null ? { edge: row.ev_edge_over } : null,
      btts: row.ev_edge_btts != null ? { edge: row.ev_edge_btts } : null,
    },
    aiStatus: (md && md.aiStatus) || 'ok',
    aiReason: (md && md.aiReason) || null,
  };
}

async function triggerBackgroundScan(leagueId, weekStart) {
  const base = process.env.URL || process.env.DEPLOY_URL || '';
  if (!base) {
    console.warn('[predictions/week] no URL env var — cannot trigger background scan');
    return;
  }
  const url = `${base}/.netlify/functions/predictions-scan-background`;
  const secret = process.env.JWT_SECRET || '';
  if (!secret) {
    console.warn('[predictions/week] JWT_SECRET missing — cannot sign internal call');
    return;
  }
  try {
    // Fire-and-forget. We do NOT await the body; the background function
    // returns 202 instantly anyway.
    const axios = require('axios');
    axios.post(url, { leagueId, weekStart }, {
      headers: { 'x-internal-scan-secret': secret, 'content-type': 'application/json' },
      timeout: 5000,
      validateStatus: () => true,
    }).catch((err) => {
      console.error('[predictions/week] bg trigger failed:', err.message);
    });
    console.log(`[predictions/week] background scan triggered league=${leagueId} weekStart=${weekStart}`);
  } catch (err) {
    console.error('[predictions/week] bg trigger setup failed:', err.message);
  }
}

async function handleWeek(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const leagueId = MLS_LEAGUE_ID;
  const weekStart = mondayOf(new Date());
  const weekEnd = addDaysStr(weekStart, 6);

  // 1. All predictions in the kickoff window (shared rows; not per-user).
  //    We don't filter by user_id because the weekly scan stores rows
  //    against the scan-owner; everyone reads the same week.
  void user;
  // MLS-only build: predictions.league is stored as the league NAME
  // string. We filter to 'MLS' here so legacy multi-league rows
  // (Bundesliga / Eredivisie / etc.) don't leak into the weekly view.
  const rows = await sql()`
    SELECT id, fixture_id, league, home_team, away_team, kickoff,
           over_line, over_confidence, btts, btts_confidence,
           ev_edge_over, ev_edge_btts, over_hit, btts_hit, created_at,
           match_data
    FROM predictions
    WHERE kickoff >= ${weekStart}::date
      AND kickoff <  (${weekEnd}::date + INTERVAL '1 day')
      AND league = 'MLS'
    ORDER BY kickoff ASC`;

  // Load calibration adjustments once for the whole week response.
  const adjustments = await loadAdjustments();

  // 2. Group by Asia/Nicosia kickoff date. This used to use the UTC date
  //    of the kickoff ISO, which silently mis-bucketed any late-night
  //    Cyprus kickoff: a 02:30 AM Sunday match (23:30 UTC Saturday) was
  //    showing under the Saturday pill. Bucketing in Cyprus time makes
  //    the date strip match what the user expects to see.
  const dates = {};
  for (const r of rows) {
    const dateKey = cyprusDateStr(r.kickoff);
    if (!dateKey) continue;
    if (!dates[dateKey]) dates[dateKey] = [];
    dates[dateKey].push(shapeForFrontend(r, adjustments));
  }

  // 3. scan_status for this week. Resilient to the table not existing yet —
  //    if the migration hasn't been run, we treat status as 'idle' so the
  //    /week endpoint still works and the dashboard renders. The background
  //    scan itself ALSO catches the missing-table case so it can complete
  //    even before the migration.
  let status = { status: 'idle', total: 0, done: 0, error: null, updated_at: null };
  try {
    const statusRows = await sql()`
      SELECT status, total, done, error, updated_at
      FROM scan_status
      WHERE id = ${`league-${leagueId}-week-${weekStart}`}
      LIMIT 1`;
    if (statusRows[0]) status = statusRows[0];
  } catch (err) {
    if (err && (err.code === '42P01' || /relation "?scan_status"? does not exist/i.test(err.message || ''))) {
      console.warn('[predictions/week] scan_status table missing — falling back to idle. Run /api/migrate or paste schema.sql in Neon.');
    } else {
      throw err;
    }
  }

  // 4. If no rows yet and not currently scanning, fire the background scan.
  let scanning = status.status === 'scanning';
  if (rows.length === 0 && status.status !== 'scanning' && status.status !== 'complete') {
    await triggerBackgroundScan(leagueId, weekStart);
    scanning = true;
  }

  return json(200, {
    leagueId,
    weekStart,
    weekEnd,
    dates,
    scanning,
    progress: { done: Number(status.done) || 0, total: Number(status.total) || 0, error: status.error || null },
    lastScanned: status.updated_at,
  });
}

// ---------- /quick — fixtures + form + stats, NO Claude ----------
//
// Returns the same fixture shape as /253 (handleLeague) but with
// `predictions: null` and `aiStatus: 'pending'`. The frontend then fires
// /analyze?fixtureId=X per fixture in parallel.
// Walk forward up to 6 days from `fromDate` and return the first date
// that has at least one fixture in API-Football. Honours `getFixturesByDateAuto`
// season-cycling so a date in season 2026 still works while SEASON=2025.
async function findNextDateWithFixtures(leagueId, fromDate) {
  for (let i = 1; i <= 6; i++) {
    const candidate = addDaysStr(fromDate, i);
    try {
      const result = await football.getFixturesByDateAuto(leagueId, candidate, 3600);
      const list = (result && result.fixtures) || [];
      if (list.length > 0) {
        return { date: candidate, fixtures: list, season: result.season };
      }
    } catch (err) {
      console.error(`[predictions] auto-next scan ${candidate} failed: ${err.message}`);
    }
  }
  return null;
}

async function handleQuick(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const leagueId = MLS_LEAGUE_ID;
  const league = LEAGUES[leagueId];
  if (!league) return error(500, 'MLS league config missing');

  void tierRank;
  void TIER_LEAGUES;

  const qs = event.queryStringParameters || {};
  const isInitial = qs.initial === '1' || qs.initial === 'true';
  const consumed = await consumeRefresh(user, isInitial);
  if (!consumed.ok) return error(429, consumed.reason, { tier: user.tier });

  const explicitDate = typeof qs.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(qs.date) ? qs.date : null;

  // Function-instance cache check — same league+date within TTL returns
  // the cached payload without touching API-Football.
  const cacheKey = quickCacheKey(leagueId, explicitDate);
  const cachedQuick = quickCacheGet(cacheKey);
  if (cachedQuick) {
    console.log(`[predictions/quick] cache hit ${cacheKey}`);
    // Stamp fresh refresh counter so the client sees an accurate quota.
    return json(200, { ...cachedQuick, dailyRefreshes: consumed.dailyRefreshes, cached: true });
  }

  let picked = await pickFixtures(leagueId, explicitDate);
  let fixtures = picked.fixtures;

  // Auto-find-next: if today (no explicit date) returned empty, scan
  // forward up to 6 days for the next playable matchday.
  let autoSelected = false;
  if ((!fixtures || fixtures.length === 0) && !explicitDate) {
    const baseDate = picked.matchDate || todayDateStr();
    const next = await findNextDateWithFixtures(leagueId, baseDate);
    if (next) {
      picked = {
        fixtures: next.fixtures,
        dateLabel: labelForDateStr(next.date),
        matchDate: next.date,
        isPast: false,
        isUpcoming: true,
        isToday: false,
        mode: 'auto-next',
        seasonUsed: next.season,
      };
      fixtures = next.fixtures;
      autoSelected = true;
      console.log(`[predictions/quick] auto-selected next playable date: ${next.date}`);
    }
  }

  if (!fixtures || fixtures.length === 0) {
    return json(200, {
      league: league.name,
      leagueId,
      tier: user.tier,
      dailyRefreshes: consumed.dailyRefreshes,
      fixtures: [],
      dateLabel: picked.dateLabel,
      matchDate: picked.matchDate,
      isPast: picked.isPast,
      isUpcoming: picked.isUpcoming,
      isToday: picked.isToday,
      mode: picked.mode,
      message: 'No fixtures available right now — try a different date.',
    });
  }

  // Cap at 4 fixtures (same cap as the old heavy path).
  const MAX_FIXTURES = 4;
  const limited = fixtures.slice(0, MAX_FIXTURES);
  if (fixtures.length > MAX_FIXTURES) {
    console.log(`[predictions/quick] capping ${fixtures.length} fixtures at ${MAX_FIXTURES}`);
  }

  // All 4 fixtures processed in parallel; each fixture's 4 calls also in
  // parallel via fetchFixtureDetail. Net: 16 in-flight API-Football calls
  // max, all parallel. Cache hits skip the API entirely. Each fixture
  // detail call gets a one-shot rate-limit retry; failures surface as
  // a friendly "Data temporarily unavailable" string rather than the raw
  // API-Football error.
  const results = await Promise.all(
    limited.map(async (fx) => {
      try {
        const detail = await retryOnRateLimit(() => fetchFixtureDetail(fx, leagueId));
        return {
          // No DB id yet — /analyze inserts the prediction row and the
          // frontend receives the row id on that response.
          id: null,
          fixtureId: fx.fixture.id,
          league: league.name,
          kickoff: fx.fixture.date,
          venue: (fx.fixture && fx.fixture.venue && fx.fixture.venue.city) || null,
          home: {
            id: detail.homeId,
            name: fx.teams.home.name,
            form: detail.homeForm,
            restDays: detail.homeRest,
            goalsPerGame: detail.homeGpg,
          },
          away: {
            id: detail.awayId,
            name: fx.teams.away.name,
            form: detail.awayForm,
            restDays: detail.awayRest,
            goalsPerGame: detail.awayGpg,
          },
          actualResult: buildActualResult(fx, null),
          isSharpMove: false,
          predictions: null,
          aiStatus: 'pending',
          aiReason: null,
        };
      } catch (err) {
        const detailMsg = err && err.message ? err.message : String(err);
        const rateLimited = isRateLimitErr(err);
        console.error(`[predictions/quick] fixture ${fx.fixture.id} detail failed:`, detailMsg);
        return {
          fixtureId: fx.fixture.id,
          league: league.name,
          kickoff: fx.fixture.date,
          home: { name: fx.teams.home.name },
          away: { name: fx.teams.away.name },
          predictions: null,
          aiStatus: rateLimited ? 'pending' : 'error',
          error: 'Data temporarily unavailable',
        };
      }
    }),
  );

  const payload = {
    league: league.name,
    leagueId,
    tier: user.tier,
    dailyRefreshes: consumed.dailyRefreshes,
    dateLabel: picked.dateLabel,
    matchDate: picked.matchDate,
    isPast: picked.isPast,
    isUpcoming: picked.isUpcoming,
    isToday: picked.isToday,
    autoSelected,
    mode: picked.mode,
    seasonUsed: picked.seasonUsed,
    fixtures: results,
  };
  // Cache by both the original key (so a same-day no-date request gets the
  // same cached payload) and the resolved matchDate key when auto-selected.
  quickCacheSet(cacheKey, payload, picked.matchDate);
  if (autoSelected && picked.matchDate) {
    quickCacheSet(quickCacheKey(leagueId, picked.matchDate), payload, picked.matchDate);
  }
  return json(200, payload);
}

// ---------- /analyze — Claude-only path for one fixture ----------
//
// GET /api/predictions/analyze?fixtureId=NNN
// Re-pulls the fixture meta from API-Football (cached), re-pulls the same
// 4 form/stats calls /quick already warmed (cached), then runs Claude.
// Returns just the prediction shape so the dashboard can splice it into
// the existing card.
async function handleAnalyze(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const leagueId = MLS_LEAGUE_ID;
  const league = LEAGUES[leagueId];
  if (!league) return error(500, 'MLS league config missing');

  const qs = event.queryStringParameters || {};
  const fixtureId = parseInt(qs.fixtureId, 10);
  if (!Number.isFinite(fixtureId)) return error(400, 'fixtureId required');

  // Pull the raw fixture record for teams + status + venue.
  let fx;
  try {
    fx = await retryOnRateLimit(() => football.getFixtureById(fixtureId));
  } catch (err) {
    console.error('[predictions/analyze] getFixtureById failed:', err.message);
    return json(200, {
      fixtureId,
      predictions: null,
      aiStatus: 'error',
      aiReason: 'Data temporarily unavailable',
    });
  }
  if (!fx) return error(404, 'fixture not found');

  // Lean 4-call detail — cached from /quick when the dashboard called it.
  let detail;
  try {
    detail = await retryOnRateLimit(() => fetchFixtureDetail(fx, leagueId));
  } catch (err) {
    console.error('[predictions/analyze] detail fetch failed:', err.message);
    return json(200, {
      fixtureId,
      predictions: null,
      aiStatus: 'error',
      aiReason: 'Data temporarily unavailable',
    });
  }

  // Build the minimal matchData payload for Claude. No referee / weather /
  // injuries / H2H / fixture stats in this leaner build — Claude gets form,
  // stats, gpg, rest days, that's it.
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

  let analysis;
  try {
    analysis = await analyseMatch(matchData, false, false);
  } catch (err) {
    console.error('[predictions/analyze] Claude call failed:', err.message);
    return json(200, {
      fixtureId,
      predictions: null,
      aiStatus: 'error',
      aiReason: err.message || 'Claude call failed',
    });
  }

  // Optional auto-odds attach — same logic as the legacy handleLeague.
  let leagueOdds = null;
  try {
    leagueOdds = await oddsService.getMatchOdds(leagueId);
  } catch (err) {
    console.error('[predictions/analyze] odds fetch failed:', err.message);
  }
  let oddsData = null;
  const matchedOdds = oddsService.findOddsForFixture(leagueOdds, fx);
  if (matchedOdds) oddsData = oddsService.buildOddsData(matchedOdds, analysis);

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

  // Persist to predictions table so /history continues to work.
  let insertedId = null;
  try {
    const inserted = await sql()`
      INSERT INTO predictions
        (user_id, league, fixture_id, home_team, away_team, kickoff,
         over_line, over_confidence, btts, btts_confidence,
         ev_edge_over, ev_edge_btts, kelly_over, kelly_btts,
         best_over_odds, best_over_bookmaker, best_btts_odds, best_btts_bookmaker,
         auto_ev_over, auto_ev_btts)
      VALUES
        (${user.id}, ${league.name}, ${fx.fixture.id}, ${fx.teams.home.name}, ${fx.teams.away.name},
         ${fx.fixture.date}, ${analysis.over.line}, ${Math.round(analysis.over.confidence)},
         ${analysis.btts.prediction}, ${Math.round(analysis.btts.confidence)},
         ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null},
         ${kellyOverAuto}, ${kellyBttsAuto},
         ${oddsData ? oddsData.bestOverOdds : null}, ${oddsData ? oddsData.bestOverBookmaker : null},
         ${oddsData ? oddsData.bestBttsOdds : null}, ${oddsData ? oddsData.bestBttsBookmaker : null},
         ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null})
      RETURNING id`;
    insertedId = inserted[0] && inserted[0].id;

    // Past fixture? Backfill the hit columns immediately.
    const actualResult = buildActualResult(fx, analysis);
    if (actualResult && insertedId) {
      try {
        await sql()`UPDATE predictions
                    SET over_hit = ${actualResult.overHit}, btts_hit = ${actualResult.bttsHit}
                    WHERE id = ${insertedId}`;
      } catch (e) {
        console.error('[predictions/analyze] past-fixture hit backfill failed:', e.message);
      }
    }
  } catch (err) {
    console.error('[predictions/analyze] DB insert failed:', err.message);
    // Non-fatal — still return the AI prediction to the client.
  }

  // Calibration: enrich the returned predictions with calibratedConfidence
  // so the dashboard MatchCard can show "raw 78% / calibrated 64%" when the
  // model is mis-calibrated. Errors here are non-fatal.
  let analyzeAdjustments = null;
  try {
    analyzeAdjustments = await loadAdjustments();
  } catch {
    analyzeAdjustments = null;
  }
  const overOut = {
    ...analysis.over,
    calibratedConfidence: analyzeAdjustments
      ? calibrate(analysis.over.confidence, 'over', analyzeAdjustments)
      : null,
  };
  const bttsOut = {
    ...analysis.btts,
    calibratedConfidence: analyzeAdjustments
      ? calibrate(analysis.btts.confidence, 'btts', analyzeAdjustments)
      : null,
  };

  return json(200, {
    id: insertedId,
    fixtureId: fx.fixture.id,
    predictions: {
      over: overOut,
      btts: bttsOut,
      firstHalf: null,
      asianHandicap: null,
    },
    aiStatus: analysis.aiStatus || 'ok',
    aiReason: analysis.aiReason || null,
    actualResult: buildActualResult(fx, analysis),
    ev: {
      over: autoEvOver,
      btts: autoEvBtts,
      kellyOver: kellyOverAuto,
      kellyBtts: kellyBttsAuto,
    },
    oddsData: oddsData
      ? {
          overLine: oddsData.overLine,
          bestOverOdds: oddsData.bestOverOdds,
          bestOverBookmaker: oddsData.bestOverBookmaker,
          bestBttsOdds: oddsData.bestBttsOdds,
          bestBttsBookmaker: oddsData.bestBttsBookmaker,
          bttsSide: oddsData.bttsSide,
          bookmakerCount: oddsData.bookmakerCount,
          allBookmakers: oddsData.allBookmakers,
          autoEV: {
            overEdge: autoEvOver ? autoEvOver.edge : null,
            overBadge: autoEvOver ? autoEvOver.valueBadge : null,
            bttsEdge: autoEvBtts ? autoEvBtts.edge : null,
            bttsBadge: autoEvBtts ? autoEvBtts.valueBadge : null,
            kellyOver: kellyOverAuto || null,
            kellyBtts: kellyBttsAuto || null,
          },
        }
      : null,
  });
}

// ---------- /253 — LEGACY handler ----------
//
// Same lean 4-call shape /quick uses, with Claude analysis bundled in.
// Stays available for backwards compat (anything that hits the old
// `/api/predictions/253` URL). Dashboard now uses /quick + /analyze.
async function handleLeague(event, _leagueIdFromPath) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const leagueId = MLS_LEAGUE_ID;
  const league = LEAGUES[leagueId];
  if (!league) return error(500, 'MLS league config missing');

  void tierRank;
  void TIER_LEAGUES;

  const qs = event.queryStringParameters || {};
  const isInitial = qs.initial === '1' || qs.initial === 'true';
  const consumed = await consumeRefresh(user, isInitial);
  if (!consumed.ok) return error(429, consumed.reason, { tier: user.tier });

  const explicitDate = typeof qs.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(qs.date) ? qs.date : null;
  const picked = await pickFixtures(leagueId, explicitDate);
  const fixtures = picked.fixtures;

  if (!fixtures || fixtures.length === 0) {
    return json(200, {
      league: league.name,
      leagueId,
      tier: user.tier,
      dailyRefreshes: consumed.dailyRefreshes,
      fixtures: [],
      dateLabel: picked.dateLabel,
      matchDate: picked.matchDate,
      isPast: picked.isPast,
      isUpcoming: picked.isUpcoming,
      isToday: picked.isToday,
      mode: picked.mode,
      message: 'No fixtures available right now — try a different date.',
    });
  }

  // Optional odds fetch — non-fatal.
  let leagueOdds = null;
  try {
    leagueOdds = await oddsService.getMatchOdds(leagueId);
  } catch (err) {
    console.error('odds fetch failed:', err.message);
  }

  // Sharp-move flags (batched).
  const fixtureIds = fixtures.map((f) => f.fixture && f.fixture.id).filter(Boolean);
  let sharpFixtureSet = new Set();
  if (fixtureIds.length) {
    try {
      const sharpRows = await sql()`
        SELECT DISTINCT fixture_id FROM odds_movements
        WHERE fixture_id = ANY(${fixtureIds})
          AND is_sharp_move = TRUE
          AND detected_at > NOW() - INTERVAL '12 hours'`;
      sharpFixtureSet = new Set(sharpRows.map((r) => Number(r.fixture_id)));
    } catch (e) {
      // odds_movements may not exist yet — non-fatal.
    }
  }

  const MAX_FIXTURES = 4;
  const limited = fixtures.slice(0, MAX_FIXTURES);
  if (fixtures.length > MAX_FIXTURES) {
    console.log(`[predictions/legacy] capping ${fixtures.length} fixtures at ${MAX_FIXTURES}`);
  }

  // Parallel per-fixture: 4-call detail in parallel, then Claude.
  const results = await Promise.all(
    limited.map(async (fx) => {
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
        const matchedOdds = oddsService.findOddsForFixture(leagueOdds, fx);
        if (matchedOdds) oddsData = oddsService.buildOddsData(matchedOdds, analysis);

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

        const inserted = await sql()`
          INSERT INTO predictions
            (user_id, league, fixture_id, home_team, away_team, kickoff,
             over_line, over_confidence, btts, btts_confidence,
             ev_edge_over, ev_edge_btts, kelly_over, kelly_btts,
             best_over_odds, best_over_bookmaker, best_btts_odds, best_btts_bookmaker,
             auto_ev_over, auto_ev_btts)
          VALUES
            (${user.id}, ${league.name}, ${fx.fixture.id}, ${fx.teams.home.name}, ${fx.teams.away.name},
             ${fx.fixture.date}, ${analysis.over.line}, ${Math.round(analysis.over.confidence)},
             ${analysis.btts.prediction}, ${Math.round(analysis.btts.confidence)},
             ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null},
             ${kellyOverAuto}, ${kellyBttsAuto},
             ${oddsData ? oddsData.bestOverOdds : null}, ${oddsData ? oddsData.bestOverBookmaker : null},
             ${oddsData ? oddsData.bestBttsOdds : null}, ${oddsData ? oddsData.bestBttsBookmaker : null},
             ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null})
          RETURNING id`;

        const actualResult = buildActualResult(fx, analysis);
        if (actualResult) {
          try {
            await sql()`UPDATE predictions
                        SET over_hit = ${actualResult.overHit}, btts_hit = ${actualResult.bttsHit}
                        WHERE id = ${inserted[0].id}`;
          } catch (e) {
            console.error('past-fixture hit backfill failed:', e.message);
          }
        }

        return {
          id: inserted[0].id,
          fixtureId: fx.fixture.id,
          league: league.name,
          kickoff: fx.fixture.date,
          venue: (fx.fixture && fx.fixture.venue && fx.fixture.venue.city) || null,
          home: {
            id: detail.homeId,
            name: fx.teams.home.name,
            form: detail.homeForm,
            restDays: detail.homeRest,
            goalsPerGame: detail.homeGpg,
          },
          away: {
            id: detail.awayId,
            name: fx.teams.away.name,
            form: detail.awayForm,
            restDays: detail.awayRest,
            goalsPerGame: detail.awayGpg,
          },
          actualResult,
          isSharpMove: sharpFixtureSet.has(Number(fx.fixture.id)),
          predictions: {
            over: analysis.over,
            btts: analysis.btts,
            firstHalf: null,
            asianHandicap: null,
          },
          aiStatus: analysis.aiStatus || 'ok',
          aiReason: analysis.aiReason || null,
          ev: {
            over: autoEvOver,
            btts: autoEvBtts,
            kellyOver: kellyOverAuto,
            kellyBtts: kellyBttsAuto,
          },
          oddsData: oddsData
            ? {
                overLine: oddsData.overLine,
                bestOverOdds: oddsData.bestOverOdds,
                bestOverBookmaker: oddsData.bestOverBookmaker,
                bestBttsOdds: oddsData.bestBttsOdds,
                bestBttsBookmaker: oddsData.bestBttsBookmaker,
                bttsSide: oddsData.bttsSide,
                bookmakerCount: oddsData.bookmakerCount,
                allBookmakers: oddsData.allBookmakers,
                autoEV: {
                  overEdge: autoEvOver ? autoEvOver.edge : null,
                  overBadge: autoEvOver ? autoEvOver.valueBadge : null,
                  bttsEdge: autoEvBtts ? autoEvBtts.edge : null,
                  bttsBadge: autoEvBtts ? autoEvBtts.valueBadge : null,
                  kellyOver: kellyOverAuto || null,
                  kellyBtts: kellyBttsAuto || null,
                },
              }
            : null,
        };
      } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        console.error(`Fixture ${fx.fixture.id} failed:`, detail);
        return {
          fixtureId: fx.fixture.id,
          league: league.name,
          kickoff: fx.fixture.date,
          home: { name: fx.teams.home.name },
          away: { name: fx.teams.away.name },
          error: `Analysis failed: ${detail}`,
        };
      }
    }),
  );

  return json(200, {
    league: league.name,
    leagueId,
    tier: user.tier,
    dailyRefreshes: consumed.dailyRefreshes,
    dateLabel: picked.dateLabel,
    matchDate: picked.matchDate,
    isPast: picked.isPast,
    isUpcoming: picked.isUpcoming,
    isToday: picked.isToday,
    mode: picked.mode,
    seasonUsed: picked.seasonUsed,
    fixtures: results,
  });
}

// GET /api/predictions/upcoming/:leagueId — date-pill helper (unchanged).
async function handleUpcoming(event, _leagueIdFromPath) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  void user;
  const leagueId = MLS_LEAGUE_ID;
  const league = LEAGUES[leagueId];
  if (!league) return error(500, 'MLS league config missing');

  const qs = event.queryStringParameters || {};
  const past   = clamp(parseInt(qs.past, 10), 0, 14, 0);
  const future = clamp(parseInt(qs.future, 10), 1, 14, 7);

  const today = todayDateStr();
  const days = [];
  for (let i = -past; i < 0; i++) {
    const dateStr = addDaysStr(today, i);
    let count = null;
    try {
      count = await football.getFixtureCountByDateAuto(leagueId, dateStr, 86400);
    } catch (e) {
      console.error(`upcoming scan failed for ${dateStr}:`, e.message);
    }
    days.push({
      date: dateStr,
      count: count == null ? null : Number(count),
      label: labelForDateStr(dateStr),
      isToday: false,
      isPast: true,
    });
  }
  for (let i = 0; i < future; i++) {
    const dateStr = addDaysStr(today, i);
    let count = null;
    try {
      const ttl = i === 0 ? 300 : 3600;
      count = await football.getFixtureCountByDateAuto(leagueId, dateStr, ttl);
    } catch (e) {
      console.error(`upcoming scan failed for ${dateStr}:`, e.message);
    }
    days.push({
      date: dateStr,
      count: count == null ? null : Number(count),
      label: labelForDateStr(dateStr),
      isToday: i === 0,
      isPast: false,
    });
  }

  return json(200, { leagueId, league: league.name, days });
}

function clamp(n, lo, hi, fallback) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

// GET /api/predictions/test — unauthenticated probe (unchanged).
async function handleTest(event) {
  const today = todayDateStr();
  const tomorrow = addDaysStr(today, 1);
  const leagueId = 253;
  const probes = [
    { tag: 'today_2024',    params: { league: leagueId, season: 2024, date: today } },
    { tag: 'today_2025',    params: { league: leagueId, season: 2025, date: today } },
    { tag: 'tomorrow_2024', params: { league: leagueId, season: 2024, date: tomorrow } },
    { tag: 'tomorrow_2025', params: { league: leagueId, season: 2025, date: tomorrow } },
    { tag: 'last10_2024',   params: { league: leagueId, season: 2024, last: 10 } },
    { tag: 'last10_2025',   params: { league: leagueId, season: 2025, last: 10 } },
  ];

  const results = {};
  for (const p of probes) {
    const url = football.buildUrl('/fixtures', p.params);
    const start = Date.now();
    try {
      const response = await football.apiGet('/fixtures', p.params, { tag: `probe ${p.tag}` });
      results[p.tag] = {
        ok: true,
        url,
        durationMs: Date.now() - start,
        responseCount: response.length,
        firstFixture: response[0] ? {
          id: response[0].fixture && response[0].fixture.id,
          date: response[0].fixture && response[0].fixture.date,
          status: response[0].fixture && response[0].fixture.status,
          home: response[0].teams && response[0].teams.home && response[0].teams.home.name,
          away: response[0].teams && response[0].teams.away && response[0].teams.away.name,
          score: response[0].goals,
        } : null,
        sample: response.slice(0, 3),
      };
    } catch (err) {
      results[p.tag] = { ok: false, url, durationMs: Date.now() - start, error: err.message };
    }
  }

  const verdict = (() => {
    if (results.today_2025 && results.today_2025.responseCount > 0) return { working: true, season: 2025, source: 'today_2025' };
    if (results.today_2024 && results.today_2024.responseCount > 0) return { working: true, season: 2024, source: 'today_2024' };
    if (results.tomorrow_2025 && results.tomorrow_2025.responseCount > 0) return { working: true, season: 2025, source: 'tomorrow_2025' };
    if (results.tomorrow_2024 && results.tomorrow_2024.responseCount > 0) return { working: true, season: 2024, source: 'tomorrow_2024' };
    if (results.last10_2025 && results.last10_2025.responseCount > 0) return { working: true, season: 2025, source: 'last10_2025' };
    if (results.last10_2024 && results.last10_2024.responseCount > 0) return { working: true, season: 2024, source: 'last10_2024' };
    const anyAuth = Object.values(results).some((r) => r.error && r.error.includes('auth failed'));
    if (anyAuth) return { working: false, reason: 'auth_failed', hint: 'Check FOOTBALL_API_KEY on Netlify env vars + redeploy.' };
    const anyQuota = Object.values(results).some((r) => r.error && r.error.includes('429'));
    if (anyQuota) return { working: false, reason: 'quota_exhausted' };
    return { working: false, reason: 'no_data', hint: 'Both seasons returned 0 fixtures for this league today/tomorrow/last10. Try a different league or check season=2025 has started.' };
  })();

  return json(200, {
    now: new Date().toISOString(),
    today,
    tomorrow,
    leagueId,
    leagueName: 'MLS',
    keyConfigured: !!process.env.FOOTBALL_API_KEY,
    keyLength: process.env.FOOTBALL_API_KEY ? process.env.FOOTBALL_API_KEY.length : 0,
    defaultSeason: football.SEASON,
    verdict,
    probes: results,
  });
}

// GET /api/predictions/ai-test (unchanged).
async function handleAITest(_event) {
  const axios = require('axios');
  const key = process.env.OPENROUTER_API_KEY || '';
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const MODEL = 'anthropic/claude-3.5-haiku';

  const meta = {
    now: new Date().toISOString(),
    model: MODEL,
    keyConfigured: !!key,
    keyLength: key.length,
    keyPrefix: key ? key.slice(0, 8) : null,
    keyLooksValid: /^sk-or-v1-/.test(key),
    referer: process.env.URL || null,
  };

  if (!key) {
    return json(200, {
      ...meta,
      verdict: 'OPENROUTER_API_KEY is not set in Netlify env vars. The prediction pipeline falls back to 50% confidence for every match. Add the key and redeploy.',
    });
  }

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You return ONLY valid JSON with shape {"ping":"pong","model":"<model name>"}.' },
      { role: 'user', content: 'ping' },
    ],
    max_tokens: 50,
  };

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'X-Title': 'FastScore',
  };
  if (process.env.URL) headers['HTTP-Referer'] = process.env.URL;

  const started = Date.now();
  try {
    const res = await axios.post(OPENROUTER_URL, body, { headers, timeout: 20000, validateStatus: () => true });
    const ms = Date.now() - started;
    const content = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message
      ? res.data.choices[0].message.content
      : null;
    let verdict;
    if (res.status === 200 && content) verdict = `OK OpenRouter is reachable, model ${MODEL} replied. AI should be running on the dashboard.`;
    else if (res.status === 401) verdict = '401 from OpenRouter — your OPENROUTER_API_KEY is invalid or revoked.';
    else if (res.status === 402) verdict = '402 from OpenRouter — out of credits. Top up your OpenRouter account.';
    else if (res.status === 404) verdict = `404 — model "${MODEL}" not found on OpenRouter. Try a different model id.`;
    else if (res.status === 429) verdict = '429 — rate limited by OpenRouter.';
    else verdict = `HTTP ${res.status} from OpenRouter. See body below.`;
    return json(200, { ...meta, durationMs: ms, httpStatus: res.status, verdict, content, rawBody: res.data });
  } catch (err) {
    return json(200, {
      ...meta,
      durationMs: Date.now() - started,
      verdict: `Request failed before a response came back: ${err.message}`,
      errorCode: err.code || null,
      errorMessage: err.message,
    });
  }
}

// GET /api/predictions/debug/:fixtureId?key=<ADMIN_PASSWORD>
//
// Inspector endpoint for verifying what the scan would actually pull and
// save for a single fixture. Returns every raw API-Football response we
// touch (fixture, last home/away games, team stats, h2h) plus the
// extracted form arrays, the gpgFromStats output, the referee block,
// and the EXACT matchData object that would be handed to Claude.
//
// Auth: ADMIN_PASSWORD via ?key= (same pattern as /api/migrate). I
// pushed back on "no auth required" — this endpoint leaks the upstream
// API shape and could be hammered to burn API-Football quota. Cheap
// admin gate, consistent with the rest of the admin surface.
async function handleDebugFixture(event, fixtureIdStr) {
  const expected = process.env.ADMIN_PASSWORD || '';
  const supplied = (event && event.queryStringParameters && event.queryStringParameters.key) || '';
  if (!expected) return error(503, 'ADMIN_PASSWORD not set on server');
  if (supplied !== expected) return error(401, 'Unauthorized — pass ?key=<ADMIN_PASSWORD>');

  const fixtureId = parseInt(fixtureIdStr, 10);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return error(400, 'fixtureId must be a positive integer');
  }

  // 1. Raw fixture.
  let rawFixture = null;
  try {
    rawFixture = await football.getFixtureById(fixtureId);
  } catch (e) {
    return json(500, { stage: 'getFixtureById', error: e.message, fixtureId });
  }
  if (!rawFixture) {
    return json(404, { stage: 'getFixtureById', error: 'fixture not found', fixtureId });
  }
  const homeId = rawFixture.teams && rawFixture.teams.home && rawFixture.teams.home.id;
  const awayId = rawFixture.teams && rawFixture.teams.away && rawFixture.teams.away.id;
  const leagueId = rawFixture.league && rawFixture.league.id;
  const seasonHint = rawFixture.league && rawFixture.league.season;

  // 2. Raw per-team last-N + team stats + h2h, in parallel. We capture
  //    errors per call so a partial failure still surfaces the rest.
  async function safe(label, p) {
    try { return { ok: true, label, data: await p }; }
    catch (e) { return { ok: false, label, error: e.message }; }
  }
  const [homeLastR, awayLastR, homeStatsR, awayStatsR, h2hR] = await Promise.all([
    safe('homeLast', football.getTeamLastHomeGames(homeId, leagueId, seasonHint)),
    safe('awayLast', football.getTeamLastAwayGames(awayId, leagueId, seasonHint)),
    safe('homeStats', football.getTeamStats(homeId, leagueId, seasonHint)),
    safe('awayStats', football.getTeamStats(awayId, leagueId, seasonHint)),
    safe('h2h', football.getH2H(homeId, awayId)),
  ]);

  // 3. Run the same extractors the scan would run.
  const homeForm = homeLastR.ok ? football.extractFormForTeam(homeLastR.data, homeId) : null;
  const awayForm = awayLastR.ok ? football.extractFormForTeam(awayLastR.data, awayId) : null;

  // 4. Synthesize the matchData object the scan would build & hand to
  //    Claude. Mirrors fetchFixtureDetail in predictions-scan-background.
  const refNameRaw = rawFixture.fixture && typeof rawFixture.fixture.referee === 'string'
    ? rawFixture.fixture.referee.trim() : '';
  const matchDataPreview = {
    league: rawFixture.league && rawFixture.league.name,
    kickoff: rawFixture.fixture && rawFixture.fixture.date,
    venue: rawFixture.fixture && rawFixture.fixture.venue && rawFixture.fixture.venue.city,
    home: {
      id: homeId,
      name: rawFixture.teams && rawFixture.teams.home && rawFixture.teams.home.name,
      form: homeForm,
      stats: homeStatsR.ok ? homeStatsR.data : null,
    },
    away: {
      id: awayId,
      name: rawFixture.teams && rawFixture.teams.away && rawFixture.teams.away.name,
      form: awayForm,
      stats: awayStatsR.ok ? awayStatsR.data : null,
    },
    referee: refNameRaw ? { name: refNameRaw } : null,
  };

  return json(200, {
    fixtureId,
    fetchedAt: new Date().toISOString(),
    rawFixture,
    raw: {
      homeLast: homeLastR,
      awayLast: awayLastR,
      homeStats: homeStatsR,
      awayStats: awayStatsR,
      h2h: h2hR,
    },
    extracted: {
      homeForm,
      awayForm,
      refereeName: refNameRaw || null,
    },
    matchDataPreview,
  });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');

    const path = subPath(event, 'predictions');

    // /debug/:fixtureId — admin-gated inspector. See handleDebugFixture.
    const debugMatch = path.match(/^\/debug\/(\d+)\/?$/);
    if (debugMatch) return await handleDebugFixture(event, debugMatch[1]);

    // /test — unauthenticated debug probe.
    if (path === '/test' || path === '/test/') return await handleTest(event);

    // /ai-test — unauthenticated OpenRouter probe.
    if (path === '/ai-test' || path === '/ai-test/') return await handleAITest(event);

    // /week — weekly Monday-Sunday read endpoint. Triggers background scan
    // when the table is empty for the current week.
    if (path === '/week' || path === '/week/') {
      return await handleWeek(event);
    }

    // /quick — fixtures + form + stats only (NO Claude). Progressive-load entry.
    if (path === '/quick' || path === '/quick/' || path === '/253/quick' || path === '/253/quick/') {
      return await handleQuick(event);
    }

    // /analyze — Claude-only path for one fixture. Reads ?fixtureId=NN.
    if (path === '/analyze' || path === '/analyze/' || path.endsWith('/analyze') || path.endsWith('/analyze/')) {
      return await handleAnalyze(event);
    }

    // /upcoming/:leagueId — date-pill helper
    const upcomingMatch = path.match(/^\/upcoming\/(\d+)\/?$/);
    if (upcomingMatch) return await handleUpcoming(event, parseInt(upcomingMatch[1], 10));

    // /:leagueId — legacy bundled path (kept for backwards compat).
    const leagueMatch = path.match(/^\/(\d+)\/?$/);
    if (leagueMatch) return await handleLeague(event, parseInt(leagueMatch[1], 10));

    return notFound();
  } catch (err) {
    console.error('predictions handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
