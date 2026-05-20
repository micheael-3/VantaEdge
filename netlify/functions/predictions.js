const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { LEAGUES, TIER_LEAGUES, tierRank } = require('./_shared/tier');
const { consumeRefresh } = require('./_shared/refresh-limit');
const football = require('./_shared/football');
const { analyseMatch } = require('./_shared/claude');
const { calculateEV, calculateKelly } = require('./_shared/ev');
const oddsService = require('./_shared/odds');

// Derive rest days from a team's recent fixtures list rather than making a
// separate /fixtures call. Falls back to null when no past games are present.
function restDaysFromForm(formFixtures) {
  if (!Array.isArray(formFixtures) || formFixtures.length === 0) return null;
  const sorted = formFixtures.slice().sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  const lastPlayed = sorted.find((f) => new Date(f.fixture.date) < new Date());
  if (!lastPlayed) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(lastPlayed.fixture.date).getTime()) / 86400000));
}

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
// Static fallback only used for the "recent matches" probe where we
// don't have a target date to derive a season from. Per-date lookups use
// football.candidateSeasonsForDate(date) so a calendar year date in 2026
// is queried with season=2026 first, regardless of FOOTBALL_DEFAULT_SEASON.
const RECENT_FALLBACK_SEASONS = (() => {
  const set = new Set([football.SEASON, football.SEASON + 1, football.SEASON - 1]);
  return Array.from(set);
})();

async function pickFixtures(leagueId, explicitDate) {
  const today = todayDateStr();

  if (explicitDate) {
    let list = [];
    let usedSeason = null;
    for (const season of football.candidateSeasonsForDate(explicitDate)) {
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

  // 1. Today, candidate seasons derived from today's calendar year
  for (const season of football.candidateSeasonsForDate(today)) {
    const list = await tryDate(leagueId, today, 300, season);
    if (list.length) {
      console.log(`[predictions] cascade league=${leagueId} hit TODAY season=${season} → ${list.length}`);
      return { fixtures: list, dateLabel: 'Today', matchDate: today, isPast: false, isUpcoming: false, isToday: true, mode: 'today', seasonUsed: season };
    }
  }
  // 2. Tomorrow, candidate seasons derived from tomorrow's calendar year
  const tomorrow = addDaysStr(today, 1);
  for (const season of football.candidateSeasonsForDate(tomorrow)) {
    const list = await tryDate(leagueId, tomorrow, 3600, season);
    if (list.length) {
      console.log(`[predictions] cascade league=${leagueId} hit TOMORROW season=${season} → ${list.length}`);
      return { fixtures: list, dateLabel: 'Tomorrow', matchDate: tomorrow, isPast: false, isUpcoming: true, isToday: false, mode: 'tomorrow', seasonUsed: season };
    }
  }
  // 3. Recent past (last=10) as the last-resort fallback. No date here,
  //    so use the static SEASON +/- 1 list.
  for (const season of RECENT_FALLBACK_SEASONS) {
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

  // Full-parallel fixture processing with a hard per-fixture timeout.
  // Total wall time = max(individual fixture time), not sum, so the
  // whole dashboard load completes in ~10-18s even with Claude calls
  // averaging 5-10s. Chunking made the math worse: 3 chunks × 22s
  // worst-case = 66s, blowing the Netlify 26s function timeout.
  //
  // API-Football impact: 10 fixtures × ~11 calls = 110 calls in parallel,
  // but the in-memory cache deduplicates shared teams across fixtures
  // and the per-minute Pro cap (~450/min) is for total calls/minute,
  // not in-flight concurrency. Still well under.
  //
  // Per-fixture timeout = 18s. If Claude is slow, we ship the analytical
  // fallback for that one card and the user still gets 9 real predictions
  // instead of 0.
  const PER_FIXTURE_TIMEOUT_MS = 18000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const withTimeout = (promise, ms, fallback) =>
    Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);

  const processOne = async (fx) => {
      const homeId = fx.teams.home.id;
      const awayId = fx.teams.away.id;
      try {
        // Simplified data pull: 4 API calls per fixture (last home, last away,
        // stats home, stats away). Rest days are derived from the form
        // fixtures we already have. H2H / referee / injuries / weather were
        // dropped in the simplification pass.
        const [homeLast, awayLast, homeStats, awayStats] = await Promise.all([
          football.getTeamLastHomeGames(homeId, leagueId),
          football.getTeamLastAwayGames(awayId, leagueId),
          football.getTeamStats(homeId, leagueId),
          football.getTeamStats(awayId, leagueId),
        ]);
        const homeForm = football.extractFormForTeam(homeLast, homeId);
        const awayForm = football.extractFormForTeam(awayLast, awayId);
        const homeRest = restDaysFromForm(homeLast);
        const awayRest = restDaysFromForm(awayLast);

        const venueCity = fx.fixture && fx.fixture.venue && fx.fixture.venue.city;

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
          },
          away: {
            id: awayId,
            name: fx.teams.away.name,
            form: awayForm,
            restDays: awayRest,
            stats: awayStats,
            goalsPerGame: awayGpg,
          },
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
          },
          away: {
            id: awayId,
            name: fx.teams.away.name,
            form: awayForm,
            restDays: awayRest,
            goalsPerGame: awayGpg,
          },
          actualResult,
          isSharpMove: sharpFixtureSet.has(Number(fx.fixture.id)),
          predictions: {
            over: analysis.over,
            btts: analysis.btts,
            firstHalf: analysis.firstHalf,
            asianHandicap: analysis.asianHandicap,
          },
          aiStatus: analysis.aiStatus || 'ok',
          aiReason: analysis.aiReason || null,
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

  const timeoutFallbackFor = (fx) => ({
    fixtureId: fx.fixture.id,
    league: league.name,
    kickoff: fx.fixture.date,
    home: { name: fx.teams.home.name },
    away: { name: fx.teams.away.name },
    error: 'Analysis timed out — try refreshing in a moment',
  });

  // Rate-limit-safe sequential batching. Process at most 2 fixtures in
  // parallel, then sleep 1 second before the next batch. This bounds
  // simultaneous API-Football calls to 2 × 4 = 8 (well below the
  // per-minute Pro cap) and gives the rolling window time to drain
  // between bursts. Hard cap at 6 fixtures so 3 batches × ~7s + 2 ×
  // 1s = ~23s stays under the 26s function timeout. Anything beyond
  // the 6th fixture is dropped for this load — refresh to see the rest.
  //
  // Retry-once-on-rate-limit: after each batch we scan results for
  // "Too many requests" / "rateLimit" error markers, sleep 2s, and
  // re-run processOne for those fixtures a single time before keeping
  // the error.
  const BATCH_SIZE = 2;
  const BATCH_PAUSE_MS = 1000;
  const MAX_FIXTURES = 6;
  const RATE_LIMIT_RETRY_PAUSE_MS = 2000;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isRateLimitError = (r) => {
    if (!r || !r.error) return false;
    const e = String(r.error).toLowerCase();
    return e.includes('too many requests') || e.includes('ratelimit') || e.includes('rate limit') || e.includes('429');
  };

  const limited = fixtures.slice(0, MAX_FIXTURES);
  if (fixtures.length > MAX_FIXTURES) {
    console.log(`[predictions] capping ${fixtures.length} fixtures at ${MAX_FIXTURES} to fit function timeout`);
  }

  const results = [];
  for (let i = 0; i < limited.length; i += BATCH_SIZE) {
    const batch = limited.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((fx) => withTimeout(processOne(fx), PER_FIXTURE_TIMEOUT_MS, timeoutFallbackFor(fx))),
    );

    // Retry any rate-limit-flagged results ONCE, after a 2s cool-down.
    const retryIndexes = [];
    for (let k = 0; k < batchResults.length; k++) {
      if (isRateLimitError(batchResults[k])) retryIndexes.push(k);
    }
    if (retryIndexes.length) {
      console.log(`[predictions] rate-limit retry for ${retryIndexes.length} fixture(s) after ${RATE_LIMIT_RETRY_PAUSE_MS}ms`);
      await delay(RATE_LIMIT_RETRY_PAUSE_MS);
      const retried = await Promise.all(
        retryIndexes.map((k) =>
          withTimeout(processOne(batch[k]), PER_FIXTURE_TIMEOUT_MS, timeoutFallbackFor(batch[k])),
        ),
      );
      for (let r = 0; r < retryIndexes.length; r++) {
        batchResults[retryIndexes[r]] = retried[r];
      }
    }

    results.push(...batchResults);
    if (i + BATCH_SIZE < limited.length) {
      await delay(BATCH_PAUSE_MS);
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

// GET /api/predictions/upcoming/:leagueId — scans a date window and
// returns [{date, count, label, isToday, isPast}]. Lightweight: only the
// per-date fixture count is needed, and every call reuses the shared
// cache so a dashboard refresh after a tab switch is free.
//
// Query params (both optional):
//   ?past=N    days to include BEFORE today (default 0, max 14)
//   ?future=N  days to include INCLUDING today (default 7, max 14)
//
// Output is ordered oldest → newest so the frontend can render pills
// left-to-right naturally with past on the left and future on the right.
async function handleUpcoming(event, leagueId) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const league = LEAGUES[leagueId];
  if (!league) return error(400, 'Invalid league');

  const allowed = TIER_LEAGUES[user.tier] || [];
  if (!allowed.includes(leagueId)) {
    return error(403, 'UPGRADE_REQUIRED', { requiredTier: league.minTier });
  }

  const qs = event.queryStringParameters || {};
  const past   = clamp(parseInt(qs.past, 10), 0, 14, 0);
  const future = clamp(parseInt(qs.future, 10), 1, 14, 7);

  const today = todayDateStr();
  const days = [];
  // Past dates: i = -past → -1. Skip when past=0.
  for (let i = -past; i < 0; i++) {
    const dateStr = addDaysStr(today, i);
    let count = null;
    try {
      // Past dates rarely change — 24h TTL.
      count = await football.getFixtureCountByDateAuto(leagueId, dateStr, 86400);
    } catch (e) {
      console.error(`upcoming scan failed for ${dateStr}:`, e.message);
    }
    days.push({
      date: dateStr,
      count: count == null ? null : Number(count),
      label: labelForDateStr(dateStr),
      isToday: false,
      isPast: true,
    });
  }
  // Today + future dates: i = 0 → future-1.
  for (let i = 0; i < future; i++) {
    const dateStr = addDaysStr(today, i);
    let count = null;
    try {
      // i === 0 → today (5min TTL), i ≥ 1 → future (1h TTL)
      const ttl = i === 0 ? 300 : 3600;
      count = await football.getFixtureCountByDateAuto(leagueId, dateStr, ttl);
    } catch (e) {
      console.error(`upcoming scan failed for ${dateStr}:`, e.message);
    }
    days.push({
      date: dateStr,
      count: count == null ? null : Number(count),
      label: labelForDateStr(dateStr),
      isToday: i === 0,
      isPast: false,
    });
  }

  return json(200, { leagueId, league: league.name, days });
}

function clamp(n, lo, hi, fallback) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
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

// GET /api/predictions/ai-test — UNAUTHENTICATED OpenRouter probe.
// Calls OpenRouter with the same model + headers analyseMatch uses and
// returns the raw response (or the full error body). Use to diagnose
// why every fixture is falling back to 50% confidence: env var missing,
// wrong key prefix, model not available, rate limit, etc.
async function handleAITest(_event) {
  const axios = require('axios');
  const key = process.env.OPENROUTER_API_KEY || '';
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const MODEL = 'anthropic/claude-3.5-haiku';

  const meta = {
    now: new Date().toISOString(),
    model: MODEL,
    keyConfigured: !!key,
    keyLength: key.length,
    keyPrefix: key ? key.slice(0, 8) : null,
    keyLooksValid: /^sk-or-v1-/.test(key),
    referer: process.env.URL || null,
  };

  if (!key) {
    return json(200, {
      ...meta,
      verdict: 'OPENROUTER_API_KEY is not set in Netlify env vars. The prediction pipeline falls back to 50% confidence for every match. Add the key and redeploy.',
    });
  }

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You return ONLY valid JSON with shape {"ping":"pong","model":"<model name>"}.' },
      { role: 'user', content: 'ping' },
    ],
    max_tokens: 50,
  };

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'X-Title': 'FastScore',
  };
  if (process.env.URL) headers['HTTP-Referer'] = process.env.URL;

  const started = Date.now();
  try {
    const res = await axios.post(OPENROUTER_URL, body, { headers, timeout: 20000, validateStatus: () => true });
    const ms = Date.now() - started;
    const content = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message
      ? res.data.choices[0].message.content
      : null;
    let verdict;
    if (res.status === 200 && content) verdict = `✅ OpenRouter is reachable, model ${MODEL} replied. AI should be running on the dashboard.`;
    else if (res.status === 401) verdict = '❌ 401 from OpenRouter — your OPENROUTER_API_KEY is invalid or revoked.';
    else if (res.status === 402) verdict = '❌ 402 from OpenRouter — out of credits. Top up your OpenRouter account.';
    else if (res.status === 404) verdict = `❌ 404 — model "${MODEL}" not found on OpenRouter. Try a different model id.`;
    else if (res.status === 429) verdict = '❌ 429 — rate limited by OpenRouter.';
    else verdict = `❌ HTTP ${res.status} from OpenRouter. See body below.`;
    return json(200, {
      ...meta,
      durationMs: ms,
      httpStatus: res.status,
      verdict,
      content,
      rawBody: res.data,
    });
  } catch (err) {
    return json(200, {
      ...meta,
      durationMs: Date.now() - started,
      verdict: `❌ Request failed before a response came back: ${err.message}`,
      errorCode: err.code || null,
      errorMessage: err.message,
    });
  }
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

    // /ai-test — UNAUTHENTICATED probe that calls OpenRouter directly and
    // returns the raw response or HTTP error body. Use to diagnose why
    // every prediction is falling back to 50% confidence.
    if (path === '/ai-test' || path === '/ai-test/') return await handleAITest(event);

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
