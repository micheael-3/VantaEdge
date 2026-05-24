const { readCookies } = require('./cookies');
const { verifyAccess } = require('./jwt');
const { error } = require('./response');
const { sql } = require('./db');

// Resilient user load. Some live DBs may not have the `is_admin` column yet
// (the schema ALTER ships in schema.sql but won't be applied until the
// operator hits /api/migrate). If the column is missing — Postgres error
// code 42703 — we transparently retry without it and set is_admin=false
// so the dashboard keeps working until the migration is run.
async function loadUserById(userId) {
  try {
    const rows = await sql()`SELECT id, email, tier, daily_refreshes, last_refresh_date, is_admin
                             FROM users WHERE id = ${userId}`;
    return rows[0] || null;
  } catch (err) {
    if (err && (err.code === '42703' || /column "?is_admin"? does not exist/i.test(err.message || ''))) {
      console.warn('[auth-mw] is_admin column missing — falling back. Run schema migration to enable admin features.');
      const rows = await sql()`SELECT id, email, tier, daily_refreshes, last_refresh_date
                               FROM users WHERE id = ${userId}`;
      const u = rows[0] || null;
      if (u) u.is_admin = false;
      return u;
    }
    throw err;
  }
}

// Synthetic user shape returned to handlers when the caller is a guest
// (tier='GUEST' JWT, no DB row). Tier is set to 'GUEST' so any handler
// gating on tier === 'ANALYST' / isSharp(...) correctly treats them as
// not-paid. is_admin is hard-false. daily_refreshes / last_refresh_date
// match the refresh-limit shape so consumeRefresh doesn't NPE.
function makeGuestUser() {
  return {
    id: null,
    email: null,
    tier: 'GUEST',
    is_admin: false,
    isGuest: true,
    daily_refreshes: 0,
    last_refresh_date: null,
  };
}

async function requireUser(event) {
  const cookies = readCookies(event);
  const token = cookies.accessToken;
  if (!token) return { res: error(401, 'UNAUTHORIZED') };
  let decoded;
  try {
    decoded = verifyAccess(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { res: error(401, 'TOKEN_EXPIRED') };
    return { res: error(401, 'UNAUTHORIZED') };
  }
  // Guest tokens carry tier='GUEST' and no real id. Short-circuit before
  // the DB lookup — guests have no row to find. Handlers that need a
  // real user should gate on user.isGuest === true and return 401.
  if (decoded && decoded.tier === 'GUEST') {
    return { user: makeGuestUser(), token: decoded };
  }
  const user = await loadUserById(decoded.id);
  if (!user) return { res: error(401, 'UNAUTHORIZED') };
  return { user, token: decoded };
}

// Convenience for handlers that should reject guests outright (Bet
// Tracker, Accuracy history, Feedback submit, Admin endpoints). The
// caller still uses requireUser first to populate `user`.
function rejectIfGuest(user) {
  if (user && user.isGuest) return error(401, 'GUEST_NOT_ALLOWED');
  return null;
}

module.exports = { requireUser, loadUserById, rejectIfGuest, makeGuestUser };
