import { useMemo } from 'react';
import { evPercent, impliedProb, kellyFraction, valueTier } from '../lib/ev.js';
import ConfBar from './ConfBar.jsx';
import LockedOverlay from './LockedOverlay.jsx';

// One prediction (e.g. OVER 2.5) — badge + confidence bar +
// odds input + computed EV/Kelly + tier pill.
// For FREE users, the odds/EV row is locked behind an overlay.
export default function PredictionRow({
  label,
  conf,
  isSharp,
  odds,
  onOdds,
  onUpgrade,
  delay = 0,
}) {
  const confFrac = (conf || 0) / 100;

  const ev = useMemo(() => {
    const o = parseFloat(odds);
    if (!o || o <= 1) return null;
    return {
      ev: evPercent(confFrac, o),
      kelly: kellyFraction(confFrac, o) * 100,
      implied: impliedProb(o) * 100,
    };
  }, [odds, confFrac]);

  const tier = ev ? valueTier(ev.ev) : null;

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
        <span className="badge badge-mint">
          {label} · <span className="mono">{conf || 0}%</span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          AI conf
        </span>
      </div>
      <ConfBar pct={conf || 0} color="mint" delay={delay} />

      <div
        style={{
          marginTop: 10,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          position: 'relative',
        }}
      >
        <input
          className="input"
          placeholder={`Enter ${label} odds`}
          value={odds || ''}
          onChange={(e) =>
            onOdds && onOdds(e.target.value.replace(/[^0-9.]/g, ''))
          }
          disabled={!isSharp}
          style={{ fontSize: 12, opacity: isSharp ? 1 : 0.6 }}
        />
        <div
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--border-soft)',
            borderRadius: 8,
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 36,
            position: 'relative',
          }}
        >
          {ev && isSharp ? (
            <div
              className="fade-in"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: ev.ev >= 0 ? 'var(--mint)' : 'var(--red)',
                }}
              >
                {ev.ev >= 0 ? '+' : ''}
                {ev.ev.toFixed(1)}%
              </span>
              <span
                className="mono"
                style={{ fontSize: 10, color: 'var(--text-3)' }}
              >
                · K {ev.kelly.toFixed(1)}%
              </span>
            </div>
          ) : (
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--text-3)' }}
            >
              {isSharp ? 'EV WAITING' : 'EV · KELLY %'}
            </span>
          )}
        </div>

        {!isSharp && (
          <LockedOverlay onClick={onUpgrade} label="SHARP — $9.99/mo" />
        )}
      </div>

      {ev && isSharp && tier && (
        <div
          className="fade-in"
          style={{
            marginTop: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background:
              tier.color === 'mint'
                ? 'rgba(110,231,183,0.08)'
                : tier.color === 'indigo'
                ? 'rgba(129,140,248,0.08)'
                : 'rgba(239,68,68,0.08)',
            border:
              '1px solid ' +
              (tier.color === 'mint'
                ? 'rgba(110,231,183,0.25)'
                : tier.color === 'indigo'
                ? 'rgba(129,140,248,0.25)'
                : 'rgba(239,68,68,0.25)'),
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: tier.glow ? '0 0 20px rgba(110,231,183,0.2)' : 'none',
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: '0.06em',
              color:
                tier.color === 'mint'
                  ? 'var(--mint)'
                  : tier.color === 'indigo'
                  ? 'var(--indigo)'
                  : 'var(--red)',
            }}
          >
            {tier.label}
          </span>
          <span
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-2)' }}
          >
            Implied {ev.implied.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
