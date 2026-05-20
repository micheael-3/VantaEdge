// Loading skeleton for MatchCard. Uses the .shimmer animation defined
// in index.css. Ported from the design's match-card.jsx.
export default function MatchCardSkeleton() {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div
        className="shimmer"
        style={{ height: 10, width: 90, borderRadius: 4, marginBottom: 16 }}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: 12,
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <div>
          <div
            className="shimmer"
            style={{
              height: 18,
              width: '70%',
              borderRadius: 4,
              marginBottom: 10,
            }}
          />
          <div
            className="shimmer"
            style={{ height: 18, width: 110, borderRadius: 4 }}
          />
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          VS
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            className="shimmer"
            style={{
              height: 18,
              width: '70%',
              borderRadius: 4,
              marginBottom: 10,
              marginLeft: 'auto',
            }}
          />
          <div
            className="shimmer"
            style={{
              height: 18,
              width: 110,
              borderRadius: 4,
              marginLeft: 'auto',
            }}
          />
        </div>
      </div>
      <div className="shimmer" style={{ height: 36, borderRadius: 8, marginBottom: 10 }} />
      <div className="shimmer" style={{ height: 36, borderRadius: 8, marginBottom: 10 }} />
      <div className="shimmer" style={{ height: 20, width: 120, borderRadius: 4 }} />
    </div>
  );
}
