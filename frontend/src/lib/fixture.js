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

export function overConf(fixture) {
  const v = fixture?.predictions?.over?.confidence;
  return typeof v === 'number' ? Math.round(v) : 0;
}

export function bttsConf(fixture) {
  const v = fixture?.predictions?.btts?.confidence;
  return typeof v === 'number' ? Math.round(v) : 0;
}

export function bttsLabel(fixture) {
  const p = (fixture?.predictions?.btts?.prediction || 'YES').toUpperCase();
  return `BTTS ${p}`;
}

export function isStrongValue(fixture) {
  return Math.max(overConf(fixture), bttsConf(fixture)) >= 70;
}

export function agentScore(fixture) {
  return Math.max(overConf(fixture), bttsConf(fixture));
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

export function restDaysDisplay(fixture) {
  const h = fixture?.home?.restDays;
  const a = fixture?.away?.restDays;
  if (typeof h !== 'number' && typeof a !== 'number') return '—';
  const v = Math.min(
    typeof h === 'number' ? h : Infinity,
    typeof a === 'number' ? a : Infinity,
  );
  return Number.isFinite(v) ? `${v}d` : '—';
}

// h2h goals/match — we don't currently surface this in the backend payload.
export function h2hDisplay(fixture) {
  const v = fixture?.h2h?.goalsPerMatch;
  return typeof v === 'number' ? `${v.toFixed(1)} G/M` : '—';
}

// Combined "AI analysis" paragraph for the expandable section.
export function analysisText(fixture) {
  const o = fixture?.predictions?.over?.reasoning;
  const b = fixture?.predictions?.btts?.reasoning;
  if (o && b) return `${o}\n\n${b}`;
  return o || b || 'No analysis available for this match yet.';
}
