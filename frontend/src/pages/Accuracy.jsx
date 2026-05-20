import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import Navbar from '../components/Navbar';
import agentApi from '../api/agent';

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
}

function bucketLabel(d) {
  return d || '—';
}

export default function Accuracy() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await agentApi.accuracy();
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled) {
          const status = err.response && err.response.status;
          setError(status === 403
            ? 'Accuracy Intelligence is an EDGE feature. Upgrade to access the self-learning model.'
            : (err.response && err.response.data && err.response.data.error) || 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dims = (data && data.dimensions) || {};

  return (
    <>
      <Navbar />
      <div className="container has-bottom-nav" style={{ paddingTop: 20 }}>
        <h2 style={{ marginBottom: 4 }}>Accuracy Intelligence</h2>
        <p className="muted small">
          The self-learning model that tunes confidence scores based on what's actually working.
          Updated nightly at 03:00 UTC.
        </p>

        {loading ? (
          <div className="card" style={{ marginTop: 20 }}>Loading…</div>
        ) : error ? (
          <div className="card error-text" style={{ marginTop: 20 }}>{error}</div>
        ) : !data ? (
          <div className="card" style={{ marginTop: 20 }}>No data yet — the model is still warming up.</div>
        ) : (
          <>
            <div className="muted small mono" style={{ marginTop: 8 }}>
              Model last updated: {fmtDate(data.lastUpdated)}
            </div>

            <div className="card" style={{ marginTop: 24 }}>
              <h3>Rolling accuracy — last 30 days</h3>
              {data.rolling && data.rolling.length > 0 ? (
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer>
                    <LineChart data={data.rolling}>
                      <CartesianGrid stroke="#2a2a38" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#888899" fontSize={11} />
                      <YAxis stroke="#888899" fontSize={11} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ background: '#111118', border: '1px solid #2a2a38', borderRadius: 8 }}
                        formatter={(v, name, { payload }) =>
                          payload ? [`${v}% (${payload.settled} settled)`, 'Accuracy'] : v
                        }
                      />
                      <Line type="monotone" dataKey="accuracy" stroke="#6ee7b7" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="muted small">Not enough settled predictions yet.</p>
              )}
            </div>

            {Object.entries(dims).map(([dim, rows]) => (
              <div key={dim} className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px 4px' }}>
                  <h3 style={{ marginBottom: 4 }}>{dim}</h3>
                </div>
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>{dim.toLowerCase()}</th>
                      <th>Predictions</th>
                      <th>Hits</th>
                      <th>Accuracy</th>
                      <th>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan="5" className="muted">No data</td></tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.value}>
                          <td>{bucketLabel(r.value)}</td>
                          <td>{r.total}</td>
                          <td>{r.hits}</td>
                          <td>{r.accuracy}%</td>
                          <td className="mono" style={{
                            color: r.weightAdjustment > 0 ? 'var(--accent)'
                                  : r.weightAdjustment < 0 ? 'var(--red)'
                                  : 'var(--text2)'
                          }}>
                            {r.weightAdjustment > 0 ? '+' : ''}{r.weightAdjustment}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
