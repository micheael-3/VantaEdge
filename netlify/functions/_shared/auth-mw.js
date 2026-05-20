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
  const user = await loadUserById(decoded.id);
  if (!user) return { res: error(401, 'UNAUTHORIZED') };
  return { user, token: decoded };
}

module.exports = { requireUser, loadUserById };
