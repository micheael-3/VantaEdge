// TESTING MODE: all tier gates disabled. Restore originals when re-enabling paid tiers.

const RANK = { FREE: 0, ANALYST: 1, EDGE: 2 };

function tierRank(t) {
  return RANK[t] ?? 0;
}

// TESTING MODE: always allow.
function requireTier(_user, _minTier) {
  return null;
}

// Three-league lineup post-simplification. Keep the SCOUT entries in any
// legacy DB rows working by mapping SCOUT → same league list as FREE.
const LEAGUES = {
  253: { name: 'MLS', minTier: 'FREE' },
  78:  { name: 'Bundesliga', minTier: 'FREE' },
  88:  { name: 'Eredivisie', minTier: 'FREE' },
};

// Every tier can access every league in the current simplified setup.
const ALL_LEAGUES = Object.keys(LEAGUES).map((k) => parseInt(k, 10));
const TIER_LEAGUES = {
  FREE:    ALL_LEAGUES,
  // SCOUT kept as a defensive alias so legacy DB rows still get league access.
  SCOUT:   ALL_LEAGUES,
  ANALYST: ALL_LEAGUES,
  EDGE:    ALL_LEAGUES,
};

module.exports = { tierRank, requireTier, LEAGUES, TIER_LEAGUES };
