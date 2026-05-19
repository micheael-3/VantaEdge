// TESTING MODE: all tier gates disabled. Restore originals when re-enabling paid tiers.

const RANK = { FREE: 0, SCOUT: 1, ANALYST: 2, EDGE: 3 };

function tierRank(t) {
  return RANK[t] ?? 0;
}

// TESTING MODE: always allow.
function requireTier(_user, _minTier) {
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

// TESTING MODE: every tier (including FREE) can access every league.
const ALL_LEAGUES = Object.keys(LEAGUES).map((k) => parseInt(k, 10));
const TIER_LEAGUES = {
  FREE:    ALL_LEAGUES,
  SCOUT:   ALL_LEAGUES,
  ANALYST: ALL_LEAGUES,
  EDGE:    ALL_LEAGUES,
};

module.exports = { tierRank, requireTier, LEAGUES, TIER_LEAGUES };
