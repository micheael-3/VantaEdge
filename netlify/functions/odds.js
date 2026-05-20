// Power-user odds aggregator: returns today's predictions across all
// leagues the user can access, joined with auto-EV from the Odds API.
// Pulls from DB only — no fresh AI calls — so it's cheap and fast.

const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { requireTier, TIER_LEAGUES, LEAGUES } = require('./_shared/tier');
const { getQuotaSnapshot, isConfigured } = require('./_shared/odds');

function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function listOdds(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  const allowedLeagueIds = TIER_LEAGUES[user.tier] || [];
  const allowedNames = allowedLeagueIds
    .map((id) => (LEAGUES[id] ? LEAGUES[id].name : null))
    .filter(Boolean);
  if (allowedNames.length === 0) {
    return json(200, { rows: [], oddsConfigured: isConfigured() });
  }

  const rows = await sql()`
    SELECT id, league, fixture_id, home_team, away_team, kickoff,
           over_line, over_confidence, btts, btts_confidence,
           ev_edge_over, ev_edge_btts, kelly_over, kelly_btts,
           best_over_odds, best_over_bookmaker, best_btts_odds, best_btts_bookmaker,
           auto_ev_over, auto_ev_btts
    FROM predictions
    WHERE user_id = ${user.id}
      AND created_at >= ${startOfTodayIso()}
      AND league = ANY(${allowedNames})
    ORDER BY GREATEST(COALESCE(auto_ev_over, ev_edge_over, -999),
                      COALESCE(auto_ev_btts, ev_edge_btts, -999)) DESC NULLS LAST,
             over_confidence DESC`;

  return json(200, {
    oddsConfigured: isConfigured(),
    quota: getQuotaSnapshot(),
    rows: rows.map((r) => ({
      id: r.id,
      league: r.league,
      fixtureId: r.fixture_id,
      kickoff: r.kickoff,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      over: {
        line: r.over_line,
        confidence: r.over_confidence,
        edge: r.auto_ev_over ?? r.ev_edge_over ?? null,
        odds: r.best_over_odds ?? null,
        bookmaker: r.best_over_bookmaker ?? null,
        kelly: r.kelly_over ?? null,
      },
      btts: {
        prediction: r.btts,
        confidence: r.btts_confidence,
        edge: r.auto_ev_btts ?? r.ev_edge_btts ?? null,
        odds: r.best_btts_odds ?? null,
        bookmaker: r.best_btts_bookmaker ?? null,
        kelly: r.kelly_btts ?? null,
      },
    })),
  });
}

async function quotaOnly(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;
  return json(200, { oddsConfigured: isConfigured(), quota: getQuotaSnapshot() });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');
    const path = subPath(event, 'odds');
    if (path === '/' || path === '') return await listOdds(event);
    if (path === '/quota') return await quotaOnly(event);
    return notFound();
  } catch (err) {
    console.error('odds handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
