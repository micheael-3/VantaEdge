import Icon from './Icon.jsx';
import {
  confidenceLabel,
  effectiveOverConf,
  formatKickoffShort,
} from '../lib/fixture.js';

// Glowing top-of-page "BEST BET TODAY" hero card.
// Mint-tinted border, radial gradient top-right, pulsing mint shadow.
//
// Restyled in the mobile UI polish:
//   - Dropped the cryptic "AI SCORE {n}" suffix (was a 0-100 composite,
//     not a probability — casual bettors read it as both).
//   - Headline is just team names; the prediction is rendered as a mint
//     pill underneath (e.g. "OVER 2.5").
//   - Confidence line reads "{conf}% confident · {label}" using the same
//     STRONG/GOOD/DECENT labels as MatchCard.
//   - Tapping the banner smooth-scrolls to the same fixture's card
//     below via the `data-fixture-id` anchor MatchCard now exposes.
export default function BestBetBanner({ fixture }) {
  if (!fixture) return null;
  const conf = effectiveOverConf(fixture);
  const label = confidenceLabel(conf);
  const overLine = fixture?.predictions?.over?.line ?? 2.5;
  const fixtureId = fixture.id || fixture.fixtureId;

  const onJumpToCard = () => {
    if (typeof document === 'undefined' || fixtureId == null) return;
    const el = document.querySelector(`[data-fixture-id="${fixtureId}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <button
      type="button"
      onClick={onJumpToCard}
      className="card glow-mint"
      style={{
        width: '100%',
        textAlign: 'left',
        padding: 20,
        marginBottom: 20,
        borderColor: 'rgba(110,231,183,0.35)',
        background:
          'linear-gradient(135deg, rgba(110,231,183,0.06), transparent 60%), var(--card)',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'block',
        font: 'inherit',
        color: 'inherit',
      }}
      aria-label={`Best bet: ${fixture.home?.name} vs ${fixture.away?.name}. Tap to view full card.`}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 300,
          height: 300,
          background:
            'radial-gradient(circle, rgba(110,231,183,0.08), transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          position: 'relative',
        }}
      >
        <Icon name="star" size={14} color="var(--mint)" />
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--mint)',
            letterSpacing: '0.08em',
          }}
        >
          BEST BET TODAY
        </span>
      </div>
      <div
        className="display"
        style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: 10,
          position: 'relative',
          lineHeight: 1.2,
          wordBreak: 'break-word',
        }}
      >
        {fixture.home?.name}{' '}
        <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>vs</span>{' '}
        {fixture.away?.name}
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '6px 12px',
          borderRadius: 999,
          background: 'rgba(110,231,183,0.12)',
          border: '1px solid rgba(110,231,183,0.35)',
          color: 'var(--mint)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.06em',
          marginBottom: 10,
          position: 'relative',
        }}
      >
        OVER {overLine}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-2)',
          position: 'relative',
        }}
      >
        <span className="mono" style={{ color: 'var(--mint)', fontWeight: 600 }}>
          {conf}%
        </span>{' '}
        confident
        {label && (
          <>
            {' · '}
            <span className="mono" style={{ color: 'var(--text)' }}>
              {label}
            </span>
          </>
        )}
      </div>
      <div
        className="mono"
        style={{
          marginTop: 6,
          fontSize: 11,
          color: 'var(--text-3)',
          letterSpacing: '0.04em',
          position: 'relative',
        }}
      >
        {formatKickoffShort(fixture.kickoff)}
      </div>
    </button>
  );
}
