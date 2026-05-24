import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import LockedOverlay from '../components/LockedOverlay.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';

// Bet Tracker — bets persist via localStorage so a refresh doesn't wipe
// them. Full backend persistence (the /api/bankroll endpoint exists but
// isn't wired) is a separate task; this is the minimum-risk middle
// ground: bets stay across reloads, no schema/API surface changes.
//
// Storage key is versioned so a future shape change can ignore old
// blobs cleanly. Capped read at 500 rows so a corrupt LS entry can't
// blow the page.
const BETS_LS_KEY = 'fastscore_bets_v1';

function loadBetsFromStorage() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BETS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 500);
  } catch {
    return [];
  }
}

function saveBetsToStorage(bets) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BETS_LS_KEY, JSON.stringify(bets || []));
  } catch {
    /* quota exceeded or storage disabled — silently fall back to in-memory */
  }
}

const INITIAL_BETS = [];

function calcPnL(bet) {
  if (bet.result === 'WIN') return bet.stake * (bet.odds - 1);
  if (bet.result === 'LOSS') return -bet.stake;
  return 0;
}

function SummaryStat({ label, value, color = 'text' }) {
  return (
    <div className="card" style={{ padding: 18 }}>
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
        className="display"
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.02em',
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

function Field({ label, children }) {
  return (
    <div>
      <label
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: '0.1em',
          display: 'block',
          marginBottom: 8,
        }}
      >
        {label.toUpperCase()}
      </label>
      {children}
    </div>
  );
}

// 3-button toggle: WIN / LOSS / PENDING. Used in single mode and on
// every parlay leg, so the colour treatment + active state lives here
// once instead of being duplicated five places.
function ResultButtons({ value, onChange }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6,
      }}
    >
      {['WIN', 'LOSS', 'PENDING'].map((r) => {
        const active = value === r;
        const borderActive =
          r === 'WIN' ? 'rgba(110,231,183,0.4)' : r === 'LOSS' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.2)';
        const bgActive =
          r === 'WIN' ? 'rgba(110,231,183,0.08)' : r === 'LOSS' ? 'rgba(239,68,68,0.08)' : 'var(--card-2)';
        const colorActive =
          r === 'WIN' ? 'var(--mint)' : r === 'LOSS' ? 'var(--red)' : 'var(--text)';
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            style={{
              padding: '10px',
              border: '1px solid ' + (active ? borderActive : 'var(--border)'),
              background: active ? bgActive : 'transparent',
              color: active ? colorActive : 'var(--text-2)',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

// Rollup of leg results → parlay result.
//   any LOSS → LOSS (lose the parlay the moment one leg fails)
//   any PENDING → PENDING (still waiting)
//   all WIN → WIN
function rollupParlayResult(legs) {
  if (!Array.isArray(legs) || legs.length < 2) return 'PENDING';
  if (legs.some((l) => l.result === 'LOSS')) return 'LOSS';
  if (legs.some((l) => l.result === 'PENDING')) return 'PENDING';
  return 'WIN';
}

function combineOdds(legs) {
  if (!Array.isArray(legs)) return 0;
  return legs.reduce((acc, l) => {
    const n = parseFloat(l.odds);
    return Number.isFinite(n) && n > 0 ? acc * n : acc * 1;
  }, 1);
}

function AddBetModal({ onClose, onAdd }) {
  // 'single' | 'parlay'. Default single — same as before.
  const [betMode, setBetMode] = useState('single');

  // Single state
  const [match, setMatch] = useState('');
  const [betType, setBetType] = useState('Over 2.5');
  const [odds, setOdds] = useState('');
  const [stake, setStake] = useState('');
  const [result, setResult] = useState('PENDING');

  // Parlay state — starts with 2 legs (minimum). Max 8.
  const [legs, setLegs] = useState([
    { match: '', betType: 'Over 2.5', odds: '', result: 'PENDING' },
    { match: '', betType: 'Over 2.5', odds: '', result: 'PENDING' },
  ]);
  const [parlayStake, setParlayStake] = useState('');

  const updateLeg = (idx, field, value) =>
    setLegs((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLeg = () =>
    setLegs((prev) => (prev.length >= 8 ? prev : [...prev, { match: '', betType: 'Over 2.5', odds: '', result: 'PENDING' }]));
  const removeLeg = (idx) =>
    setLegs((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));

  // Live parlay maths — combined odds + result rollup + return + profit.
  // We re-derive on every render rather than storing in state so it's
  // always in sync with the leg inputs.
  const parlayCombinedOdds = combineOdds(legs);
  const parlayResult = rollupParlayResult(legs);
  const parlayStakeNum = parseFloat(parlayStake) || 0;
  const parlayReturn = parlayStakeNum * parlayCombinedOdds;
  const parlayProfit = parlayReturn - parlayStakeNum;

  // Validation: at least 2 legs with both match name and odds entered.
  const parlayValid =
    legs.length >= 2 &&
    legs.every((l) => l.match.trim() && Number(parseFloat(l.odds)) > 1) &&
    parlayStakeNum > 0;

  const submit = () => {
    const d = new Date();
    const dateLabel = `${
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
        d.getMonth()
      ]
    } ${d.getDate()}`;

    if (betMode === 'single') {
      if (!match || !odds || !stake) return;
      onAdd({
        match,
        bet: betType,
        odds: parseFloat(odds),
        stake: parseFloat(stake),
        result,
        date: dateLabel,
        isParlay: false,
      });
      return;
    }

    // Parlay submit.
    if (!parlayValid) return;
    const legsClean = legs.map((l) => ({
      match: l.match.trim(),
      betType: l.betType,
      odds: parseFloat(l.odds),
      result: l.result,
    }));
    onAdd({
      // The bets table reads .match and .bet directly. We synthesise
      // them for the row summary and keep the full leg list under .legs
      // for the expandable detail panel.
      match: `🔗 PARLAY · ${legsClean.length} legs`,
      bet: `PARLAY · ${legsClean.length}`,
      odds: parlayCombinedOdds,
      stake: parlayStakeNum,
      result: parlayResult,
      date: dateLabel,
      isParlay: true,
      legs: legsClean,
      combinedOdds: parlayCombinedOdds,
    });
  };

  return (
    <div className="addbet-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="addbet-content card scale-in"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <h3
            className="display"
            style={{ margin: 0, fontSize: 22, fontWeight: 700 }}
          >
            Add a bet
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-3)',
              padding: 4,
            }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Single / Parlay toggle — two big tap buttons, mint-active.
              Matches the Calculator page's toggle so the visual
              vocabulary is consistent across the staking surface. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            {[
              { key: 'single', label: 'Single' },
              { key: 'parlay', label: 'Parlay' },
            ].map((t) => {
              const active = betMode === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setBetMode(t.key)}
                  className="mono"
                  style={{
                    background: active ? 'var(--mint)' : 'transparent',
                    color: active ? '#001a10' : 'var(--text)',
                    border: `1px solid ${active ? 'var(--mint)' : 'var(--border)'}`,
                    borderRadius: 10,
                    padding: '12px 10px',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    minHeight: 44,
                  }}
                  aria-pressed={active}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {betMode === 'single' && (
            <>
              <Field label="Match">
                <input
                  className="input"
                  value={match}
                  onChange={(e) => setMatch(e.target.value)}
                  placeholder="e.g. Portland vs Seattle"
                  autoFocus
                />
              </Field>
              <Field label="Bet type">
                <select
                  className="input"
                  value={betType}
                  onChange={(e) => setBetType(e.target.value)}
                >
                  <option>Over 2.5</option>
                  <option>Under 2.5</option>
                  <option>BTTS Yes</option>
                  <option>BTTS No</option>
                  <option>Other</option>
                </select>
              </Field>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <Field label="Odds">
                  <input
                    className="input"
                    value={odds}
                    onChange={(e) => setOdds(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="1.85"
                  />
                </Field>
                <Field label="Stake ($)">
                  <input
                    className="input"
                    value={stake}
                    onChange={(e) =>
                      setStake(e.target.value.replace(/[^0-9.]/g, ''))
                    }
                    placeholder="100"
                  />
                </Field>
              </div>
              <Field label="Result">
                <ResultButtons value={result} onChange={setResult} />
              </Field>
            </>
          )}

          {betMode === 'parlay' && (
            <>
              <div style={{ display: 'grid', gap: 10 }}>
                {legs.map((leg, idx) => (
                  <div
                    key={idx}
                    className="card"
                    style={{
                      padding: 12,
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border-soft)',
                      display: 'grid',
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          letterSpacing: '0.1em',
                          color: 'var(--text-3)',
                        }}
                      >
                        LEG {idx + 1}
                      </span>
                      {legs.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeLeg(idx)}
                          className="mono"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--red)',
                            fontSize: 11,
                            padding: 0,
                            cursor: 'pointer',
                            letterSpacing: '0.04em',
                          }}
                          aria-label={`Remove leg ${idx + 1}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      className="input"
                      value={leg.match}
                      onChange={(e) => updateLeg(idx, 'match', e.target.value)}
                      placeholder="e.g. Portland vs Seattle"
                    />
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 100px',
                        gap: 8,
                      }}
                    >
                      <select
                        className="input"
                        value={leg.betType}
                        onChange={(e) => updateLeg(idx, 'betType', e.target.value)}
                      >
                        <option>Over 2.5</option>
                        <option>Under 2.5</option>
                        <option>BTTS Yes</option>
                        <option>BTTS No</option>
                        <option>Other</option>
                      </select>
                      <input
                        className="input"
                        value={leg.odds}
                        onChange={(e) => updateLeg(idx, 'odds', e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="1.85"
                        inputMode="decimal"
                      />
                    </div>
                    <ResultButtons
                      value={leg.result}
                      onChange={(v) => updateLeg(idx, 'result', v)}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addLeg}
                  disabled={legs.length >= 8}
                  className="btn btn-ghost btn-sm"
                  style={{
                    justifySelf: 'start',
                    opacity: legs.length >= 8 ? 0.5 : 1,
                  }}
                >
                  <Icon name="plus" size={12} /> Add Leg
                </button>
              </div>

              <Field label="Stake ($)">
                <input
                  className="input"
                  value={parlayStake}
                  onChange={(e) => setParlayStake(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="100"
                  inputMode="decimal"
                />
              </Field>

              {/* Live parlay summary — recomputes on every keystroke. */}
              <div
                className="card"
                style={{
                  padding: 14,
                  background: 'var(--bg-2)',
                  borderLeft: '3px solid var(--mint)',
                  display: 'grid',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em' }}>
                    COMBINED ODDS
                  </span>
                  <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--mint)' }}>
                    {parlayCombinedOdds.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: 'var(--text-2)',
                  }}
                >
                  <span className="mono" style={{ letterSpacing: '0.04em' }}>Potential return</span>
                  <span className="mono">
                    ${parlayReturn.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: 'var(--text-2)',
                  }}
                >
                  <span className="mono" style={{ letterSpacing: '0.04em' }}>Potential profit</span>
                  <span className="mono" style={{ color: 'var(--mint)' }}>
                    ${parlayProfit.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: 'var(--text-2)',
                  }}
                >
                  <span className="mono" style={{ letterSpacing: '0.04em' }}>Status</span>
                  <span
                    className="mono"
                    style={{
                      fontWeight: 600,
                      color:
                        parlayResult === 'WIN'
                          ? 'var(--mint)'
                          : parlayResult === 'LOSS'
                            ? 'var(--red)'
                            : 'var(--text-2)',
                    }}
                  >
                    {parlayResult}
                  </span>
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ flex: 1 }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={submit}
              disabled={betMode === 'parlay' && !parlayValid}
            >
              Add bet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Bankroll() {
  const { user } = useAuth();
  const sharp = isSharp(user);
  // Initialise from localStorage on mount so a refresh doesn't wipe the
  // tracked bets. The lazy initialiser only runs once (React useState
  // pattern), so we don't pay the parse cost on every render. Falls
  // back to INITIAL_BETS = [] if storage is empty / corrupt / disabled.
  const [bets, setBets] = useState(() => {
    const stored = loadBetsFromStorage();
    return stored.length ? stored : INITIAL_BETS;
  });
  const [modal, setModal] = useState(false);
  // Which parlay row, if any, has its leg detail expanded. Single bets
  // don't expand — they have no legs to show.
  const [expandedId, setExpandedId] = useState(null);

  // Persist on every change. Cheap (one JSON.stringify call) and runs
  // after render, so it never blocks user input. If saveBetsToStorage
  // fails (quota / private-browsing), state stays in memory — we just
  // lose persistence for this user, never the bets they're currently
  // looking at.
  useEffect(() => {
    saveBetsToStorage(bets);
  }, [bets]);

  const stats = useMemo(() => {
    const settled = bets.filter((b) => b.result !== 'PENDING');
    const wins = settled.filter((b) => b.result === 'WIN').length;
    const total = settled.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const totalStaked = settled.reduce((a, b) => a + b.stake, 0);
    const totalPnL = settled.reduce((a, b) => a + calcPnL(b), 0);
    const roi = totalStaked > 0 ? (totalPnL / totalStaked) * 100 : 0;
    return { total: bets.length, settled: total, wins, winRate, totalPnL, roi };
  }, [bets]);

  const addBet = (b) => {
    setBets((prev) => [{ ...b, id: Date.now() }, ...prev]);
    setModal(false);
  };

  const toggleResult = (id) => {
    setBets((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        // Parlay rows can't be cycled directly — their result is the
        // rollup of leg results. Cycling here would let the user create
        // an inconsistent state (e.g. parlay=WIN with a leg=LOSS).
        // Instead, clicking a parlay row toggles its leg expansion
        // panel; the user edits leg results there and the rollup
        // recomputes. We return the row unchanged.
        if (b.isParlay) return b;
        return {
          ...b,
          result:
            b.result === 'PENDING'
              ? 'WIN'
              : b.result === 'WIN'
                ? 'LOSS'
                : 'PENDING',
        };
      }),
    );
  };

  // Cycle a single leg's result on an existing parlay, then recompute
  // the parlay rollup based on the new leg state. Used by the
  // expandable leg detail panel below each parlay row.
  const cycleLegResult = (betId, legIdx) => {
    setBets((prev) =>
      prev.map((b) => {
        if (b.id !== betId || !b.isParlay || !Array.isArray(b.legs)) return b;
        const nextLegs = b.legs.map((l, i) => {
          if (i !== legIdx) return l;
          const next =
            l.result === 'PENDING' ? 'WIN' : l.result === 'WIN' ? 'LOSS' : 'PENDING';
          return { ...l, result: next };
        });
        return { ...b, legs: nextLegs, result: rollupParlayResult(nextLegs) };
      }),
    );
  };

  return (
    <Layout>
      {({ openUpgrade }) => (
        <div style={{ position: 'relative' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 24,
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h1
                className="display"
                style={{
                  fontSize: 36,
                  fontWeight: 700,
                  margin: 0,
                  letterSpacing: '-0.025em',
                }}
              >
                Bet Tracker
              </h1>
              <p
                className="mono"
                style={{
                  margin: '4px 0 0',
                  color: 'var(--text-3)',
                  fontSize: 12,
                  letterSpacing: '0.04em',
                }}
              >
                EVERY BET. EVERY RESULT.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => sharp && setModal(true)}
              disabled={!sharp}
            >
              <Icon name="plus" size={14} /> Add Bet
            </button>
          </div>

          <div style={{ position: 'relative' }}>
            <div
              style={{
                filter: sharp ? 'none' : 'blur(7px)',
                pointerEvents: sharp ? 'auto' : 'none',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 12,
                  marginBottom: 20,
                }}
                className="bk-stats-grid"
              >
                <SummaryStat label="TOTAL BETS" value={stats.total} />
                <SummaryStat
                  label="WIN RATE"
                  value={`${stats.winRate.toFixed(1)}%`}
                  color={stats.winRate >= 55 ? 'mint' : 'text'}
                />
                <SummaryStat
                  label="TOTAL P&L"
                  value={`${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)}`}
                  color={stats.totalPnL >= 0 ? 'mint' : 'red'}
                />
                <SummaryStat
                  label="ROI"
                  value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`}
                  color={stats.roi >= 0 ? 'mint' : 'red'}
                />
              </div>

              <div
                className="card"
                style={{ padding: 0, overflow: 'hidden' }}
              >
                <div style={{ overflowX: 'auto' }}>
                  <div
                    className="mono"
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        '70px 1.4fr 110px 70px 80px 90px 80px',
                      gap: 12,
                      padding: '14px 20px',
                      background: 'var(--card-2)',
                      borderBottom: '1px solid var(--border-soft)',
                      fontSize: 10,
                      color: 'var(--text-3)',
                      letterSpacing: '0.08em',
                      minWidth: 720,
                    }}
                  >
                    <span>DATE</span>
                    <span>MATCH</span>
                    <span>BET</span>
                    <span style={{ textAlign: 'right' }}>ODDS</span>
                    <span style={{ textAlign: 'right' }}>STAKE</span>
                    <span style={{ textAlign: 'center' }}>RESULT</span>
                    <span style={{ textAlign: 'right' }}>P&amp;L</span>
                  </div>
                  {bets.length === 0 && (
                    <div
                      className="muted"
                      style={{
                        padding: '32px 20px',
                        textAlign: 'center',
                        fontSize: 13,
                      }}
                    >
                      No bets tracked yet. Click "Add Bet" to log your first.
                    </div>
                  )}
                  {bets.map((b) => {
                    const pnl = calcPnL(b);
                    const bg =
                      b.result === 'WIN'
                        ? 'rgba(110,231,183,0.04)'
                        : b.result === 'LOSS'
                          ? 'rgba(239,68,68,0.04)'
                          : 'transparent';
                    const isExpanded = expandedId === b.id && b.isParlay;
                    return (
                      <BetRowFragment
                        key={b.id}
                        b={b}
                        pnl={pnl}
                        bg={bg}
                        isExpanded={isExpanded}
                        onToggleExpand={() =>
                          b.isParlay && setExpandedId(isExpanded ? null : b.id)
                        }
                        onToggleResult={() => toggleResult(b.id)}
                        onCycleLeg={(idx) => cycleLegResult(b.id, idx)}
                      />
                    );
                  })}
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
                    Bet Tracker is PRO-only
                  </div>
                  <p
                    style={{
                      margin: '0 0 16px',
                      color: 'var(--text-2)',
                      fontSize: 14,
                    }}
                  >
                    Track every bet automatically. Real profit, real win rate.
                  </p>
                  <button type="button" className="btn btn-primary">
                    Get PRO <Icon name="arrow-right" size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {modal && (
            <AddBetModal
              onClose={() => setModal(false)}
              onAdd={addBet}
            />
          )}
        </div>
      )}
    </Layout>
  );
}

// Per-row renderer split out so the table .map() doesn't grow into a
// 200-line block. Single bets render one grid row; parlays render the
// same grid row plus a collapsible detail panel that lists each leg
// (clickable to cycle that leg's WIN/LOSS/PENDING).
function BetRowFragment({ b, pnl, bg, isExpanded, onToggleExpand, onToggleResult, onCycleLeg }) {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            '70px 1.4fr 110px 70px 80px 90px 80px',
          gap: 12,
          padding: '14px 20px',
          borderBottom: isExpanded ? 'none' : '1px solid var(--border-soft)',
          background: bg,
          fontSize: 13,
          alignItems: 'center',
          minWidth: 720,
          cursor: b.isParlay ? 'pointer' : 'default',
        }}
        onClick={(e) => {
          // Don't fire on the result-cycle button — that has its own
          // click handler. We only want a row-level click to toggle
          // the parlay's leg detail expansion.
          if (!b.isParlay) return;
          if (e.target.closest && e.target.closest('button')) return;
          onToggleExpand();
        }}
      >
                        <span
                          className="mono"
                          style={{
                            color: 'var(--text-3)',
                            fontSize: 11,
                          }}
                        >
                          {b.date}
                        </span>
                        <span style={{ fontWeight: 500 }}>{b.match}</span>
                        <span style={{ color: 'var(--text-2)', fontSize: 12 }}>
                          {b.bet}
                        </span>
                        <span className="mono" style={{ textAlign: 'right' }}>
                          {b.odds.toFixed(2)}
                        </span>
                        <span className="mono" style={{ textAlign: 'right' }}>
                          ${b.stake}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleResult(b.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            justifySelf: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          <span
                            className="mono"
                            style={{
                              padding: '3px 9px',
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: '0.06em',
                              background:
                                b.result === 'WIN'
                                  ? 'rgba(110,231,183,0.15)'
                                  : b.result === 'LOSS'
                                  ? 'rgba(239,68,68,0.15)'
                                  : 'rgba(156,163,175,0.1)',
                              color:
                                b.result === 'WIN'
                                  ? 'var(--mint)'
                                  : b.result === 'LOSS'
                                  ? 'var(--red)'
                                  : 'var(--text-3)',
                              border:
                                '1px solid ' +
                                (b.result === 'WIN'
                                  ? 'rgba(110,231,183,0.25)'
                                  : b.result === 'LOSS'
                                  ? 'rgba(239,68,68,0.25)'
                                  : 'var(--border-soft)'),
                            }}
                          >
                            {b.result}
                          </span>
                        </button>
                        <span
                          className="mono"
                          style={{
                            textAlign: 'right',
                            fontWeight: 600,
                            color:
                              pnl > 0
                                ? 'var(--mint)'
                                : pnl < 0
                                ? 'var(--red)'
                                : 'var(--text-3)',
                          }}
                        >
                          {b.result === 'PENDING'
                            ? '—'
                            : `${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`}
                        </span>
      </div>
      {/* Leg detail panel — only renders when this row is the
          currently-expanded parlay. Lists each leg with its match,
          bet type, odds, and a clickable WIN/LOSS/PENDING badge. */}
      {isExpanded && Array.isArray(b.legs) && (
        <div
          style={{
            padding: '10px 20px 14px 92px',
            borderBottom: '1px solid var(--border-soft)',
            background: 'var(--bg-2)',
            minWidth: 720,
            display: 'grid',
            gap: 6,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.1em',
              color: 'var(--text-3)',
              marginBottom: 2,
            }}
          >
            LEGS ({b.legs.length}) · COMBINED {Number(b.odds).toFixed(2)} ·
            click a status to cycle
          </div>
          {b.legs.map((leg, idx) => {
            const legColor =
              leg.result === 'WIN'
                ? 'var(--mint)'
                : leg.result === 'LOSS'
                  ? 'var(--red)'
                  : 'var(--text-3)';
            const legBg =
              leg.result === 'WIN'
                ? 'rgba(110,231,183,0.12)'
                : leg.result === 'LOSS'
                  ? 'rgba(239,68,68,0.12)'
                  : 'rgba(156,163,175,0.08)';
            const legBorder =
              leg.result === 'WIN'
                ? 'rgba(110,231,183,0.25)'
                : leg.result === 'LOSS'
                  ? 'rgba(239,68,68,0.25)'
                  : 'var(--border-soft)';
            return (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr 100px 60px 80px',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 12,
                }}
              >
                <span className="mono" style={{ color: 'var(--text-3)' }}>{idx + 1}.</span>
                <span style={{ fontWeight: 500 }}>{leg.match}</span>
                <span style={{ color: 'var(--text-2)' }}>{leg.betType}</span>
                <span className="mono" style={{ textAlign: 'right' }}>
                  {Number(leg.odds).toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => onCycleLeg(idx)}
                  className="mono"
                  style={{
                    justifySelf: 'center',
                    padding: '3px 9px',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    borderRadius: 4,
                    background: legBg,
                    color: legColor,
                    border: `1px solid ${legBorder}`,
                    cursor: 'pointer',
                  }}
                >
                  {leg.result}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
