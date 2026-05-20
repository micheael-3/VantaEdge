import { useEffect, useState } from 'react';

// NOTE: localStorage key intentionally kept as 'vantaedge_' prefix for state
// migration — renaming would log out existing admin sessions on the rebrand.
const TOKEN_KEY = 'vantaedge_admin_token';

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${window.localStorage.getItem(TOKEN_KEY) || ''}`,
  };
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
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

export default function AdminOdds() {
  const [quota, setQuota] = useState(null);
  const [oddsConfigured, setOddsConfigured] = useState(true);
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState({}); // leagueId -> boolean

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [q, c] = await Promise.all([
        adminGet('/api/admin/odds-quota'),
        adminGet('/api/admin/odds-config'),
      ]);
      setQuota(q.quota || null);
      setOddsConfigured(q.oddsConfigured !== false);
      setLeagues(c.leagues || []);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (leagueId, enabled) => {
    setSaving((s) => ({ ...s, [leagueId]: true }));
    // Optimistic UI flip.
    setLeagues((rows) => rows.map((r) => (r.leagueId === leagueId ? { ...r, enabled } : r)));
    try {
      await adminPost('/api/admin/odds-config', { leagueId, enabled });
    } catch (err) {
      // Revert on failure.
      setLeagues((rows) => rows.map((r) => (r.leagueId === leagueId ? { ...r, enabled: !enabled } : r)));
      setError(err.message || 'Save failed');
    } finally {
      setSaving((s) => ({ ...s, [leagueId]: false }));
    }
  };

  if (loading) return <div className="card">Loading…</div>;

  const q = quota || {};
  const total = (q.used || 0) + (q.remaining || 0);
  const pct = total > 0 ? Math.min(100, Math.round(((q.used || 0) / total) * 100)) : 0;
  const warn = q.remaining != null && q.remaining < 50;

  return (
    <>
      <h2 style={{ marginBottom: 20 }}>Odds API</h2>

      {!oddsConfigured && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--yellow)', color: 'var(--yellow)' }}>
          <strong>ODDS_API_KEY is not set.</strong> Auto-odds are disabled. Add the key in Netlify
          env vars and trigger a redeploy.
        </div>
      )}

      {error && (
        <div className="card error-text" style={{ marginBottom: 20 }}>{error}</div>
      )}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Used this month</div>
          <div className="value">{q.used ?? '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">Remaining</div>
          <div className="value" style={warn ? { color: 'var(--red)' } : undefined}>{q.remaining ?? '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">% used</div>
          <div className="value">{total > 0 ? `${pct}%` : '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">Errors (warm)</div>
          <div className="value">{q.errors ?? 0}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Last activity</h3>
        <p className="muted small"><strong>Last fetched at:</strong> <span className="mono">{fmtTime(q.lastFetchedAt)}</span></p>
        <p className="muted small"><strong>Last sport key:</strong> <span className="mono">{q.lastSportKey || '—'}</span></p>
        <p className="muted small">
          <strong>Auto-disabled (quota):</strong>{' '}
          <span className="mono">{(q.disabledLeagues || []).length === 0 ? 'none' : (q.disabledLeagues || []).join(', ')}</span>
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 8px' }}>
          <h3 style={{ marginBottom: 4 }}>Per-league odds fetching</h3>
          <p className="muted small">
            Disable a league here to skip its API call entirely (saves quota). Quota-level auto-disable
            still applies on top of this. Changes take effect within 5 minutes (cache TTL).
          </p>
        </div>
        <table className="history-table">
          <thead>
            <tr>
              <th>League</th>
              <th>Sport key</th>
              <th style={{ textAlign: 'right' }}>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {leagues.length === 0 ? (
              <tr><td colSpan="3" className="muted">No leagues configured.</td></tr>
            ) : (
              leagues.map((l) => (
                <tr key={l.leagueId}>
                  <td>{l.name}</td>
                  <td className="mono small" style={{ color: 'var(--text2)' }}>{l.sportKey}</td>
                  <td style={{ textAlign: 'right' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!l.enabled}
                        onChange={(e) => toggle(l.leagueId, e.target.checked)}
                        disabled={!!saving[l.leagueId]}
                      />
                      <span className="mono small" style={{ color: l.enabled ? 'var(--accent)' : 'var(--text2)' }}>
                        {l.enabled ? 'ON' : 'OFF'}
                      </span>
                    </label>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Quota policy</h3>
        <ul className="muted small" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Each prediction fetch refreshes the cache per league after 5 minutes.</li>
          <li>Maximum 3 calls per full refresh (one per league) when all are enabled.</li>
          <li>When remaining drops below 50, only MLS keeps fetching — others auto-disable.</li>
          <li>When remaining hits zero, auto-odds are disabled until the monthly reset.</li>
        </ul>
      </div>
    </>
  );
}
