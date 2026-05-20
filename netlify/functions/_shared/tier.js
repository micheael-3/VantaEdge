// MLS-only lineup. FREE / ANALYST / EDGE all see the same league set —
// upgrade-required gates are off in this build.

const RANK = { FREE: 0, ANALYST: 1, EDGE: 2 };

function tierRank(t) {
  return RANK[t] ?? 0;
}

// TESTING MODE: always allow.
function requireTier(_user, _minTier) {
  return null;
}

// MLS only (id 253). Other leagues were removed during the MLS-only
// simplification — keep this map narrow so any stray league lookup
// surfaces as "Invalid league" instead of silently fetching data.
const LEAGUES = {
  253: { name: 'MLS', minTier: 'FREE' },
};

const ALL_LEAGUES = Object.keys(LEAGUES).map((k) => parseInt(k, 10));
const TIER_LEAGUES = {
  FREE:    ALL_LEAGUES,
  // SCOUT kept as a defensive alias so legacy DB rows still get league access.
  SCOUT:   ALL_LEAGUES,
  ANALYST: ALL_LEAGUES,
  EDGE:    ALL_LEAGUES,
};

module.exports = { tierRank, requireTier, LEAGUES, TIER_LEAGUES };
