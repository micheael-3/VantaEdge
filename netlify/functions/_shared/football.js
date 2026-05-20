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

async function getTodayFixtures(leagueId) {
  const params = { league: leagueId, season: SEASON, date: todayString() };
  return getOrFetch('/fixtures', params, () => apiGet('/fixtures', params));
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
  getTeamLastHomeGames,
  getTeamLastAwayGames,
  getH2H,
  getTeamStats,
  getTeamFixtures,
  getFixtureById,
  extractFormForTeam,
  calculateRestDays,
};
