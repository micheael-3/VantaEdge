// Helpers that translate backend fixture shape → design's expected fields.
// Backend shape (from /api/predictions/253):
//   { home: { name, form: ['W','D'...], goalsPerGame: { avgFor, avgAgainst }, restDays },
//     away: { ... },
//     kickoff: ISO string,
//     predictions: {
//       over: { line, confidence, reasoning },
//       btts: { prediction: 'YES'|'NO', confidence, reasoning },
//     },
//     actualResult: { homeGoals, awayGoals, overHit, bttsHit } | undefined }

// Raw model confidence. Used for the prediction badge on each card so the
// bettor can see what the model originally claimed.
export function overConf(fixture) {
  const v = fixture?.predictions?.over?.confidence;
  return typeof v === 'number' ? Math.round(v) : 0;
}

export function bttsConf(fixture) {
  const v = fixture?.predictions?.btts?.confidence;
  return typeof v === 'number' ? Math.round(v) : 0;
}

// Calibrated confidence pulled from the backend (null when the calibration
// engine hasn't produced an adjustment for this bucket yet, e.g. <10
// settled samples). Used by the small "Calibrated NN%" chip below the
// raw badge.
export function overCalibrated(fixture) {
  const v = fixture?.predictions?.over?.calibratedConfidence;
  return typeof v === 'number' ? Math.round(v) : null;
}

export function bttsCalibrated(fixture) {
  const v = fixture?.predictions?.btts?.calibratedConfidence;
  return typeof v === 'number' ? Math.round(v) : null;
}

// Effective confidence — prefer calibrated when present, fall back to raw.
// This is what EV / Kelly / value-tier math should use because the bettor
// cares about the calibrated probability, not the model's gut feel. If the
// model says 80% but historically that bucket hits at 60%, +EV is the
// 60%-based EV — anything else is garbage-in-garbage-out.
export function effectiveOverConf(fixture) {
  const c = overCalibrated(fixture);
  return c != null ? c : overConf(fixture);
}

export function effectiveBttsConf(fixture) {
  const c = bttsCalibrated(fixture);
  return c != null ? c : bttsConf(fixture);
}

export function bttsLabel(fixture) {
  const p = (fixture?.predictions?.btts?.prediction || 'YES').toUpperCase();
  return `BTTS ${p}`;
}

// Strong-value flag uses CALIBRATED confidence — a raw 80% that actually
// hits 55% of the time should not be highlighted as "strong value".
export function isStrongValue(fixture) {
  return Math.max(effectiveOverConf(fixture), effectiveBttsConf(fixture)) >= 70;
}

export function agentScore(fixture) {
  return Math.max(effectiveOverConf(fixture), effectiveBttsConf(fixture));
}

// Confidence label — null when confidence is too low to surface at all.
// Used to render a small mono uppercase chip next to the confidence %.
//   80+ → 'Very Strong Pick'
//   70-79 → 'Strong Pick'
//   65-69 → 'Good Pick'
//   55-64 → 'Decent Pick'
//   <55  → null  (the whole match is hidden by MatchCard)
//
// Threshold lowered from <60 to <55 in the mobile UI polish round so
// borderline picks still surface with an honest "Decent" label rather
// than being silently hidden — keeps the dashboard from looking empty
// on quieter matchdays.
export function confidenceLabel(conf) {
  if (typeof conf !== 'number' || conf < 55) return null;
  if (conf >= 80) return 'Very Strong Pick';
  if (conf >= 70) return 'Strong Pick';
  if (conf >= 65) return 'Good Pick';
  return 'Decent Pick';
}

// Surface the betting market label directly: "Over 2.5 goals".
//
// The previous "More than X goals" plain-English translation looked
// friendly but was actively misleading. A casual reader naturally
// parses "more than 2 goals" as "2 or more goals" — which makes a
// 2-0 final (total = 2) feel like a HIT. The bookmaker line "Over 2.5"
// is strict mathematical >, hits only on 3+. We had Minnesota vs Salt
// Lake settled correctly as MISS at 2-0, but the user read the label
// as a HIT and the contradiction looked like a bug in our settle code.
//
// Going forward: render the exact line the bookmaker uses. Zero
// ambiguity. "Over 2.5" means total goals > 2.5, full stop.
export function overPlainEnglish(line) {
  const n = typeof line === 'number' ? line : parseFloat(line);
  if (!Number.isFinite(n)) return 'Over 2.5 goals';
  return `Over ${n} goals`;
}

// BTTS plain English. 'YES' → both score, 'NO' → at least one blanks.
export function bttsPlainEnglish(pred) {
  return String(pred || 'YES').toUpperCase() === 'NO'
    ? 'One team fails to score'
    : 'Both teams score';
}

// Format kickoff "Sat 7:30 PM" — match the design's kickoff line.
export function formatKickoffShort(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d
      .toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
      .replace(/^0/, '');
    if (sameDay) return `TODAY ${time}`;
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    return `${day} ${time}`;
  } catch {
    return '';
  }
}

// "AVG GOALS X / Y" — averages across both teams' for/against where available.
export function avgScored(fixture) {
  const h = fixture?.home?.goalsPerGame?.avgFor;
  const a = fixture?.away?.goalsPerGame?.avgFor;
  if (typeof h !== 'number' && typeof a !== 'number') return '—';
  if (typeof h === 'number' && typeof a === 'number') {
    return ((h + a) / 2).toFixed(1);
  }
  return (typeof h === 'number' ? h : a).toFixed(1);
}

export function avgConceded(fixture) {
  const h = fixture?.home?.goalsPerGame?.avgAgainst;
  const a = fixture?.away?.goalsPerGame?.avgAgainst;
  if (typeof h !== 'number' && typeof a !== 'number') return '—';
  if (typeof h === 'number' && typeof a === 'number') {
    return ((h + a) / 2).toFixed(1);
  }
  return (typeof h === 'number' ? h : a).toFixed(1);
}

// Rest days — clean human-readable version. Returns "5 days rest",
// "1 day rest" (singular), or "Season start" when the gap is so large
// (>30 days) it almost certainly means the season hasn't begun yet
// rather than the team genuinely resting that long. Em-dash for missing.
export function restDaysDisplay(fixture) {
  const h = fixture?.home?.restDays;
  const a = fixture?.away?.restDays;
  if (typeof h !== 'number' && typeof a !== 'number') return '—';
  const v = Math.min(
    typeof h === 'number' ? h : Infinity,
    typeof a === 'number' ? a : Infinity,
  );
  if (!Number.isFinite(v)) return '—';
  if (v > 30) return 'Season start';
  if (v === 1) return '1 day rest';
  return `${v} days rest`;
}

// h2h goals/match. Backend stores a pre-formatted display string in
// fixture.h2h ("3.2 G/M") populated by the weekly scan from the last-5
// H2H meetings. We strip the cryptic "G/M" suffix here so the stats
// grid can render a clean "2.5 goals per game" string.
export function h2hDisplay(fixture) {
  let raw = null;
  if (typeof fixture?.h2h === 'string' && fixture.h2h.trim()) raw = fixture.h2h;
  else if (typeof fixture?.h2h?.goalsPerMatch === 'number') raw = fixture.h2h.goalsPerMatch;
  if (raw == null) return '—';
  // Coerce to a number whether we got "3.2 G/M", "3.2", or 3.2.
  const m = String(raw).match(/-?\d+(?:\.\d+)?/);
  if (!m) return '—';
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)} goals per game`;
}

// Combined "AI analysis" paragraph for the expandable section.
export function analysisText(fixture) {
  const o = fixture?.predictions?.over?.reasoning;
  const b = fixture?.predictions?.btts?.reasoning;
  if (o && b) return `${o}\n\n${b}`;
  return o || b || 'No analysis available for this match yet.';
}

// Referee display split into name + per-ref goals/game so the stats
// grid can render them in separate visual slots. Use refereeName() for
// the value line and refereeGoalsPerGame() for the explanation.
//
// "Not announced" is the fallback (NOT "Unknown") — API-Football
// only publishes referee appointments ~24–48 hours before kickoff, so a
// missing ref isn't a data quality issue, it's normal for fixtures more
// than two days out. The 30-min agent-scanner pass refetches the
// fixture to fill the name in once it's announced.
export function refereeName(fixture) {
  const n = fixture?.referee?.name || fixture?.fixture?.referee?.name;
  return n && String(n).trim() ? n : 'Not announced';
}

export function refereeGoalsPerGame(fixture) {
  const avg = fixture?.referee?.avgGoalsPerGame;
  return typeof avg === 'number' ? avg : null;
}

// Legacy combined display kept for the (now-removed) dense stats row
// and for any unit tests / call sites that still want a one-liner.
export function refereeDisplay(fixture) {
  const name = refereeName(fixture);
  if (name === 'Unknown') return '—';
  const avg = refereeGoalsPerGame(fixture);
  return avg != null ? `${name} · avg ${avg.toFixed(1)} G/G` : name;
}
