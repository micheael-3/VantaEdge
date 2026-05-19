import { useEffect, useMemo, useState } from 'react';
import { admin } from '../../api/admin';

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(d);
  }
}

export default function AdminUsers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await admin.users();
        setRows(data.users || []);
      } catch (err) {
        const status = err.response && err.response.status;
        if (status !== 401) setError((err.response && err.response.data && err.response.data.error) || 'Failed to load users');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.email.toLowerCase().includes(q));
  }, [rows, filter]);

  return (
    <>
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Users</h2>
          <div className="muted small mono">{rows.length} total</div>
        </div>
        <input
          className="input"
          placeholder="Filter by email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>

      {loading ? (
        <div className="card">Loading…</div>
      ) : error ? (
        <div className="card error-text">{error}</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="history-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Tier</th>
                <th>Joined</th>
                <th>Predictions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="4" className="muted">
                    No users match.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>
                      <span className="badge accent mono">{u.tier}</span>
                    </td>
                    <td>{fmtDate(u.createdAt)}</td>
                    <td>{u.totalPredictions}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
