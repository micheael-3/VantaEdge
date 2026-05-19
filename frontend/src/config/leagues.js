export const LEAGUES = [
  { id: 253, name: 'MLS', flag: '🇺🇸', minTier: 'SCOUT' },
  { id: 78, name: 'Bundesliga', flag: '🇩🇪', minTier: 'SCOUT' },
  { id: 88, name: 'Eredivisie', flag: '🇳🇱', minTier: 'SCOUT' },
  { id: 40, name: 'Championship', flag: '🏴', minTier: 'ANALYST' },
  { id: 61, name: 'Ligue 1', flag: '🇫🇷', minTier: 'ANALYST' },
  { id: 179, name: 'Scottish Prem', flag: '🏴', minTier: 'ANALYST' },
  { id: 140, name: 'La Liga', flag: '🇪🇸', minTier: 'ANALYST' },
  { id: 39, name: 'Premier League', flag: '🏴', minTier: 'EDGE' },
];

export const TIER_RANK = { FREE: 0, SCOUT: 1, ANALYST: 2, EDGE: 3 };

// TESTING MODE: all gating helpers return true. Restore tier-aware logic
// when re-enabling paid tiers (see git history for originals).
export function canAccessLeague(_userTier, _leagueMinTier) {
  return true;
}

export function canSeeEV(_userTier) {
  return true;
}

export function canSeeExtras(_userTier) {
  return true;
}

export const PLANS = [
  {
    id: 'SCOUT',
    name: 'Scout',
    price: '$4.99',
    period: '/mo',
    popular: false,
    features: [
      '3 leagues',
      '3 daily refreshes',
      'Over/BTTS predictions',
      'Confidence %',
    ],
  },
  {
    id: 'ANALYST',
    name: 'Analyst',
    price: '$12.99',
    period: '/mo',
    popular: true,
    features: [
      '7 leagues',
      '10 daily refreshes',
      'Everything in Scout',
      '+EV calculator',
      'Kelly stake %',
      'Value badges',
      'AI reasoning',
      '30-day history',
    ],
  },
  {
    id: 'EDGE',
    name: 'Edge',
    price: '$24.99',
    period: '/mo',
    popular: false,
    features: [
      'All 8 leagues',
      'Unlimited refreshes',
      'Everything in Analyst',
      'First half markets',
      'Asian handicap',
      'Full accuracy dashboard',
      'CSV export',
      'Early access to new leagues',
    ],
  },
];

export const REFRESH_LIMITS = { FREE: 0, SCOUT: 3, ANALYST: 10, EDGE: Infinity };
