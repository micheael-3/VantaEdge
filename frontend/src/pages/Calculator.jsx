import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { openWhopCheckout } from '../lib/checkout.js';
import {
  computeSingle,
  computeParlay,
  computeParlayFromAverage,
} from '../lib/stakeCalculator.js';

// Stake Calculator — Kelly + bankroll math, live as the user types.
// All math is in src/lib/stakeCalculator.js so this page is purely
// presentational. No API calls, no DB writes, works offline.
//
// Deep link from the dashboard: /calculator?odds=2.10 pre-fills the
// single-bet odds input. We default to SINGLE so the link lands on a
// useful screen.

function RiskBadge({ level }) {
  const color =
    level === 'HIGH' ? 'var(--red)' : level === 'MEDIUM' ? 'var(--amber)' : 'var(--mint)';
  const bg =
    level === 'HIGH'
      ? 'rgba(239,68,68,0.12)'
      : level === 'MEDIUM'
        ? 'rgba(251,191,36,0.15)'
        : 'rgba(110,231,183,0.15)';
  const border =
    level === 'HIGH'
      ? 'rgba(239,68,68,0.4)'
      : level === 'MEDIUM'
        ? 'rgba(251,191,36,0.35)'
        : 'rgba(110,231,183,0.35)';
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        background: bg,
        border: `1px solid ${border}`,
        color,
      }}
    >
      {level}
    </span>
  );
}

function ResultRow({ label, value, valueColor }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 0',
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.04em' }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: valueColor || 'var(--text)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Locked state shown to FREE users. Lives at module scope so the
// authed Calculator component doesn't keep its useState hooks loaded
// when the user can't see the page. Wraps in <Layout> so it inherits
// the same top bar / sidebar / bottom nav as every other page.
function CalculatorLocked() {
  return (
    <Layout>
      {() => (
        <div style={{ maxWidth: 560 }}>
          <div
            className="card"
            style={{
              padding: 28,
              borderColor: 'rgba(110,231,183,0.3)',
              background:
                'linear-gradient(180deg, rgba(110,231,183,0.05), transparent), var(--card)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                margin: '0 auto 16px',
                borderRadius: 16,
                background: 'rgba(110,231,183,0.10)',
                border: '1px solid rgba(110,231,183,0.3)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mint)',
              }}
            >
              <Icon name="lock" size={28} color="var(--mint)" />
            </div>
            <h1
              className="display"
              style={{
                fontSize: 28,
                fontWeight: 700,
                margin: '0 0 8px',
                letterSpacing: '-0.02em',
              }}
            >
              Stake Calculator
            </h1>
            <p
              style={{
                margin: '0 0 22px',
                color: 'var(--text-2)',
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              Know exactly how much to bet on every pick.
            </p>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '0 0 22px',
                display: 'grid',
                gap: 8,
                textAlign: 'left',
              }}
            >
              {[
                'Kelly Criterion staking',
                'Single bet calculator',
                'Parlay calculator',
                'Risk assessment',
                'Instant results',
              ].map((f) => (
                <li
                  key={f}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 14,
                    color: 'var(--text-2)',
                  }}
                >
                  <Icon name="check" size={14} color="var(--mint)" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={openWhopCheckout}
              style={{ width: '100%' }}
            >
              Upgrade to PRO — $4.99/mo
            </button>
            <p
              className="mono"
              style={{
                margin: '12px 0 0',
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.04em',
              }}
            >
              CANCEL ANYTIME
            </p>
          </div>
        </div>
      )}
    </Layout>
  );
}

// Default export — auth + tier gate only. Forwards PRO users to the
// authed Calculator component below; FREE users see the locked screen.
// Split this way so the authed component's hooks don't get conditionally
// mounted (rules of hooks). When the user upgrades, the parent re-renders
// and the authed component mounts cleanly.
export default function Calculator() {
  const { user } = useAuth();
  if (!isSharp(user)) return <CalculatorLocked />;
  return <CalculatorAuthed />;
}

function CalculatorAuthed() {
  const [searchParams] = useSearchParams();
  const preFillOdds = (() => {
    const raw = searchParams.get('odds');
    if (!raw) return '';
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1.01 || n > 50) return '';
    return raw;
  })();

  const [betType, setBetType] = useState('single'); // 'single' | 'parlay'
  const [bankroll, setBankroll] = useState('500');
  const [odds, setOdds] = useState(preFillOdds || '1.85');
  // Optional confidence override (single-bet only). When `useConfidence`
  // is true the slider value (50-85) replaces the odds-derived
  // probability in the Kelly calc, so the user can size to their own
  // belief instead of the bookmaker's implied number.
  const [useConfidence, setUseConfidence] = useState(false);
  const [confidence, setConfidence] = useState('68');

  // If the URL ?odds= changes after mount (e.g. user navigates from
  // another card), update the input.
  useEffect(() => {
    if (preFillOdds) setOdds(preFillOdds);
  }, [preFillOdds]);

  // Parlay state — supports both "average odds × N" mode and "input
  // each leg individually" advanced mode.
  const [parlayMode, setParlayMode] = useState('average'); // 'average' | 'individual'
  const [numLegs, setNumLegs] = useState('2');
  const [avgOdds, setAvgOdds] = useState('1.85');
  const [legs, setLegs] = useState([
    { odds: '1.85', label: '' },
    { odds: '1.85', label: '' },
  ]);

  // Live result. We recompute on every keystroke — math is cheap and
  // it's the whole point of the page.
  const result = useMemo(() => {
    if (betType === 'single') {
      return computeSingle({
        bankroll: parseFloat(bankroll),
        odds: parseFloat(odds),
        confidenceOverride: useConfidence ? parseFloat(confidence) : undefined,
      });
    }
    if (parlayMode === 'individual') {
      return computeParlay({
        bankroll: parseFloat(bankroll),
        legs: legs.map((l) => ({ odds: parseFloat(l.odds), label: l.label })),
      });
    }
    return computeParlayFromAverage({
      bankroll: parseFloat(bankroll),
      avgOdds: parseFloat(avgOdds),
      numLegs: parseInt(numLegs, 10),
    });
  }, [betType, bankroll, odds, useConfidence, confidence, parlayMode, numLegs, avgOdds, legs]);

  // Sync legs array length to the selected leg count when the user
  // switches from average → individual mode.
  const ensureLegCount = (n) => {
    setLegs((prev) => {
      const target = Math.max(2, Math.min(8, Number(n) || 2));
      if (prev.length === target) return prev;
      if (prev.length > target) return prev.slice(0, target);
      const out = [...prev];
      while (out.length < target) out.push({ odds: '1.85', label: '' });
      return out;
    });
  };

  const onSwitchParlayMode = (mode) => {
    setParlayMode(mode);
    if (mode === 'individual') ensureLegCount(numLegs);
  };

  const onChangeNumLegs = (raw) => {
    setNumLegs(raw);
    if (parlayMode === 'individual') ensureLegCount(raw);
  };

  const onChangeLeg = (idx, field, value) => {
    setLegs((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  return (
    <Layout>
      {() => (
        <div style={{ maxWidth: 560 }}>
          <h1
            className="display dash-page-title"
            style={{
              fontSize: 36,
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-0.025em',
            }}
          >
            Stake Calculator
          </h1>
          <p
            className="dash-page-sub"
            style={{
              margin: '4px 0 24px',
              color: 'var(--text-2)',
              fontSize: 14,
            }}
          >
            Tell us your bankroll and odds. We'll tell you exactly how much to bet.
          </p>

          {/* Bet type toggle — two big tap buttons */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              marginBottom: 18,
            }}
          >
            {[
              { key: 'single', label: 'Single Bet' },
              { key: 'parlay', label: 'Parlay' },
            ].map((t) => {
              const active = betType === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setBetType(t.key)}
                  className="mono"
                  style={{
                    background: active ? 'var(--mint)' : 'transparent',
                    color: active ? '#001a10' : 'var(--text)',
                    border: `1px solid ${active ? 'var(--mint)' : 'var(--border)'}`,
                    borderRadius: 10,
                    padding: '14px 12px',
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    minHeight: 48,
                  }}
                  aria-pressed={active}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Bankroll input — shared between Single and Parlay */}
          <div style={{ marginBottom: 14 }}>
            <label
              className="mono"
              style={{
                display: 'block',
                fontSize: 10,
                letterSpacing: '0.1em',
                color: 'var(--text-3)',
                marginBottom: 6,
              }}
            >
              YOUR BANKROLL ($)
            </label>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              placeholder="e.g. 500"
              value={bankroll}
              onChange={(e) => setBankroll(e.target.value)}
              min="10"
              step="1"
            />
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
              Total money you have set aside for betting
            </div>
          </div>

          {/* Single-bet specific input */}
          {betType === 'single' && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label
                  className="mono"
                  style={{
                    display: 'block',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    color: 'var(--text-3)',
                    marginBottom: 6,
                  }}
                >
                  BOOKMAKER ODDS
                </label>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  placeholder="e.g. 1.85"
                  value={odds}
                  onChange={(e) => setOdds(e.target.value)}
                  min="1.01"
                  step="0.01"
                />
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
                  Decimal odds from your bookmaker
                </div>
              </div>

              {/* Optional confidence override. When enabled, the slider
                  value replaces the odds-derived probability in the
                  Kelly math. Lets the user size to their own belief
                  ("I'm 70% on this") instead of the bookmaker's
                  implied probability. */}
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    userSelect: 'none',
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useConfidence}
                    onChange={(e) => setUseConfidence(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--mint)' }}
                  />
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.04em',
                      color: useConfidence ? 'var(--mint)' : 'var(--text-2)',
                    }}
                  >
                    Use my own confidence
                  </span>
                </label>
                {useConfidence && (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <span
                        className="mono"
                        style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-3)' }}
                      >
                        CONFIDENCE
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 16, fontWeight: 700, color: 'var(--mint)' }}
                      >
                        {confidence}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="85"
                      step="1"
                      value={confidence}
                      onChange={(e) => setConfidence(e.target.value)}
                      style={{
                        width: '100%',
                        accentColor: 'var(--mint)',
                      }}
                    />
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
                      Your estimated win probability (50–85%). Used instead of the odds-derived number.
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Parlay-specific inputs */}
          {betType === 'parlay' && (
            <div
              className="card"
              style={{ padding: 14, marginBottom: 14, background: 'var(--bg-2)' }}
            >
              {/* Mode toggle */}
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  marginBottom: 14,
                  padding: 3,
                  background: 'var(--card-2)',
                  border: '1px solid var(--border-soft)',
                  borderRadius: 6,
                }}
              >
                {[
                  { key: 'average', label: 'Average odds' },
                  { key: 'individual', label: 'Per leg' },
                ].map((t) => {
                  const active = parlayMode === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => onSwitchParlayMode(t.key)}
                      className="mono"
                      style={{
                        flex: 1,
                        background: active ? 'var(--card)' : 'transparent',
                        color: active ? 'var(--text)' : 'var(--text-3)',
                        border: 'none',
                        fontSize: 11,
                        letterSpacing: '0.04em',
                        padding: '7px 8px',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <label
                className="mono"
                style={{
                  display: 'block',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: 'var(--text-3)',
                  marginBottom: 6,
                }}
              >
                NUMBER OF LEGS (2–8)
              </label>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={numLegs}
                onChange={(e) => onChangeNumLegs(e.target.value)}
                min="2"
                max="8"
                step="1"
                style={{ marginBottom: 12 }}
              />

              {parlayMode === 'average' ? (
                <div>
                  <label
                    className="mono"
                    style={{
                      display: 'block',
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      color: 'var(--text-3)',
                      marginBottom: 6,
                    }}
                  >
                    AVERAGE ODDS PER LEG
                  </label>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    placeholder="e.g. 1.85"
                    value={avgOdds}
                    onChange={(e) => setAvgOdds(e.target.value)}
                    min="1.01"
                    step="0.01"
                  />
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {legs.map((leg, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '90px 1fr',
                        gap: 8,
                      }}
                    >
                      <input
                        className="input"
                        type="number"
                        inputMode="decimal"
                        placeholder="Odds"
                        value={leg.odds}
                        onChange={(e) => onChangeLeg(idx, 'odds', e.target.value)}
                        min="1.01"
                        step="0.01"
                      />
                      <input
                        className="input"
                        type="text"
                        placeholder={`Leg ${idx + 1} label (optional)`}
                        value={leg.label}
                        onChange={(e) => onChangeLeg(idx, 'label', e.target.value)}
                      />
                    </div>
                  ))}
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-3)',
                      letterSpacing: '0.04em',
                      paddingTop: 4,
                    }}
                  >
                    Combined odds: <span style={{ color: 'var(--text)' }}>{result.combinedOdds ?? '—'}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RESULT CARD */}
          <ResultCard result={result} />
        </div>
      )}
    </Layout>
  );
}

// Big mint-edged card that renders the live result. Always renders so
// the layout doesn't jump as the user types; on validation failure it
// shows the warning string instead of stake math.
function ResultCard({ result }) {
  if (!result) return null;
  const isParlay = result.kind === 'parlay';

  // Validation failed (bad odds / bankroll too small) → show the
  // warning string in a calm muted way, no big number.
  if (result.ok === false) {
    return (
      <div
        className="card fade-in"
        style={{
          padding: 18,
          borderLeft: '3px solid var(--amber)',
        }}
      >
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 6 }}>
          CHECK YOUR INPUTS
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{result.warning}</div>
      </div>
    );
  }

  const noValue = result.noValue;
  const showStake = result.recommendedStake > 0;

  return (
    <div
      className="card fade-in"
      style={{
        padding: 20,
        borderLeft: '3px solid var(--mint)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em' }}
        >
          RECOMMENDED STAKE
        </span>
        {showStake && <RiskBadge level={result.riskLevel} />}
      </div>

      {showStake ? (
        <div
          className="mono"
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: 'var(--mint)',
            lineHeight: 1.1,
            marginBottom: 14,
            letterSpacing: '-0.01em',
          }}
        >
          ${result.recommendedStake.toFixed(2)}
        </div>
      ) : (
        <div
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text-2)',
            marginBottom: 14,
            lineHeight: 1.3,
          }}
        >
          {noValue ? 'No value — skip this bet' : 'Skip this bet'}
        </div>
      )}

      {showStake && (
        <div style={{ display: 'grid', gap: 0 }}>
          <ResultRow label="Potential return" value={`$${result.potentialReturn.toFixed(2)}`} />
          <ResultRow
            label="Potential profit"
            value={`$${result.potentialProfit.toFixed(2)}`}
            valueColor="var(--mint)"
          />
          <ResultRow label="% of bankroll" value={`${result.stakePercent.toFixed(1)}%`} />
        </div>
      )}

      {/* Parlay-specific extra rows */}
      {isParlay && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid var(--border-soft)',
            display: 'grid',
            gap: 0,
          }}
        >
          <ResultRow label="Combined odds" value={result.combinedOdds?.toFixed(2)} />
          <ResultRow
            label="True win probability"
            value={`${(result.combinedTrueProbability || 0).toFixed(1)}%`}
          />
          <ResultRow
            label="Break-even hit rate"
            value={`${(result.breakEvenHitRate || 0).toFixed(1)}%`}
          />
          {typeof result.edgePercent === 'number' && (
            <ResultRow
              label="Edge vs market"
              value={`${result.edgePercent > 0 ? '+' : ''}${result.edgePercent.toFixed(1)}%`}
              valueColor={result.edgePercent > 0 ? 'var(--mint)' : 'var(--red)'}
            />
          )}
        </div>
      )}

      {!isParlay && typeof result.edgePercent === 'number' && showStake && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid var(--border-soft)',
            display: 'grid',
            gap: 0,
          }}
        >
          <ResultRow label="Implied probability" value={`${result.impliedProbability.toFixed(1)}%`} />
          <ResultRow
            label="Edge vs market"
            value={`${result.edgePercent > 0 ? '+' : ''}${result.edgePercent.toFixed(1)}%`}
            valueColor={result.edgePercent > 0 ? 'var(--mint)' : 'var(--red)'}
          />
        </div>
      )}

      {/* Warnings — yellow strip below the math when applicable */}
      {(result.warning || result.legsWarning) && (
        <div
          className="mono"
          style={{
            marginTop: 14,
            padding: '8px 12px',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 8,
            fontSize: 11,
            color: 'var(--amber)',
            letterSpacing: '0.02em',
            lineHeight: 1.5,
          }}
        >
          {result.warning || result.legsWarning}
        </div>
      )}

      {/* Tiny print: which Kelly fraction we used. Honesty about the
          conservatism baked into the recommendation. */}
      {showStake && (
        <div
          style={{
            marginTop: 12,
            fontSize: 10,
            color: 'var(--text-faint)',
            lineHeight: 1.4,
          }}
        >
          Stake sized with {Math.round(result.fractionalKellyApplied * 100)}% Kelly.
          Max stake is capped at 10% of your bankroll regardless of edge.
        </div>
      )}
    </div>
  );
}
