import { useState } from 'react';
import Layout from '../components/Layout.jsx';
import LockedOverlay from '../components/LockedOverlay.jsx';
import Icon from '../components/Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { evPercent, impliedProb, kellyFraction, valueTier } from '../lib/ev.js';

// Standalone EV calculator. Sliders + input → big edge tile + Kelly + return.
// For FREE users the whole interactive block is blurred and an overlay
// nudges them to upgrade.
export default function EVCalculator() {
  const { user } = useAuth();
  const sharp = isSharp(user);
  const [conf, setConf] = useState(74);
  const [odds, setOdds] = useState('1.85');
  const [bankroll, setBankroll] = useState(1000);
  const [unit, setUnit] = useState('$');

  const o = parseFloat(odds);
  const c = conf / 100;
  const implied = o > 1 ? impliedProb(o) * 100 : 0;
  const edge = o > 1 ? evPercent(c, o) : 0;
  const kelly = o > 1 ? kellyFraction(c, o) * 100 : 0;
  const tier = valueTier(edge);
  const stake = (kelly / 100) * bankroll;

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
              Expected Value Calculator
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--text-2)', fontSize: 15 }}>
              Find out if a bet has mathematical edge before you place it.
            </p>
          </div>

          <div style={{ position: 'relative' }}>
            <div
              className="ev-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
                filter: sharp ? 'none' : 'blur(7px)',
                pointerEvents: sharp ? 'auto' : 'none',
              }}
            >
              <div className="card" style={{ padding: 28 }}>
                <h3
                  className="display"
                  style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 600 }}
                >
                  Inputs
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
                      style={{
                        fontSize: 28,
                        fontWeight: 700,
                        color: 'var(--mint)',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {conf}
                      <span style={{ fontSize: 14, color: 'var(--text-3)' }}>%</span>
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
                    BOOKMAKER ODDS (DECIMAL)
                  </label>
                  <input
                    className="input"
                    value={odds}
                    onChange={(e) =>
                      setOdds(e.target.value.replace(/[^0-9.]/g, ''))
                    }
                    style={{
                      fontSize: 22,
                      padding: '14px 16px',
                      textAlign: 'center',
                      fontWeight: 600,
                    }}
                  />
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-faint)',
                      marginTop: 8,
                      textAlign: 'center',
                    }}
                  >
                    Implied probability:{' '}
                    <span style={{ color: 'var(--text-2)' }}>
                      {implied.toFixed(1)}%
                    </span>
                  </div>
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
                    BANKROLL
                  </label>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      gap: 8,
                    }}
                  >
                    <select
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      className="input"
                      style={{ width: 70, textAlign: 'center', fontWeight: 600 }}
                    >
                      <option value="$">$</option>
                      <option value="£">£</option>
                      <option value="€">€</option>
                    </select>
                    <input
                      className="input"
                      value={bankroll}
                      type="number"
                      onChange={(e) =>
                        setBankroll(parseFloat(e.target.value) || 0)
                      }
                      style={{ fontSize: 14 }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                <div
                  className="card"
                  style={{
                    padding: 28,
                    borderColor:
                      tier.color === 'mint'
                        ? 'rgba(110,231,183,0.4)'
                        : tier.color === 'indigo'
                        ? 'rgba(129,140,248,0.3)'
                        : 'rgba(239,68,68,0.3)',
                    background:
                      tier.color === 'mint'
                        ? 'linear-gradient(180deg, rgba(110,231,183,0.06), transparent), var(--card)'
                        : 'var(--card)',
                    boxShadow: tier.glow
                      ? '0 0 40px rgba(110,231,183,0.15)'
                      : 'none',
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      letterSpacing: '0.1em',
                      marginBottom: 10,
                    }}
                  >
                    YOUR EDGE
                  </div>
                  <div
                    className="display"
                    style={{
                      fontSize: 56,
                      fontWeight: 700,
                      letterSpacing: '-0.03em',
                      lineHeight: 1,
                      color: edge >= 0 ? 'var(--mint)' : 'var(--red)',
                    }}
                  >
                    {edge >= 0 ? '+' : ''}
                    {edge.toFixed(1)}%
                  </div>
                  <div
                    style={{
                      marginTop: 16,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span
                      className={`badge badge-${
                        tier.color === 'red' ? 'red' : tier.color
                      }`}
                    >
                      {tier.label}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--text-3)' }}
                    >
                      CONF {conf}% × ODDS {odds || '—'}
                    </span>
                  </div>
                </div>

                <div className="card" style={{ padding: 24 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 20,
                    }}
                  >
                    <div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: 'var(--text-3)',
                          letterSpacing: '0.1em',
                          marginBottom: 8,
                        }}
                      >
                        KELLY STAKE
                      </div>
                      <div
                        className="display"
                        style={{
                          fontSize: 28,
                          fontWeight: 700,
                          letterSpacing: '-0.02em',
                        }}
                      >
                        {kelly.toFixed(1)}%
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: 'var(--text-faint)',
                          marginTop: 6,
                        }}
                      >
                        OF BANKROLL
                      </div>
                    </div>
                    <div
                      style={{
                        borderLeft: '1px solid var(--border-soft)',
                        paddingLeft: 20,
                      }}
                    >
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: 'var(--text-3)',
                          letterSpacing: '0.1em',
                          marginBottom: 8,
                        }}
                      >
                        RECOMMENDED
                      </div>
                      <div
                        className="display"
                        style={{
                          fontSize: 28,
                          fontWeight: 700,
                          letterSpacing: '-0.02em',
                          color: 'var(--mint)',
                        }}
                      >
                        {unit}
                        {stake.toFixed(2)}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: 'var(--text-faint)',
                          marginTop: 6,
                        }}
                      >
                        AT {unit}{Number(bankroll).toLocaleString()} BANKROLL
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ padding: 20 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      letterSpacing: '0.1em',
                      marginBottom: 10,
                    }}
                  >
                    POTENTIAL RETURN
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 16,
                    }}
                  >
                    <div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--text-faint)',
                          marginBottom: 4,
                        }}
                      >
                        IF WIN
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          color: 'var(--mint)',
                        }}
                      >
                        +{unit}
                        {(stake * (o - 1) || 0).toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--text-faint)',
                          marginBottom: 4,
                        }}
                      >
                        IF LOSS
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          color: 'var(--red)',
                        }}
                      >
                        −{unit}
                        {stake.toFixed(2)}
                      </div>
                    </div>
                  </div>
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
                    EV Calculator is SHARP-only
                  </div>
                  <p
                    style={{
                      margin: '0 0 16px',
                      color: 'var(--text-2)',
                      fontSize: 14,
                    }}
                  >
                    Unlock for $9.99/mo. Pays for itself in one bet.
                  </p>
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
