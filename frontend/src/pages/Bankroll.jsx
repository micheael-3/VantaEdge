import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { bankroll as bankrollApi } from '../api/bankroll';
import './Bankroll.css';

const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€' };

function fmtMoney(n, currency = 'USD') {
  const sym = CURRENCY_SYMBOLS[currency] || '$';
  const sign = n < 0 ? '-' : '';
  return `${sign}${sym}${Math.abs(Number(n) || 0).toFixed(2)}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch { return String(iso); }
}

function fmtDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch { return String(iso); }
}

function resultBadge(result) {
  const r = (result || '').toUpperCase();
  if (r === 'WIN') return <span className="br-badge win">WIN</span>;
  if (r === 'LOSS') return <span className="br-badge loss">LOSS</span>;
  if (r === 'PUSH') return <span className="br-badge push">PUSH</span>;
  return <span className="br-badge pending">PENDING</span>;
}

// ---------- Setup screen ----------
function Setup({ onDone }) {
  const [amount, setAmount] = useState('1000');
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const n = Number(amount);
    if (!n || n <= 0) { setError('Enter a positive starting amount'); return; }
    setBusy(true);
    try {
      await bankrollApi.setup(n, currency);
      onDone();
    } catch (err) {
      setError((err.response && err.response.data && err.response.data.error) || 'Setup failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="br-setup">
      <h2>Set up your bankroll</h2>
      <p>
        Tell us your starting bankroll and we'll track P&amp;L, ROI, and growth over time.
        Each bet you log deducts the stake instantly; settlement adds winnings back.
      </p>
      <form onSubmit={submit}>
        <div className="br-field">
          <label className="br-label" htmlFor="br-amount">Starting amount</label>
          <input
            id="br-amount"
            className="br-input"
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>
        <div className="br-field">
          <label className="br-label" htmlFor="br-currency">Currency</label>
          <select id="br-currency" className="br-input br-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD ($)</option>
            <option value="GBP">GBP (£)</option>
            <option value="EUR">EUR (€)</option>
          </select>
        </div>
        {error && <div className="br-error">{error}</div>}
        <div className="br-modal-actions">
          <button className="br-btn br-btn-primary" type="submit" disabled={busy}>
            {busy ? 'Setting up…' : 'Create bankroll'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Log a Bet / Adjustment modal ----------
function LogModal({ initial, onClose, onSaved }) {
  // initial may contain { stake, odds, market, predictionId, notes } for pre-fill from Dashboard.
  const [tab, setTab] = useState('bet');   // 'bet' | 'adjustment'
  const [stake, setStake] = useState(initial && initial.stake != null ? String(initial.stake) : '');
  const [odds, setOdds] = useState(initial && initial.odds != null ? String(initial.odds) : '');
  const [market, setMarket] = useState((initial && initial.market) || 'OVER');
  const [result, setResult] = useState('PENDING');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState((initial && initial.notes) || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (tab === 'adjustment') {
        const n = Number(amount);
        if (!n || Number.isNaN(n)) { setBusy(false); setError('Enter a non-zero amount'); return; }
        await bankrollApi.addEntry({ type: 'ADJUSTMENT', amount: n, notes });
      } else if (initial && initial.predictionId) {
        await bankrollApi.logBet({
          predictionId: initial.predictionId,
          stake: Number(stake),
          odds: Number(odds),
          market,
          notes,
        });
      } else {
        await bankrollApi.addEntry({
          type: 'BET',
          stake: Number(stake),
          odds: Number(odds),
          market,
          result,
          notes,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError((err.response && err.response.data && err.response.data.error) || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="br-modal-backdrop" onClick={onClose}>
      <div className="br-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <h3>Log {initial && initial.predictionId ? 'this bet' : 'an entry'}</h3>

        {!initial?.predictionId && (
          <div className="br-toggle-group" style={{ marginBottom: 14 }}>
            <button className={`br-toggle ${tab === 'bet' ? 'on' : ''}`} onClick={() => setTab('bet')}>Bet</button>
            <button className={`br-toggle ${tab === 'adjustment' ? 'on' : ''}`} onClick={() => setTab('adjustment')}>
              Deposit / withdraw
            </button>
          </div>
        )}

        <form onSubmit={submit}>
          {tab === 'adjustment' ? (
            <>
              <div className="br-field">
                <label className="br-label">Amount (+ deposit / − withdraw)</label>
                <input className="br-input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="br-row">
                <div className="br-field">
                  <label className="br-label">Stake</label>
                  <input className="br-input" type="number" min="0.01" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} />
                </div>
                <div className="br-field">
                  <label className="br-label">Odds (decimal)</label>
                  <input className="br-input" type="number" min="1.01" step="0.01" value={odds} onChange={(e) => setOdds(e.target.value)} />
                </div>
              </div>
              <div className="br-field">
                <label className="br-label">Market</label>
                <div className="br-toggle-group">
                  {['OVER', 'BTTS', 'OTHER'].map((m) => (
                    <button key={m} type="button" className={`br-toggle ${market === m ? 'on' : ''}`} onClick={() => setMarket(m)}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              {!initial?.predictionId && (
                <div className="br-field">
                  <label className="br-label">Result</label>
                  <div className="br-toggle-group">
                    {['PENDING', 'WIN', 'LOSS', 'PUSH'].map((r) => (
                      <button key={r} type="button" className={`br-toggle ${result === r ? 'on' : ''}`} onClick={() => setResult(r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <div className="br-field">
            <label className="br-label">Notes (optional)</label>
            <input className="br-input" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Brighton vs Aston Villa — Over 2.5 @ 1.85" />
          </div>
          {error && <div className="br-error">{error}</div>}
          <div className="br-modal-actions">
            <button type="button" className="br-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="br-btn br-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Main dashboard ----------
export default function Bankroll() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logOpen, setLogOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await bankrollApi.get();
      setData(res);
    } catch (err) {
      setError((err.response && err.response.data && err.response.data.error) || 'Failed to load bankroll');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const bk = data && data.bankroll;
  const stats = (data && data.stats) || {};
  const series = (data && data.series) || [];
  const entries = (data && data.entries) || [];
  const currency = bk ? bk.currency : 'USD';

  const chartData = useMemo(() => series.map((p) => ({
    date: new Date(p.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    balance: Math.round(Number(p.balance) * 100) / 100,
  })), [series]);

  return (
    <div className="bankroll-page">
      <Navbar />
      <div className="br-head">
        <h1>Bankroll</h1>
        <p className="sub">Track every bet, see P&amp;L over time, and watch the Kelly stake compound.</p>
      </div>

      <div className="br-body">
        {loading ? (
          <div style={{ color: 'var(--bp-dim)', fontFamily: 'DM Mono, monospace' }}>Loading…</div>
        ) : error ? (
          <div className="br-error">{error}</div>
        ) : !bk ? (
          <Setup onDone={load} />
        ) : (
          <>
            <div className="br-actions">
              <button className="br-btn br-btn-primary" onClick={() => setLogOpen(true)}>+ Log a bet</button>
              <button className="br-btn" onClick={() => { if (window.confirm('Reset starting amount to current balance? History is preserved.')) bankrollApi.setup(bk.currentAmount, currency).then(load); }}>
                Reset starting point to current
              </button>
            </div>

            <div className="br-kpi-grid">
              <div className="br-kpi primary">
                <div className="lbl">Current balance</div>
                <div className="val">{fmtMoney(bk.currentAmount, currency)}</div>
                <div className={`sub ${stats.pl >= 0 ? 'br-pos' : 'br-neg'}`}>
                  {stats.pl >= 0 ? '+' : ''}{fmtMoney(stats.pl, currency)} ({stats.plPct >= 0 ? '+' : ''}{stats.plPct}%)
                </div>
              </div>
              <div className="br-kpi">
                <div className="lbl">Starting</div>
                <div className="val">{fmtMoney(bk.startingAmount, currency)}</div>
                <div className="sub">Created {fmtDate(bk.createdAt)}</div>
              </div>
              <div className="br-kpi">
                <div className="lbl">ROI</div>
                <div className={`val ${stats.roi >= 0 ? 'br-pos' : 'br-neg'}`}>{stats.roi >= 0 ? '+' : ''}{stats.roi}%</div>
                <div className="sub">on {fmtMoney(stats.totalStaked, currency)} staked</div>
              </div>
              <div className="br-kpi">
                <div className="lbl">Win rate</div>
                <div className="val">{stats.winRate || 0}%</div>
                <div className="sub">{stats.wins || 0} W / {stats.losses || 0} L</div>
              </div>
            </div>

            <div className="br-card">
              <h3>Bankroll growth</h3>
              {chartData.length > 1 ? (
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="brFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#6ee7b7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#2a2a38" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#888899" fontSize={11} />
                      <YAxis stroke="#888899" fontSize={11} />
                      <Tooltip
                        contentStyle={{ background: '#111118', border: '1px solid #2a2a38', borderRadius: 8 }}
                        formatter={(v) => [fmtMoney(v, currency), 'Balance']}
                      />
                      <Area type="monotone" dataKey="balance" stroke="#6ee7b7" strokeWidth={2} fill="url(#brFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ color: 'var(--bp-dim)', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>
                  Log a bet or an adjustment to start the curve.
                </div>
              )}
            </div>

            <div className="br-card">
              <h3>Recent activity (last 30)</h3>
              <div className="br-table-wrap">
                <table className="br-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Type</th>
                      <th>Market</th>
                      <th>Stake</th>
                      <th>Odds</th>
                      <th>P&amp;L</th>
                      <th>Balance after</th>
                      <th>Result</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0 ? (
                      <tr><td colSpan="9" style={{ color: 'var(--bp-dim)' }}>No activity yet.</td></tr>
                    ) : (
                      entries.map((e) => (
                        <tr key={e.id}>
                          <td>{fmtDateTime(e.createdAt)}</td>
                          <td>{e.type}</td>
                          <td>{e.market || '—'}</td>
                          <td>{e.stake != null ? fmtMoney(e.stake, currency) : '—'}</td>
                          <td>{e.odds != null ? Number(e.odds).toFixed(2) : '—'}</td>
                          <td className={e.profitLoss >= 0 ? 'br-pos' : 'br-neg'}>
                            {e.profitLoss >= 0 ? '+' : ''}{fmtMoney(e.profitLoss, currency)}
                          </td>
                          <td>{fmtMoney(e.balanceAfter, currency)}</td>
                          <td>{e.type === 'ADJUSTMENT' ? <span className="br-badge">ADJ</span> : resultBadge(e.result)}</td>
                          <td style={{ color: 'var(--bp-dim)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.notes || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {logOpen && bk && (
        <LogModal
          onClose={() => setLogOpen(false)}
          onSaved={() => { load(); }}
        />
      )}
    </div>
  );
}
