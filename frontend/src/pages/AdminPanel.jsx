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
  const [rescanState, setRescanState] = useState({ busy: false, message: '' });
  // Two pieces of state for the new admin tools. Kept inline with the
  // stats tab so they sit next to "Force Rescan" — same mental model.
  const [clearState, setClearState] = useState({ busy: false, message: '' });
  const [debugId, setDebugId] = useState('');
  const [debugState, setDebugState] = useState({ busy: false, message: '', result: null });

  const loadStats = (cancelledRef) => {
    setLoading(true);
    adminApi
      .stats()
      .then((r) => {
        if (cancelledRef && cancelledRef.cancelled) return;
        setStats(r);
      })
      .catch((err) => {
        if (cancelledRef && cancelledRef.cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load stats');
      })
      .finally(() => {
        if (cancelledRef && cancelledRef.cancelled) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    const cancelledRef = { cancelled: false };
    loadStats(cancelledRef);
    return () => {
      cancelledRef.cancelled = true;
    };
  }, []);

  const onForceRescan = async () => {
    if (rescanState.busy) return;
    setRescanState({ busy: true, message: '' });
    try {
      await adminApi.forceRescan(253);
      setRescanState({ busy: true, message: 'Rescan triggered. Predictions will populate over the next few minutes.' });
      // Refresh stats after the scan has had time to finish.
      setTimeout(() => {
        loadStats({ cancelled: false });
        setRescanState({ busy: false, message: 'Stats refreshed.' });
        setTimeout(() => setRescanState((s) => ({ ...s, message: '' })), 4000);
      }, 30000);
    } catch (err) {
      setRescanState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Rescan failed',
      });
    }
  };

  // Wipe ALL prediction tables and trigger a fresh scan with the new
  // pipeline. Confirms first — this is destructive across 10 tables.
  const onClearAll = async () => {
    if (clearState.busy) return;
    if (!window.confirm(
      'Wipe ALL predictions, accuracy model, best-bet, agent alerts, odds snapshots and bankroll-entry links, then trigger a fresh scan?\n\nThis cannot be undone.',
    )) return;
    setClearState({ busy: true, message: 'Wiping tables & triggering rescan…' });
    try {
      const r = await adminApi.clearAll();
      setClearState({
        busy: false,
        message: `Wiped ${r.totalDeleted ?? 0} rows across ${(r.results || []).length} tables. Scan ${r.scanTriggered ? 'triggered' : 'NOT triggered'} — refresh dashboard in ~1 min.`,
      });
      setTimeout(() => loadStats({ cancelled: false }), 5000);
    } catch (err) {
      setClearState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Clear failed',
      });
    }
  };

  // Inspect a single fixture's raw data. Opens nothing — we render the
  // result inline as JSON so the admin can scan it and confirm the
  // form/stats/standings match what the dashboard shows.
  const onDebug = async () => {
    if (debugState.busy) return;
    const id = parseInt(String(debugId).trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      setDebugState({ busy: false, message: 'Enter a numeric fixture id', result: null });
      return;
    }
    setDebugState({ busy: true, message: 'Fetching raw fixture data…', result: null });
    try {
      const r = await adminApi.debugFixture(id);
      setDebugState({ busy: false, message: '', result: r });
    } catch (err) {
      setDebugState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Debug failed',
        result: null,
      });
    }
  };

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
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
            WEEKLY SCAN
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Wipe this week's MLS predictions and trigger a fresh background scan.
          </div>
          {rescanState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: rescanState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {rescanState.message}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onForceRescan}
          disabled={rescanState.busy}
        >
          {rescanState.busy ? 'Rescanning…' : 'Force Rescan'}
        </button>
      </div>

      {/* Destructive: wipe every prediction-related table + trigger scan.
          Lives next to "Force Rescan" but does much more — wipes 10
          tables (predictions, accuracy_model, best_bet, agent_alerts,
          odds snapshots, etc.) before kicking the background scanner. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          borderColor: 'rgba(239,68,68,0.3)',
        }}
      >
        <div>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}
          >
            CLEAR ALL & RESCAN
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Wipe every prediction-related table (10 tables) and force a fresh scan with the latest pipeline. Use after a model or prompt change.
          </div>
          {clearState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: clearState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {clearState.message}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClearAll}
          disabled={clearState.busy}
          style={{ borderColor: 'rgba(239,68,68,0.4)' }}
        >
          {clearState.busy ? 'Wiping…' : 'Clear All & Rescan'}
        </button>
      </div>

      {/* Per-fixture inspector. Paste a fixtureId, see exactly what the
          scan would fetch + send to Claude. Renders the JSON inline so
          you can verify form/standings/refs before trusting a card. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}
        >
          DEBUG FIXTURE
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Inspect the raw API-Football data and the extracted form / stats / standings / referee for a single fixture id.
        </div>
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <input
            className="input"
            type="text"
            inputMode="numeric"
            placeholder="Fixture id (e.g. 1318755)"
            value={debugId}
            onChange={(e) => setDebugId(e.target.value)}
            style={{ flex: '1 1 220px', minHeight: 36 }}
            disabled={debugState.busy}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDebug}
            disabled={debugState.busy}
          >
            {debugState.busy ? 'Fetching…' : 'Debug'}
          </button>
        </div>
        {debugState.message && (
          <div
            className="mono"
            style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}
          >
            {debugState.message}
          </div>
        )}
        {debugState.result && (
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              background: 'var(--bg-2)',
              border: '1px solid var(--border-soft)',
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.5,
              maxHeight: 480,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {JSON.stringify(debugState.result, null, 2)}
          </pre>
        )}
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
