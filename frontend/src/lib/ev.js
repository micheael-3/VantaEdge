// EV / Kelly math. Pure functions; safe to call with any user input.
// `confidence` is given as a 0-1 fraction in the new helpers below.
// `confidencePct` (0-100) is supported in the legacy `calculate*` helpers
// for back-compat with the existing EVInput/MatchCard code.

export function impliedProb(odds) {
  if (!odds || odds <= 1) return 0;
  return 1 / odds;
}

export function evPercent(confidence, odds) {
  // confidence as 0-1
  return (confidence * odds - 1) * 100;
}

export function kellyFraction(confidence, odds) {
  const b = odds - 1;
  const p = confidence;
  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f);
}

export function valueTier(evPct) {
  if (evPct >= 15) return { label: 'STRONG VALUE', color: 'mint', glow: true };
  if (evPct >= 5) return { label: 'VALUE', color: 'mint', glow: false };
  if (evPct >= 0) return { label: 'MARGINAL', color: 'indigo', glow: false };
  return { label: 'NO VALUE', color: 'red', glow: false };
}

// --- Legacy 0-100 helpers — kept so any older callers keep building. ---

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
