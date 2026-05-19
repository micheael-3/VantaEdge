import { useEffect, useState } from 'react';
import { admin } from '../../api/admin';

export default function AdminStats() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await admin.stats();
        setData(res);
      } catch (err) {
        const status = err.response && err.response.status;
        if (status !== 401) setError((err.response && err.response.data && err.response.data.error) || 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <h2 style={{ marginBottom: 20 }}>Stats</h2>

      {loading ? (
        <div className="card">Loading…</div>
      ) : error ? (
        <div className="card error-text">{error}</div>
      ) : !data ? (
        <div className="card">No data.</div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="label">Total users</div>
              <div className="value">{data.totalUsers}</div>
            </div>
            <div className="kpi">
              <div className="label">Predictions today</div>
              <div className="value">{data.totalPredictionsToday}</div>
            </div>
            <div className="kpi">
              <div className="label">Predictions all-time</div>
              <div className="value">{data.totalPredictionsAllTime}</div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 8px' }}>
              <h3 style={{ marginBottom: 4 }}>Predictions per league</h3>
              <div className="muted small">All-time totals</div>
            </div>
            <table className="history-table">
              <thead>
                <tr>
                  <th>League</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {data.perLeague.length === 0 ? (
                  <tr>
                    <td colSpan="2" className="muted">
                      No predictions yet.
                    </td>
                  </tr>
                ) : (
                  data.perLeague.map((row) => (
                    <tr key={row.league}>
                      <td>{row.league}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
