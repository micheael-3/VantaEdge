export const LEAGUES = [
  { id: 253, name: 'MLS', flag: '🇺🇸', minTier: 'FREE' },
  { id: 78, name: 'Bundesliga', flag: '🇩🇪', minTier: 'FREE' },
  { id: 88, name: 'Eredivisie', flag: '🇳🇱', minTier: 'FREE' },
];

export const TIER_RANK = { FREE: 0, ANALYST: 1, EDGE: 2 };

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
    id: 'FREE',
    name: 'Free',
    price: '$0',
    period: '/mo',
    popular: false,
    features: [
      '3 leagues (MLS, Bundesliga, Eredivisie)',
      'AI confidence + reasoning',
      'Daily predictions',
      'Form + rest day stats',
    ],
  },
  {
    id: 'ANALYST',
    name: 'Analyst',
    price: '$12.99',
    period: '/mo',
    popular: true,
    features: [
      'Everything in Free',
      'EV calculator on every match card',
      'Kelly stake sizing',
      'Full prediction history + accuracy stats',
      'CSV export of bet log',
      'Priority support',
    ],
  },
];

export const REFRESH_LIMITS = { FREE: Infinity, ANALYST: Infinity, EDGE: Infinity };
