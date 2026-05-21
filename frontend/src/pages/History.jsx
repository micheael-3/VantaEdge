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

// Bar chart for a single market's calibration. Five buckets along x-axis,
// 0-100% along y. Each bar shows the actual settled hit rate. A dashed
// diagonal traces the model's claimed confidence (the bucket centre, 55%
// 65% 75% 85% 95%). Bars BELOW the diagonal = model overconfident;
// bars ABOVE = underconfident.
function CalibrationChart({ buckets, label }) {
  const W = 360;
  const H = 220;
  const padL = 32;
  const padR = 16;
  const padT = 18;
  const padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = buckets.length;
  const colW = plotW / n;
  const yFor = (pct) => padT + plotH * (1 - Math.max(0, Math.min(100, pct)) / 100);
  // Diagonal: connects (centre of first bucket col, expected[0])
  // to (centre of last bucket col, expected[last]).
  const diagPoints = buckets
    .map((b, i) => {
      const x = padL + colW * (i + 0.5);
      const y = yFor(b.expected);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text-3)',
          letterSpacing: '0.06em',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 220, display: 'block' }}
      >
        {/* Horizontal gridlines at 0/25/50/75/100% */}
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={padL}
              x2={W - padR}
              y1={yFor(g)}
              y2={yFor(g)}
              stroke="#1c1c26"
              strokeWidth="1"
            />
            <text
              x={padL - 6}
              y={yFor(g) + 3}
              textAnchor="end"
              fontFamily="monospace"
              fontSize="9"
              fill="#6b7280"
            >
              {g}
            </text>
          </g>
        ))}
        {/* Bars */}
        {buckets.map((b, i) => {
          const x = padL + colW * i + colW * 0.22;
          const w = colW * 0.56;
          const y = yFor(b.hitRate);
          const h = padT + plotH - y;
          const isUnder = b.hitRate < b.expected - 0.5;
          const fill = b.predicted === 0
            ? '#2a2a36'
            : isUnder
              ? 'rgba(239,68,68,0.6)'
              : 'rgba(110,231,183,0.65)';
          return (
            <g key={b.label}>
              <rect
                x={x}
                y={y}
                width={w}
                height={Math.max(0, h)}
                fill={fill}
                stroke={isUnder ? 'rgba(239,68,68,0.9)' : 'rgba(110,231,183,0.9)'}
                strokeWidth="1"
                rx="2"
              />
              <text
                x={padL + colW * (i + 0.5)}
                y={H - padB + 14}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize="10"
                fill="#9ca3af"
              >
                {b.label}
              </text>
              <text
                x={padL + colW * (i + 0.5)}
                y={H - padB + 26}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize="9"
                fill="#6b7280"
              >
                n={b.predicted}
              </text>
            </g>
          );
        })}
        {/* Diagonal reference: what the model claimed each bucket would hit at */}
        <polyline
          fill="none"
          stroke="#818cf8"
          strokeDasharray="4 3"
          strokeWidth="1.5"
          points={diagPoints}
        />
      </svg>
    </div>
  );
}

function CalibrationTable({ buckets, market }) {
  return (
    <table className="tbl" style={{ minWidth: 380, marginTop: 10 }}>
      <thead>
        <tr>
          <th>Bucket</th>
          <th>Predictions</th>
          <th>Hits</th>
          <th>Hit Rate</th>
          <th>Model Says</th>
          <th>Drift</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => {
          const drift = b.predicted === 0 ? null : b.hitRate - b.expected;
          let color = 'var(--text-3)';
          if (drift != null) {
            if (drift < -5) color = 'var(--red)';
            else if (drift > 5) color = 'var(--amber)';
            else color = 'var(--mint)';
          }
          return (
            <tr key={`${market}-${b.label}`}>
              <td className="mono">{b.label}</td>
              <td className="mono">{b.predicted}</td>
              <td className="mono">{b.hits}</td>
              <td className="mono">{b.predicted ? `${b.hitRate}%` : '—'}</td>
              <td className="mono" style={{ color: 'var(--text-3)' }}>
                {b.expected}%
              </td>
              <td className="mono" style={{ color }}>
                {drift == null
                  ? '—'
                  : `${drift > 0 ? '+' : ''}${drift.toFixed(1)}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function History() {
  const { user } = useAuth();
  const sharp = isSharp(user);
  const [windowKey, setWindowKey] = useState('month');
  const [data, setData] = useState(null);
  const [calibration, setCalibration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      historyApi.get(windowKey),
      historyApi.calibration().catch(() => null),
    ])
      .then(([res, calib]) => {
        if (cancelled) return;
        setData(res);
        setCalibration(calib);
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
                    Model Calibration
                  </h3>
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text-3)' }}
                  >
                    DRIFT BETWEEN CLAIMED AND ACTUAL %
                  </span>
                </div>
                <div style={{ filter: sharp ? 'none' : 'blur(6px)' }}>
                  {!calibration || (calibration.samples || 0) < 10 ? (
                    <div className="empty-state" style={{ padding: 24 }}>
                      Calibration data builds as predictions settle. Check back
                      after ~30 settled markets — currently{' '}
                      {(calibration && calibration.samples) || 0}.
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                          gap: 18,
                        }}
                        className="calibration-grid"
                      >
                        <div>
                          <CalibrationChart
                            buckets={calibration.over.buckets}
                            label="OVER / UNDER"
                          />
                          <div style={{ overflowX: 'auto' }}>
                            <CalibrationTable
                              buckets={calibration.over.buckets}
                              market="over"
                            />
                          </div>
                        </div>
                        <div>
                          <CalibrationChart
                            buckets={calibration.btts.buckets}
                            label="BTTS"
                          />
                          <div style={{ overflowX: 'auto' }}>
                            <CalibrationTable
                              buckets={calibration.btts.buckets}
                              market="btts"
                            />
                          </div>
                        </div>
                      </div>
                      <div
                        className="mono"
                        style={{
                          marginTop: 14,
                          fontSize: 11,
                          color: 'var(--text-3)',
                          lineHeight: 1.6,
                        }}
                      >
                        Bars below the dashed line = model OVERconfident at
                        that bucket. Bars above = UNDERconfident. Once each
                        bucket has 10+ settled samples, the EV calculator
                        starts using the calibrated number.
                      </div>
                    </>
                  )}
                </div>
                {!sharp && (
                  <LockedOverlay
                    onClick={openUpgrade}
                    label="Calibration is SHARP-only"
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
