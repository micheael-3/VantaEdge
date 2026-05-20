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

    if (method === 'GET' && (path === '/users' || path === '/users/')) return await listUsers();
    if (method === 'GET' && (path === '/stats' || path === '/stats/')) return await getStats();
    if (method === 'GET' && (path === '/predictions' || path === '/predictions/')) return await listPredictions();

    return notFound();
  } catch (err) {
    console.error('admin handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
