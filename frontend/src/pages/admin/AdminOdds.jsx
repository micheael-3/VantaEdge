import { useEffect, useState } from 'react';
import { admin as adminApi } from '../../api/admin';

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function AdminOdds() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Reuse the admin axios instance for the bearer header.
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/odds-quota`, {
          headers: {
            Authorization: `Bearer ${window.localStorage.getItem('vantaedge_admin_token') || ''}`,
          },
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || 'Failed');
        setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    void adminApi;
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="card">Loading…</div>;
  if (error) return <div className="card error-text">{error}</div>;
  if (!data) return <div className="card">No data.</div>;

  const q = data.quota || {};
  const total = (q.used || 0) + (q.remaining || 0);
  const pct = total > 0 ? Math.min(100, Math.round(((q.used || 0) / total) * 100)) : 0;
  const warn = q.remaining != null && q.remaining < 50;

  return (
    <>
      <h2 style={{ marginBottom: 20 }}>Odds API</h2>

      {!data.oddsConfigured && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--yellow)', color: 'var(--yellow)' }}>
          <strong>ODDS_API_KEY is not set.</strong> Auto-odds are disabled. Add the key in Netlify
          env vars and trigger a redeploy.
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Used this month</div>
          <div className="value">{q.used ?? '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">Remaining</div>
          <div className="value" style={warn ? { color: 'var(--red)' } : undefined}>
            {q.remaining ?? '—'}
          </div>
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
        <p className="muted small">
          <strong>Last fetched at:</strong> <span className="mono">{fmtTime(q.lastFetchedAt)}</span>
        </p>
        <p className="muted small">
          <strong>Last sport key:</strong> <span className="mono">{q.lastSportKey || '—'}</span>
        </p>
        <p className="muted small">
          <strong>Auto-disabled leagues:</strong>{' '}
          <span className="mono">{(q.disabledLeagues || []).length === 0 ? 'none' : (q.disabledLeagues || []).join(', ')}</span>
        </p>
      </div>

      <div className="card">
        <h3>Quota policy</h3>
        <ul className="muted small" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Each prediction fetch refreshes the cache per league after 5 minutes.</li>
          <li>Maximum 8 calls per full refresh (one per league).</li>
          <li>When remaining drops below 50, only MLS, Bundesliga, and Premier League keep fetching — others fall back to manual odds.</li>
          <li>When remaining hits zero, auto-odds are disabled until the monthly reset.</li>
        </ul>
      </div>
    </>
  );
}
