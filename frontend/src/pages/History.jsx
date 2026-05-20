import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import LockedOverlay from '../components/LockedOverlay.jsx';
import Loading from '../components/Loading.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { history as historyApi } from '../api/client.js';

const WINDOWS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7D' },
  { key: 'month', label: '30D' },
  { key: 'all', label: 'All' },
];

function StatCard({ label, value, sub, highlight }) {
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
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: '0.1em',
          marginBottom: 10,
        }}
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
        style={{
          fontSize: 11,
          color: 'var(--text-3)',
          marginTop: 8,
          minHeight: 14,
        }}
      >
        {sub || ''}
      </div>
    </div>
  );
}

function RollingChart({ rolling }) {
  const data = Array.isArray(rolling) ? rolling.filter((r) => r.accuracy != null) : [];
  if (data.length < 2) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        Not enough settled history to chart yet.
      </div>
    );
  }
  const W = 600;
  const H = 200;
  const pad = 28;
  const xs = data.map(
    (_, i) => pad + (i * (W - 2 * pad)) / Math.max(1, data.length - 1),
  );
  const ys = data.map((d) => {
    const acc = Math.max(0, Math.min(100, d.accuracy));
    return H - pad - (acc / 100) * (H - 2 * pad);
  });
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  return (
    <svg
      style={{ width: '100%', height: 200, display: 'block' }}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#6ee7b7" />
        </linearGradient>
      </defs>
      <line
        x1={pad}
        y1={H - pad}
        x2={W - pad}
        y2={H - pad}
        stroke="#1c1c26"
        strokeWidth="1"
      />
      <polyline
        fill="none"
        stroke="url(#lineGrad)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="2.5" fill="#6ee7b7" />
      ))}
    </svg>
  );
}

export default function History() {
  const { user } = useAuth();
  const sharp = isSharp(user);
  const [windowKey, setWindowKey] = useState('month');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    historyApi
      .get(windowKey)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          'Failed to load history';
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowKey]);

  const summary = (data && data.summary) || {};
  const settled = summary.settledMarkets || 0;
  const overallHits = (summary.overHits || 0) + (summary.bttsHits || 0);
  const overallPct = settled > 0 ? Math.round((overallHits / settled) * 1000) / 10 : 0;
  const overPct = summary.overPct != null
    ? summary.overPct
    : summary.overSettled
      ? Math.round((summary.overHits / summary.overSettled) * 1000) / 10
      : 0;
  const bttsPct = summary.bttsPct != null
    ? summary.bttsPct
    : summary.bttsSettled
      ? Math.round((summary.bttsHits / summary.bttsSettled) * 1000) / 10
      : 0;

  const recent = useMemo(() => (data && data.recent) || [], [data]);

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
                Accuracy History
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
                EVERY PREDICTION, EVERY RESULT — NO CHERRY-PICKING.
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 4,
                padding: 4,
                background: 'var(--card)',
                borderRadius: 10,
                border: '1px solid var(--border-soft)',
              }}
            >
              {WINDOWS.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  onClick={() => setWindowKey(w.key)}
                  style={{
                    padding: '6px 12px',
                    border: 'none',
                    background:
                      windowKey === w.key ? 'var(--card-2)' : 'transparent',
                    color:
                      windowKey === w.key ? 'var(--text)' : 'var(--text-3)',
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 6,
                    transition: 'all 0.12s',
                  }}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <Loading label="Loading history…" />
          ) : error ? (
            <div className="empty-state">
              <h3>Couldn't load history</h3>
              <p>{error}</p>
            </div>
          ) : (
            <>
              <div style={{ position: 'relative', marginBottom: 24 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 12,
                    filter: sharp ? 'none' : 'blur(6px)',
                  }}
                  className="history-kpi-grid"
                >
                  <StatCard
                    label="OVERALL HIT RATE"
                    value={`${overallPct}%`}
                    sub={`${overallHits} hits / ${settled} markets`}
                    highlight
                  />
                  <StatCard
                    label="OVER/UNDER"
                    value={`${overPct}%`}
                    sub={`${summary.overHits || 0} / ${summary.overSettled || 0} hits`}
                  />
                  <StatCard
                    label="BTTS"
                    value={`${bttsPct}%`}
                    sub={`${summary.bttsHits || 0} / ${summary.bttsSettled || 0} hits`}
                  />
                  <StatCard
                    label="PENDING"
                    value={summary.pendingRows || 0}
                    sub="rows awaiting settlement"
                  />
                </div>
                {!sharp && (
                  <LockedOverlay
                    onClick={openUpgrade}
                    label="Full history is SHARP-only"
                    radius={12}
                  />
                )}
              </div>

              <div
                className="card"
                style={{ padding: 24, marginBottom: 24, position: 'relative' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <h3
                    className="display"
                    style={{ margin: 0, fontSize: 18, fontWeight: 600 }}
                  >
                    Rolling Accuracy
                  </h3>
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text-3)' }}
                  >
                    HIT RATE OVER TIME
                  </span>
                </div>
                <div style={{ filter: sharp ? 'none' : 'blur(6px)' }}>
                  <RollingChart rolling={data?.rolling || []} />
                </div>
                {!sharp && (
                  <LockedOverlay
                    onClick={openUpgrade}
                    label="Unlock with SHARP"
                    radius={12}
                  />
                )}
              </div>

              <div
                className="card"
                style={{ padding: 24, position: 'relative' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 16,
                  }}
                >
                  <h3
                    className="display"
                    style={{ margin: 0, fontSize: 18, fontWeight: 600 }}
                  >
                    Recent settled predictions
                  </h3>
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text-3)' }}
                  >
                    {recent.length} ROWS
                  </span>
                </div>
                <div
                  style={{ filter: sharp ? 'none' : 'blur(6px)', overflowX: 'auto' }}
                >
                  <table className="tbl" style={{ minWidth: 540 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Match</th>
                        <th>Over</th>
                        <th>BTTS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="muted">
                            No settled rows in this window.
                          </td>
                        </tr>
                      ) : (
                        recent.map((r) => (
                          <tr key={r.id}>
                            <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                              {r.date}
                            </td>
                            <td>{r.match}</td>
                            <td>
                              {r.overLine != null ? `O ${r.overLine}` : '—'} ·{' '}
                              {r.overConfidence != null ? `${r.overConfidence}%` : '—'}{' '}
                              {r.overHit == null ? null : r.overHit ? (
                                <Icon name="check" size={12} color="var(--mint)" />
                              ) : (
                                <Icon name="x" size={11} color="var(--red)" />
                              )}
                            </td>
                            <td>
                              {r.btts || '—'} ·{' '}
                              {r.bttsConfidence != null ? `${r.bttsConfidence}%` : '—'}{' '}
                              {r.bttsHit == null ? null : r.bttsHit ? (
                                <Icon name="check" size={12} color="var(--mint)" />
                              ) : (
                                <Icon name="x" size={11} color="var(--red)" />
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {!sharp && (
                  <LockedOverlay
                    onClick={openUpgrade}
                    label="Recent picks are SHARP-only"
                    radius={12}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Layout>
  );
}
