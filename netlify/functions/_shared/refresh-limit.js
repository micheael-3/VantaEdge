// TESTING MODE: refresh limits disabled. consumeRefresh always succeeds and never increments.
// Restore the original file from git history when re-enabling paid tiers.

const { sql } = require('./db');

const LIMITS = { FREE: Infinity, SCOUT: Infinity, ANALYST: Infinity, EDGE: Infinity };

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// TESTING MODE: always allow, but still keep last_refresh_date current so the
// counter resets cleanly when limits are re-enabled.
async function consumeRefresh(user, _isInitial) {
  const today = todayStr();
  if (user.last_refresh_date !== today) {
    try {
      await sql()`UPDATE users SET daily_refreshes = 0, last_refresh_date = ${today} WHERE id = ${user.id}`;
    } catch (e) {
      console.error('consumeRefresh date reset failed:', e.message);
    }
  }
  return { ok: true, dailyRefreshes: 0, lastRefreshDate: today };
}

module.exports = { consumeRefresh, LIMITS };
