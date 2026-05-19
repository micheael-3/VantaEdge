const prisma = require('../prisma/client');

function gate(allowedTiers, requiredTier) {
  return async function gateMiddleware(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      if (!allowedTiers.includes(user.tier)) {
        return res.status(403).json({ error: 'UPGRADE_REQUIRED', requiredTier });
      }
      req.dbUser = user;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

const requireScout = gate(['SCOUT', 'ANALYST', 'EDGE'], 'SCOUT');
const requireAnalyst = gate(['ANALYST', 'EDGE'], 'ANALYST');
const requireEdge = gate(['EDGE'], 'EDGE');

module.exports = { requireScout, requireAnalyst, requireEdge };
