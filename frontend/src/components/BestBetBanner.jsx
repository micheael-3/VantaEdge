import { useMemo } from 'react';
import Icon from './Icon.jsx';
import {
  agentScore,
  effectiveOverConf,
  formatKickoffShort,
} from '../lib/fixture.js';

// Glowing top-of-page "BEST BET TODAY" hero card.
// Mint-tinted border, radial gradient top-right, pulsing mint shadow.
// Right column showed odds/EV/Kelly — stripped for the casual rebuild.
export default function BestBetBanner({ fixture }) {
  const score = useMemo(() => (fixture ? agentScore(fixture) : 0), [fixture]);
  if (!fixture) return null;
  const conf = effectiveOverConf(fixture);
  return (
    <div
      className="card glow-mint"
      style={{
        padding: 24,
        marginBottom: 32,
        borderColor: 'rgba(110,231,183,0.35)',
        background:
          'linear-gradient(135deg, rgba(110,231,183,0.06), transparent 60%), var(--card)',
        position: 'relative',
        overflow: 'hidden',
      }}
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
          gap: 10,
          marginBottom: 10,
          position: 'relative',
        }}
      >
        <Icon name="star" size={16} color="var(--mint)" />
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--mint)',
            letterSpacing: '0.08em',
          }}
        >
          BEST BET TODAY · AI SCORE {score}
        </span>
      </div>
      <div
        className="display"
        style={{
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: 6,
          position: 'relative',
        }}
      >
        {fixture.home?.name}{' '}
        <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>vs</span>{' '}
        {fixture.away?.name}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 13,
          color: 'var(--text-2)',
          flexWrap: 'wrap',
          position: 'relative',
        }}
      >
        <span>
          <span
            className="mono"
            style={{ color: 'var(--text)', fontWeight: 500 }}
          >
            OVER {fixture?.predictions?.over?.line ?? 2.5}
          </span>{' '}
          @ Confidence{' '}
          <span className="mono" style={{ color: 'var(--mint)' }}>
            {conf}%
          </span>
        </span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span className="mono">{formatKickoffShort(fixture.kickoff)}</span>
      </div>
    </div>
  );
}
