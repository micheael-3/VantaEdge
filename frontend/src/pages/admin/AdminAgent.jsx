import { useEffect, useState } from 'react';

const TOKEN_KEY = 'vantaedge_admin_token';

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${window.localStorage.getItem(TOKEN_KEY) || ''}`,
  };
}

async function adminGet(path) {
  const res = await fetch(`${import.meta.env.VITE_API_URL || ''}${path}`, { headers: authHeaders() });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function adminPost(path, body) {
  const res = await fetch(`${import.meta.env.VITE_API_URL || ''}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function fmt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
}

const TRIGGERS = [
  ['agent-scanner', 'Scanner', 'Round-robin scan of 3 leagues per run'],
  ['agent-odds-monitor', 'Odds monitor', '10-min sharp-move loop on today\'s matches'],
  ['agent-results', 'Results', 'Settle finished predictions + bankroll cascade'],
  ['agent-accuracy', 'Accuracy rebuild', 'Recompute the accuracy_model from scratch'],
  ['agent-alerts', 'Alerts fanout', 'Process unprocessed alerts → user inboxes + email'],
  ['agent-best-bet', 'Best bet', 'Pick and email today\'s top scorer'],
];

export default function AdminAgent() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyName, setBusyName] = useState(null);
  const [triggerResult, setTriggerResult] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await adminGet('/api/admin/agent');
      setData(d);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const trigger = async (name) => {
    setBusyName(name);
    setTriggerResult(null);
    try {
      const r = await adminPost('/api/admin/agent/trigger', { name });
      setTriggerResult({ name, report: r.response });
      await load();
    } catch (err) {
      setTriggerResult({ name, error: err.message });
    } finally {
      setBusyName(null);
    }
  };

  if (loading) return <div className="card">Loading…</div>;
  if (error) return <div className="card error-text">{error}</div>;
  if (!data) return <div className="card">No data.</div>;

  const status = data.status || {};
  const reports = data.reports || {};

  return (
    <>
      <h2 style={{ marginBottom: 20 }}>Agent</h2>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Status</div>
          <div className="value" style={{
            color: status.status === 'ACTIVE' ? 'var(--accent)' : status.status === 'LATE' ? 'var(--yellow)' : 'var(--text2)'
          }}>
            {status.status || '—'}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            last scan {fmt(status.lastScannerRun)}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Matches monitored (24h)</div>
          <div className="value">{status.matchesMonitored || 0}</div>
        </div>
        <div className="kpi">
          <div className="label">Alerts (24h)</div>
          <div className="value">{status.alertsToday || 0}</div>
        </div>
        <div className="kpi">
          <div className="label">Sharp moves (24h)</div>
          <div className="value">{data.sharp ? data.sharp.length : 0}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Manual triggers</h3>
        <p className="muted small">Useful for testing without waiting for the cron schedule. Triggers auth with your admin password.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 }}>
          {TRIGGERS.map(([name, label, hint]) => (
            <div key={name} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontFamily: 'Syne, sans-serif', fontSize: 14 }}>{label}</strong>
                <span className="mono small" style={{ color: 'var(--text2)' }}>{name}</span>
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>{hint}</div>
              <button
                className="btn btn-sm"
                style={{ marginTop: 12, width: '100%' }}
                onClick={() => trigger(name)}
                disabled={busyName !== null}
              >
                {busyName === name ? 'Running…' : 'Run now'}
              </button>
            </div>
          ))}
        </div>
        {triggerResult && (
          <div className="card" style={{ marginTop: 14, background: 'var(--bg3)' }}>
            <strong className="mono small">{triggerResult.name}</strong>
            {triggerResult.error ? (
              <div className="error-text small">{triggerResult.error}</div>
            ) : (
              <pre style={{ overflow: 'auto', fontSize: 11, margin: '8px 0 0', maxHeight: 240 }}>
                {JSON.stringify(triggerResult.report, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Last run reports</h3>
        <table className="history-table">
          <thead>
            <tr>
              <th>Function</th>
              <th>Last run</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(reports).map(([k, v]) => (
              <tr key={k}>
                <td className="mono">{k}</td>
                <td>{v && v.at ? fmt(v.at) : '—'}</td>
                <td className="mono small" style={{ color: 'var(--text2)' }}>
                  {v ? Object.entries(v).filter(([key]) => key !== 'at' && key !== 'examples').slice(0, 4).map(([k2, v2]) => `${k2}=${typeof v2 === 'object' ? '…' : v2}`).join('  ') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 8px' }}>
          <h3 style={{ marginBottom: 4 }}>Sharp moves (24h)</h3>
        </div>
        <table className="history-table">
          <thead>
            <tr>
              <th>When</th>
              <th>League</th>
              <th>Match</th>
              <th>Market</th>
              <th>Movement</th>
              <th>Bookmaker</th>
            </tr>
          </thead>
          <tbody>
            {(data.sharp || []).length === 0 ? (
              <tr><td colSpan="6" className="muted">No sharp moves detected in the last 24h.</td></tr>
            ) : (
              data.sharp.map((s, i) => (
                <tr key={i}>
                  <td>{fmt(s.detected_at)}</td>
                  <td>{s.league}</td>
                  <td>{s.home_team} vs {s.away_team}</td>
                  <td>{s.market} {s.line || ''}</td>
                  <td className="mono" style={{ color: 'var(--yellow)' }}>{Number(s.movement_pct).toFixed(1)}%</td>
                  <td>{s.bookmaker || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 8px' }}>
          <h3 style={{ marginBottom: 4 }}>Recent alerts</h3>
        </div>
        <table className="history-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Severity</th>
              <th>Message</th>
              <th>Processed</th>
            </tr>
          </thead>
          <tbody>
            {(data.recentAlerts || []).length === 0 ? (
              <tr><td colSpan="5" className="muted">No alerts yet.</td></tr>
            ) : (
              data.recentAlerts.map((a) => (
                <tr key={a.id}>
                  <td>{fmt(a.created_at)}</td>
                  <td className="mono small">{a.type}</td>
                  <td className="mono small">{a.severity}</td>
                  <td>{a.message}</td>
                  <td className="mono small">{a.processed ? '✓' : 'queued'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
