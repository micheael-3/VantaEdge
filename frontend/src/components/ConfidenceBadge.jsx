// Prediction chip: "OVER 2.5 · 74%" with optional hit/miss tick for past matches.
export default function ConfidenceBadge({ label, confidence, result }) {
  const isHit = result === true;
  const isMiss = result === false;
  return (
    <div className={`conf-badge ${isMiss ? 'miss' : ''}`}>
      <span className="conf-label">{label}</span>
      <span className="conf-pct">{confidence != null ? `${confidence}%` : '—'}</span>
      {(isHit || isMiss) && (
        <span className={`conf-result ${isHit ? 'hit' : 'miss'}`}>
          {isHit ? '✓' : '✗'}
        </span>
      )}
    </div>
  );
}
