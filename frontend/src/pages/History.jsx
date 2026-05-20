import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import Navbar from '../components/Navbar';
import { history as historyApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

const WINDOWS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}

function ResultIcon({ hit }) {
  if (hit === true)
    return (
      <span className="badge green mono" title="Hit">
        ✓
      </span>
    );
  if (hit === false)
    return (
      <span className="badge red mono" title="Miss">
        ✗
      </span>
    );
  return (
    <span className="badge mono" title="Pending — match not finished yet">
      ⏳
    </span>
  );
}

export default function History() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Default window matches the backend: 30d for ANALYST, all for EDGE.
  const [windowKey, setWindowKey] = useState(user && user.tier === 'EDGE' ? 'all' : 'month');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await historyApi.getHistory(windowKey);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError((err.response && err.response.data && err.response.data.error) || 'Failed to load history');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowKey]);

  const summary = (data && data.summary) || {};

  return (
    <>
      <Navbar />
      <div className="container" style={{ paddingTop: 20 }}>
        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Accuracy history</h2>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Hit rate measured on settled markets only.{' '}
              {typeof summary.pendingRows === 'number' && summary.pendingRows > 0
                ? `${summary.pendingRows} predictions still pending — they settle automatically every 2 hours.`
                : 'All predictions in this window are settled.'}
            </p>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {WINDOWS.map((w) => (
              <button
                key={w.id}
                className={`tab ${windowKey === w.id ? 'active' : ''}`}
                onClick={() => setWindowKey(w.id)}
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          {loading ? (
            <div className="card">Loading…</div>
          ) : error ? (
            <div className="card error-text">{error}</div>
          ) : !data ? (
            <div className="card">No data yet.</div>
          ) : (() => {
            // Settled-zero means the user has no resolved predictions for
            // this window — kill the KPI percentages, the rolling chart,
            // and the per-league table; show a single empty-state card.
            const settledTotal = Number(summary.settledMarkets) || 0;
            const hasSettled = settledTotal > 0;
            const fmtPct = (v) => (hasSettled && v != null ? `${v}%` : '—');

            return (
              <>
                <div className="kpi-grid">
                  <div className="kpi">
                    <div className="label">Overall hit rate</div>
                    <div className="value">{fmtPct(summary.overallAccuracy)}</div>
                    <div className="muted small mono" style={{ marginTop: 4 }}>
                      {settledTotal} settled markets
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="label">Over / Under</div>
                    <div className="value">{fmtPct(summary.overAccuracy)}</div>
                    <div className="muted small mono" style={{ marginTop: 4 }}>
                      {summary.overHits || 0} / {summary.overSettled || 0} hits
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="label">BTTS</div>
                    <div className="value">{fmtPct(summary.bttsAccuracy)}</div>
                    <div className="muted small mono" style={{ marginTop: 4 }}>
                      {summary.bttsHits || 0} / {summary.bttsSettled || 0} hits
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="label">Best league</div>
                    <div className="value" style={{ fontSize: 18 }}>
                      {hasSettled && summary.bestLeague ? summary.bestLeague : '—'}
                    </div>
                  </div>
                </div>

                {!hasSettled ? (
                  <div className="card" style={{ marginBottom: 24 }}>
                    <h3>No settled predictions yet</h3>
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      No settled predictions yet. Predictions settle automatically after matches end.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="card" style={{ marginBottom: 24 }}>
                      <h3>Rolling accuracy</h3>
                      {data.rolling && data.rolling.length > 0 ? (
                        <div style={{ width: '100%', height: 280 }}>
                          <ResponsiveContainer>
                            <LineChart data={data.rolling}>
                              <CartesianGrid stroke="#2a2a38" strokeDasharray="3 3" />
                              <XAxis dataKey="date" stroke="#888899" fontSize={11} />
                              <YAxis stroke="#888899" fontSize={11} domain={[0, 100]} />
                              <Tooltip
                                contentStyle={{ background: '#111118', border: '1px solid #2a2a38', borderRadius: 8 }}
                                labelStyle={{ color: '#e8e8f0' }}
                                formatter={(v, name, { payload }) =>
                                  payload && payload.settled != null ? [`${v}% (${payload.settled} settled)`, 'Accuracy'] : v
                                }
                              />
                              <Line type="monotone" dataKey="accuracy" stroke="#6ee7b7" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <p className="muted small">No settled predictions in this window yet.</p>
                      )}
                    </div>

                    <div className="card" style={{ marginBottom: 24 }}>
                      <h3>By league</h3>
                      <table className="history-table">
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
                          {data.leagues.length === 0 ? (
                            <tr>
                              <td colSpan="5" className="muted">
                                No data
                              </td>
                            </tr>
                          ) : (
                            data.leagues.map((row) => (
                              <tr key={row.league}>
                                <td>{row.league}</td>
                                <td>{row.predictions}</td>
                                <td>{row.settled}</td>
                                <td>{row.hits}</td>
                                <td>{row.accuracy}%</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div className="card">
                  <h3>Recent predictions</h3>
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>League</th>
                        <th>Match</th>
                        <th>Over</th>
                        <th>Result</th>
                        <th>BTTS</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="muted">
                            No settled predictions yet. Predictions settle automatically after matches end.
                          </td>
                        </tr>
                      ) : (
                        data.recent.map((p) => (
                          <tr key={p.id}>
                            <td>{fmtDate(p.date)}</td>
                            <td>{p.league}</td>
                            <td>{p.match}</td>
                            <td>
                              O{p.overLine}{' '}
                              <span className="muted">({p.overConfidence}%)</span>
                            </td>
                            <td>
                              <ResultIcon hit={p.overHit} />
                            </td>
                            <td>
                              {p.btts}{' '}
                              <span className="muted">({p.bttsConfidence}%)</span>
                            </td>
                            <td>
                              <ResultIcon hit={p.bttsHit} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
}
