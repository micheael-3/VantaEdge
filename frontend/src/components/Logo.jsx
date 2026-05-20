// FastScore mint-chip logo + wordmark.
// Ported from the design's shared.jsx Logo component.
export default function Logo({ size = 'md' }) {
  const fontSize = size === 'lg' ? 24 : size === 'sm' ? 16 : 20;
  return (
    <div className="logo" style={{ fontSize }}>
      <span className="logo-mark" />
      <span>
        fast<span style={{ color: 'var(--mint)' }}>score</span>
      </span>
    </div>
  );
}
