export default function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading-wrap">
      <div className="spinner" />
      <div style={{ marginTop: 12 }}>{label}</div>
    </div>
  );
}
