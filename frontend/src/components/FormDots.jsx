import { useEffect, useState } from 'react';

// W/D/L letter chips with staggered fade-in (80ms per dot). Always
// renders exactly 5 dots so the layout never jitters between cards —
// any missing slots are padded with a muted "?" placeholder dot.
//
// Accepts `form` either as an array (['W','W','D']) — our backend shape —
// or as a string ('WWD') — the design's shape. Either way we normalise.
export default function FormDots({ form, delay = 0 }) {
  const raw = Array.isArray(form)
    ? form.map((c) => (c || '').toString().toUpperCase().slice(0, 1))
    : (form || '').toString().toUpperCase().split('').slice(0, 5);
  // Pad to 5 with empty markers so the row is always the same width.
  const chars = [...raw];
  while (chars.length < 5) chars.push('?');

  const [visible, setVisible] = useState(0);
  useEffect(() => {
    setVisible(0);
    const timers = [];
    chars.forEach((_, i) => {
      timers.push(
        setTimeout(() => setVisible((v) => v + 1), delay + i * 80),
      );
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars.join(''), delay]);

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {chars.map((c, i) => {
        const known = ['W', 'D', 'L'].includes(c);
        const cls = known ? c : 'empty';
        return (
          <span
            key={i}
            className={`form-dot ${cls}`}
            style={{
              opacity: i < visible ? 1 : 0,
              transform:
                i < visible
                  ? 'translateY(0) scale(1)'
                  : 'translateY(4px) scale(0.7)',
              transition:
                'opacity 0.25s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {known ? c : '?'}
          </span>
        );
      })}
    </div>
  );
}
