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

// Find a sensible fixture batch. If the caller supplied an explicit date we
// fetch only that. Otherwise we cascade: today → tomorrow → recent past.
async function pickFixtures(leagueId, explicitDate) {
  if (explicitDate) {
    const list = await football.getFixturesByDate(leagueId, explicitDate, ttlForDate(explicitDate));
    const today = todayDateStr();
    return {
      fixtures: list || [],
      dateLabel: labelForDateStr(explicitDate),
      matchDate: explicitDate,
      isPast: explicitDate < today,
      isUpcoming: explicitDate > today,
      isToday: explicitDate === today,
      mode: 'explicit',
    };
  }

  const today = todayDateStr();
  // 1. Today
  let list = await football.getFixturesByDate(leagueId, today, 300);
  if (list && list.length) {
    return {
      fixtures: list,
      dateLabel: 'Today',
      matchDate: today,
      isPast: false,
      isUpcoming: false,
      isToday: true,
      mode: 'today',
    };
  }
  // 2. Tomorrow (per spec, only today + tomorrow get pre-scanned on initial load)
  const tomorrow = addDaysStr(today, 1);
  list = await football.getFixturesByDate(leagueId, tomorrow, 3600);
  if (list && list.length) {
    return {
      fixtures: list,
      dateLabel: 'Tomorrow',
      matchDate: tomorrow,
      isPast: false,
      isUpcoming: true,
      isToday: false,
      mode: 'tomorrow',
    };
  }
  // 3. Recent past as the last-resort fallback so the page is never empty.
  const recent = await football.getRecentPlayedFixtures(leagueId, 10);
  return {
    fixtures: Array.isArray(recent) ? recent : [],
    dateLabel: 'Recent Matches',
    matchDate: null,
    isPast: true,
    isUpcoming: false,
    isToday: false,
    mode: 'recent',
  };
}

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

  // --- Fixture cascade (spec §1): today → tomorrow → recent past.
  //     If the caller passes ?date=YYYY-MM-DD we use that day directly.
  const explicitDate = typeof qs.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(qs.date) ? qs.date : null;
  const picked = await pickFixtures(leagueId, explicitDate);
  const fixtures = picked.fixtures;

  // Even on an empty pick we still return the date metadata so the frontend
  // can render something useful (e.g. an empty-state with a "Try Tomorrow" CTA).
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

        // For past / completed fixtures, attach the actual result so the
        // frontend can render "FT 2-1" + ✓/✗ verdicts next to the prediction.
        const statusShort = fx.fixture && fx.fixture.status && fx.fixture.status.short;
        const homeGoals = fx.goals && fx.goals.home;
        const awayGoals = fx.goals && fx.goals.away;
        let actualResult = null;
        if (TERMINAL_STATUSES.has(statusShort) && homeGoals != null && awayGoals != null) {
          const total = Number(homeGoals) + Number(awayGoals);
          const bothScored = Number(homeGoals) > 0 && Number(awayGoals) > 0;
          const overHit = total > Number(analysis.over.line);
          const bttsCall = String(analysis.btts.prediction || 'YES').toUpperCase();
          const bttsHit = bttsCall === 'YES' ? bothScored : !bothScored;
          actualResult = {
            status: 'FT',
            homeGoals: Number(homeGoals),
            awayGoals: Number(awayGoals),
            totalGoals: total,
            bothScored,
            overHit,
            bttsHit,
          };
          // Backfill the hit columns so /history and the results worker
          // stay consistent with what the user sees on the dashboard.
          try {
            await sql()`UPDATE predictions
                        SET over_hit = ${overHit}, btts_hit = ${bttsHit}
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
          actualResult,
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
    dateLabel: picked.dateLabel,
    matchDate: picked.matchDate,
    isPast: picked.isPast,
    isUpcoming: picked.isUpcoming,
    isToday: picked.isToday,
    mode: picked.mode,
    fixtures: results,
  });
}

// GET /api/predictions/upcoming/:leagueId — scans the next 7 days and
// returns [{date, count, label, isToday}]. Lightweight: only the per-date
// fixture count is needed, and every call reuses the shared cache so a
// dashboard refresh after a tab switch is free.
async function handleUpcoming(event, leagueId) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const league = LEAGUES[leagueId];
  if (!league) return error(400, 'Invalid league');

  const allowed = TIER_LEAGUES[user.tier] || [];
  if (!allowed.includes(leagueId)) {
    return error(403, 'UPGRADE_REQUIRED', { requiredTier: league.minTier });
  }

  const today = todayDateStr();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dateStr = addDaysStr(today, i);
    let count = null;
    try {
      // i === 0 → today (5min TTL), i ≥ 1 → future (1h TTL)
      const ttl = i === 0 ? 300 : 3600;
      count = await football.getFixtureCountByDate(leagueId, dateStr, ttl);
    } catch (e) {
      console.error(`upcoming scan failed for ${dateStr}:`, e.message);
    }
    days.push({
      date: dateStr,
      count: count == null ? null : Number(count),
      label: labelForDateStr(dateStr),
      isToday: i === 0,
    });
  }

  return json(200, { leagueId, league: league.name, days });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');

    const path = subPath(event, 'predictions');

    // /upcoming/:leagueId — date-pill helper
    const upcomingMatch = path.match(/^\/upcoming\/(\d+)\/?$/);
    if (upcomingMatch) return await handleUpcoming(event, parseInt(upcomingMatch[1], 10));

    const leagueMatch = path.match(/^\/(\d+)\/?$/);
    if (leagueMatch) return await handleLeague(event, parseInt(leagueMatch[1], 10));

    return notFound();
  } catch (err) {
    console.error('predictions handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
