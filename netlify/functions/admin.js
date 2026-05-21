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

  // 1. Clear this week's predictions for the league.
  // The legacy `predictions.league` column stores the league name (e.g.
  // "MLS"); we only have the ID here. Easiest: scope by kickoff window —
  // MLS is the only league in this build, so the window is unambiguous.
  await sql()`
    DELETE FROM predictions
    WHERE kickoff >= ${weekStart}::date
      AND kickoff <  (${weekEnd}::date + INTERVAL '1 day')`;

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

  return json(200, { ok: true, leagueId, weekStart, weekEnd });
}

// POST /api/admin/clear-all
//
// Cookie-authed admin version of /api/admin/clear-history (which uses
// ?key=<ADMIN_PASSWORD>). Wipes the same 10 tables and triggers a
// fresh background scan. Used by the AdminPanel "Clear All & Rescan"
// button so admins don't need to construct URLs or type their
// password into a browser address bar.
async function clearAllAndRescan() {
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

    // --- POST /clear-all --- cookie-authed wipe + rescan. The legacy
    //     /api/admin/clear-history endpoint (uses ?key=) still works
    //     for direct hits; this is the in-app version.
    if (method === 'POST' && (path === '/clear-all' || path === '/clear-all/')) {
      return await clearAllAndRescan();
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
