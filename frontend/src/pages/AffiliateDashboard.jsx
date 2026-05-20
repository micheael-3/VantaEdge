import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import Navbar from '../components/Navbar';
import affiliateApi from '../api/affiliate';

function fmtMoney(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}

function statusBadge(status) {
  if (status === 'ACTIVE') return <span className="badge green mono">ACTIVE</span>;
  if (status === 'CANCELLED') return <span className="badge red mono">CANCELLED</span>;
  return <span className="badge mono">{status}</span>;
}

export default function AffiliateDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const [payoutMethod, setPayoutMethod] = useState('paypal');
  const [payoutDest, setPayoutDest] = useState('');
  const [payoutMsg, setPayoutMsg] = useState({ type: '', text: '' });
  const [payoutBusy, setPayoutBusy] = useState(false);

  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await affiliateApi.dashboard();
      setData(res);
    } catch (err) {
      setError((err.response && err.response.data && err.response.data.error) || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleJoin = async () => {
    setJoining(true);
    try {
      await affiliateApi.join();
      await load();
    } catch (err) {
      setError((err.response && err.response.data && err.response.data.error) || 'Failed to join');
    } finally {
      setJoining(false);
    }
  };

  const handleCopy = async () => {
    if (!data || !data.referralLink) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handlePayout = async (e) => {
    e.preventDefault();
    setPayoutMsg({ type: '', text: '' });
    if (!payoutDest.trim()) {
      setPayoutMsg({ type: 'error', text: 'Enter a destination (PayPal email or crypto address)' });
      return;
    }
    setPayoutBusy(true);
    try {
      const res = await affiliateApi.requestPayout(payoutMethod, payoutDest.trim());
      setPayoutMsg({ type: 'success', text: `Requested payout of ${fmtMoney(res.amount)}` });
      setPayoutDest('');
      await load();
    } catch (err) {
      setPayoutMsg({
        type: 'error',
        text: (err.response && err.response.data && err.response.data.error) || 'Payout request failed',
      });
    } finally {
      setPayoutBusy(false);
    }
  };

  const canRequestPayout = useMemo(
    () => data && data.hasAffiliate && data.pendingPayout >= (data.payoutThreshold || 20),
    [data],
  );

  return (
    <>
      <Navbar />
      <div className="container" style={{ paddingTop: 20 }}>
        <h2>Affiliate dashboard</h2>

        {loading ? (
          <div className="card">Loading…</div>
        ) : error ? (
          <div className="card error-text">{error}</div>
        ) : !data || !data.hasAffiliate ? (
          <div className="card stack" style={{ gap: 12, maxWidth: 600 }}>
            <h3 style={{ marginBottom: 0 }}>Become an affiliate</h3>
            <p className="muted small">
              Earn 30–40% monthly commission on every paid subscriber you refer. Recurring, no cap,
              no expiry. One click to join — we'll generate your referral link instantly.
            </p>
            <button className="btn btn-primary" onClick={handleJoin} disabled={joining} style={{ alignSelf: 'flex-start' }}>
              {joining ? 'Joining…' : 'Join the affiliate program'}
            </button>
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="label">Your referral link</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <input
                  className="input mono"
                  value={data.referralLink}
                  readOnly
                  style={{ flex: 1, minWidth: 280 }}
                />
                <button className="btn" onClick={handleCopy}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className="muted small mono" style={{ marginTop: 8 }}>
                Code: {data.code}
              </div>
            </div>

            <div className="kpi-grid">
              <div className="kpi">
                <div className="label">Active referrals</div>
                <div className="value">{data.activeReferrals}</div>
              </div>
              <div className="kpi">
                <div className="label">Pending payout</div>
                <div className="value">{fmtMoney(data.pendingPayout)}</div>
              </div>
              <div className="kpi">
                <div className="label">Lifetime paid</div>
                <div className="value">{fmtMoney(data.lifetimePayout)}</div>
              </div>
              <div className="kpi">
                <div className="label">Total referrals</div>
                <div className="value">{data.totalReferrals}</div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <h3>Last 6 months</h3>
              {data.monthlyEarnings && data.monthlyEarnings.length > 0 ? (
                <div style={{ width: '100%', height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={data.monthlyEarnings}>
                      <CartesianGrid stroke="#2a2a38" strokeDasharray="3 3" />
                      <XAxis dataKey="month" stroke="#888899" fontSize={11} />
                      <YAxis stroke="#888899" fontSize={11} />
                      <Tooltip
                        contentStyle={{ background: '#111118', border: '1px solid #2a2a38', borderRadius: 8 }}
                        labelStyle={{ color: '#e8e8f0' }}
                        formatter={(v) => fmtMoney(v)}
                      />
                      <Bar dataKey="amount" fill="#6ee7b7" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="muted small">No earnings yet.</div>
              )}
            </div>

            <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px 8px' }}>
                <h3 style={{ marginBottom: 4 }}>Recent referrals</h3>
                <div className="muted small">Last 20 sign-ups via your link</div>
              </div>
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Monthly</th>
                    <th>Last paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="muted">
                        No referrals yet — share your link to get started.
                      </td>
                    </tr>
                  ) : (
                    data.recent.map((r) => (
                      <tr key={r.id}>
                        <td>{fmtDate(r.createdAt)}</td>
                        <td>{r.plan}</td>
                        <td>{statusBadge(r.status)}</td>
                        <td>{fmtMoney(r.monthlyCommission)}</td>
                        <td>{fmtDate(r.lastPaidAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <h3>Request a payout</h3>
              <p className="muted small" style={{ marginTop: -4 }}>
                Minimum {fmtMoney(data.payoutThreshold || 20)} pending. Current pending:{' '}
                <span className="mono">{fmtMoney(data.pendingPayout)}</span>.
              </p>
              <form onSubmit={handlePayout} className="stack" style={{ marginTop: 12 }}>
                <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <label className="label">Method</label>
                    <select
                      className="input"
                      value={payoutMethod}
                      onChange={(e) => setPayoutMethod(e.target.value)}
                      style={{ minWidth: 160 }}
                    >
                      <option value="paypal">PayPal</option>
                      <option value="crypto">Crypto (USDT/USDC)</option>
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <label className="label">
                      {payoutMethod === 'paypal' ? 'PayPal email' : 'Crypto address'}
                    </label>
                    <input
                      className="input"
                      type={payoutMethod === 'paypal' ? 'email' : 'text'}
                      value={payoutDest}
                      onChange={(e) => setPayoutDest(e.target.value)}
                      placeholder={payoutMethod === 'paypal' ? 'you@example.com' : '0x… or USDT TRC20 address'}
                    />
                  </div>
                </div>
                <button className="btn btn-primary" type="submit" disabled={!canRequestPayout || payoutBusy} style={{ alignSelf: 'flex-start' }}>
                  {payoutBusy ? 'Submitting…' : 'Request payout'}
                </button>
                {!canRequestPayout && (
                  <div className="muted small">
                    Threshold not reached — keep referring.
                  </div>
                )}
                {payoutMsg.text && (
                  <div className={payoutMsg.type === 'success' ? 'success-text' : 'error-text'}>
                    {payoutMsg.text}
                  </div>
                )}
              </form>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px 8px' }}>
                <h3 style={{ marginBottom: 4 }}>Payout history</h3>
              </div>
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Destination</th>
                    <th>Status</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="muted">
                        No payouts requested yet.
                      </td>
                    </tr>
                  ) : (
                    data.payouts.map((p) => (
                      <tr key={p.id}>
                        <td>{fmtDate(p.requestedAt)}</td>
                        <td>{fmtMoney(p.amount)}</td>
                        <td>{p.method || '—'}</td>
                        <td className="mono">{p.destination || '—'}</td>
                        <td>
                          {p.status === 'PAID' ? (
                            <span className="badge green mono">PAID</span>
                          ) : (
                            <span className="badge yellow mono">PENDING</span>
                          )}
                        </td>
                        <td>{fmtDate(p.paidAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
