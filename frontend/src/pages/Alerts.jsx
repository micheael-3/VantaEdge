import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import agentApi from '../api/agent';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'SHARP_MOVE', label: 'Sharp Moves' },
  { id: 'VALUE_APPEARED', label: 'Value Bets' },
  { id: 'RESULT_SETTLED', label: 'Results' },
  { id: 'BEST_BET_SELECTED', label: 'Best Bets' },
];

const ICONS = {
  SHARP_MOVE: '⚡',
  VALUE_APPEARED: '🟢',
  RESULT_SETTLED: '✓',
  BEST_BET_SELECTED: '⭐',
  ACCURACY_UPDATE: '📈',
  LINE_CHANGE: '📊',
  VALUE_DISAPPEARED: '⚪',
};

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function Alerts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await agentApi.alerts();
      setData(d);
    } catch (err) {
      setError((err.response && err.response.data && err.response.data.error) || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markAllRead = async () => {
    try {
      await agentApi.markAllRead();
      load();
    } catch { /* ignore */ }
  };

  const filtered = useMemo(() => {
    if (!data || !data.alerts) return [];
    if (filter === 'all') return data.alerts;
    return data.alerts.filter((a) => a.type === filter);
  }, [data, filter]);

  return (
    <>
      <Navbar />
      <div className="container has-bottom-nav" style={{ paddingTop: 20 }}>
        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Alerts</h2>
            <p className="muted small" style={{ marginBottom: 0 }}>
              {data ? `${data.unread || 0} unread of ${data.alerts.length} total` : 'Loading…'}
            </p>
          </div>
          <button className="btn" onClick={markAllRead} disabled={!data || data.unread === 0}>
            Mark all read
          </button>
        </div>

        <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '20px 0' }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`tab ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="card">Loading…</div>
        ) : error ? (
          <div className="card error-text">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="card muted">No alerts in this filter yet.</div>
        ) : (
          <div className="stack">
            {filtered.map((a) => (
              <div
                key={a.alertId || a.userAlertId}
                className="card"
                style={{
                  borderLeft: a.read ? '1px solid var(--border)' : '3px solid var(--accent)',
                  padding: '14px 16px',
                }}
              >
                <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <span style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>
                    {ICONS[a.type] || '•'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.5 }}>{a.message}</div>
                    <div
                      className="mono small"
                      style={{ color: 'var(--text2)', marginTop: 4, letterSpacing: '0.04em' }}
                    >
                      {a.league ? `${a.league} · ` : ''}
                      {a.type.replace(/_/g, ' ').toLowerCase()} · {timeAgo(a.createdAt)}
                      {a.severity === 'HIGH' && (
                        <span style={{ marginLeft: 8, color: 'var(--yellow)' }}>· HIGH</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
