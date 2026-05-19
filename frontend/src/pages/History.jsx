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

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}

function resultBadge(hit) {
  if (hit === true) return <span className="badge green mono">✓ Hit</span>;
  if (hit === false) return <span className="badge red mono">✗ Miss</span>;
  return <span className="badge mono">Pending</span>;
}

export default function History() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await historyApi.getHistory();
        setData(res);
      } catch (err) {
        setError((err.response && err.response.data && err.response.data.error) || 'Failed to load history');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <Navbar />
      <div className="container" style={{ paddingTop: 20 }}>
        <h2>Accuracy history</h2>
        <p className="muted small" style={{ marginBottom: 20 }}>
          {user.tier === 'EDGE' ? 'All-time rolling accuracy' : 'Last 30 days'}
        </p>

        {loading ? (
          <div className="card">Loading…</div>
        ) : error ? (
          <div className="card error-text">{error}</div>
        ) : !data ? (
          <div className="card">No data yet.</div>
        ) : (
          <>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="label">Total predictions</div>
                <div className="value">{data.summary.totalPredictions}</div>
              </div>
              <div className="kpi">
                <div className="label">Overall accuracy</div>
                <div className="value">{data.summary.overallAccuracy}%</div>
              </div>
              <div className="kpi">
                <div className="label">Best league</div>
                <div className="value" style={{ fontSize: 18 }}>
                  {data.summary.bestLeague || '—'}
                </div>
              </div>
            </div>

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
                      />
                      <Line type="monotone" dataKey="accuracy" stroke="#6ee7b7" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="muted small">Not enough data to plot yet.</p>
              )}
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
              <h3>By league</h3>
              <table className="history-table">
                <thead>
                  <tr>
                    <th>League</th>
                    <th>Predictions</th>
                    <th>Hits</th>
                    <th>Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leagues.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="muted">
                        No data
                      </td>
                    </tr>
                  ) : (
                    data.leagues.map((row) => (
                      <tr key={row.league}>
                        <td>{row.league}</td>
                        <td>{row.predictions}</td>
                        <td>{row.hits}</td>
                        <td>{row.accuracy}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

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
                        No predictions yet
                      </td>
                    </tr>
                  ) : (
                    data.recent.map((p) => (
                      <tr key={p.id}>
                        <td>{fmtDate(p.date)}</td>
                        <td>{p.league}</td>
                        <td>{p.match}</td>
                        <td>
                          O{p.overLine} ({p.overConfidence}%)
                        </td>
                        <td>{resultBadge(p.overHit)}</td>
                        <td>
                          {p.btts} ({p.bttsConfidence}%)
                        </td>
                        <td>{resultBadge(p.bttsHit)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
