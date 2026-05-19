const { error } = require('./response');

const RANK = { FREE: 0, SCOUT: 1, ANALYST: 2, EDGE: 3 };

function tierRank(t) {
  return RANK[t] ?? 0;
}

function requireTier(user, minTier) {
  if (tierRank(user.tier) < tierRank(minTier)) {
    return error(403, 'UPGRADE_REQUIRED', { requiredTier: minTier });
  }
  return null;
}

const LEAGUES = {
  253: { name: 'MLS', minTier: 'SCOUT' },
  78:  { name: 'Bundesliga', minTier: 'SCOUT' },
  88:  { name: 'Eredivisie', minTier: 'SCOUT' },
  40:  { name: 'Championship', minTier: 'ANALYST' },
  61:  { name: 'Ligue 1', minTier: 'ANALYST' },
  179: { name: 'Scottish Prem', minTier: 'ANALYST' },
  140: { name: 'La Liga', minTier: 'ANALYST' },
  39:  { name: 'Premier League', minTier: 'EDGE' },
};

const TIER_LEAGUES = {
  FREE:    [253, 78, 88],
  SCOUT:   [253, 78, 88],
  ANALYST: [253, 78, 88, 40, 61, 179, 140],
  EDGE:    [253, 78, 88, 40, 61, 179, 140, 39],
};

module.exports = { tierRank, requireTier, LEAGUES, TIER_LEAGUES };
