const axios = require('axios');
const { getOrFetch } = require('./cache');

const BASE_URL = 'https://v3.football.api-sports.io';
const SEASON = 2024;

function client() {
  return axios.create({
    baseURL: BASE_URL,
    headers: { 'x-apisports-key': process.env.FOOTBALL_API_KEY },
    timeout: 15000,
  });
}

async function apiGet(endpoint, params) {
  try {
    const res = await client().get(endpoint, { params });
    if (res.data && res.data.errors && Object.keys(res.data.errors).length > 0) {
      throw new Error(`API-Football ${endpoint}: ${JSON.stringify(res.data.errors)}`);
    }
    return res.data && Array.isArray(res.data.response) ? res.data.response : [];
  } catch (err) {
    if (err.response) {
      throw new Error(`API-Football ${endpoint} failed: ${err.response.status} ${err.response.statusText}`);
    }
    throw err;
  }
}

function todayString() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Fetch fixtures for a specific date. Caller picks TTL based on temporality:
//   • today -> 300s (lineups, late changes)
//   • future -> 3600s (rarely changes)
//   • past   -> 86400s (final results don't change)
async function getFixturesByDate(leagueId, dateStr, ttlSeconds) {
  const params = { league: leagueId, season: SEASON, date: dateStr };
  return getOrFetch('/fixtures', params, () => apiGet('/fixtures', params), ttlSeconds);
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

async function getTeamLastHomeGames(teamId, leagueId) {
  const params = { team: teamId, league: leagueId, season: SEASON, last: 5, venue: 'home' };
  return getOrFetch('/fixtures', params, () => apiGet('/fixtures', params));
}

async function getTeamLastAwayGames(teamId, leagueId) {
  const params = { team: teamId, league: leagueId, season: SEASON, last: 5, venue: 'away' };
  return getOrFetch('/fixtures', params, () => apiGet('/fixtures', params));
}

async function getH2H(homeId, awayId) {
  const params = { h2h: `${homeId}-${awayId}`, last: 5 };
  return getOrFetch('/fixtures/headtohead', params, () => apiGet('/fixtures/headtohead', params));
}

async function getTeamStats(teamId, leagueId) {
  const params = { team: teamId, league: leagueId, season: SEASON };
  return getOrFetch('/teams/statistics', params, async () => {
    const res = await client().get('/teams/statistics', { params });
    return res.data && res.data.response ? res.data.response : null;
  });
}

async function getTeamFixtures(teamId, leagueId) {
  const params = { team: teamId, league: leagueId, season: SEASON, last: 2 };
  return getOrFetch('/fixtures', params, () => apiGet('/fixtures', params));
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
  return getOrFetch('/fixtures/statistics', params, async () => {
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
  });
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

// Injuries / suspensions for a team in a specific fixture.
async function getTeamInjuries(teamId, fixtureId) {
  if (!teamId || !fixtureId) return [];
  try {
    const res = await client().get('/injuries', { params: { team: teamId, fixture: fixtureId } });
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
  getTodayFixtures,
  getFixturesByDate,
  getRecentPlayedFixtures,
  getFixtureCountByDate,
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
