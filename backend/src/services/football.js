const axios = require('axios');
const { getOrFetch } = require('./cache');

const BASE_URL = 'https://v3.football.api-sports.io';
const SEASON = 2025;

function client() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'x-apisports-key': process.env.FOOTBALL_API_KEY,
    },
    timeout: 15000,
  });
}

async function apiGet(endpoint, params) {
  try {
    const res = await client().get(endpoint, { params });
    if (res.data && res.data.errors && Object.keys(res.data.errors).length > 0) {
      const msg = JSON.stringify(res.data.errors);
      throw new Error(`API-Football error for ${endpoint}: ${msg}`);
    }
    return res.data && Array.isArray(res.data.response) ? res.data.response : [];
  } catch (err) {
    if (err.response) {
      throw new Error(`API-Football ${endpoint} failed: ${err.response.status} ${err.response.statusText}`);
    }
    throw new Error(`API-Football ${endpoint} failed: ${err.message}`);
  }
}

function todayString() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

function extractFormForTeam(fixtures, teamId) {
  if (!Array.isArray(fixtures)) return [];
  return fixtures
    .slice()
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
    .map((f) => {
      const home = f.teams.home;
      const away = f.teams.away;
      const isHome = home.id === teamId;
      const myGoals = isHome ? f.goals.home : f.goals.away;
      const theirGoals = isHome ? f.goals.away : f.goals.home;
      if (myGoals == null || theirGoals == null) return 'D';
      if (myGoals > theirGoals) return 'W';
      if (myGoals < theirGoals) return 'L';
      return 'D';
    });
}

function calculateRestDays(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return null;
  const dates = fixtures
    .map((f) => new Date(f.fixture.date))
    .sort((a, b) => b - a);
  const lastPlayed = dates.find((d) => d < new Date());
  if (!lastPlayed) return null;
  const diffMs = Date.now() - lastPlayed.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

module.exports = {
  getTodayFixtures,
  getTeamLastHomeGames,
  getTeamLastAwayGames,
  getH2H,
  getTeamStats,
  getTeamFixtures,
  extractFormForTeam,
  calculateRestDays,
};
