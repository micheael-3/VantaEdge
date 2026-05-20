import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import './Odds.css';

const MARKETS = ['all', 'over', 'btts'];

function fmtKickoff(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtOdds(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(2);
}

function exportCsv(rows) {
  const headers = [
    'League', 'Kickoff', 'Home', 'Away',
    'Market', 'Line', 'Side', 'Confidence',
    'Best odds', 'Bookmaker', 'EV edge', 'Kelly',
  ];
  const lines = [headers.join(',')];
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (const r of rows) {
    if (r.over && r.over.confidence != null) {
      lines.push([
        r.league, r.kickoff || '', r.homeTeam, r.awayTeam,
        'OVER', r.over.line, '', r.over.confidence,
        r.over.odds, r.over.bookmaker, r.over.edge, r.over.kelly,
      ].map(escape).join(','));
    }
    if (r.btts && r.btts.confidence != null) {
      lines.push([
        r.league, r.kickoff || '', r.homeTeam, r.awayTeam,
        'BTTS', '', r.btts.prediction, r.btts.confidence,
        r.btts.odds, r.btts.bookmaker, r.btts.edge, r.btts.kelly,
      ].map(escape).join(','));
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `vantaedge-odds-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Odds() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [oddsConfigured, setOddsConfigured] = useState(true);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [leagueFilter, setLeagueFilter] = useState('ALL');
  const [minEdge, setMinEdge] = useState(0);
  const [minConfidence, setMinConfidence] = useState(60);
  const [market, setMarket] = useState('all');
  const [valueOnly, setValueOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await api.get('/api/odds');
        if (cancelled) return;
        setRows(data.rows || []);
        setOddsConfigured(data.oddsConfigured !== false);
        setQuota(data.quota || null);
      } catch (err) {
        if (!cancelled) setError((err.response && err.response.data && err.response.data.error) || 'Failed to load odds');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const leagues = useMemo(() => Array.from(new Set(rows.map((r) => r.league))).sort(), [rows]);

  // Flatten each prediction into 1-2 rows (Over + BTTS) for the table.
  const flattened = useMemo(() => {
    const out = [];
    for (const r of rows) {
      if (leagueFilter !== 'ALL' && r.league !== leagueFilter) continue;
      if (market === 'all' || market === 'over') {
        if (r.over && r.over.confidence >= minConfidence) {
          const edge = r.over.edge ?? null;
          const passEdge = edge == null ? !valueOnly : edge >= minEdge;
          if (passEdge) {
            out.push({
              key: `${r.id}-over`,
              league: r.league,
              kickoff: r.kickoff,
              homeTeam: r.homeTeam,
              awayTeam: r.awayTeam,
              betLabel: `OVER ${r.over.line}`,
              side: 'over',
              confidence: r.over.confidence,
              odds: r.over.odds,
              bookmaker: r.over.bookmaker,
              edge,
              kelly: r.over.kelly,
            });
          }
        }
      }
      if (market === 'all' || market === 'btts') {
        if (r.btts && r.btts.confidence >= minConfidence) {
          const edge = r.btts.edge ?? null;
          const passEdge = edge == null ? !valueOnly : edge >= minEdge;
          if (passEdge) {
            out.push({
              key: `${r.id}-btts`,
              league: r.league,
              kickoff: r.kickoff,
              homeTeam: r.homeTeam,
              awayTeam: r.awayTeam,
              betLabel: `BTTS ${r.btts.prediction}`,
              side: 'btts',
              confidence: r.btts.confidence,
              odds: r.btts.odds,
              bookmaker: r.btts.bookmaker,
              edge,
              kelly: r.btts.kelly,
            });
          }
        }
      }
    }
    return out.sort((a, b) => (b.edge ?? -Infinity) - (a.edge ?? -Infinity));
  }, [rows, leagueFilter, minEdge, minConfidence, market, valueOnly]);

  const quotaText = quota
    ? (quota.remaining != null
        ? `Odds API quota: ${quota.remaining} requests remaining`
        : 'Odds API quota: unknown')
    : null;
  const quotaWarn = quota && quota.remaining != null && quota.remaining < 50;

  return (
    <div className="odds-page">
      <Navbar />
      <div className="op-head">
        <h1>Odds & Value</h1>
        <p>Every match VantaEdge has analysed today, sorted by EV edge. Best available bookmaker odds with the matching auto-EV.</p>
      </div>

      <div className="op-filter-bar">
        <div>
          <span className="op-filter-label" style={{ marginRight: 8 }}>League</span>
          <select className="op-select" value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}>
            <option value="ALL">All</option>
            {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <span className="op-filter-label" style={{ marginRight: 8 }}>Min EV %</span>
          <input
            className="op-input"
            type="number"
            step="0.1"
            value={minEdge}
            onChange={(e) => setMinEdge(parseFloat(e.target.value) || 0)}
            style={{ width: 80 }}
          />
        </div>
        <div>
          <span className="op-filter-label" style={{ marginRight: 8 }}>Min confidence</span>
          <input
            className="op-input"
            type="number"
            min="0"
            max="100"
            step="1"
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseInt(e.target.value, 10) || 0)}
            style={{ width: 80 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {MARKETS.map((m) => (
            <button
              key={m}
              className={`op-toggle ${market === m ? 'on' : ''}`}
              onClick={() => setMarket(m)}
            >
              {m === 'all' ? 'All markets' : m === 'over' ? 'Over' : 'BTTS'}
            </button>
          ))}
        </div>
        <button
          className={`op-toggle ${valueOnly ? 'on' : ''}`}
          onClick={() => setValueOnly((v) => !v)}
          title="Hide rows where EV isn't positive (or odds aren't available)"
        >
          {valueOnly ? '✓ Value only' : 'Value only'}
        </button>
        {user.tier === 'EDGE' && (
          <button className="op-btn" onClick={() => exportCsv(rows)}>⬇ CSV</button>
        )}
        {quotaText && (
          <span className={`op-quota ${quotaWarn ? 'warn' : ''}`}>{quotaText}</span>
        )}
      </div>

      <div className="op-table-wrap">
        {!oddsConfigured && (
          <div className="op-empty" style={{ marginBottom: 16 }}>
            <strong>Auto-odds disabled</strong>
            ODDS_API_KEY isn't configured. The table will only show EV for matches where you've
            entered odds manually on a match card.
          </div>
        )}
        {loading ? (
          <div style={{ color: 'var(--op-text-dim)', fontFamily: 'DM Mono, monospace' }}>Loading…</div>
        ) : error ? (
          <div style={{ color: 'var(--op-red)' }}>{error}</div>
        ) : flattened.length === 0 ? (
          <div className="op-empty">
            <strong>Nothing to show</strong>
            No predictions match these filters yet. Visit the dashboard for any league to generate
            today's predictions — they'll appear here automatically.
          </div>
        ) : (
          <table className="op-table">
            <thead>
              <tr>
                <th>League</th>
                <th>Kickoff</th>
                <th>Match</th>
                <th>Bet</th>
                <th>Confidence</th>
                <th>Best odds</th>
                <th>Bookmaker</th>
                <th>EV edge</th>
                <th>Kelly</th>
              </tr>
            </thead>
            <tbody>
              {flattened.map((r) => (
                <tr key={r.key}>
                  <td data-label="League">{r.league}</td>
                  <td data-label="Kickoff">{fmtKickoff(r.kickoff)}</td>
                  <td data-label="Match" className="op-team">{r.homeTeam} <span style={{ color: 'var(--op-text-faint)' }}>vs</span> {r.awayTeam}</td>
                  <td data-label="Bet">
                    <span className={`op-badge ${r.side === 'over' ? 'mint' : 'indigo'}`}>{r.betLabel}</span>
                  </td>
                  <td data-label="Confidence">{r.confidence}%</td>
                  <td data-label="Best odds">{fmtOdds(r.odds)}</td>
                  <td data-label="Bookmaker">{r.bookmaker || '—'}</td>
                  <td data-label="EV edge" className={`op-edge ${r.edge != null && r.edge > 0 ? 'positive' : 'negative'}`}>
                    {fmtPct(r.edge)}
                  </td>
                  <td data-label="Kelly">{r.kelly != null && r.kelly > 0 ? `${(r.kelly * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
