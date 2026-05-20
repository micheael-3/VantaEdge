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

  // Fetch live bookmaker odds for the whole league once (cached 5 min).
  // Returns null when ODDS_API_KEY is unset — we fall back to manual entry per card.
  let leagueOdds = null;
  try {
    leagueOdds = await oddsService.getMatchOdds(leagueId);
  } catch (err) {
    console.error('odds fetch failed:', err.message);
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

        // ---- Data enrichment (each independent; failures don't break the prediction) ----
        const refereeName = fx.fixture && fx.fixture.referee ? fx.fixture.referee : null;
        const venueCity = fx.fixture && fx.fixture.venue && fx.fixture.venue.city;

        const enrichmentResults = await Promise.allSettled([
          refereeName ? football.getRefereeStats(refereeName) : Promise.resolve(null),
          football.getTeamInjuries(homeId, fx.fixture.id),
          football.getTeamInjuries(awayId, fx.fixture.id),
          venueCity ? weatherService.getMatchWeather(venueCity, fx.fixture.date) : Promise.resolve(null),
        ]);
        const refereeStats = enrichmentResults[0].status === 'fulfilled' ? enrichmentResults[0].value : null;
        const homeInjuries = enrichmentResults[1].status === 'fulfilled' ? enrichmentResults[1].value : [];
        const awayInjuries = enrichmentResults[2].status === 'fulfilled' ? enrichmentResults[2].value : [];
        const weather = enrichmentResults[3].status === 'fulfilled' ? enrichmentResults[3].value : null;

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

        const homeGpg = gpgFromStats(homeStats);
        const awayGpg = gpgFromStats(awayStats);

        const matchData = {
          league: league.name,
          kickoff: fx.fixture.date,
          venue: venueCity || null,
          home: {
            id: homeId,
            name: fx.teams.home.name,
            form: homeForm,
            restDays: homeRest,
            stats: homeStats,
            goalsPerGame: homeGpg,
            injuries: Array.isArray(homeInjuries)
              ? homeInjuries.map((i) => ({ ...i, key: football.flagKeyPlayer(i) }))
              : [],
          },
          away: {
            id: awayId,
            name: fx.teams.away.name,
            form: awayForm,
            restDays: awayRest,
            stats: awayStats,
            goalsPerGame: awayGpg,
            injuries: Array.isArray(awayInjuries)
              ? awayInjuries.map((i) => ({ ...i, key: football.flagKeyPlayer(i) }))
              : [],
          },
          h2h: Array.isArray(h2h)
            ? h2h.slice(0, 5).map((g) => ({
                date: g.fixture.date,
                home: g.teams.home.name,
                away: g.teams.away.name,
                score: `${g.goals.home}-${g.goals.away}`,
              }))
            : [],
          referee: refereeStats,
          weather: weather,
        };

        const analysis = await analyseMatch(matchData, includeFirstHalf, includeAH);

        // ---- Auto-odds via The Odds API ----
        let oddsData = null;
        const matchedOdds = oddsService.findOddsForFixture(leagueOdds, fx);
        if (matchedOdds) {
          oddsData = oddsService.buildOddsData(matchedOdds, analysis);
        }

        // Auto EV from real bookmaker odds — preferred when present.
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

        // Manual user-provided odds (legacy fallback path, still supported via query string).
        const overOddsManual = parseFloat(qs[`over_${fx.fixture.id}`]) || null;
        const bttsOddsManual = parseFloat(qs[`btts_${fx.fixture.id}`]) || null;

        let evOver = autoEvOver;
        let evBtts = autoEvBtts;
        let kellyOver = kellyOverAuto;
        let kellyBtts = kellyBttsAuto;
        if (includeEV) {
          if (!evOver && overOddsManual) {
            evOver = calculateEV(analysis.over.confidence, overOddsManual);
            kellyOver = calculateKelly(analysis.over.confidence, overOddsManual);
          }
          if (!evBtts && bttsOddsManual) {
            evBtts = calculateEV(analysis.btts.confidence, bttsOddsManual);
            kellyBtts = calculateKelly(analysis.btts.confidence, bttsOddsManual);
          }
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
             ${evOver ? evOver.edge : null}, ${evBtts ? evBtts.edge : null},
             ${kellyOver}, ${kellyBtts},
             ${oddsData ? oddsData.bestOverOdds : null}, ${oddsData ? oddsData.bestOverBookmaker : null},
             ${oddsData ? oddsData.bestBttsOdds : null}, ${oddsData ? oddsData.bestBttsBookmaker : null},
             ${autoEvOver ? autoEvOver.edge : null}, ${autoEvBtts ? autoEvBtts.edge : null})
          RETURNING id`;

        return {
          id: inserted[0].id,
          fixtureId: fx.fixture.id,
          league: league.name,
          kickoff: fx.fixture.date,
          venue: venueCity || null,
          home: {
            id: homeId,
            name: fx.teams.home.name,
            form: homeForm,
            restDays: homeRest,
            goalsPerGame: homeGpg,
            injuries: matchData.home.injuries,
          },
          away: {
            id: awayId,
            name: fx.teams.away.name,
            form: awayForm,
            restDays: awayRest,
            goalsPerGame: awayGpg,
            injuries: matchData.away.injuries,
          },
          referee: refereeStats,
          weather: weather,
          predictions: {
            over: analysis.over,
            btts: analysis.btts,
            firstHalf: analysis.firstHalf,
            asianHandicap: analysis.asianHandicap,
          },
          ev: { over: evOver, btts: evBtts, kellyOver, kellyBtts },
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
