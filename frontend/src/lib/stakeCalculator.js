// Stake Calculator — pure math, no React, no I/O.
//
// Two entry points:
//   computeSingle({ bankroll, odds })
//   computeParlay({ bankroll, legs })            -- legs = [{odds, label}]
//   computeParlayFromAverage({ bankroll, avgOdds, numLegs })
//
// All three return a plain object the UI can render directly. We never
// throw — invalid inputs surface as a `warning` string and `recommendedStake: 0`
// so the page can react without try/catch noise.
//
// Design notes:
//   • Bookmaker overround is assumed at 5%. That's roughly the typical
//     mid-market two-way line on MLS goal markets; lopsided markets run
//     higher and would push our "true" probability down further. 5% is
//     a conservative anchor — better to under-bet than over-bet.
//   • Quarter-Kelly on singles, Tenth-Kelly on parlays. Full Kelly is
//     mathematically optimal but assumes perfect probability knowledge,
//     which a casual bettor never has. Fractional Kelly trades a tiny
//     bit of long-run growth for much lower variance, which is the
//     correct trade for someone whose bankroll matters.
//   • Hard ceiling at 10% of bankroll regardless of what Kelly says.
//     Even a "true 90%" pick at long odds shouldn't get half your roll
//     on one card.
//   • Hard floor at 0.5% of bankroll when Kelly is positive — sub-0.5%
//     bets aren't meaningful for the user; we'd rather flag "skip it"
//     than recommend rounding noise.

const OVERROUND = 1.05;            // 5% bookmaker margin assumption
const SINGLE_KELLY_FRACTION = 0.25; // quarter Kelly
const PARLAY_KELLY_FRACTION = 0.10; // tenth Kelly (parlays are riskier)
const MAX_STAKE_FRACTION = 0.10;   // never recommend > 10% of bankroll
const MIN_STAKE_FRACTION = 0.005;  // floor at 0.5% when Kelly is positive

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function round1(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function riskLevelFor(stakePercent) {
  if (stakePercent > 5) return 'HIGH';
  if (stakePercent >= 2) return 'MEDIUM';
  return 'LOW';
}

// Internal: validate the inputs every variant needs. Returns a warning
// string on failure or null when everything checks out.
function validateBasic({ bankroll, odds }) {
  const b = Number(bankroll);
  const o = Number(odds);
  if (!Number.isFinite(b) || b < 10) {
    return 'Minimum bankroll €10 for meaningful stakes';
  }
  if (!Number.isFinite(o) || o < 1.01) return 'Invalid odds';
  if (o > 50) return 'Very long shot — extremely high risk';
  return null;
}

// Apply the universal stake clamps (max-10%, min-0.5%) AFTER fractional
// Kelly has been computed. Always returns a number in [0, bankroll*0.10].
function clampStake(rawStake, bankroll) {
  if (!Number.isFinite(rawStake) || rawStake <= 0) return 0;
  const max = bankroll * MAX_STAKE_FRACTION;
  const min = bankroll * MIN_STAKE_FRACTION;
  if (rawStake > max) return max;
  if (rawStake < min) return min;
  return rawStake;
}

// ---------- SINGLE BET ----------
export function computeSingle({ bankroll, odds }) {
  const warning = validateBasic({ bankroll, odds });
  if (warning) {
    return {
      kind: 'single',
      ok: false,
      warning,
      recommendedStake: 0,
    };
  }
  const b = Number(bankroll);
  const o = Number(odds);

  // Step 1: implied probability adjusted for the 5% overround.
  const adjustedProbability = (1 / o) / OVERROUND;

  // Step 2: full Kelly. b in formula = odds - 1 (decimal payout multiplier).
  const bMul = o - 1;
  const p = adjustedProbability;
  const q = 1 - p;
  const kelly = (bMul * p - q) / bMul;

  if (kelly <= 0) {
    return {
      kind: 'single',
      ok: true,
      noValue: true,
      warning: 'No value detected at these odds — consider skipping',
      recommendedStake: 0,
      odds: o,
      bankroll: b,
      trueProbability: round1(adjustedProbability * 100),
      impliedProbability: round1((1 / o) * 100),
    };
  }

  // Step 3: quarter Kelly + Step 5 clamp.
  const fractionalKelly = kelly * SINGLE_KELLY_FRACTION;
  const rawStake = b * fractionalKelly;
  const recommendedStake = clampStake(rawStake, b);

  const stakePercent = (recommendedStake / b) * 100;
  const potentialReturn = recommendedStake * o;
  const potentialProfit = potentialReturn - recommendedStake;
  const riskLevel = riskLevelFor(stakePercent);

  return {
    kind: 'single',
    ok: true,
    recommendedStake: round2(recommendedStake),
    potentialReturn: round2(potentialReturn),
    potentialProfit: round2(potentialProfit),
    stakePercent: round1(stakePercent),
    riskLevel,
    odds: o,
    bankroll: b,
    trueProbability: round1(adjustedProbability * 100),
    impliedProbability: round1((1 / o) * 100),
    edgePercent: round1((adjustedProbability - 1 / o) * 100),
    // The raw full-Kelly number is useful for users curious about how
    // conservative we're being. We don't surface it by default but
    // expose it on the object for an "advanced" toggle later.
    fullKelly: round1(kelly * 100),
    fractionalKellyApplied: SINGLE_KELLY_FRACTION,
  };
}

// Internal: shared parlay math. Accepts an array of leg odds.
// Returns a normalised result object the public wrappers can return as-is.
function _parlay({ bankroll, legOddsArr, legLabels }) {
  // Bankroll validation up front so parlay-with-bad-bankroll also fails fast.
  if (!Number.isFinite(Number(bankroll)) || Number(bankroll) < 10) {
    return { kind: 'parlay', ok: false, warning: 'Minimum bankroll €10 for meaningful stakes', recommendedStake: 0 };
  }
  if (!Array.isArray(legOddsArr) || legOddsArr.length < 2) {
    return { kind: 'parlay', ok: false, warning: 'Parlays need at least 2 legs', recommendedStake: 0 };
  }
  if (legOddsArr.length > 8) {
    return { kind: 'parlay', ok: false, warning: 'Parlays are capped at 8 legs', recommendedStake: 0 };
  }
  for (const o of legOddsArr) {
    if (!Number.isFinite(o) || o < 1.01) return { kind: 'parlay', ok: false, warning: 'Invalid odds on one of the legs', recommendedStake: 0 };
    if (o > 50) return { kind: 'parlay', ok: false, warning: 'One of the legs is a very long shot — extremely high risk', recommendedStake: 0 };
  }

  const b = Number(bankroll);

  // Step 1: combined odds = product of every leg.
  const combinedOdds = legOddsArr.reduce((acc, o) => acc * o, 1);

  // Step 2: true probability per leg + combined.
  const legProbs = legOddsArr.map((o) => (1 / o) / OVERROUND);
  const combinedTrueProbability = legProbs.reduce((acc, p) => acc * p, 1);

  // Step 3: EV / edge check.
  const impliedProbability = 1 / combinedOdds;
  const edgePct = (combinedTrueProbability - impliedProbability) * 100;

  // Step 4: Kelly on the combined market.
  const bMul = combinedOdds - 1;
  const p = combinedTrueProbability;
  const q = 1 - p;
  const kelly = (bMul * p - q) / bMul;

  const breakEvenHitRate = (1 / combinedOdds) * 100;

  // Parlay-specific warning when math says skip.
  let warning = null;
  if (edgePct < 0) warning = 'Parlays lose value with each leg added — math says skip';
  else if (kelly <= 0) warning = 'No value detected at these combined odds — consider skipping';
  else if (legOddsArr.length > 5) warning = 'Each additional leg significantly reduces your edge';

  let recommendedStake = 0;
  let stakePercent = 0;
  let potentialReturn = 0;
  let potentialProfit = 0;

  if (kelly > 0) {
    const fractionalKelly = kelly * PARLAY_KELLY_FRACTION;
    const rawStake = b * fractionalKelly;
    recommendedStake = clampStake(rawStake, b);
    stakePercent = (recommendedStake / b) * 100;
    potentialReturn = recommendedStake * combinedOdds;
    potentialProfit = potentialReturn - recommendedStake;
  }

  // Step 6: parlays with 3+ legs are forced HIGH regardless of size.
  let riskLevel = riskLevelFor(stakePercent);
  if (legOddsArr.length >= 3) riskLevel = 'HIGH';

  return {
    kind: 'parlay',
    ok: true,
    noValue: kelly <= 0,
    warning,
    recommendedStake: round2(recommendedStake),
    potentialReturn: round2(potentialReturn),
    potentialProfit: round2(potentialProfit),
    stakePercent: round1(stakePercent),
    riskLevel,
    bankroll: b,
    legs: legOddsArr.map((o, i) => ({
      odds: o,
      label: (legLabels && legLabels[i]) || `Leg ${i + 1}`,
      trueProbability: round1(legProbs[i] * 100),
    })),
    numLegs: legOddsArr.length,
    combinedOdds: round2(combinedOdds),
    combinedTrueProbability: round1(combinedTrueProbability * 100),
    impliedProbability: round1(impliedProbability * 100),
    edgePercent: round1(edgePct),
    breakEvenHitRate: round1(breakEvenHitRate),
    fullKelly: round1(kelly * 100),
    fractionalKellyApplied: PARLAY_KELLY_FRACTION,
    forcedHighRisk: legOddsArr.length >= 3,
    legsWarning: legOddsArr.length >= 3
      ? 'Parlays with 3+ legs are high risk. The math rarely favours them long term.'
      : null,
  };
}

// ---------- PARLAY: individual legs ----------
export function computeParlay({ bankroll, legs }) {
  const oddsArr = Array.isArray(legs) ? legs.map((l) => Number(l && l.odds)) : [];
  const labels = Array.isArray(legs) ? legs.map((l) => (l && l.label) || null) : [];
  return _parlay({ bankroll, legOddsArr: oddsArr, legLabels: labels });
}

// ---------- PARLAY: average odds × N ----------
// Convenience wrapper for "I'll have ~1.80 odds across 3 legs". Internally
// we still treat each leg as separate so the per-leg true probability +
// final compounded probability math is identical to the individual path.
export function computeParlayFromAverage({ bankroll, avgOdds, numLegs }) {
  const n = parseInt(numLegs, 10);
  const avg = Number(avgOdds);
  if (!Number.isFinite(n) || n < 2 || n > 8) {
    return { kind: 'parlay', ok: false, warning: 'Number of legs must be between 2 and 8', recommendedStake: 0 };
  }
  if (!Number.isFinite(avg) || avg < 1.01) {
    return { kind: 'parlay', ok: false, warning: 'Invalid average odds', recommendedStake: 0 };
  }
  const oddsArr = Array.from({ length: n }, () => avg);
  return _parlay({ bankroll, legOddsArr: oddsArr });
}

// ---------- Helpers exposed for the dashboard "Calculate Stake →" deep link ----------
// Converts an AI confidence (0-100) into the "fair odds" the user would
// need to break even at that probability. Used to seed the calculator's
// odds input when the link is followed from a MatchCard.
export function fairOddsFromConfidence(confidencePct) {
  const p = Number(confidencePct) / 100;
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  return round2(1 / p);
}
