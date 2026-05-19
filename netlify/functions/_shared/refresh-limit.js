const { sql } = require('./db');

const LIMITS = { FREE: 0, SCOUT: 3, ANALYST: 10, EDGE: Infinity };

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function consumeRefresh(user, isInitial) {
  const today = todayStr();
  let dailyRefreshes = user.daily_refreshes;
  let lastDate = user.last_refresh_date;

  if (lastDate !== today) {
    dailyRefreshes = 0;
    lastDate = today;
  }

  if (user.tier === 'FREE') {
    if (!isInitial) return { ok: false, reason: 'REFRESH_LIMIT_REACHED' };
  } else {
    const limit = LIMITS[user.tier];
    if (dailyRefreshes >= limit) return { ok: false, reason: 'REFRESH_LIMIT_REACHED' };
    dailyRefreshes += 1;
  }

  await sql()`UPDATE users
              SET daily_refreshes = ${dailyRefreshes}, last_refresh_date = ${lastDate}
              WHERE id = ${user.id}`;

  return { ok: true, dailyRefreshes, lastRefreshDate: lastDate };
}

module.exports = { consumeRefresh, LIMITS };
