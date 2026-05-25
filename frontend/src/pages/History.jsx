import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import LockedOverlay from '../components/LockedOverlay.jsx';
import Loading from '../components/Loading.jsx';
import AdUnit from '../components/AdUnit.jsx';
import { isAdmin, isSharp, useAuth } from '../context/AuthContext.jsx';
import { history as historyApi, admin as adminApi } from '../api/client.js';

// Accuracy History — kept intentionally simple for the casual rebuild.
// Four KPI tiles, the rolling-accuracy line, and a recent settled
// predictions table. The per-bucket Model Calibration chart was removed:
// the backend still computes calibration and silently adjusts the
// confidence shown on the dashboard, but we don't surface the chart UI.

// 'Today' was removed — it's UTC-anchored, which means matches kicking
// off after midnight UTC (most US evening MLS games) fell out of the
// window and showed an empty page. 7D is the new canonical default;
// covers today + the last 6 calendar days regardless of timezone.
const WINDOWS = [
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
  const admin = isAdmin(user);
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleMsg, setSettleMsg] = useState('');
  // Default to 'week' so the headline numbers match what Results shows
  // (Results explicitly uses week). Avoids the dissonance of "Results
  // says 30 settled, Accuracy says 2" when both read the same endpoint
  // with different time windows.
  const [windowKey, setWindowKey] = useState('week');

  // One-click settle for admins — pushes today's finished matches into
  // hit columns immediately so the page rerenders with fresh data.
  // Same engine as the 2-hour cron + the admin panel button.
  const onSettleNow = async () => {
    if (settleBusy) return;
    setSettleBusy(true);
    setSettleMsg('Settling…');
    try {
      const r = await adminApi.settleNow();
      const rep = (r && r.report) || {};
      setSettleMsg(
        `Settled ${rep.predictionsUpdated ?? 0} predictions across ${rep.fixturesSettled ?? 0} fixtures. Reloading…`,
      );
      // Trigger a refetch via windowKey re-set (React noticed the
      // shallow same value is OK; force a Date.now() tick instead).
      historyApi
        .get(windowKey)
        .then((res) => {
          setData(res);
          setSettleBusy(false);
          setTimeout(() => setSettleMsg(''), 4000);
        })
        .catch(() => setSettleBusy(false));
    } catch (err) {
      setSettleBusy(false);
      setSettleMsg(err?.response?.data?.error || err.message || 'Settle failed');
    }
  };
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
        if (cancelled) return;
        setData(res);
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
  // Settled-this-week count for the fourth tile.
  const weekSettled = summary.weekSettled != null ? summary.weekSettled : settled;
  const weekTotal = summary.weekTotal != null ? summary.weekTotal : settled + (summary.pendingRows || 0);

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
                Accuracy
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
              {/* Inline diagnostics — proves the data the backend
                  returned for this window. If "settled in window" here
                  doesn't match what Results shows, the bug is server-
                  side. If it DOES match but the page still looks
                  wrong, the bug is render-side. Either way: visible. */}
              {data && data._debug && (
                <div
                  className="mono"
                  style={{
                    marginBottom: 14,
                    padding: '10px 12px',
                    background: 'var(--card-2)',
                    border: '1px solid var(--border-soft)',
                    borderRadius: 8,
                    fontSize: 11,
                    color: 'var(--text-3)',
                    letterSpacing: '0.04em',
                    overflowX: 'auto',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <div>
                      window: <strong style={{ color: 'var(--text)' }}>{data._debug.window}</strong>
                      {' · '}rows: <strong style={{ color: 'var(--text)' }}>{data._debug.rawRowsInWindow}</strong>
                      {' · '}unique fixtures: <strong style={{ color: 'var(--text)' }}>{data._debug.uniqueByFixture}</strong>
                      {' · '}settled: <strong style={{ color: 'var(--mint)' }}>{data._debug.settledInWindow}</strong>
                      {' · '}pending: <strong style={{ color: 'var(--amber)' }}>{data._debug.pendingInWindow}</strong>
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.75 }}>
                      days: {(data._debug.distinctDays || []).join(', ') || '—'}
                    </div>
                    <div style={{ marginTop: 2, opacity: 0.75 }}>
                      leagues: {(data._debug.distinctLeagues || []).join(', ') || '—'}
                      {' · '}fetched: {new Date(data._debug.fetchedAt).toLocaleTimeString()}
                    </div>
                  </div>
                  {/* Admin-only Settle Now — fires the same engine as
                      the 2-hour cron + the admin panel button. Lets us
                      verify accuracy data without leaving the page. */}
                  {admin && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={onSettleNow}
                        disabled={settleBusy}
                        style={{ fontSize: 11, padding: '6px 12px', minHeight: 32 }}
                      >
                        {settleBusy ? 'Settling…' : 'Settle Now'}
                      </button>
                      {settleMsg && (
                        <span style={{ fontSize: 10, color: 'var(--mint)' }}>{settleMsg}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                    label="HIT RATE"
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
                    label="THIS WEEK"
                    value={`${weekSettled}/${weekTotal}`}
                    sub="settled / total"
                  />
                </div>
                {!sharp && (
                  <LockedOverlay
                    onClick={openUpgrade}
                    label="Full history is PRO-only"
                    radius={12}
                  />
                )}
              </div>

              {/* AdSense — after the 4 stat cards, before Rolling Accuracy.
                  PRO users see nothing; the component returns null. */}
              <AdUnit slot="2222222222" />

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
                    label="Unlock with PRO"
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
                    Recent predictions
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
                  <table className="tbl" style={{ minWidth: 460 }}>
                    <thead>
                      <tr>
                        <th>Match</th>
                        <th>Over / Under</th>
                        <th>BTTS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.length === 0 ? (
                        <tr>
                          <td colSpan="3" className="muted">
                            No settled rows in this window.
                          </td>
                        </tr>
                      ) : (
                        recent.map((r) => {
                          // Two-column layout: Over/Under prediction + result
                          // on the left, BTTS prediction + result on the
                          // right. Each cell shows both the pick (line +
                          // confidence) and a hit/miss glyph so the user
                          // sees every prediction we made, not just the
                          // higher-confidence side.
                          const oc = r.overConfidence;
                          const bc = r.bttsConfidence;
                          const renderCell = (pickText, hit, hasPick) => {
                            if (!hasPick) return <span className="muted">—</span>;
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span>{pickText}</span>
                                {hit === true && (
                                  <Icon name="check" size={13} color="var(--mint)" />
                                )}
                                {hit === false && (
                                  <Icon name="x" size={12} color="var(--red)" />
                                )}
                                {hit == null && (
                                  <span className="muted" style={{ fontSize: 11 }}>pending</span>
                                )}
                              </span>
                            );
                          };
                          return (
                            <tr key={r.id}>
                              <td>{r.match}</td>
                              <td>
                                {renderCell(
                                  `OVER ${r.overLine ?? 2.5} · ${oc ?? '—'}%`,
                                  r.overHit,
                                  oc != null && Number(oc) > 0,
                                )}
                              </td>
                              <td>
                                {renderCell(
                                  `BTTS ${r.btts || 'YES'} · ${bc ?? '—'}%`,
                                  r.bttsHit,
                                  bc != null && Number(bc) > 0,
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {!sharp && (
                  <LockedOverlay
                    onClick={openUpgrade}
                    label="Recent picks are PRO-only"
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
