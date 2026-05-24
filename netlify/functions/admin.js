// Admin router. Every endpoint is protected by the requireAdmin middleware
// below — which builds on top of the regular session auth (requireUser)
// and additionally checks `users.is_admin = TRUE` on the loaded user.
//
// Sub-routes off /api/admin/*:
//   GET  /users                          → list every user
//   GET  /stats                          → KPI tile data for the admin panel
//   GET  /predictions                    → last 100 predictions w/ user emails
//   POST /users/:id/tier { tier }        → change a user's tier
//
// /api/admin/clear-history is mapped separately in netlify.toml — the
// wildcard /api/admin/* matches AFTER the more specific clear-history rule,
// so this file never sees that path.

const { sql } = require('./_shared/db');
const { json, error, notFound, subPath, parseBody } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');

const VALID_TIERS = new Set(['FREE', 'ANALYST', 'EDGE']);

// Same helpers as predictions.handleWeek — duplicated locally to avoid a
// Cyprus-aware mondayOf / addDaysStr are defined further down so they
// can share the same Asia/Nicosia helper as the rest of the pipeline.
// Hoisted via function declarations — referenced by forceRescan above.

async function requireAdmin(event) {
  const { res, user } = await requireUser(event);
  if (res) return { res };
  if (!user || !user.is_admin) return { res: error(403, 'Admin only') };
  return { user };
}

function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// GET /api/admin/users
async function listUsers() {
  const rows = await sql()`
    SELECT id,
           email,
           tier,
           is_admin           AS "isAdmin",
           created_at         AS "createdAt",
           daily_refreshes    AS "dailyRefreshes",
           onboarding_completed AS "onboardingCompleted"
    FROM users
    ORDER BY created_at DESC`;
  return json(200, { users: rows });
}

// GET /api/admin/stats
async function getStats() {
  const since = startOfTodayUtc();
  const [totalUsersRow] = await sql()`SELECT COUNT(*)::int AS n FROM users`;
  const tierRows = await sql()`SELECT tier, COUNT(*)::int AS n FROM users GROUP BY tier`;
  const [newUsersRow] = await sql()`SELECT COUNT(*)::int AS n FROM users WHERE created_at >= ${since}`;
  const [predTodayRow] = await sql()`SELECT COUNT(*)::int AS n FROM predictions WHERE created_at >= ${since}`;
  const [predAllRow] = await sql()`SELECT COUNT(*)::int AS n FROM predictions`;

  // Always return the three known tiers, defaulting missing buckets to 0.
  const byTier = { FREE: 0, ANALYST: 0, EDGE: 0 };
  for (const r of tierRows) {
    if (r.tier && byTier[r.tier] !== undefined) byTier[r.tier] = Number(r.n);
  }

  return json(200, {
    totalUsers: Number(totalUsersRow.n),
    byTier,
    newUsersToday: Number(newUsersRow.n),
    predictionsToday: Number(predTodayRow.n),
    predictionsAllTime: Number(predAllRow.n),
  });
}

// GET /api/admin/predictions
async function listPredictions() {
  const rows = await sql()`
    SELECT p.created_at      AS "createdAt",
           u.email           AS "userEmail",
           p.league,
           p.home_team       AS "homeTeam",
           p.away_team       AS "awayTeam",
           p.over_line       AS "overLine",
           p.over_confidence AS "overConfidence",
           p.btts,
           p.btts_confidence AS "bttsConfidence",
           p.over_hit        AS "overHit",
           p.btts_hit        AS "bttsHit"
    FROM predictions p
    LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT 100`;
  return json(200, { predictions: rows });
}

// POST /api/admin/rescan/:leagueId
// Wipes this week's predictions + scan_status for the league, then triggers
// the background scanner to rebuild. Used by the AdminPanel "Force Rescan"
// button when you need to refresh predictions mid-week (e.g. after a Claude
// prompt change).
async function forceRescan(leagueId) {
  if (!Number.isFinite(leagueId)) return error(400, 'Invalid leagueId');
  const weekStart = mondayOf(new Date());
  const weekEnd = addDaysStr(weekStart, 6);
  const scanId = `league-${leagueId}-week-${weekStart}`;

  // 1. Clear THIS WEEK'S UPCOMING + UNSETTLED predictions only.
  //    Critical bug fix (May 2026): the previous version deleted every
  //    row in the current week's kickoff window — including matches
  //    that had already played and been settled. That destroyed
  //    accuracy history. The new filter:
  //      - kickoff > NOW()       → only upcoming matches
  //      - over_hit IS NULL      → never touch a row that's already
  //      - btts_hit IS NULL        been settled by agent-results
  //
  //    Effect: re-runs Claude / refetches stats for matches that
  //    haven't kicked off yet, while preserving every settled row
  //    earlier in the same week.
  const deletedRows = await sql()`
    DELETE FROM predictions
    WHERE kickoff >= ${weekStart}::date
      AND kickoff <  (${weekEnd}::date + INTERVAL '1 day')
      AND kickoff > NOW()
      AND over_hit IS NULL
      AND btts_hit IS NULL
    RETURNING id`;
  console.log(`[admin/rescan] league=${leagueId} weekStart=${weekStart} deleted ${deletedRows.length} upcoming/unsettled rows; settled rows preserved.`);

  // 2. Clear the scan_status row so /week re-triggers cleanly.
  await sql()`DELETE FROM scan_status WHERE id = ${scanId}`;

  // 3. Fire the background scan.
  const base = process.env.URL || process.env.DEPLOY_URL || '';
  const secret = process.env.JWT_SECRET || '';
  if (!base || !secret) {
    return error(500, 'Server misconfigured: URL and JWT_SECRET required to trigger background scan');
  }
  try {
    const axios = require('axios');
    axios.post(`${base}/.netlify/functions/predictions-scan-background`,
      { leagueId, weekStart },
      {
        headers: { 'x-internal-scan-secret': secret, 'content-type': 'application/json' },
        timeout: 5000,
        validateStatus: () => true,
      }).catch((err) => {
        console.error('[admin/rescan] bg trigger failed:', err.message);
      });
  } catch (err) {
    console.error('[admin/rescan] bg trigger setup failed:', err.message);
  }

  return json(200, {
    ok: true,
    leagueId,
    weekStart,
    weekEnd,
    deletedUpcomingRows: deletedRows.length,
    settledRowsPreserved: true,
  });
}

// POST /api/admin/clear-all
//
// DESTRUCTIVE — wipes settled data including the predictions table.
// Requires `confirmation: "DELETE ALL"` in the request body to proceed.
// Previously a window.confirm was the only guard, which we hit by
// accident in May 2026 and lost weeks of settled accuracy history.
// The phrase is intentional: typing "CONFIRM" is too easy to muscle-
// memory through, "DELETE ALL" forces you to read what you're doing.
//
// For non-destructive refresh of upcoming-only predictions, use
// /api/admin/rescan/:leagueId — that preserves every settled row.
async function clearAllAndRescan(event) {
  const body = parseBody(event);
  const confirmation = String((body && body.confirmation) || '').trim();
  if (confirmation !== 'DELETE ALL') {
    return error(400, 'Confirmation required: send { "confirmation": "DELETE ALL" } to proceed. This is destructive and irreversible.');
  }
  const TARGETS = [
    'bankroll_entries',
    'odds_snapshots',
    'odds_movements',
    'user_alerts',
    'agent_alerts',
    'accuracy_model',
    'best_bet',
    'prediction_history',
    'predictions',
    'scan_status',
  ];

  // Run each DELETE inside its own try/catch so a missing table on an
  // older schema doesn't abort the rest. Mirrors admin-clear-history.js.
  const results = [];
  let totalDeleted = 0;
  for (const table of TARGETS) {
    try {
      const sqlFn = sql();
      const parts = [`DELETE FROM ${table}`];
      parts.raw = [`DELETE FROM ${table}`];
      const r = await sqlFn(parts);
      const rows = r && r.rowCount != null ? Number(r.rowCount) : null;
      if (Number.isFinite(rows)) totalDeleted += rows;
      results.push({ ok: true, table, rowsDeleted: rows });
    } catch (e) {
      results.push({ ok: false, table, error: e.message });
    }
  }

  // Fire the background scan immediately so the dashboard doesn't sit
  // empty waiting for the cron tick.
  let scanTriggered = false;
  try {
    const base = process.env.URL || process.env.DEPLOY_URL || '';
    const secret = process.env.JWT_SECRET || '';
    if (base && secret) {
      const weekStart = mondayOf(new Date());
      const axios = require('axios');
      axios.post(`${base}/.netlify/functions/predictions-scan-background`,
        { leagueId: 253, weekStart },
        {
          headers: { 'x-internal-scan-secret': secret, 'content-type': 'application/json' },
          timeout: 5000,
          validateStatus: () => true,
        }).catch((err) => {
          console.error('[admin/clear-all] bg trigger failed:', err.message);
        });
      scanTriggered = true;
    }
  } catch (err) {
    console.warn('[admin/clear-all] background scan trigger failed:', err.message);
  }

  return json(200, { ok: true, totalDeleted, scanTriggered, results });
}

// POST /api/admin/clear-bad
//
// Deletes only the synthetic 50%/50% rows that the legacy fallback path
// produced when OpenRouter was unhealthy. Safe by design: never touches
// settled rows. Used to clean up "Analysis unavailable. 50%" placeholders
// without affecting accuracy history.
async function clearBadPredictions() {
  const rows = await sql()`
    DELETE FROM predictions
    WHERE over_confidence = 50
      AND btts_confidence = 50
      AND over_hit IS NULL
      AND btts_hit IS NULL
    RETURNING id`;
  console.log(`[admin/clear-bad] deleted ${rows.length} synthetic 50% placeholders (settled rows preserved).`);
  return json(200, { ok: true, deletedRows: rows.length });
}

// POST /api/admin/refresh-forms
//
// Non-destructive refresh of the form arrays inside match_data on every
// UPCOMING prediction row. Use when the form dots on today's cards
// look thin/empty because the rows were inserted before the
// extractFormForTeam + topUpForm padding fixes shipped.
//
// What it does:
//   1. SELECT every prediction with kickoff > NOW() and league = 'MLS'
//   2. For each, re-fetch the home + away team's recent fixtures from
//      API-Football (cached in the football helper, so cheap on warm
//      calls).
//   3. Recompute homeForm / awayForm using the current 5-entry padded
//      extractFormForTeam logic, with the same any-venue top-up the
//      weekly scan uses.
//   4. UPDATE just the match_data JSONB column with the fresh form
//      arrays. Every other column is untouched.
//
// Never touches over_hit / btts_hit / accuracy_score / debate_json /
// calibrated_*. Never DELETEs anything. Safe to call repeatedly.
async function refreshUpcomingForms() {
  const football = require('./_shared/football');
  const rows = await sql()`
    SELECT id, fixture_id, kickoff, match_data
    FROM predictions
    WHERE kickoff > NOW()
      AND league = 'MLS'
    ORDER BY kickoff ASC`;

  const report = {
    rowsScanned: rows.length,
    rowsUpdated: 0,
    rowsSkipped: 0,
    errors: [],
    durationMs: 0,
  };
  const t0 = Date.now();

  // Same helper structure as predictions-scan-background.js — we use
  // the actual exported extractFormForTeam (which now pads to 5 with
  // null) and re-implement the "top-up from any-venue" check locally
  // to avoid coupling admin.js to scan-bg.
  function realCount(arr) {
    return Array.isArray(arr) ? arr.filter((v) => v != null).length : 0;
  }

  for (const r of rows) {
    let md = {};
    try {
      md = typeof r.match_data === 'string' ? JSON.parse(r.match_data) : (r.match_data || {});
    } catch {
      report.errors.push({ fixtureId: r.fixture_id, error: 'match_data unparseable' });
      report.rowsSkipped += 1;
      continue;
    }
    const homeId = (md.home && md.home.id);
    const awayId = (md.away && md.away.id);
    if (!homeId || !awayId) {
      report.rowsSkipped += 1;
      continue;
    }

    try {
      // Pull venue-only AND any-venue arrays in parallel. Football's
      // cache will keep this cheap when the scan ran recently.
      const [homeLast, awayLast, homeAnyVenue, awayAnyVenue] = await Promise.all([
        football.getTeamLastHomeGames(homeId, 253),
        football.getTeamLastAwayGames(awayId, 253),
        football.getTeamLastGamesAnyVenue(homeId, 253),
        football.getTeamLastGamesAnyVenue(awayId, 253),
      ]);

      // Venue-specific first. Top up from any-venue when thin.
      const homeVenue = football.extractFormForTeam(homeLast, homeId);
      const awayVenue = football.extractFormForTeam(awayLast, awayId);
      const homeAny = football.extractFormForTeam(homeAnyVenue, homeId);
      const awayAny = football.extractFormForTeam(awayAnyVenue, awayId);

      const homeForm = realCount(homeAny) > realCount(homeVenue) ? homeAny : homeVenue;
      const awayForm = realCount(awayAny) > realCount(awayVenue) ? awayAny : awayVenue;

      const newMd = {
        ...md,
        home: { ...(md.home || {}), form: homeForm },
        away: { ...(md.away || {}), form: awayForm },
      };

      await sql()`
        UPDATE predictions
        SET match_data = ${JSON.stringify(newMd)}::jsonb
        WHERE id = ${r.id}`;
      report.rowsUpdated += 1;
      console.log(`[admin/refresh-forms] fixture=${r.fixture_id} home=[${homeForm.map((v) => v || '·').join(',')}] away=[${awayForm.map((v) => v || '·').join(',')}]`);
    } catch (e) {
      report.errors.push({ fixtureId: r.fixture_id, error: e.message });
    }
  }

  report.durationMs = Date.now() - t0;
  return json(200, { ok: true, report });
}

// POST /api/admin/recover-history?days=30
//
// Recovery for the May 2026 wipe. Pulls last N days of MLS fixtures
// from API-Football and inserts a row in the predictions table for
// every FINISHED match that doesn't already have one.
//
// Honest scope:
//   - The match score is restored (home_goals + away_goals + over_hit
//     + btts_hit) because API-Football still has it.
//   - The AI prediction (line, confidence, debate, reasoning) is NOT
//     restored. It's GONE. Rows inserted by this function have
//     over_confidence = 0 and btts_confidence = 0 as sentinels meaning
//     "no real AI prediction here". match_data.recovered = true so
//     the UI can render them distinctly.
//   - These rows do NOT count toward Accuracy hit rate stats — the
//     History endpoint filters out over_confidence = 0. Including them
//     would either invent AI predictions (lie) or deflate the real
//     model's track record (also wrong).
//
// What the user sees afterwards:
//   - Results page lists every match in the window with FT score
//     and a "RECOVERED · NO AI PREDICTION" badge.
//   - Accuracy hit rate is unchanged — still reflects only rows where
//     the AI actually produced a prediction.
//   - Going forward the new weekly scan + safe Force Rescan rebuilds
//     real settled-with-AI-prediction history week by week.
async function recoverHistory(event) {
  const football = require('./_shared/football');
  const qs = (event && event.queryStringParameters) || {};
  const days = (() => {
    const n = parseInt(qs.days, 10);
    if (!Number.isFinite(n) || n < 1) return 30;
    return Math.min(n, 90);
  })();

  const today = new Date();
  const from = new Date(today.getTime() - days * 86400000);
  const toDateStr = today.toISOString().slice(0, 10);
  const fromDateStr = from.toISOString().slice(0, 10);

  const report = {
    days,
    fromDate: fromDateStr,
    toDate: toDateStr,
    seasonsTried: [],
    fixturesFetched: 0,
    fixturesFinished: 0,
    fixturesAlreadyInDb: 0,
    rowsInserted: 0,
    errors: [],
    durationMs: 0,
  };
  const t0 = Date.now();

  // Try each candidate season; first one with data wins.
  const seasons = football.candidateSeasonsForDate(fromDateStr);
  let fixtures = [];
  for (const season of seasons) {
    report.seasonsTried.push(season);
    try {
      const list = await football.apiGet('/fixtures', {
        league: 253,
        season,
        from: fromDateStr,
        to: toDateStr,
      }, { tag: `recover-history s${season}` });
      if (Array.isArray(list) && list.length) {
        fixtures = list;
        break;
      }
    } catch (e) {
      report.errors.push({ stage: `fetch-season-${season}`, error: e.message });
    }
  }
  report.fixturesFetched = fixtures.length;

  // Filter to finished matches only.
  const FINISHED = new Set(['FT', 'AET', 'PEN']);
  const finished = fixtures.filter((fx) => {
    const s = fx && fx.fixture && fx.fixture.status && fx.fixture.status.short;
    return FINISHED.has(s);
  });
  report.fixturesFinished = finished.length;

  if (finished.length === 0) {
    report.durationMs = Date.now() - t0;
    return json(200, { ok: true, report, message: 'No finished fixtures in window. Try a larger ?days= value.' });
  }

  // Find which fixture_ids already exist so we don't double-insert.
  const ids = finished.map((fx) => fx.fixture.id).filter(Boolean);
  let existing = new Set();
  try {
    const rows = await sql()`
      SELECT DISTINCT fixture_id FROM predictions WHERE fixture_id = ANY(${ids})`;
    existing = new Set(rows.map((r) => Number(r.fixture_id)));
  } catch (e) {
    report.errors.push({ stage: 'existing-lookup', error: e.message });
  }
  report.fixturesAlreadyInDb = existing.size;

  // We need a user_id to insert against (predictions.user_id is NOT NULL).
  // Use the first admin if available, else the oldest user.
  let ownerId = null;
  try {
    const admins = await sql()`SELECT id FROM users WHERE is_admin = TRUE ORDER BY created_at ASC LIMIT 1`;
    if (admins.length) ownerId = admins[0].id;
    else {
      const fb = await sql()`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`;
      if (fb.length) ownerId = fb[0].id;
    }
  } catch (e) {
    return error(500, `Cannot find an owner user_id for inserts: ${e.message}`);
  }
  if (!ownerId) return error(500, 'No users exist — cannot insert recovered rows.');

  for (const fx of finished) {
    if (existing.has(Number(fx.fixture.id))) continue;
    const home = fx.teams && fx.teams.home && fx.teams.home.name;
    const away = fx.teams && fx.teams.away && fx.teams.away.name;
    const h = fx.goals && fx.goals.home;
    const a = fx.goals && fx.goals.away;
    if (!home || !away || h == null || a == null) continue;
    const total = Number(h) + Number(a);
    // Default neutral line of 2.5 — the over_hit boolean is the only
    // thing the Results page reads, and we compute it honestly off the
    // real score. The 0% confidence sentinel means "no AI prediction".
    const overLine = 2.5;
    const overHit = total > overLine;
    const bothScored = Number(h) > 0 && Number(a) > 0;
    // BTTS direction is ambiguous without an AI call. Store 'YES' as
    // the canonical default and the boolean as whether both teams
    // scored — Results page just shows "Score: H-A" for recovered rows.
    const bttsCall = 'YES';
    const bttsHit = bothScored;
    const mdPayload = {
      recovered: true,
      recoveredAt: new Date().toISOString(),
      league: 'MLS',
      kickoff: fx.fixture.date,
      home: { name: home },
      away: { name: away },
      aiStatus: 'recovered',
      aiReason: 'Score-only recovery from API-Football. Original AI prediction lost in May 2026 wipe.',
    };
    try {
      await sql()`
        INSERT INTO predictions
          (user_id, league, fixture_id, home_team, away_team, kickoff,
           over_line, over_confidence, btts, btts_confidence,
           over_hit, btts_hit, home_goals, away_goals,
           match_data)
        VALUES
          (${ownerId}, 'MLS', ${fx.fixture.id}, ${home}, ${away}, ${fx.fixture.date},
           ${overLine}, 0, ${bttsCall}, 0,
           ${overHit}, ${bttsHit}, ${Number(h)}, ${Number(a)},
           ${JSON.stringify(mdPayload)}::jsonb)`;
      report.rowsInserted += 1;
    } catch (e) {
      // Most likely a column-doesn't-exist (42703) for home_goals/away_goals
      // if the migration hasn't been applied. Try a minimal INSERT
      // without those columns as a fallback.
      if (e && (e.code === '42703' || /column .* does not exist/i.test(e.message || ''))) {
        try {
          await sql()`
            INSERT INTO predictions
              (user_id, league, fixture_id, home_team, away_team, kickoff,
               over_line, over_confidence, btts, btts_confidence,
               over_hit, btts_hit, match_data)
            VALUES
              (${ownerId}, 'MLS', ${fx.fixture.id}, ${home}, ${away}, ${fx.fixture.date},
               ${overLine}, 0, ${bttsCall}, 0,
               ${overHit}, ${bttsHit},
               ${JSON.stringify(mdPayload)}::jsonb)`;
          report.rowsInserted += 1;
        } catch (e2) {
          report.errors.push({ fixtureId: fx.fixture.id, stage: 'insert-fallback', error: e2.message });
        }
      } else {
        report.errors.push({ fixtureId: fx.fixture.id, stage: 'insert', error: e.message });
      }
    }
  }

  report.durationMs = Date.now() - t0;
  return json(200, { ok: true, report });
}

// POST /api/admin/resettle
//
// Re-runs the agent-results settle pipeline immediately. Use this to
// recover settled data after an accidental wipe — it walks every
// prediction where kickoff < NOW() AND over_hit IS NULL, fetches the
// real score from API-Football, and writes hit/miss + accuracy_score.
//
// Safe to call repeatedly; the underlying settleBatch only operates on
// rows that don't have hit columns set, so already-settled rows are
// untouched.
async function resettlePastPredictions() {
  let settleBatch;
  try {
    settleBatch = require('./agent-results').settleBatch;
  } catch (e) {
    return error(500, `Could not load agent-results: ${e.message}`);
  }
  if (typeof settleBatch !== 'function') {
    return error(500, 'agent-results.settleBatch is not exported');
  }
  try {
    const report = await settleBatch({ dryRun: false });
    return json(200, { ok: true, report });
  } catch (e) {
    console.error('[admin/resettle] failed:', e);
    return error(500, e.message || 'resettle failed');
  }
}

// GET /api/admin/debug-fixture/:fixtureId
//
// Cookie-authed alias for /api/predictions/debug/:fixtureId. Same data,
// but uses admin JWT instead of ?key= so the UI can link straight to
// it. Forwards the actual work to the predictions debug handler by
// calling it directly (we already wrote the inspector logic there).
async function debugFixture(fixtureId) {
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return error(400, 'fixtureId must be a positive integer');
  }
  const football = require('./_shared/football');

  let rawFixture;
  try {
    rawFixture = await football.getFixtureById(fixtureId);
  } catch (e) {
    return json(500, { stage: 'getFixtureById', error: e.message, fixtureId });
  }
  if (!rawFixture) {
    return json(404, { stage: 'getFixtureById', error: 'fixture not found', fixtureId });
  }
  const homeId = rawFixture.teams && rawFixture.teams.home && rawFixture.teams.home.id;
  const awayId = rawFixture.teams && rawFixture.teams.away && rawFixture.teams.away.id;
  const leagueId = rawFixture.league && rawFixture.league.id;
  const seasonHint = rawFixture.league && rawFixture.league.season;

  async function safe(label, p) {
    try { return { ok: true, label, data: await p }; }
    catch (e) { return { ok: false, label, error: e.message }; }
  }
  const [homeLastR, awayLastR, homeStatsR, awayStatsR, h2hR, standingsR] = await Promise.all([
    safe('homeLast', football.getTeamLastHomeGames(homeId, leagueId, seasonHint)),
    safe('awayLast', football.getTeamLastAwayGames(awayId, leagueId, seasonHint)),
    safe('homeStats', football.getTeamStats(homeId, leagueId, seasonHint)),
    safe('awayStats', football.getTeamStats(awayId, leagueId, seasonHint)),
    safe('h2h', football.getH2H(homeId, awayId)),
    safe('standings', football.getLeagueStandings(leagueId, seasonHint)),
  ]);

  const homeForm = homeLastR.ok ? football.extractFormForTeam(homeLastR.data, homeId) : null;
  const awayForm = awayLastR.ok ? football.extractFormForTeam(awayLastR.data, awayId) : null;
  const homeStanding = standingsR.ok ? football.pickStandingForTeam(standingsR.data, homeId) : null;
  const awayStanding = standingsR.ok ? football.pickStandingForTeam(standingsR.data, awayId) : null;
  const refNameRaw = rawFixture.fixture && typeof rawFixture.fixture.referee === 'string'
    ? rawFixture.fixture.referee.trim() : '';

  return json(200, {
    fixtureId,
    fetchedAt: new Date().toISOString(),
    rawFixture,
    raw: {
      homeLast: homeLastR,
      awayLast: awayLastR,
      homeStats: homeStatsR,
      awayStats: awayStatsR,
      h2h: h2hR,
      standings: standingsR.ok ? { teams: standingsR.data && standingsR.data.byTeamId ? standingsR.data.byTeamId.size : 0, season: standingsR.data && standingsR.data.season } : standingsR,
    },
    extracted: {
      homeForm,
      awayForm,
      homeStanding,
      awayStanding,
      refereeName: refNameRaw || null,
    },
  });
}

// mondayOf — re-uses the same Cyprus-aware Monday helper the scan uses,
// so clear-all-and-rescan picks the same weekStart key the scan will
// write to. Requiring it locally keeps the admin function self-contained.
function mondayOf(date) {
  try {
    const { cyprusMonday } = require('./_shared/dates');
    return cyprusMonday(date);
  } catch {
    // Fallback to UTC math if the dates module isn't bundled for some
    // reason (shouldn't happen — netlify.toml includes _shared/**).
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
}

function addDaysStr(baseDateStr, days) {
  const d = new Date(`${baseDateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// POST /api/admin/users/:id/tier  body { tier }
async function setUserTier(event, userId) {
  const body = parseBody(event);
  const tier = String(body && body.tier ? body.tier : '').toUpperCase();
  if (!VALID_TIERS.has(tier)) {
    return error(400, 'Invalid tier — must be FREE, ANALYST or EDGE');
  }
  const rows = await sql()`
    UPDATE users SET tier = ${tier}::tier WHERE id = ${userId}
    RETURNING id, email, tier, is_admin AS "isAdmin",
              created_at AS "createdAt",
              daily_refreshes AS "dailyRefreshes",
              onboarding_completed AS "onboardingCompleted"`;
  if (!rows.length) return error(404, 'User not found');
  return json(200, { user: rows[0] });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };

    const gate = await requireAdmin(event);
    if (gate.res) return gate.res;

    const path = subPath(event, 'admin');
    const method = event.httpMethod;

    // --- POST /users/:id/tier ---
    const tierMatch = path.match(/^\/users\/([0-9a-f-]+)\/tier\/?$/i);
    if (tierMatch && method === 'POST') return await setUserTier(event, tierMatch[1]);

    // --- POST /rescan/:leagueId ---
    const rescanMatch = path.match(/^\/rescan\/(\d+)\/?$/);
    if (rescanMatch && method === 'POST') return await forceRescan(parseInt(rescanMatch[1], 10));

    // --- POST /clear-all --- cookie-authed wipe + rescan. Requires
    //     { confirmation: "DELETE ALL" } in the body to actually run.
    if (method === 'POST' && (path === '/clear-all' || path === '/clear-all/')) {
      return await clearAllAndRescan(event);
    }

    // --- POST /clear-bad --- delete synthetic 50%/50% placeholders.
    //     Never touches settled rows; no confirmation required.
    if (method === 'POST' && (path === '/clear-bad' || path === '/clear-bad/')) {
      return await clearBadPredictions();
    }

    // --- POST /resettle --- re-run agent-results settle logic for any
    //     past predictions still missing hit columns. Use to recover
    //     settled data when something has been wiped.
    if (method === 'POST' && (path === '/resettle' || path === '/resettle/')) {
      return await resettlePastPredictions();
    }

    // --- POST /refresh-forms --- non-destructive update of form arrays
    //     inside match_data for every upcoming row. Use when form dots
    //     look thin/empty after a stale scan.
    if (method === 'POST' && (path === '/refresh-forms' || path === '/refresh-forms/')) {
      return await refreshUpcomingForms();
    }

    // --- POST /recover-history?days=30 --- score-only recovery from
    //     API-Football. Inserts placeholder rows for every finished
    //     fixture in the window that doesn't already exist. Honest
    //     about what's been lost — no fabricated AI predictions.
    if (method === 'POST' && (path === '/recover-history' || path === '/recover-history/')) {
      return await recoverHistory(event);
    }

    // --- GET /debug-fixture/:fixtureId --- cookie-authed inspector.
    //     Mirrors /api/predictions/debug/:fixtureId?key= but uses the
    //     admin JWT cookie so the UI can link straight to it.
    const debugMatch = path.match(/^\/debug-fixture\/(\d+)\/?$/);
    if (debugMatch && method === 'GET') return await debugFixture(parseInt(debugMatch[1], 10));

    if (method === 'GET' && (path === '/users' || path === '/users/')) return await listUsers();
    if (method === 'GET' && (path === '/stats' || path === '/stats/')) return await getStats();
    if (method === 'GET' && (path === '/predictions' || path === '/predictions/')) return await listPredictions();

    return notFound();
  } catch (err) {
    console.error('admin handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
