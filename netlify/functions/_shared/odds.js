// VantaEdge — The Odds API integration.
//
// Free tier = 500 requests/month. We cache aggressively (5 min in-memory)
// and fetch per league (max 8 calls per refresh cycle), so 500 req/month
// supports ~62 full refreshes. Quota is tracked from response headers and
// exposed via /api/admin/odds-quota for monitoring.
//
// When ODDS_API_KEY is missing the module returns null cleanly — the rest
// of the app falls back to manual odds input on every match card.

const axios = require('axios');

const BASE_URL = 'https://api.the-odds-api.com/v4';
const REGIONS = 'eu';
const MARKETS = 'totals,btts';
const ODDS_FORMAT = 'decimal';
const CACHE_TTL_MS = 5 * 60 * 1000;

// API-Football league id -> Odds API sport key
const LEAGUE_TO_SPORT_KEY = {
  253: 'soccer_usa_mls',
  78:  'soccer_germany_bundesliga',
  88:  'soccer_netherlands_eredivisie',
  40:  'soccer_england_championship',
  61:  'soccer_france_ligue_one',
  179: 'soccer_scotland_premiership',
  140: 'soccer_spain_la_liga',
  39:  'soccer_epl',
};

// Leagues kept active when quota gets low.
const PRIORITY_LEAGUES = new Set([253, 78, 39]);

// In-memory caches; survive within a warm function instance only.
const oddsCache = new Map(); // sportKey -> { value, expires }
const quota = {
  used: null,
  remaining: null,
  lastFetchedAt: null,
  lastSportKey: null,
  errors: 0,
};
// Sport keys this instance has been told to skip (disabled by quota).
const disabledLeagues = new Set();

function setQuotaFromHeaders(headers) {
  if (!headers) return;
  const used = headers['x-requests-used'];
  const remaining = headers['x-requests-remaining'];
  if (used != null) quota.used = parseInt(used, 10);
  if (remaining != null) quota.remaining = parseInt(remaining, 10);
  quota.lastFetchedAt = new Date().toISOString();
}

function getQuotaSnapshot() {
  return {
    used: quota.used,
    remaining: quota.remaining,
    lastFetchedAt: quota.lastFetchedAt,
    lastSportKey: quota.lastSportKey,
    errors: quota.errors,
    disabledLeagues: Array.from(disabledLeagues),
  };
}

function isConfigured() {
  return !!process.env.ODDS_API_KEY;
}

// ---------- Fuzzy team-name matching ----------

const STOPWORDS = new Set([
  'fc', 'sc', 'cf', 'ac', 'as', 'ss', 'sv', 'tsv', 'vfb', 'vfl', 'fsv', 'club',
  'the', 'and', 'de', 'la', 'el', 'le', 'les', 'di', 'du', 'sport',
]);

function normaliseName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(s) {
  return normaliseName(s)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w));
}

// Returns 0–1 score. Match threshold to use externally: 0.6.
function matchTeamNames(a, b) {
  const ta = new Set(tokenise(a));
  const tb = new Set(tokenise(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const w of ta) if (tb.has(w)) intersection += 1;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union === 0 ? 0 : intersection / union;

  // Boost if one set is fully contained in the other (e.g. "Man City" ⊂ "Manchester City").
  const aSubset = [...ta].every((w) => tb.has(w));
  const bSubset = [...tb].every((w) => ta.has(w));
  if (aSubset || bSubset) return Math.max(jaccard, 0.85);

  return jaccard;
}

// ---------- Odds fetching ----------

async function fetchSportOdds(sportKey) {
  const url = `${BASE_URL}/sports/${sportKey}/odds`;
  const res = await axios.get(url, {
    params: {
      apiKey: process.env.ODDS_API_KEY,
      regions: REGIONS,
      markets: MARKETS,
      oddsFormat: ODDS_FORMAT,
    },
    timeout: 12000,
    validateStatus: () => true,
  });
  setQuotaFromHeaders(res.headers);
  quota.lastSportKey = sportKey;

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Odds API auth failed (${res.status}). Check ODDS_API_KEY.`);
  }
  if (res.status === 429) {
    throw new Error('Odds API rate limit / quota exceeded.');
  }
  if (res.status >= 400) {
    throw new Error(`Odds API error ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
  }
  return Array.isArray(res.data) ? res.data : [];
}

function pickBestOver(totalsMarkets, predictedLine) {
  // totalsMarkets: array of { bookmaker, line, overOdds, underOdds }
  // Find odds for the exact predicted line first, else closest line.
  let exact = totalsMarkets.filter((m) => Math.abs(m.line - predictedLine) < 0.01);
  if (exact.length === 0) {
    // Fall back to closest line.
    const sorted = [...totalsMarkets].sort((a, b) => Math.abs(a.line - predictedLine) - Math.abs(b.line - predictedLine));
    if (sorted.length === 0) return null;
    const closestLine = sorted[0].line;
    exact = totalsMarkets.filter((m) => Math.abs(m.line - closestLine) < 0.01);
  }
  if (exact.length === 0) return null;
  let best = exact[0];
  for (const m of exact) if (m.overOdds > best.overOdds) best = m;
  return best;
}

function pickBestBtts(bttsMarkets, prediction /* 'YES' | 'NO' */) {
  if (!Array.isArray(bttsMarkets) || bttsMarkets.length === 0) return null;
  const key = prediction === 'NO' ? 'noOdds' : 'yesOdds';
  let best = bttsMarkets[0];
  for (const m of bttsMarkets) if (m[key] > best[key]) best = m;
  return { bookmaker: best.bookmaker, odds: best[key], side: prediction };
}

// Flatten a raw Odds API match into our structured shape.
function shapeMatch(raw) {
  const totals = [];
  const btts = [];

  if (Array.isArray(raw.bookmakers)) {
    for (const bk of raw.bookmakers) {
      if (!Array.isArray(bk.markets)) continue;
      for (const market of bk.markets) {
        if (market.key === 'totals' && Array.isArray(market.outcomes)) {
          const over = market.outcomes.find((o) => /^over$/i.test(o.name));
          const under = market.outcomes.find((o) => /^under$/i.test(o.name));
          if (over && under && over.point != null) {
            totals.push({
              bookmaker: bk.title || bk.key,
              line: Number(over.point),
              overOdds: Number(over.price),
              underOdds: Number(under.price),
            });
          }
        } else if ((market.key === 'btts' || market.key === 'both_teams_to_score') && Array.isArray(market.outcomes)) {
          const yes = market.outcomes.find((o) => /^yes$/i.test(o.name));
          const no = market.outcomes.find((o) => /^no$/i.test(o.name));
          if (yes && no) {
            btts.push({
              bookmaker: bk.title || bk.key,
              yesOdds: Number(yes.price),
              noOdds: Number(no.price),
            });
          }
        }
      }
    }
  }

  return {
    homeTeam: raw.home_team || (raw.teams && raw.teams[0]) || '',
    awayTeam: raw.away_team || (raw.teams && raw.teams[1]) || '',
    commenceTime: raw.commence_time || null,
    odds: { totals, btts },
  };
}

async function getMatchOdds(leagueId) {
  if (!isConfigured()) return null;
  const sportKey = LEAGUE_TO_SPORT_KEY[leagueId];
  if (!sportKey) return null;

  // Quota gating
  if (quota.remaining != null) {
    if (quota.remaining === 0) {
      console.warn('[odds] quota exhausted — refusing fetch');
      return { quotaExhausted: true, matches: [] };
    }
    if (quota.remaining < 50 && !PRIORITY_LEAGUES.has(leagueId)) {
      disabledLeagues.add(sportKey);
      console.warn(`[odds] quota low (${quota.remaining}) — skipping non-priority league ${leagueId}`);
      return { quotaLow: true, matches: [] };
    }
  }
  if (disabledLeagues.has(sportKey)) return { quotaLow: true, matches: [] };

  // Cache
  const cached = oddsCache.get(sportKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const raw = await fetchSportOdds(sportKey);
    const matches = raw.map(shapeMatch);
    const value = { matches, fetchedAt: new Date().toISOString() };
    oddsCache.set(sportKey, { value, expires: Date.now() + CACHE_TTL_MS });
    console.log(`[odds] ${sportKey}: ${matches.length} matches, quota ${quota.remaining}/${(quota.remaining || 0) + (quota.used || 0)}`);
    return value;
  } catch (err) {
    quota.errors += 1;
    console.error(`[odds] fetch failed for ${sportKey}:`, err.message);
    return null;
  }
}

// ---------- Per-fixture odds lookup ----------

function findOddsForFixture(oddsResult, fixture) {
  if (!oddsResult || !Array.isArray(oddsResult.matches) || oddsResult.matches.length === 0) return null;
  const homeTarget = fixture.teams && fixture.teams.home && fixture.teams.home.name;
  const awayTarget = fixture.teams && fixture.teams.away && fixture.teams.away.name;
  if (!homeTarget || !awayTarget) return null;

  let best = null;
  let bestScore = 0;
  for (const m of oddsResult.matches) {
    const homeScore = matchTeamNames(homeTarget, m.homeTeam);
    const awayScore = matchTeamNames(awayTarget, m.awayTeam);
    // Both teams must match — symmetrically.
    const score = Math.min(homeScore, awayScore);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (bestScore < 0.6) return null;
  return best;
}

// Build the consolidated oddsData payload for a single fixture.
function buildOddsData(matchOdds, prediction) {
  if (!matchOdds) return null;
  const overLine = (prediction.over && typeof prediction.over.line === 'number') ? prediction.over.line : 2.5;
  const bttsPrediction = prediction.btts && prediction.btts.prediction ? prediction.btts.prediction : 'YES';

  const bestOver = pickBestOver(matchOdds.odds.totals, overLine);
  const bestBtts = pickBestBtts(matchOdds.odds.btts, bttsPrediction);

  const bookmakerCount = new Set([
    ...matchOdds.odds.totals.map((t) => t.bookmaker),
    ...matchOdds.odds.btts.map((t) => t.bookmaker),
  ]).size;

  return {
    overLine: bestOver ? bestOver.line : overLine,
    bestOverOdds: bestOver ? bestOver.overOdds : null,
    bestOverBookmaker: bestOver ? bestOver.bookmaker : null,
    bestBttsOdds: bestBtts ? bestBtts.odds : null,
    bestBttsBookmaker: bestBtts ? bestBtts.bookmaker : null,
    bttsSide: bestBtts ? bestBtts.side : bttsPrediction,
    bookmakerCount,
    allBookmakers: {
      totals: matchOdds.odds.totals,
      btts: matchOdds.odds.btts,
    },
  };
}

module.exports = {
  isConfigured,
  LEAGUE_TO_SPORT_KEY,
  getMatchOdds,
  findOddsForFixture,
  buildOddsData,
  matchTeamNames,
  getQuotaSnapshot,
};
