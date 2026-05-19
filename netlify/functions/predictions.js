const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { LEAGUES, TIER_LEAGUES, tierRank } = require('./_shared/tier');
const { consumeRefresh } = require('./_shared/refresh-limit');
const football = require('./_shared/football');
const { analyseMatch } = require('./_shared/claude');
const { calculateEV, calculateKelly } = require('./_shared/ev');

async function handleLeague(event, leagueId) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const league = LEAGUES[leagueId];
  if (!league) return error(400, 'Invalid league');

  const allowed = TIER_LEAGUES[user.tier] || [];
  if (!allowed.includes(leagueId)) {
    return error(403, 'UPGRADE_REQUIRED', { requiredTier: league.minTier });
  }

  const qs = event.queryStringParameters || {};
  const isInitial = qs.initial === '1' || qs.initial === 'true';
  const consumed = await consumeRefresh(user, isInitial);
  if (!consumed.ok) return error(429, consumed.reason, { tier: user.tier });

  // TESTING MODE: unlock all feature gates regardless of tier.
  const includeFirstHalf = true;
  const includeAH = true;
  const includeEV = true;
  void tierRank; // keep import; restore tier-aware logic when re-enabling.

  const fixtures = await football.getTodayFixtures(leagueId);
  if (!fixtures || fixtures.length === 0) {
    return json(200, {
      league: league.name,
      leagueId,
      tier: user.tier,
      dailyRefreshes: consumed.dailyRefreshes,
      fixtures: [],
      message: 'No matches today',
    });
  }

  const results = await Promise.all(
    fixtures.map(async (fx) => {
      const homeId = fx.teams.home.id;
      const awayId = fx.teams.away.id;
      try {
        const [homeLast, awayLast, h2h, homeStats, awayStats, homeFx, awayFx] = await Promise.all([
          football.getTeamLastHomeGames(homeId, leagueId),
          football.getTeamLastAwayGames(awayId, leagueId),
          football.getH2H(homeId, awayId),
          football.getTeamStats(homeId, leagueId),
          football.getTeamStats(awayId, leagueId),
          football.getTeamFixtures(homeId, leagueId),
          football.getTeamFixtures(awayId, leagueId),
        ]);
        const homeForm = football.extractFormForTeam(homeLast, homeId);
        const awayForm = football.extractFormForTeam(awayLast, awayId);
        const homeRest = football.calculateRestDays(homeFx);
        const awayRest = football.calculateRestDays(awayFx);

        const matchData = {
          league: league.name,
          kickoff: fx.fixture.date,
          home: { id: homeId, name: fx.teams.home.name, form: homeForm, restDays: homeRest, stats: homeStats },
          away: { id: awayId, name: fx.teams.away.name, form: awayForm, restDays: awayRest, stats: awayStats },
          h2h: Array.isArray(h2h)
            ? h2h.slice(0, 5).map((g) => ({
                date: g.fixture.date,
                home: g.teams.home.name,
                away: g.teams.away.name,
                score: `${g.goals.home}-${g.goals.away}`,
              }))
            : [],
        };

        const analysis = await analyseMatch(matchData, includeFirstHalf, includeAH);

        const overOdds = parseFloat(qs[`over_${fx.fixture.id}`]) || null;
        const bttsOdds = parseFloat(qs[`btts_${fx.fixture.id}`]) || null;

        let evOver = null;
        let evBtts = null;
        let kellyOver = null;
        let kellyBtts = null;
        if (includeEV) {
          if (overOdds) {
            evOver = calculateEV(analysis.over.confidence, overOdds);
            kellyOver = calculateKelly(analysis.over.confidence, overOdds);
          }
          if (bttsOdds) {
            evBtts = calculateEV(analysis.btts.confidence, bttsOdds);
            kellyBtts = calculateKelly(analysis.btts.confidence, bttsOdds);
          }
        }

        const inserted = await sql()`
          INSERT INTO predictions
            (user_id, league, fixture_id, home_team, away_team, kickoff,
             over_line, over_confidence, btts, btts_confidence,
             ev_edge_over, ev_edge_btts, kelly_over, kelly_btts)
          VALUES
            (${user.id}, ${league.name}, ${fx.fixture.id}, ${fx.teams.home.name}, ${fx.teams.away.name},
             ${fx.fixture.date}, ${analysis.over.line}, ${Math.round(analysis.over.confidence)},
             ${analysis.btts.prediction}, ${Math.round(analysis.btts.confidence)},
             ${evOver ? evOver.edge : null}, ${evBtts ? evBtts.edge : null},
             ${kellyOver}, ${kellyBtts})
          RETURNING id`;

        return {
          id: inserted[0].id,
          fixtureId: fx.fixture.id,
          league: league.name,
          kickoff: fx.fixture.date,
          home: { id: homeId, name: fx.teams.home.name, form: homeForm, restDays: homeRest },
          away: { id: awayId, name: fx.teams.away.name, form: awayForm, restDays: awayRest },
          predictions: {
            over: analysis.over,
            btts: analysis.btts,
            firstHalf: analysis.firstHalf,
            asianHandicap: analysis.asianHandicap,
          },
          ev: { over: evOver, btts: evBtts, kellyOver, kellyBtts },
        };
      } catch (err) {
        console.error(`Fixture ${fx.fixture.id} failed:`, err.message);
        return {
          fixtureId: fx.fixture.id,
          league: league.name,
          kickoff: fx.fixture.date,
          home: { name: fx.teams.home.name },
          away: { name: fx.teams.away.name },
          error: 'Analysis failed for this fixture',
        };
      }
    }),
  );

  return json(200, {
    league: league.name,
    leagueId,
    tier: user.tier,
    dailyRefreshes: consumed.dailyRefreshes,
    fixtures: results,
  });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');

    const path = subPath(event, 'predictions');
    const leagueMatch = path.match(/^\/(\d+)\/?$/);
    if (leagueMatch) return await handleLeague(event, parseInt(leagueMatch[1], 10));

    return notFound();
  } catch (err) {
    console.error('predictions handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
