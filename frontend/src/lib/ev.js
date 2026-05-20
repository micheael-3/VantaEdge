// EV + Kelly calculators. Pure functions; safe to call with any user input.

export function calculateEV(confidencePct, odds) {
  const o = parseFloat(odds);
  const c = parseFloat(confidencePct);
  if (!o || o <= 1 || !c) return { edge: 0, valid: false };
  const modelP = c / 100;
  const bookP = 1 / o;
  const edge = (modelP - bookP) * 100;
  return { edge: Math.round(edge * 10) / 10, valid: true };
}

export function calculateKelly(confidencePct, odds) {
  const o = parseFloat(odds);
  const c = parseFloat(confidencePct);
  if (!o || o <= 1 || !c) return 0;
  const b = o - 1;
  const p = c / 100;
  const q = 1 - p;
  const k = (b * p - q) / b;
  if (k <= 0) return 0;
  // Cap at 10% of bankroll regardless of edge — a sane real-world ceiling.
  return Math.min(k, 0.1);
}
