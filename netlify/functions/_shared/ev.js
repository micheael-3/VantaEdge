function round1(n) {
  return Math.round(n * 10) / 10;
}

function calculateEV(confidencePct, boostedOdds) {
  if (!boostedOdds || boostedOdds <= 1) return { edge: 0, valueBadge: 'NO_VALUE' };
  const claudeProbability = confidencePct / 100;
  const bookieProbability = 1 / boostedOdds;
  const edge = (claudeProbability - bookieProbability) * 100;
  let valueBadge;
  if (edge >= 15) valueBadge = 'STRONG_VALUE';
  else if (edge >= 8) valueBadge = 'VALUE';
  else if (edge >= 1) valueBadge = 'MARGINAL';
  else valueBadge = 'NO_VALUE';
  return { edge: round1(edge), valueBadge };
}

function calculateKelly(confidencePct, odds) {
  if (!odds || odds <= 1) return 0;
  const b = odds - 1;
  const p = confidencePct / 100;
  const q = 1 - p;
  const k = (b * p - q) / b;
  if (k <= 0) return 0;
  return Math.min(k, 0.1);
}

module.exports = { calculateEV, calculateKelly };
