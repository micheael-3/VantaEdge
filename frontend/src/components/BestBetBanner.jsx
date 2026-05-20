import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import LockedOverlay from './LockedOverlay.jsx';
import {
  evPercent,
  impliedProb,
  kellyFraction,
} from '../lib/ev.js';
import {
  agentScore,
  formatKickoffShort,
  overConf,
} from '../lib/fixture.js';

// Glowing top-of-page "BEST BET TODAY" hero card.
// Mint-tinted border, radial gradient top-right, pulsing mint shadow.
// Right column has odds input + EV/Kelly readout — blurred for FREE.
export default function BestBetBanner({ fixture, isSharp, onUpgrade }) {
  const [odds, setOdds] = useState('1.78');
  if (!fixture) return null;
  const o = parseFloat(odds);
  const conf = overConf(fixture) / 100;
  const ev = o > 1 ? evPercent(conf, o) : 0;
  const kelly = o > 1 ? kellyFraction(conf, o) * 100 : 0;
  const score = useMemo(() => agentScore(fixture), [fixture]);
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
        className="best-bet-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 24,
          alignItems: 'center',
          position: 'relative',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
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
                {overConf(fixture)}%
              </span>
            </span>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span className="mono">{formatKickoffShort(fixture.kickoff)}</span>
          </div>
        </div>
        <div style={{ minWidth: 280 }}>
          <div style={{ position: 'relative' }}>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--text-3)',
                  letterSpacing: '0.06em',
                  flex: 1,
                }}
              >
                YOUR BOOK ODDS
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--text-3)',
                  letterSpacing: '0.06em',
                }}
              >
                EV · KELLY
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                filter: isSharp ? 'none' : 'blur(6px)',
                pointerEvents: isSharp ? 'auto' : 'none',
              }}
            >
              <input
                className="input"
                value={odds}
                onChange={(e) =>
                  setOdds(e.target.value.replace(/[^0-9.]/g, ''))
                }
                style={{ fontSize: 14 }}
              />
              <div
                style={{
                  background: 'rgba(110,231,183,0.1)',
                  border: '1px solid rgba(110,231,183,0.3)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: ev >= 0 ? 'var(--mint)' : 'var(--red)',
                  }}
                >
                  {ev >= 0 ? '+' : ''}
                  {ev.toFixed(1)}%
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--text-2)' }}
                >
                  K {kelly.toFixed(1)}%
                </span>
              </div>
            </div>
            {!isSharp && (
              <LockedOverlay onClick={onUpgrade} label="Unlock with SHARP" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
