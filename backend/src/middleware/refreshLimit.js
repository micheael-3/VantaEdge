const prisma = require('../prisma/client');

const LIMITS = { FREE: 0, SCOUT: 3, ANALYST: 10, EDGE: Infinity };

function todayStr() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function refreshLimit(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const user = req.dbUser || (await prisma.user.findUnique({ where: { id: req.user.id } }));
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const today = todayStr();
    let dailyRefreshes = user.dailyRefreshes;
    let lastRefreshDate = user.lastRefreshDate;

    if (lastRefreshDate !== today) {
      dailyRefreshes = 0;
      lastRefreshDate = today;
    }

    const isInitial = req.query && (req.query.initial === '1' || req.query.initial === 'true');

    if (user.tier === 'FREE') {
      if (!isInitial) {
        return res.status(429).json({ error: 'REFRESH_LIMIT_REACHED', tier: 'FREE' });
      }
    } else {
      const limit = LIMITS[user.tier];
      if (dailyRefreshes >= limit) {
        return res.status(429).json({ error: 'REFRESH_LIMIT_REACHED', tier: user.tier });
      }
      dailyRefreshes += 1;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { dailyRefreshes, lastRefreshDate },
    });
    req.dbUser = updated;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = refreshLimit;
module.exports.LIMITS = LIMITS;
