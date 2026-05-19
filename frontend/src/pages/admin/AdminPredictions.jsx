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

export default function AdminPredictions() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leagueFilter, setLeagueFilter] = useState('ALL');

  useEffect(() => {
    (async () => {
      try {
        const data = await admin.predictions();
        setRows(data.predictions || []);
      } catch (err) {
        const status = err.response && err.response.status;
        if (status !== 401) setError((err.response && err.response.data && err.response.data.error) || 'Failed to load predictions');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const leagues = useMemo(() => {
    const set = new Set(rows.map((r) => r.league));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (leagueFilter === 'ALL') return rows;
    return rows.filter((r) => r.league === leagueFilter);
  }, [rows, leagueFilter]);

  return (
    <>
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Today's predictions</h2>
          <div className="muted small mono">
            {filtered.length} shown · {rows.length} total
          </div>
        </div>
        <select
          className="input"
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
          style={{ maxWidth: 220 }}
        >
          <option value="ALL">All leagues</option>
          {leagues.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="card">Loading…</div>
      ) : error ? (
        <div className="card error-text">{error}</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="history-table">
            <thead>
              <tr>
                <th>League</th>
                <th>Home</th>
                <th>Away</th>
                <th>Kickoff</th>
                <th>Over</th>
                <th>Conf</th>
                <th>BTTS</th>
                <th>Conf</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="9" className="muted">
                    No predictions today.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id}>
                    <td>{p.league}</td>
                    <td>{p.homeTeam}</td>
                    <td>{p.awayTeam}</td>
                    <td>{fmtDate(p.kickoff)}</td>
                    <td>O{p.overLine}</td>
                    <td>{p.overConfidence}%</td>
                    <td>{p.btts}</td>
                    <td>{p.bttsConfidence}%</td>
                    <td>{fmtDate(p.createdAt)}</td>
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
