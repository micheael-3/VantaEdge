export function calculateEV(confidencePct, boostedOdds) {
  const odds = parseFloat(boostedOdds);
  if (!odds || odds <= 1) return { edge: 0, valueBadge: 'NO_VALUE' };
  const claudeP = confidencePct / 100;
  const bookieP = 1 / odds;
  const edge = (claudeP - bookieP) * 100;
  let valueBadge;
  if (edge >= 15) valueBadge = 'STRONG_VALUE';
  else if (edge >= 8) valueBadge = 'VALUE';
  else if (edge >= 1) valueBadge = 'MARGINAL';
  else valueBadge = 'NO_VALUE';
  return { edge: Math.round(edge * 10) / 10, valueBadge };
}

export function calculateKelly(confidencePct, boostedOdds) {
  const odds = parseFloat(boostedOdds);
  if (!odds || odds <= 1) return 0;
  const b = odds - 1;
  const p = confidencePct / 100;
  const q = 1 - p;
  const k = (b * p - q) / b;
  if (k <= 0) return 0;
  return Math.min(k, 0.1);
}
