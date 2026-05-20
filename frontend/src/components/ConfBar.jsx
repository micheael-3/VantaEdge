import { useEffect, useState } from 'react';

// Animated horizontal confidence bar. Fills from 0 to `pct` over 1.2s.
// Ported from design's shared.jsx ConfBar.
export default function ConfBar({ pct, color = 'mint', delay = 0 }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(pct), 80 + delay);
    return () => clearTimeout(t);
  }, [pct, delay]);
  const bg =
    color === 'mint'
      ? 'linear-gradient(90deg, #34d399, #6ee7b7)'
      : color === 'indigo'
      ? 'linear-gradient(90deg, #6366f1, #818cf8)'
      : 'linear-gradient(90deg, #f87171, #ef4444)';
  return (
    <div className="conf-bar">
      <div className="conf-bar-fill" style={{ width: `${w}%`, background: bg }} />
    </div>
  );
}
