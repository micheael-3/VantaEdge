import { useState } from 'react';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { evPercent, impliedProb, kellyFraction } from '../lib/ev.js';

function MiniStat({ label, value, color }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: '0.1em',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color:
            color === 'mint'
              ? 'var(--mint)'
              : color === 'red'
              ? 'var(--red)'
              : 'var(--text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function KellySizer() {
  const { user } = useAuth();
  const sharp = isSharp(user);
  const [conf, setConf] = useState(72);
  const [odds, setOdds] = useState('2.00');
  const [bankroll, setBankroll] = useState(1000);
  const [fraction, setFraction] = useState(0.5);

  const o = parseFloat(odds);
  const c = conf / 100;
  const fullKelly = o > 1 ? kellyFraction(c, o) * 100 : 0;
  const adjKelly = fullKelly * fraction;
  const stake = (adjKelly / 100) * bankroll;
  const edge = o > 1 ? evPercent(c, o) : 0;

  return (
    <Layout>
      {({ openUpgrade }) => (
        <div style={{ position: 'relative', maxWidth: 980 }}>
          <div style={{ marginBottom: 28 }}>
            <h1
              className="display"
              style={{
                fontSize: 36,
                fontWeight: 700,
                margin: 0,
                letterSpacing: '-0.025em',
              }}
            >
              Kelly Sizer
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--text-2)', fontSize: 15 }}>
              Maximise long-run growth without going broke. Half-Kelly is
              recommended for most bettors.
            </p>
          </div>

          <div style={{ position: 'relative' }}>
            <div
              className="ev-grid"
              style={{
                filter: sharp ? 'none' : 'blur(7px)',
                pointerEvents: sharp ? 'auto' : 'none',
                display: 'grid',
                gridTemplateColumns: '1fr 1.2fr',
                gap: 16,
              }}
            >
              <div className="card" style={{ padding: 28 }}>
                <h3
                  className="display"
                  style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 600 }}
                >
                  Bet inputs
                </h3>

                <div style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 10,
                    }}
                  >
                    <label
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--text-2)',
                        letterSpacing: '0.08em',
                      }}
                    >
                      AI CONFIDENCE
                    </label>
                    <span
                      className="display"
                      style={{ fontSize: 22, fontWeight: 700, color: 'var(--mint)' }}
                    >
                      {conf}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={95}
                    step={0.5}
                    value={conf}
                    onChange={(e) => setConf(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: '#6ee7b7' }}
                  />
                </div>

                <div style={{ marginBottom: 24 }}>
                  <label
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-2)',
                      letterSpacing: '0.08em',
                      display: 'block',
                      marginBottom: 10,
                    }}
                  >
                    ODDS
                  </label>
                  <input
                    className="input"
                    value={odds}
                    onChange={(e) =>
                      setOdds(e.target.value.replace(/[^0-9.]/g, ''))
                    }
                    style={{
                      fontSize: 16,
                      textAlign: 'center',
                      fontWeight: 600,
                    }}
                  />
                </div>

                <div style={{ marginBottom: 24 }}>
                  <label
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-2)',
                      letterSpacing: '0.08em',
                      display: 'block',
                      marginBottom: 10,
                    }}
                  >
                    BANKROLL ($)
                  </label>
                  <input
                    className="input"
                    type="number"
                    value={bankroll}
                    onChange={(e) =>
                      setBankroll(parseFloat(e.target.value) || 0)
                    }
                    style={{
                      fontSize: 16,
                      textAlign: 'center',
                      fontWeight: 600,
                    }}
                  />
                </div>

                <div>
                  <label
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-2)',
                      letterSpacing: '0.08em',
                      display: 'block',
                      marginBottom: 10,
                    }}
                  >
                    KELLY FRACTION
                  </label>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 6,
                    }}
                  >
                    {[
                      { l: 'Quarter', v: 0.25 },
                      { l: 'Half', v: 0.5 },
                      { l: '3/4', v: 0.75 },
                      { l: 'Full', v: 1 },
                    ].map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setFraction(opt.v)}
                        style={{
                          padding: '10px 6px',
                          border:
                            '1px solid ' +
                            (fraction === opt.v
                              ? 'rgba(110,231,183,0.4)'
                              : 'var(--border)'),
                          background:
                            fraction === opt.v
                              ? 'rgba(110,231,183,0.08)'
                              : 'transparent',
                          color:
                            fraction === opt.v
                              ? 'var(--mint)'
                              : 'var(--text-2)',
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        {opt.l}
                      </button>
                    ))}
                  </div>
                  <p
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-faint)',
                      marginTop: 10,
                    }}
                  >
                    Half-Kelly gives most of the growth, half the variance.
                  </p>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                <div
                  className="card glow-mint"
                  style={{
                    padding: 32,
                    borderColor: 'rgba(110,231,183,0.35)',
                    background:
                      'linear-gradient(180deg, rgba(110,231,183,0.06), transparent), var(--card)',
                    textAlign: 'center',
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      letterSpacing: '0.1em',
                      marginBottom: 12,
                    }}
                  >
                    RECOMMENDED STAKE
                  </div>
                  <div
                    className="display"
                    style={{
                      fontSize: 72,
                      fontWeight: 700,
                      letterSpacing: '-0.03em',
                      color: 'var(--mint)',
                      lineHeight: 1,
                    }}
                  >
                    ${stake.toFixed(2)}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 12,
                      color: 'var(--text-2)',
                      marginTop: 12,
                    }}
                  >
                    {adjKelly.toFixed(2)}% of $
                    {Number(bankroll).toLocaleString()} ·{' '}
                    {fraction === 1
                      ? 'Full'
                      : fraction === 0.5
                      ? 'Half'
                      : fraction === 0.25
                      ? 'Quarter'
                      : '3/4'}{' '}
                    Kelly
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 12,
                  }}
                >
                  <MiniStat
                    label="EDGE"
                    value={`${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%`}
                    color={edge >= 0 ? 'mint' : 'red'}
                  />
                  <MiniStat label="FULL KELLY" value={`${fullKelly.toFixed(2)}%`} />
                  <MiniStat
                    label="IMPLIED"
                    value={`${(o > 1 ? impliedProb(o) * 100 : 0).toFixed(1)}%`}
                  />
                </div>
              </div>
            </div>

            {!sharp && (
              <div
                className="locked-overlay"
                onClick={openUpgrade}
                style={{ borderRadius: 12 }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div
                    className="display"
                    style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}
                  >
                    Kelly Sizer is SHARP-only
                  </div>
                  <button type="button" className="btn btn-primary">
                    Get SHARP <Icon name="arrow-right" size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
