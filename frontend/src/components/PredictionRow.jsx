import ConfBar from './ConfBar.jsx';

// One prediction (e.g. OVER 2.5) — badge + confidence bar.
// The badge shows the already-calibrated confidence transparently. No
// odds input, no EV chip, no Kelly stake, no value-tier pill. The
// casual bettor just sees the AI's confidence and moves on.
//
// When `pending` is true, renders a shimmering skeleton row instead so
// the card can sit there waiting for /api/predictions/analyze to resolve.
export default function PredictionRow({
  label,
  conf,
  delay = 0,
  pending = false,
}) {
  if (pending) {
    return (
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span
            className="shimmer"
            style={{ height: 22, width: 130, borderRadius: 4 }}
          />
          <span
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-3)' }}
          >
            Confidence
          </span>
        </div>
        <div
          className="shimmer"
          style={{ height: 8, borderRadius: 4, marginBottom: 4 }}
        />
      </div>
    );
  }

  const pct = conf || 0;
  // Friendly aria/tooltip — explains what the percentage means without
  // any betting-math jargon.
  const a11y = `The AI predicts ${label} with ${pct}% confidence based on form, head-to-head, and the referee's history.`;

  return (
    <div title={a11y} aria-label={a11y}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span className="badge badge-mint">
          {label} · <span className="mono">{pct}%</span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Confidence
        </span>
      </div>
      <ConfBar pct={pct} color="mint" delay={delay} />
    </div>
  );
}
