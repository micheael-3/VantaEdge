import { useCallback, useEffect, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import Loading from '../components/Loading.jsx';
import { affiliate as affApi } from '../api/client.js';

export default function Affiliate() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  // Payout form state.
  const [method, setMethod] = useState('paypal');
  const [destination, setDestination] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await affApi.dashboard();
      setData(res);
    } catch (err) {
      const msg =
        (err.response && err.response.data && err.response.data.message) ||
        (err.response && err.response.data && err.response.data.error) ||
        'Failed to load affiliate dashboard';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onJoin = async () => {
    setBusy(true);
    setActionMsg(null);
    try {
      await affApi.join();
      await load();
    } catch (err) {
      const msg =
        (err.response && err.response.data && err.response.data.message) ||
        (err.response && err.response.data && err.response.data.error) ||
        'Could not enroll';
      setActionMsg({ ok: false, text: msg });
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!data || !data.referralLink) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const onPayout = async (e) => {
    e.preventDefault();
    if (!destination.trim()) {
      setActionMsg({ ok: false, text: 'Enter your payout destination.' });
      return;
    }
    setBusy(true);
    setActionMsg(null);
    try {
      await affApi.requestPayout(method, destination.trim());
      setActionMsg({ ok: true, text: 'Payout requested. We’ll review and process it.' });
      setDestination('');
      await load();
    } catch (err) {
      const msg =
        (err.response && err.response.data && err.response.data.message) ||
        (err.response && err.response.data && err.response.data.error) ||
        'Payout request failed';
      setActionMsg({ ok: false, text: msg });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="page">
          <Loading label="Loading affiliate dashboard…" />
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Navbar />
        <main className="page">
          <div className="container">
            <div className="empty-state">
              <h3>Couldn’t load affiliate data</h3>
              <p>{error}</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  // Pre-enrollment state: backend returns { hasAffiliate: false }.
  if (data && data.hasAffiliate === false) {
    return (
      <>
        <Navbar />
        <main className="page">
          <div className="container">
            <div className="dash-header">
              <div>
                <h1>Affiliate</h1>
                <div className="date-label">Earn commission for every Sharp signup.</div>
              </div>
            </div>
            <div className="upgrade-card">
              <h3>Become an affiliate</h3>
              <p className="muted">
                Get a unique link, share FastScore, earn a cut on every paid signup.
              </p>
              <button type="button" className="btn btn-primary" onClick={onJoin} disabled={busy} style={{ marginTop: 10 }}>
                {busy ? 'Enrolling…' : 'Become an affiliate'}
              </button>
              {actionMsg && (
                <div className={actionMsg.ok ? 'success-text' : 'error-text'} style={{ marginTop: 10 }}>
                  {actionMsg.text}
                </div>
              )}
            </div>
          </div>
        </main>
      </>
    );
  }

  const pending = Number(data.pendingPayout || 0);
  const threshold = Number(data.payoutThreshold || 0);
  const canRequestPayout = pending >= threshold && threshold > 0;

  return (
    <>
      <Navbar />
      <main className="page">
        <div className="container">
          <div className="dash-header">
            <div>
              <h1>Affiliate</h1>
              <div className="date-label">Your referral code: <strong>{data.code}</strong></div>
            </div>
          </div>

          <section className="settings-section">
            <h2>Your referral link</h2>
            <div className="copy-row">
              <input type="text" readOnly value={data.referralLink || ''} />
              <button type="button" className="btn" onClick={onCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </section>

          <div className="kpi-grid">
            <div className="kpi-tile">
              <div className="kpi-label">Total referrals</div>
              <div className="kpi-value">{data.totalReferrals || 0}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-label">Active referrals</div>
              <div className="kpi-value">{data.activeReferrals || 0}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-label">Lifetime earnings</div>
              <div className="kpi-value">${Number(data.totalEarned || 0).toFixed(2)}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-label">Pending payout</div>
              <div className="kpi-value">${pending.toFixed(2)}</div>
              {threshold > 0 && (
                <div className="kpi-sub">Threshold ${threshold.toFixed(2)}</div>
              )}
            </div>
          </div>

          {canRequestPayout && (
            <section className="settings-section">
              <h2>Request payout</h2>
              <form onSubmit={onPayout} className="stack">
                <div className="field-row">
                  <div>
                    <label htmlFor="method">Method</label>
                    <select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                      <option value="paypal">PayPal</option>
                      <option value="crypto">Crypto</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="destination">
                      {method === 'paypal' ? 'PayPal email' : 'Wallet address'}
                    </label>
                    <input
                      id="destination"
                      type="text"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      required
                    />
                  </div>
                </div>
                {actionMsg && (
                  <div className={actionMsg.ok ? 'success-text' : 'error-text'}>{actionMsg.text}</div>
                )}
                <div>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'Requesting…' : `Request $${pending.toFixed(2)} payout`}
                  </button>
                </div>
              </form>
            </section>
          )}

          {!canRequestPayout && pending > 0 && (
            <section className="settings-section">
              <h2>Payout</h2>
              <p className="muted">
                You need ${threshold.toFixed(2)} pending to request a payout. Current balance: ${pending.toFixed(2)}.
              </p>
            </section>
          )}

          <section className="settings-section">
            <h2>Recent referrals</h2>
            <div className="table-wrap" style={{ border: 'none' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Monthly</th>
                    <th>Joined</th>
                    <th>Last paid</th>
                  </tr>
                </thead>
                <tbody>
                  {!data.recent || data.recent.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="muted">No referrals yet — share your link.</td>
                    </tr>
                  ) : (
                    data.recent.map((r) => (
                      <tr key={r.id}>
                        <td>{r.plan}</td>
                        <td>{r.status}</td>
                        <td>${Number(r.monthlyCommission || 0).toFixed(2)}</td>
                        <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
                        <td>{r.lastPaidAt ? new Date(r.lastPaidAt).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
