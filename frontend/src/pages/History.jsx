import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import Loading from '../components/Loading.jsx';
import { history as historyApi } from '../api/client.js';

const WINDOWS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

function fmtPct(num, denom) {
  if (!denom || denom === 0) return '—';
  return `${Math.round((num / denom) * 100)}%`;
}

// Simple inline SVG line chart for rolling accuracy. No external libs.
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
  const H = 160;
  const pad = 20;
  const xs = data.map((_, i) => pad + (i * (W - 2 * pad)) / Math.max(1, data.length - 1));
  const ys = data.map((d) => {
    const acc = Math.max(0, Math.min(100, d.accuracy));
    return H - pad - (acc / 100) * (H - 2 * pad);
  });
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" strokeWidth="1" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="var(--border)" strokeWidth="1" />
      <polyline
        fill="none"
        stroke="var(--mint)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="2.5" fill="var(--mint)" />
      ))}
    </svg>
  );
}

export default function History() {
  const [windowKey, setWindowKey] = useState('all');
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
          (err.response && err.response.data && err.response.data.message) ||
          (err.response && err.response.data && err.response.data.error) ||
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

  return (
    <>
      <Navbar />
      <main className="page">
        <div className="container">
          <div className="dash-header">
            <div>
              <h1>Accuracy tracking</h1>
              <div className="date-label">How our predictions have settled.</div>
            </div>
            <div className="win-tabs">
              {WINDOWS.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  className={`win-tab ${windowKey === w.key ? 'active' : ''}`}
                  onClick={() => setWindowKey(w.key)}
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
              <h3>Couldn’t load history</h3>
              <p>{error}</p>
            </div>
          ) : settled === 0 ? (
            <div className="empty-state">
              <h3>No settled predictions yet.</h3>
              <p>Predictions settle automatically after matches end.</p>
            </div>
          ) : (
            <>
              <div className="kpi-grid">
                <div className="kpi-tile">
                  <div className="kpi-label">Overall hit rate</div>
                  <div className="kpi-value">{fmtPct(overallHits, settled)}</div>
                  <div className="kpi-sub">{overallHits} / {settled} markets</div>
                </div>
                <div className="kpi-tile">
                  <div className="kpi-label">Over hit rate</div>
                  <div className="kpi-value">
                    {summary.overPct != null ? `${summary.overPct}%` : fmtPct(summary.overHits, summary.overSettled)}
                  </div>
                  <div className="kpi-sub">{summary.overHits || 0} / {summary.overSettled || 0}</div>
                </div>
                <div className="kpi-tile">
                  <div className="kpi-label">BTTS hit rate</div>
                  <div className="kpi-value">
                    {summary.bttsPct != null ? `${summary.bttsPct}%` : fmtPct(summary.bttsHits, summary.bttsSettled)}
                  </div>
                  <div className="kpi-sub">{summary.bttsHits || 0} / {summary.bttsSettled || 0}</div>
                </div>
                <div className="kpi-tile">
                  <div className="kpi-label">Best league</div>
                  <div className="kpi-value">{summary.bestLeague || '—'}</div>
                  <div className="kpi-sub">{summary.pendingRows || 0} pending</div>
                </div>
              </div>

              <div className="chart-card">
                <h3>Rolling accuracy</h3>
                <RollingChart rolling={data.rolling || []} />
              </div>

              <div className="chart-card">
                <h3>By league</h3>
                <div className="table-wrap" style={{ border: 'none' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>League</th>
                        <th>Predictions</th>
                        <th>Settled markets</th>
                        <th>Hits</th>
                        <th>Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.leagues || []).length === 0 ? (
                        <tr>
                          <td colSpan="5" className="muted">No league data yet.</td>
                        </tr>
                      ) : (
                        data.leagues.map((l) => (
                          <tr key={l.league}>
                            <td>{l.league}</td>
                            <td>{l.predictions}</td>
                            <td>{l.settledMarkets}</td>
                            <td>{l.hits}</td>
                            <td>{l.accuracy != null ? `${l.accuracy}%` : '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="chart-card">
                <h3>Recent settled predictions</h3>
                <div className="table-wrap" style={{ border: 'none' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>League</th>
                        <th>Match</th>
                        <th>Over</th>
                        <th>BTTS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.recent || []).length === 0 ? (
                        <tr>
                          <td colSpan="5" className="muted">No settled rows in this window.</td>
                        </tr>
                      ) : (
                        data.recent.map((r) => (
                          <tr key={r.id}>
                            <td>{r.date}</td>
                            <td>{r.league}</td>
                            <td>{r.match}</td>
                            <td>
                              {r.overLine != null ? `O ${r.overLine}` : '—'} ·{' '}
                              {r.overConfidence != null ? `${r.overConfidence}%` : '—'}{' '}
                              <span className={r.overHit ? 'pill-hit' : 'pill-miss'}>
                                {r.overHit == null ? '·' : r.overHit ? '✓' : '✗'}
                              </span>
                            </td>
                            <td>
                              {r.btts || '—'} ·{' '}
                              {r.bttsConfidence != null ? `${r.bttsConfidence}%` : '—'}{' '}
                              <span className={r.bttsHit ? 'pill-hit' : 'pill-miss'}>
                                {r.bttsHit == null ? '·' : r.bttsHit ? '✓' : '✗'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
