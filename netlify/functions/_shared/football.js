const axios = require('axios');
const { getOrFetch } = require('./cache');

const BASE_URL = 'https://v3.football.api-sports.io';
// Default season. Override per call by passing { season } in params — used
// by the cascade in predictions.js to retry 2025 when 2024 returns nothing.
const SEASON = parseInt(process.env.FOOTBALL_DEFAULT_SEASON, 10) || 2024;

function client() {
  return axios.create({
    baseURL: BASE_URL,
    headers: { 'x-apisports-key': process.env.FOOTBALL_API_KEY },
    timeout: 15000,
    validateStatus: () => true, // we want full visibility on non-2xx
  });
}

function buildUrl(endpoint, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  }
  return `${BASE_URL}${endpoint}${qs.toString() ? `?${qs.toString()}` : ''}`;
}

// apiGet — verbose by default. Logs the exact URL we hit, the HTTP status,
// any API-Football errors body, and how many rows came back. The API key is
// never in the URL (it's a header), so the logged URL is safe.
async function apiGet(endpoint, params, { tag = '' } = {}) {
  const url = buildUrl(endpoint, params);
  const prefix = `[apiFootball${tag ? ' ' + tag : ''}]`;
  if (!process.env.FOOTBALL_API_KEY) {
    console.error(`${prefix} FOOTBALL_API_KEY is not set — every request will 401.`);
  }
  console.log(`${prefix} GET ${url}`);
  let res;
  try {
    res = await client().get(endpoint, { params });
  } catch (err) {
    console.error(`${prefix} network error: ${err.message}`);
    throw new Error(`API-Football ${endpoint} network error: ${err.message}`);
  }

  const data = res.data || {};
  const errors = data.errors;
  const results = typeof data.results === 'number' ? data.results : null;
  const responseLen = Array.isArray(data.response) ? data.response.length : null;
  console.log(
    `${prefix} status=${res.status} results=${results} responseLen=${responseLen}` +
      (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)
        ? ` errors=${JSON.stringify(errors)}`
        : ''),
  );

  if (res.status === 401 || res.status === 403) {
    throw new Error(`API-Football ${endpoint} ${res.status}: auth failed — check FOOTBALL_API_KEY (paid plan keys use the same endpoint).`);
  }
  if (res.status === 429) {
    throw new Error(`API-Football ${endpoint} 429: daily quota reached.`);
  }
  if (res.status >= 400) {
    throw new Error(`API-Football ${endpoint} ${res.status} ${res.statusText}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  // Some endpoints return errors inside a 200 envelope. Treat as failure.
  if (errors && ((Array.isArray(errors) && errors.length > 0) || (typeof errors === 'object' && Object.keys(errors).length > 0))) {
    throw new Error(`API-Football ${endpoint}: ${JSON.stringify(errors)}`);
  }
  return Array.isArray(data.response) ? data.response : [];
}

function todayString() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Fetch fixtures for a specific date. Caller picks TTL based on temporality:
//   • today -> 300s (lineups, late changes)
//   • future -> 3600s (rarely changes)
//   • past   -> 86400s (final results don't change)
async function getFixturesByDate(leagueId, dateStr, ttlSeconds, seasonOverride) {
  const season = Number.isFinite(seasonOverride) ? seasonOverride : SEASON;
  const params = { league: leagueId, season, date: dateStr };
  return getOrFetch('/fixtures', params, () => apiGet('/fixtures', params, { tag: `byDate ${dateStr} s${season}` }), ttlSeconds);
}

async function getTodayFixtures(leagueId) {
  return getFixturesByDate(leagueId, todayString(), 300);
}

// Last N completed fixtures for the league (across all teams). Used as the
// graceful fallback when there are no upcoming matches in the next week.
async function getRecentPlayedFixtures(leagueId, last = 10) {
  const params = { league: leagueId, season: SEASON, last };
  return getOrFetch('/fixtures', params, () => apiGet('/fixtures', params), 86400);
}

// Lightweight: just the count of fixtures on a date. Reuses the same cache
// entry as a full fetch, so a subsequent call for the same date is free.
async function getFixtureCountByDate(leagueId, dateStr, ttlSeconds) {
  const list = await getFixturesByDate(leagueId, dateStr, ttlSeconds);
  return Array.isArray(list) ? list.length : 0;
}

// Candidate API-Football season keys for a given calendar date. MLS and
// most domestic leagues key seasons by year; a 2026-05-24 game lives in
// season 2026, but the default SEASON env var may still be 2025. Returns
// [year-of-date, year-of-date - 1, SEASON, SEASON+1] deduped — try in
// order, first one that returns rows wins.
function candidateSeasonsForDate(dateStr) {
  const seasons = [];
  const seen = new Set();
  const add = (s) => {
    if (Number.isFinite(s) && !seen.has(s)) { seen.add(s); seasons.push(s); }
  };
  const yearOfDate = dateStr && /^\d{4}-/.test(dateStr) ? parseInt(dateStr.slice(0, 4), 10) : null;
  if (yearOfDate) {
    add(yearOfDate);
    add(yearOfDate - 1);
  }
  add(SEASON);
  add(SEASON + 1);
  return seasons;
}

// Like getFixturesByDate but tries multiple season keys until one comes
// back non-empty. Used by the date-pill scan so a date in calendar year
// 2026 doesn't return 0 just because the default SEASON is still 2025.
// Returns { fixtures, season } so callers can know which season matched.
async function getFixturesByDateAuto(leagueId, dateStr, ttlSeconds) {
  const candidates = candidateSeasonsForDate(dateStr);
  let lastFixtures = [];
  for (const season of candidates) {
    const list = await getFixturesByDate(leagueId, dateStr, ttlSeconds, season);
    if (Array.isArray(list) && list.length > 0) return { fixtures: list, season };
    lastFixtures = list || [];
  }
  return { fixtures: lastFixtures, season: candidates[0] || SEASON };
}

async function getFixtureCountByDateAuto(leagueId, dateStr, ttlSeconds) {
  const { fixtures } = await getFixturesByDateAuto(leagueId, dateStr, ttlSeconds);
  return Array.isArray(fixtures) ? fixtures.length : 0;
}

// API-Football's /fixtures `venue` param now expects an INTEGER venue ID
// (it used to accept the strings 'home' / 'away'). To preserve the
// home/away split without venue lookups, fetch the team's last N games
// regardless of venue, then filter in JS by checking the home/away team
// ids on each returned fixture.
// Per-call TTLs are explicit so cache.js's default never silently downgrades
// us. 3600s (1h) is the spec-mandated default for everything except live
// fixture lookups (which already use date-aware TTLs above).
async function getTeamLastHomeGames(teamId, leagueId) {
  const params = { team: teamId, league: leagueId, season: SEASON, last: 10 };
  // 2h TTL — last-N results don't change between fixture refreshes, and the
  // progressive-load path hits this on every dashboard mount.
  const all = await getOrFetch('/fixtures', params, () => apiGet('/fixtures', params), 7200);
  if (!Array.isArray(all)) return [];
  return all.filter((f) => f.teams && f.teams.home && f.teams.home.id === teamId).slice(0, 5);
}

async function getTeamLastAwayGames(teamId, leagueId) {
  const params = { team: teamId, league: leagueId, season: SEASON, last: 10 };
  const all = await getOrFetch('/fixtures', params, () => apiGet('/fixtures', params), 7200);
  if (!Array.isArray(all)) return [];
  return all.filter((f) => f.teams && f.teams.away && f.teams.away.id === teamId).slice(0, 5);
}

async function getH2H(homeId, awayId) {
  const params = { h2h: `${homeId}-${awayId}`, last: 5 };
  return getOrFetch('/fixtures/headtohead', params, () => apiGet('/fixtures/headtohead', params), 3600);
}

async function getTeamStats(teamId, leagueId) {
  const params = { team: teamId, league: leagueId, season: SEASON };
  // 2h TTL — season-aggregate stats move slowly enough that an hour is
  // overkill on the dashboard hot path.
  return getOrFetch('/teams/statistics', params, async () => {
    const res = await client().get('/teams/statistics', { params });
    return res.data && res.data.response ? res.data.response : null;
  }, 7200);
}

async function getTeamFixtures(teamId, leagueId) {
  const params = { team: teamId, league: leagueId, season: SEASON, last: 2 };
  // 2h TTL — kept defined for the rest-days fallback in the lean
  // /quick path even though the spec'd 4-call minimum doesn't use it.
  return getOrFetch('/fixtures', params, () => apiGet('/fixtures', params), 7200);
}

// Fetch a single fixture by its API-Football ID. Bypasses the general cache
// so we always read the latest status. The results worker only calls this
// for matches that should be over, so the volume is bounded.
async function getFixtureById(fixtureId) {
  const res = await client().get('/fixtures', { params: { id: fixtureId } });
  if (res.data && res.data.errors && Object.keys(res.data.errors).length > 0) {
    throw new Error(`API-Football /fixtures id=${fixtureId}: ${JSON.stringify(res.data.errors)}`);
  }
  const list = res.data && Array.isArray(res.data.response) ? res.data.response : [];
  return list[0] || null;
}

// Per-team statistics for a specific (completed) fixture. xG, shots, possession.
// Returns shape: [{ teamId, name, xg, shotsOn, shotsOff, possession }] or [].
async function getFixtureStats(fixtureId) {
  const params = { fixture: fixtureId };
  return getOrFetch('/fixtures/statistics', params, async () => {  // 1h TTL — once a match ends, stats are stable.
    try {
      const res = await client().get('/fixtures/statistics', { params });
      const data = res.data && Array.isArray(res.data.response) ? res.data.response : [];
      return data.map((team) => {
        const stats = Array.isArray(team.statistics) ? team.statistics : [];
        const grab = (label) => {
          const m = stats.find((s) => s.type && s.type.toLowerCase() === label.toLowerCase());
          return m ? m.value : null;
        };
        const xg = grab('expected_goals') ?? grab('expected goals') ?? grab('xg');
        return {
          teamId: team.team && team.team.id,
          name: team.team && team.team.name,
          xg: xg != null ? parseFloat(xg) : null,
          shotsOn: parseInt(grab('Shots on Goal'), 10) || null,
          shotsOff: parseInt(grab('Shots off Goal'), 10) || null,
          possession: grab('Ball Possession') || null,
        };
      });
    } catch {
      return [];
    }
  }, 3600);
}

// Referee tendencies across their recent matches officiated.
// Cached aggressively because trends change slowly. The cache module's
// default 30-min TTL is too short, so we layer an in-memory 24h cache here.
const refereeCache = new Map(); // name -> { value, expires }
const REFEREE_TTL_MS = 24 * 60 * 60 * 1000;

async function getRefereeStats(refereeName) {
  if (!refereeName) return null;
  const key = refereeName.toLowerCase();
  const cached = refereeCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const res = await client().get('/fixtures', {
      params: { referee: refereeName, season: SEASON, last: 20 },
    });
    const fixtures = res.data && Array.isArray(res.data.response) ? res.data.response : [];
    if (fixtures.length === 0) {
      const empty = { name: refereeName, matchesAnalysed: 0 };
      refereeCache.set(key, { value: empty, expires: Date.now() + REFEREE_TTL_MS });
      return empty;
    }
    let totalGoals = 0;
    let bttsCount = 0;
    let over25Count = 0;
    for (const f of fixtures) {
      const h = f.goals && f.goals.home;
      const a = f.goals && f.goals.away;
      if (h == null || a == null) continue;
      totalGoals += Number(h) + Number(a);
      if (Number(h) > 0 && Number(a) > 0) bttsCount += 1;
      if (Number(h) + Number(a) >= 3) over25Count += 1;
    }
    const n = fixtures.length;
    const stats = {
      name: refereeName,
      matchesAnalysed: n,
      avgGoalsPerGame: Math.round((totalGoals / n) * 100) / 100,
      bttsRate: Math.round((bttsCount / n) * 1000) / 10, // percent
      over25Rate: Math.round((over25Count / n) * 1000) / 10,
    };
    refereeCache.set(key, { value: stats, expires: Date.now() + REFEREE_TTL_MS });
    return stats;
  } catch (err) {
    console.error('[football] referee fetch failed:', err.message);
    return null;
  }
}

// Injuries / suspensions for a team in a specific fixture. Cached 1h —
// injury lists do change intra-day but rarely within a 60-minute window.
async function getTeamInjuries(teamId, fixtureId) {
  if (!teamId || !fixtureId) return [];
  const params = { team: teamId, fixture: fixtureId };
  return getOrFetch('/injuries', params, async () => {
    try {
      const res = await client().get('/injuries', { params });
      const list = res.data && Array.isArray(res.data.response) ? res.data.response : [];
      return list.map((item) => ({
        player: item.player && item.player.name,
        position: item.player && item.player.position,
        type: item.player && item.player.type, // "Missing Fixture" / "Suspended" etc.
        reason: item.player && item.player.reason,
      }));
    } catch (err) {
      console.error('[football] injuries fetch failed:', err.message);
      return [];
    }
  }, 3600);
}

// Heuristic: a player is "key" if they're a goalkeeper or hold a striker
// role and we don't have a way to check their season minutes here.
function flagKeyPlayer(inj) {
  const pos = String(inj.position || '').toLowerCase();
  return pos.includes('goalkeeper') || pos.includes('attacker') || pos.includes('forward');
}

function extractFormForTeam(fixtures, teamId) {
  if (!Array.isArray(fixtures)) return [];
  return fixtures
    .slice()
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
    .map((f) => {
      const isHome = f.teams.home.id === teamId;
      const myG = isHome ? f.goals.home : f.goals.away;
      const theirG = isHome ? f.goals.away : f.goals.home;
      if (myG == null || theirG == null) return 'D';
      if (myG > theirG) return 'W';
      if (myG < theirG) return 'L';
      return 'D';
    });
}

function calculateRestDays(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return null;
  const dates = fixtures.map((f) => new Date(f.fixture.date)).sort((a, b) => b - a);
  const lastPlayed = dates.find((d) => d < new Date());
  if (!lastPlayed) return null;
  return Math.max(0, Math.floor((Date.now() - lastPlayed.getTime()) / (1000 * 60 * 60 * 24)));
}

module.exports = {
  SEASON,
  BASE_URL,
  apiGet,
  buildUrl,
  getTodayFixtures,
  getFixturesByDate,
  getFixturesByDateAuto,
  candidateSeasonsForDate,
  getRecentPlayedFixtures,
  getFixtureCountByDate,
  getFixtureCountByDateAuto,
  getTeamLastHomeGames,
  getTeamLastAwayGames,
  getH2H,
  getTeamStats,
  getTeamFixtures,
  getFixtureById,
  getFixtureStats,
  getRefereeStats,
  getTeamInjuries,
  flagKeyPlayer,
  extractFormForTeam,
  calculateRestDays,
};
