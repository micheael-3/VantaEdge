const express = require('express');
const prisma = require('../prisma/client');
const authMiddleware = require('../middleware/auth');
const refreshLimit = require('../middleware/refreshLimit');
const football = require('../services/football');
const { analyseMatch } = require('../services/claude');
const { calculateEV, calculateKelly } = require('../services/ev');

const router = express.Router();

const LEAGUES = {
  253: { name: 'MLS', minTier: 'SCOUT' },
  78: { name: 'Bundesliga', minTier: 'SCOUT' },
  88: { name: 'Eredivisie', minTier: 'SCOUT' },
  40: { name: 'Championship', minTier: 'ANALYST' },
  61: { name: 'Ligue 1', minTier: 'ANALYST' },
  179: { name: 'Scottish Prem', minTier: 'ANALYST' },
  140: { name: 'La Liga', minTier: 'ANALYST' },
  39: { name: 'Premier League', minTier: 'EDGE' },
};

const TIER_LEAGUES = {
  FREE: [253, 78, 88],
  SCOUT: [253, 78, 88],
  ANALYST: [253, 78, 88, 40, 61, 179, 140],
  EDGE: [253, 78, 88, 40, 61, 179, 140, 39],
};

function tierRank(t) {
  return { FREE: 0, SCOUT: 1, ANALYST: 2, EDGE: 3 }[t] ?? 0;
}

router.get('/:leagueId', authMiddleware, refreshLimit, async (req, res, next) => {
  try {
    const leagueId = parseInt(req.params.leagueId, 10);
    const league = LEAGUES[leagueId];
    if (!league) return res.status(400).json({ error: 'Invalid league' });

    const user = req.dbUser || (await prisma.user.findUnique({ where: { id: req.user.id } }));
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const allowed = TIER_LEAGUES[user.tier] || [];
    if (!allowed.includes(leagueId)) {
      return res.status(403).json({ error: 'UPGRADE_REQUIRED', requiredTier: league.minTier });
    }

    const includeFirstHalf = user.tier === 'EDGE';
    const includeAsianHandicap = user.tier === 'EDGE';
    const includeEV = tierRank(user.tier) >= tierRank('ANALYST');

    const fixtures = await football.getTodayFixtures(leagueId);
    if (!fixtures || fixtures.length === 0) {
      return res.json({ fixtures: [], message: 'No matches today', league: league.name });
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
            home: {
              id: homeId,
              name: fx.teams.home.name,
              form: homeForm,
              restDays: homeRest,
              stats: homeStats,
            },
            away: {
              id: awayId,
              name: fx.teams.away.name,
              form: awayForm,
              restDays: awayRest,
              stats: awayStats,
            },
            h2h: Array.isArray(h2h)
              ? h2h.slice(0, 5).map((g) => ({
                  date: g.fixture.date,
                  home: g.teams.home.name,
                  away: g.teams.away.name,
                  score: `${g.goals.home}-${g.goals.away}`,
                }))
              : [],
          };

          const analysis = await analyseMatch(matchData, includeFirstHalf, includeAsianHandicap);

          const overOdds = parseFloat(req.query[`over_${fx.fixture.id}`]) || null;
          const bttsOdds = parseFloat(req.query[`btts_${fx.fixture.id}`]) || null;

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

          const saved = await prisma.prediction.create({
            data: {
              userId: user.id,
              league: league.name,
              fixtureId: fx.fixture.id,
              homeTeam: fx.teams.home.name,
              awayTeam: fx.teams.away.name,
              kickoff: new Date(fx.fixture.date),
              overLine: analysis.over.line,
              overConfidence: Math.round(analysis.over.confidence),
              btts: analysis.btts.prediction,
              bttsConfidence: Math.round(analysis.btts.confidence),
              evEdgeOver: evOver ? evOver.edge : null,
              evEdgeBtts: evBtts ? evBtts.edge : null,
              kellyOver: kellyOver,
              kellyBtts: kellyBtts,
            },
          });

          return {
            id: saved.id,
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

    return res.json({
      league: league.name,
      leagueId,
      tier: user.tier,
      dailyRefreshes: req.dbUser ? req.dbUser.dailyRefreshes : user.dailyRefreshes,
      fixtures: results,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
