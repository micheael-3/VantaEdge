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

// Try a season on a specific date. Returns [] on any error so the cascade
// can keep going. All errors get logged in football.js / here.
async function tryDate(leagueId, dateStr, ttl, season) {
  try {
    const list = await football.getFixturesByDate(leagueId, dateStr, ttl, season);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error(`[predictions] cascade: ${dateStr} s${season} failed: ${err.message}`);
    return [];
  }
}

// Find a sensible fixture batch. If the caller supplied an explicit date we
// fetch only that. Otherwise we cascade: today → tomorrow → recent past.
// On each attempt we try the default season; if it returns nothing we retry
// with the *other* season (paid plan upgrade often coincides with a new
// season key going live before the next default is rolled out).
const FALLBACK_SEASONS = [football.SEASON, football.SEASON === 2024 ? 2025 : 2024];

async function pickFixtures(leagueId, explicitDate) {
  const today = todayDateStr();

  if (explicitDate) {
    let list = [];
    let usedSeason = null;
    for (const season of FALLBACK_SEASONS) {
      list = await tryDate(leagueId, explicitDate, ttlForDate(explicitDate), season);
      if (list.length) { usedSeason = season; break; }
    }
    console.log(`[predictions] cascade explicit league=${leagueId} date=${explicitDate} season=${usedSeason} → ${list.length} fixtures`);
    return {
      fixtures: list,
      dateLabel: labelForDateStr(explicitDate),
      matchDate: explicitDate,
      isPast: explicitDate < today,
      isUpcoming: explicitDate > today,
      isToday: explicitDate === today,
      mode: 'explicit',
      seasonUsed: usedSeason,
    };
  }

  // 1. Today, both seasons
  for (const season of FALLBACK_SEASONS) {
    const list = await tryDate(leagueId, today, 300, season);
    if (list.length) {
      console.log(`[predictions] cascade league=${leagueId} hit TODAY season=${season} → ${list.length}`);
      return { fixtures: list, dateLabel: 'Today', matchDate: today, isPast: false, isUpcoming: false, isToday: true, mode: 'today', seasonUsed: season };
    }
  }
  // 2. Tomorrow, both seasons
  const tomorrow = addDaysStr(today, 1);
  for (const season of FALLBACK_SEASONS) {
    const list = await tryDate(leagueId, tomorrow, 3600, season);
    if (list.length) {
      console.log(`[predictions] cascade league=${leagueId} hit TOMORROW season=${season} → ${list.length}`);
      return { fixtures: list, dateLabel: 'Tomorrow', matchDate: tomorrow, isPast: false, isUpcoming: true, isToday: false, mode: 'tomorrow', seasonUsed: season };
    }
  }
  // 3. Recent past (last=10) as the last-resort fallback. Try both seasons.
  for (const season of FALLBACK_SEASONS) {
    try {
      const recent = await football.apiGet('/fixtures', { league: leagueId, season, last: 10 }, { tag: `recent s${season}` });
      if (Array.isArray(recent) && recent.length) {
        console.log(`[predictions] cascade league=${leagueId} hit RECENT season=${season} → ${recent.length}`);
        return { fixtures: recent, dateLabel: 'Recent Matches', matchDate: null, isPast: true, isUpcoming: false, isToday: false, mode: 'recent', seasonUsed: season };
      }
    } catch (err) {
      console.error(`[predictions] recent s${season} failed: ${err.message}`);
    }
  }

  console.warn(`[predictions] cascade league=${leagueId} — empty for both seasons today/tomorrow/recent`);
  return { fixtures: [], dateLabel: 'Recent Matches', matchDate: null, isPast: true, isUpcoming: false, isToday: false, mode: 'recent', seasonUsed: null };
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

  // One batched lookup for sharp-move flags so the cards render with the
  // agent's latest verdict — newly inserted rows won't have is_sharp_move
  // set yet, but the canonical odds_movements table does.
  const fixtureIds = fixtures.map((f) => f.fixture && f.fixture.id).filter(Boolean);
  let sharpFixtureSet = new Set();
  if (fixtureIds.length) {
    try {
      const sharpRows = await sql()`
        SELECT DISTINCT fixture_id FROM odds_movements
        WHERE fixture_id = ANY(${fixtureIds})
          AND is_sharp_move = TRUE
          AND detected_at > NOW() - INTERVAL '12 hours'`;
      sharpFixtureSet = new Set(sharpRows.map((r) => Number(r.fixture_id)));
    } catch (e) {
      // odds_movements may not exist yet — non-fatal.
    }
  }

  // Sequential fixture processing — API-Football paid plans cap requests
  // per minute. Each fixture makes ~11 API calls (7 stats + 4 enrichment)
  // in parallel internally, so processing one fixture at a time still
  // gives a healthy 11-call burst, but spaces those bursts out enough
  // that the rolling per-minute window never saturates. Total wall time
  // for 10 fixtures ≈ 8-12 seconds, well inside the function timeout.
  // Also retries once with a 2s backoff if a fixture hits a rate limit
  // mid-run, since cached subsequent calls let the retry usually succeed.
  const CHUNK_SIZE = 1;
  const CHUNK_DELAY_MS = 700;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const processOne = async (fx) => {
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
          isSharpMove: sharpFixtureSet.has(Number(fx.fixture.id)),
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
        // Surface the actual error to the client so we can debug without
        // hunting through function logs. Stack-traceable name + message; the
        // stack itself stays server-side.
        const detail = err && err.message ? err.message : String(err);
        const code = err && err.code ? ` [${err.code}]` : '';
        console.error(`Fixture ${fx.fixture.id} failed:${code}`, detail, err && err.stack);
        return {
          fixtureId: fx.fixture.id,
          league: league.name,
          kickoff: fx.fixture.date,
          home: { name: fx.teams.home.name },
          away: { name: fx.teams.away.name },
          error: `Analysis failed: ${detail}${code}`,
        };
      }
  };

  const isRateLimitErr = (r) =>
    r && r.error && /rateLimit|Too many requests|exceeded the limit/i.test(r.error);

  const results = [];
  for (let i = 0; i < fixtures.length; i += CHUNK_SIZE) {
    const chunk = fixtures.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(chunk.map(processOne));

    // If any fixture in this chunk hit a rate-limit, wait 2 seconds and
    // retry once. Most retries succeed because subsequent calls hit the
    // in-memory cache populated by earlier fixtures.
    for (let j = 0; j < chunkResults.length; j += 1) {
      if (isRateLimitErr(chunkResults[j])) {
        await sleep(2000);
        try {
          const retried = await processOne(chunk[j]);
          chunkResults[j] = retried;
        } catch {
          // keep the original error if retry itself throws
        }
      }
    }

    results.push(...chunkResults);
    if (i + CHUNK_SIZE < fixtures.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

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
    seasonUsed: picked.seasonUsed,
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

// GET /api/predictions/test — UNAUTHENTICATED probe for debugging
// API-Football connectivity. Returns raw response shapes for each probe
// so you can paste them straight into a bug report.
async function handleTest(event) {
  const today = todayDateStr();
  const tomorrow = addDaysStr(today, 1);
  const leagueId = 253; // MLS
  const probes = [
    { tag: 'today_2024',    params: { league: leagueId, season: 2024, date: today } },
    { tag: 'today_2025',    params: { league: leagueId, season: 2025, date: today } },
    { tag: 'tomorrow_2024', params: { league: leagueId, season: 2024, date: tomorrow } },
    { tag: 'tomorrow_2025', params: { league: leagueId, season: 2025, date: tomorrow } },
    { tag: 'last10_2024',   params: { league: leagueId, season: 2024, last: 10 } },
    { tag: 'last10_2025',   params: { league: leagueId, season: 2025, last: 10 } },
  ];

  const results = {};
  for (const p of probes) {
    const url = football.buildUrl('/fixtures', p.params);
    const start = Date.now();
    try {
      const response = await football.apiGet('/fixtures', p.params, { tag: `probe ${p.tag}` });
      results[p.tag] = {
        ok: true,
        url,
        durationMs: Date.now() - start,
        responseCount: response.length,
        firstFixture: response[0] ? {
          id: response[0].fixture && response[0].fixture.id,
          date: response[0].fixture && response[0].fixture.date,
          status: response[0].fixture && response[0].fixture.status,
          home: response[0].teams && response[0].teams.home && response[0].teams.home.name,
          away: response[0].teams && response[0].teams.away && response[0].teams.away.name,
          score: response[0].goals,
        } : null,
        sample: response.slice(0, 3),
      };
    } catch (err) {
      results[p.tag] = {
        ok: false,
        url,
        durationMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  const verdict = (() => {
    if (results.today_2025 && results.today_2025.responseCount > 0) return { working: true, season: 2025, source: 'today_2025' };
    if (results.today_2024 && results.today_2024.responseCount > 0) return { working: true, season: 2024, source: 'today_2024' };
    if (results.tomorrow_2025 && results.tomorrow_2025.responseCount > 0) return { working: true, season: 2025, source: 'tomorrow_2025' };
    if (results.tomorrow_2024 && results.tomorrow_2024.responseCount > 0) return { working: true, season: 2024, source: 'tomorrow_2024' };
    if (results.last10_2025 && results.last10_2025.responseCount > 0) return { working: true, season: 2025, source: 'last10_2025' };
    if (results.last10_2024 && results.last10_2024.responseCount > 0) return { working: true, season: 2024, source: 'last10_2024' };
    const anyAuth = Object.values(results).some((r) => r.error && r.error.includes('auth failed'));
    if (anyAuth) return { working: false, reason: 'auth_failed', hint: 'Check FOOTBALL_API_KEY on Netlify env vars + redeploy.' };
    const anyQuota = Object.values(results).some((r) => r.error && r.error.includes('429'));
    if (anyQuota) return { working: false, reason: 'quota_exhausted' };
    return { working: false, reason: 'no_data', hint: 'Both seasons returned 0 fixtures for this league today/tomorrow/last10. Try a different league or check season=2025 has started.' };
  })();

  return json(200, {
    now: new Date().toISOString(),
    today,
    tomorrow,
    leagueId,
    leagueName: 'MLS',
    keyConfigured: !!process.env.FOOTBALL_API_KEY,
    keyLength: process.env.FOOTBALL_API_KEY ? process.env.FOOTBALL_API_KEY.length : 0,
    defaultSeason: football.SEASON,
    verdict,
    probes: results,
  });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');

    const path = subPath(event, 'predictions');

    // /test — UNAUTHENTICATED debug probe. Returns raw API-Football
    // responses for league=253 (MLS) across today, tomorrow, and last=10
    // for BOTH seasons 2024 and 2025, plus a verdict on which works.
    if (path === '/test' || path === '/test/') return await handleTest(event);

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
