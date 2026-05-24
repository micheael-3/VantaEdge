// Central sport/league registry. EVERY new piece of FastScore that
// touches predictions, autopsy, patterns, calibration, learned rules, or
// any other AI-pipeline machinery should read from here instead of
// hardcoding 'MLS' / 253 / 'football'. When a future sport (UFC, World
// Cup, Champions League) goes live, you add ONE entry to SPORTS and the
// agents loop over it automatically.
//
// Conventions
//   id:        kebab-case unique key, used as the storage `league`/`sport`
//              identifier across DB tables.
//   name:      human-readable name shown in UI ("MLS", "UFC", "World Cup").
//   type:      'football' | 'mma' | etc. Drives which Claude prompts /
//              market shapes apply.
//   apiFootballLeagueId: only meaningful when type==='football' (UFC will
//              swap this for a Sherdog/MMA-API equivalent later).
//   season:    integer year; the football data fetchers use it.
//   active:    inactive sports are skipped by every scheduled agent.
//   markets:   array of market keys the AI should produce for this sport.
//              MLS: ['over_under', 'btts'].
//              UFC: ['method_of_victory', 'round_betting', 'fight_to_go_distance'].
//   flag:      emoji shown in nav / cards.
//
// Adding a sport:
//   1. Append an entry to SPORTS.
//   2. Set active: false until prompts + data fetchers are ready.
//   3. The agents will pick it up on next cron run.

const SPORTS = [
  {
    id: 'mls',
    name: 'MLS',
    type: 'football',
    apiFootballLeagueId: 253,
    season: 2024,
    active: true,
    markets: ['over_under', 'btts'],
    flag: '🇺🇸',
  },
  // Future stubs — keep `active: false` until ready. Example:
  // {
  //   id: 'ufc',
  //   name: 'UFC',
  //   type: 'mma',
  //   apiFootballLeagueId: null,
  //   season: 2026,
  //   active: false,
  //   markets: ['method_of_victory', 'round_betting', 'fight_to_go_distance'],
  //   flag: '🥊',
  // },
];

// ---------- Helpers ----------

function activeSports() {
  return SPORTS.filter((s) => s && s.active);
}

function findById(id) {
  if (!id) return null;
  return SPORTS.find((s) => s.id === String(id).toLowerCase()) || null;
}

// Legacy bridge — most existing rows store league as 'MLS' (the .name)
// rather than the canonical id 'mls'. This helper accepts either so
// new code can be written against ids while old rows still resolve.
function findByLeagueLabel(label) {
  if (!label) return null;
  const key = String(label).toLowerCase();
  return (
    SPORTS.find((s) => s.id === key || s.name.toLowerCase() === key) || null
  );
}

function isFootball(sport) {
  return sport && sport.type === 'football';
}

module.exports = {
  SPORTS,
  activeSports,
  findById,
  findByLeagueLabel,
  isFootball,
};
