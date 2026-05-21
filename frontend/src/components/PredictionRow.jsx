import { useMemo } from 'react';
import { evPercent, impliedProb, kellyFraction, valueTier } from '../lib/ev.js';
import ConfBar from './ConfBar.jsx';
import LockedOverlay from './LockedOverlay.jsx';

// One prediction (e.g. OVER 2.5) — badge + confidence bar +
// odds input + computed EV/Kelly + tier pill.
// For FREE users, the odds/EV row is locked behind an overlay.
// When `pending` is true, renders a shimmering skeleton row instead so the
// card can sit there waiting for /api/predictions/analyze to resolve.
//
// EV / Kelly math intentionally uses `conf` (the EFFECTIVE/calibrated
// confidence passed by MatchCard). The bettor cares about the calibrated
// probability — if the model says 80% but historically those hit 60%,
// the +EV that matters is the 60%-based one. The raw badge above shows
// what the model originally claimed for transparency.
export default function PredictionRow({
  label,
  conf,
  rawConf,
  calibratedConf,
  isSharp,
  odds,
  onOdds,
  onUpgrade,
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
            AI conf
          </span>
        </div>
        <div
          className="shimmer"
          style={{ height: 8, borderRadius: 4, marginBottom: 10 }}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
          }}
        >
          <div
            className="shimmer"
            style={{ height: 36, borderRadius: 8 }}
          />
          <div
            className="shimmer"
            style={{ height: 36, borderRadius: 8 }}
          />
        </div>
      </div>
    );
  }

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

  // Show the small calibrated chip only when the model is materially mis-
  // calibrated (gap >= 3 points). Differences smaller than that aren't worth
  // the visual noise.
  const displayRaw = rawConf != null ? rawConf : conf || 0;
  const showCalibrated =
    calibratedConf != null &&
    calibratedConf !== rawConf &&
    Math.abs(calibratedConf - displayRaw) >= 3;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="badge badge-mint">
            {label} · <span className="mono">{displayRaw}%</span>
          </span>
          {showCalibrated && (
            <span
              className="mono"
              title="Adjusted based on the model's actual hit rate at this confidence level."
              style={{
                fontSize: 10,
                color: 'var(--text-3)',
                background: 'var(--bg-2)',
                border: '1px solid var(--border-soft)',
                borderRadius: 4,
                padding: '2px 6px',
                letterSpacing: '0.04em',
              }}
            >
              CALIBRATED {calibratedConf}%
            </span>
          )}
        </div>
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
