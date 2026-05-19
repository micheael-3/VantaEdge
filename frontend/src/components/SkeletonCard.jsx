export default function SkeletonCard() {
  return (
    <div className="card match-card">
      <div className="skeleton" style={{ height: 18, width: '60%' }} />
      <div className="skeleton" style={{ height: 38 }} />
      <div className="skeleton" style={{ height: 14, width: '40%' }} />
      <div className="skeleton" style={{ height: 60 }} />
      <div className="skeleton" style={{ height: 14, width: '70%' }} />
    </div>
  );
}
