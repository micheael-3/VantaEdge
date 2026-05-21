import { useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import LockedOverlay from '../components/LockedOverlay.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';

// Bet Tracker — port of the design's bet-tracker.jsx.
// Uses local state for tracked bets (the backend bankroll endpoint exists
// and can be wired in a follow-up; the visual structure is the priority).
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

function AddBetModal({ onClose, onAdd }) {
  const [match, setMatch] = useState('');
  const [betType, setBetType] = useState('Over 2.5');
  const [odds, setOdds] = useState('');
  const [stake, setStake] = useState('');
  const [result, setResult] = useState('PENDING');

  const submit = () => {
    if (!match || !odds || !stake) return;
    const d = new Date();
    onAdd({
      match,
      bet: betType,
      odds: parseFloat(odds),
      stake: parseFloat(stake),
      result,
      date: `${
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
          d.getMonth()
        ]
      } ${d.getDate()}`,
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
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 6,
              }}
            >
              {['WIN', 'LOSS', 'PENDING'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  style={{
                    padding: '10px',
                    border:
                      '1px solid ' +
                      (result === r
                        ? r === 'WIN'
                          ? 'rgba(110,231,183,0.4)'
                          : r === 'LOSS'
                          ? 'rgba(239,68,68,0.4)'
                          : 'rgba(255,255,255,0.2)'
                        : 'var(--border)'),
                    background:
                      result === r
                        ? r === 'WIN'
                          ? 'rgba(110,231,183,0.08)'
                          : r === 'LOSS'
                          ? 'rgba(239,68,68,0.08)'
                          : 'var(--card-2)'
                        : 'transparent',
                    color:
                      result === r
                        ? r === 'WIN'
                          ? 'var(--mint)'
                          : r === 'LOSS'
                          ? 'var(--red)'
                          : 'var(--text)'
                        : 'var(--text-2)',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>
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
  const [bets, setBets] = useState(INITIAL_BETS);
  const [modal, setModal] = useState(false);

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
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              result:
                b.result === 'PENDING'
                  ? 'WIN'
                  : b.result === 'WIN'
                  ? 'LOSS'
                  : 'PENDING',
            }
          : b,
      ),
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
                    return (
                      <div
                        key={b.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            '70px 1.4fr 110px 70px 80px 90px 80px',
                          gap: 12,
                          padding: '14px 20px',
                          borderBottom: '1px solid var(--border-soft)',
                          background: bg,
                          fontSize: 13,
                          alignItems: 'center',
                          minWidth: 720,
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
