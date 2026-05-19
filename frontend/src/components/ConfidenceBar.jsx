export default function ConfidenceBar({ value }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  let color = 'red';
  if (pct >= 70) color = 'green';
  else if (pct >= 50) color = 'yellow';
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="spread mono small">
        <span className="muted">Confidence</span>
        <span>{pct}%</span>
      </div>
      <div className="confidence-bar">
        <div className={`confidence-bar-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
