const { readCookies } = require('./cookies');
const { verifyAccess } = require('./jwt');
const { error } = require('./response');
const { sql } = require('./db');

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
  const rows = await sql()`SELECT id, email, tier, daily_refreshes, last_refresh_date, is_admin
                           FROM users WHERE id = ${decoded.id}`;
  if (rows.length === 0) return { res: error(401, 'UNAUTHORIZED') };
  return { user: rows[0], token: decoded };
}

module.exports = { requireUser };
