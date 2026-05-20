import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import Loading from '../components/Loading.jsx';
import { admin as adminApi } from '../api/client.js';

// Admin Panel — three tabs: STATS, USERS, PREDICTIONS.
// Mounted at /admin-panel and gated by <AdminOnly> in App.jsx.

const TABS = [
  { key: 'stats', label: 'Stats' },
  { key: 'users', label: 'Users' },
  { key: 'predictions', label: 'Predictions' },
];

const TIER_BADGE = {
  FREE: 'badge badge-soft',
  ANALYST: 'badge badge-mint',
  EDGE: 'badge badge-indigo',
};

function formatDateLong(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
  } catch {
    return String(iso);
  }
}

function KpiTile({ label, value, sub, highlight }) {
  return (
    <div
      className="card"
      style={{
        padding: 20,
        borderColor: highlight ? 'rgba(110,231,183,0.3)' : 'var(--border)',
        background: highlight
          ? 'linear-gradient(180deg, rgba(110,231,183,0.04), transparent), var(--card)'
          : 'var(--card)',
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: 10 }}
      >
        {label}
      </div>
      <div
        className="display"
        style={{
          fontSize: 38,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: highlight ? 'var(--mint)' : 'var(--text)',
        }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, minHeight: 14 }}
      >
        {sub || ''}
      </div>
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .stats()
      .then((r) => {
        if (!cancelled) setStats(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load stats');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loading label="Loading stats…" />;
  if (error) {
    return (
      <div className="empty-state">
        <h3>Couldn't load stats</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!stats) return null;

  const byTier = stats.byTier || {};
  return (
    <>
      <div
        className="history-kpi-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}
      >
        <KpiTile label="TOTAL USERS" value={stats.totalUsers ?? 0} highlight />
        <KpiTile label="FREE USERS" value={byTier.FREE ?? 0} />
        <KpiTile label="ANALYST USERS" value={byTier.ANALYST ?? 0} />
        <KpiTile label="NEW USERS TODAY" value={stats.newUsersToday ?? 0} />
        <KpiTile label="PREDICTIONS TODAY" value={stats.predictionsToday ?? 0} />
      </div>
      <div
        className="card"
        style={{
          padding: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em' }}
        >
          TOTAL PREDICTIONS ALL TIME
        </div>
        <div className="display" style={{ fontSize: 24, fontWeight: 700 }}>
          {stats.predictionsAllTime ?? 0}
        </div>
      </div>
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          EDGE USERS
        </div>
        <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>
          {byTier.EDGE ?? 0}
        </div>
      </div>
    </>
  );
}

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState({});

  useEffect(() => {
    let cancelled = false;
    adminApi
      .users()
      .then((r) => {
        if (!cancelled) setUsers(r.users || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load users');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => String(u.email || '').toLowerCase().includes(q));
  }, [users, search]);

  const onTierChange = async (userId, tier) => {
    setUpdating((m) => ({ ...m, [userId]: true }));
    // Optimistic — flip the row immediately, roll back on failure.
    const prev = users;
    setUsers((list) => list.map((u) => (u.id === userId ? { ...u, tier } : u)));
    try {
      await adminApi.setTier(userId, tier);
    } catch (err) {
      console.error('tier change failed:', err);
      setUsers(prev);
      alert(err?.response?.data?.error || 'Failed to change tier');
    } finally {
      setUpdating((m) => {
        const copy = { ...m };
        delete copy[userId];
        return copy;
      });
    }
  };

  if (loading) return <Loading label="Loading users…" />;
  if (error) {
    return (
      <div className="empty-state">
        <h3>Couldn't load users</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by email…"
          style={{
            flex: 1,
            minWidth: 240,
            padding: '8px 12px',
            background: 'var(--bg-2)',
            border: '1px solid var(--border-soft)',
            borderRadius: 8,
            color: 'var(--text)',
            fontSize: 13,
          }}
        />
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {filtered.length} ROW{filtered.length === 1 ? '' : 'S'}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Tier</th>
              <th>Joined</th>
              <th>Predictions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="5" className="muted">No users match this filter.</td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {u.isAdmin && (
                      <span
                        className="badge badge-mint"
                        style={{ fontSize: 9, padding: '2px 6px', marginLeft: 8 }}
                      >
                        ADMIN
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={TIER_BADGE[u.tier] || 'badge badge-soft'} style={{ fontSize: 10 }}>
                      {u.tier || '—'}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {formatDateLong(u.createdAt)}
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>—</td>
                  <td>
                    <select
                      value={u.tier || 'FREE'}
                      disabled={!!updating[u.id]}
                      onChange={(e) => onTierChange(u.id, e.target.value)}
                      style={{
                        background: 'var(--bg-2)',
                        color: 'var(--text)',
                        border: '1px solid var(--border-soft)',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 12,
                      }}
                      aria-label={`Change tier for ${u.email}`}
                    >
                      <option value="FREE">FREE</option>
                      <option value="ANALYST">ANALYST</option>
                      <option value="EDGE">EDGE</option>
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PRED_WINDOWS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'all', label: 'All' },
];

function isWithin(rangeKey, iso) {
  if (rangeKey === 'all') return true;
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  if (rangeKey === 'today') {
    return (
      d.getUTCFullYear() === now.getUTCFullYear() &&
      d.getUTCMonth() === now.getUTCMonth() &&
      d.getUTCDate() === now.getUTCDate()
    );
  }
  if (rangeKey === 'week') {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return now.getTime() - d.getTime() <= weekMs;
  }
  return true;
}

function HitIcon({ value }) {
  if (value === true) return <Icon name="check" size={12} color="var(--mint)" />;
  if (value === false) return <Icon name="x" size={11} color="var(--red)" />;
  return <span style={{ color: 'var(--text-faint)' }}>⏳</span>;
}

function PredictionsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [windowKey, setWindowKey] = useState('today');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .predictions()
      .then((r) => {
        if (!cancelled) setRows(r.predictions || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load predictions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => isWithin(windowKey, r.createdAt))
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [rows, windowKey],
  );

  if (loading) return <Loading label="Loading predictions…" />;
  if (error) {
    return (
      <div className="empty-state">
        <h3>Couldn't load predictions</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'var(--bg-2)',
            borderRadius: 10,
            border: '1px solid var(--border-soft)',
          }}
        >
          {PRED_WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              style={{
                padding: '6px 12px',
                border: 'none',
                background: windowKey === w.key ? 'var(--card-2)' : 'transparent',
                color: windowKey === w.key ? 'var(--text)' : 'var(--text-3)',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 6,
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>
          {filtered.length} ROW{filtered.length === 1 ? '' : 'S'}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>Match</th>
              <th>Over</th>
              <th>Conf</th>
              <th>Over hit</th>
              <th>BTTS</th>
              <th>Conf</th>
              <th>BTTS hit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="9" className="muted">No predictions in this window.</td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr key={`${r.createdAt}-${i}`}>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.userEmail || '—'}</td>
                  <td>{r.homeTeam} vs {r.awayTeam}</td>
                  <td>O {r.overLine ?? '—'}</td>
                  <td className="mono">{r.overConfidence != null ? `${r.overConfidence}%` : '—'}</td>
                  <td><HitIcon value={r.overHit} /></td>
                  <td>{r.btts || '—'}</td>
                  <td className="mono">{r.bttsConfidence != null ? `${r.bttsConfidence}%` : '—'}</td>
                  <td><HitIcon value={r.bttsHit} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const [tab, setTab] = useState('stats');

  return (
    <Layout>
      {() => (
        <div>
          <div style={{ marginBottom: 24 }}>
            <h1
              className="display"
              style={{ fontSize: 36, fontWeight: 700, margin: 0, letterSpacing: '-0.025em' }}
            >
              Admin Panel
            </h1>
            <p
              className="mono"
              style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 12, letterSpacing: '0.04em' }}
            >
              FOUNDER TOOLS · USERS · STATS · PREDICTIONS
            </p>
          </div>
          <div
            style={{
              display: 'inline-flex',
              gap: 4,
              padding: 4,
              background: 'var(--card)',
              borderRadius: 10,
              border: '1px solid var(--border-soft)',
              marginBottom: 16,
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  background: tab === t.key ? 'var(--card-2)' : 'transparent',
                  color: tab === t.key ? 'var(--text)' : 'var(--text-3)',
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'stats' && <StatsTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'predictions' && <PredictionsTab />}
        </div>
      )}
    </Layout>
  );
}
