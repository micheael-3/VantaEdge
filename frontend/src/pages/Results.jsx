import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Loading from '../components/Loading.jsx';
import Icon from '../components/Icon.jsx';
import { history as historyApi } from '../api/client.js';

// Results page — the "proof it works" view. Shows the last 7 days'
// settled predictions as stacked match cards. FREE-tier accessible.
//
// Each card: home vs away, what the AI predicted, the final score,
// and a hit/miss check or x. Plus a summary chip up top.
//
// Calls history.get('week'). The endpoint already returns settled rows
// in its `recent` array plus over/btts hit counts in `summary`.

function dateLabel(daysAgo = 1) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday} ${month} ${d.getDate()}`.toUpperCase();
}

function ResultCard({ row }) {
  // Pick the call we have a settlement for. Prefer the one with the
  // higher confidence so we surface the AI's strongest take.
  const overConf = row.overConfidence;
  const bttsConf = row.bttsConfidence;
  let pickLabel = '—';
  let pickHit = null;
  if (overConf != null && (bttsConf == null || overConf >= bttsConf)) {
    pickLabel = `OVER ${row.overLine ?? 2.5} · ${overConf}%`;
    pickHit = row.overHit;
  } else if (bttsConf != null) {
    pickLabel = `BTTS ${row.btts || 'YES'} · ${bttsConf}%`;
    pickHit = row.bttsHit;
  }

  const ft =
    row.finalScore ||
    (row.homeGoals != null && row.awayGoals != null
      ? `FT ${row.homeGoals}-${row.awayGoals}`
      : null);

  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: '0.08em',
          marginBottom: 8,
        }}
      >
        {row.date || ''}
      </div>
      <div
        className="display"
        style={{
          fontSize: 17,
          fontWeight: 600,
          lineHeight: 1.2,
          marginBottom: 10,
        }}
      >
        {row.match}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <span className="badge badge-mint" style={{ fontSize: 11 }}>
          {pickLabel}
        </span>
        {ft && (
          <span
            className="mono"
            style={{
              fontSize: 12,
              color: 'var(--text-2)',
              padding: '4px 10px',
              background: 'var(--bg-2)',
              borderRadius: 6,
            }}
          >
            {ft}
          </span>
        )}
        {pickHit === true && (
          <span
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--mint)',
              fontSize: 12,
            }}
          >
            <Icon name="check" size={13} color="var(--mint)" /> HIT
          </span>
        )}
        {pickHit === false && (
          <span
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--red)',
              fontSize: 12,
            }}
          >
            <Icon name="x" size={13} color="var(--red)" /> MISS
          </span>
        )}
      </div>
    </div>
  );
}

export default function Results() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    historyApi
      .get('week')
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          'Failed to load results';
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recent = useMemo(() => (data && data.recent) || [], [data]);
  const summary = (data && data.summary) || {};
  const settled = summary.settledMarkets || 0;
  const hits = (summary.overHits || 0) + (summary.bttsHits || 0);
  const pct = settled > 0 ? Math.round((hits / settled) * 100) : 0;

  return (
    <Layout>
      <div>
        <div style={{ marginBottom: 22 }}>
          <h1
            className="display"
            style={{
              fontSize: 36,
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-0.025em',
            }}
          >
            Results
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
            YESTERDAY · {dateLabel(1)}
          </p>
        </div>

        {loading ? (
          <Loading label="Loading results…" />
        ) : error ? (
          <div className="empty-state">
            <h3>Couldn't load results</h3>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {settled > 0 && (
              <div
                className="card"
                style={{
                  padding: 14,
                  marginBottom: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  borderColor: 'rgba(110,231,183,0.3)',
                }}
              >
                <Icon name="check" size={14} color="var(--mint)" />
                <span
                  className="mono"
                  style={{ fontSize: 12, color: 'var(--text)' }}
                >
                  {hits} from {settled} correct ({pct}%)
                </span>
              </div>
            )}

            {recent.length === 0 ? (
              <div className="empty-state">
                <h3>No settled matches yet this week.</h3>
                <p>Check back after the next matchday.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {recent.map((row) => (
                  <ResultCard key={row.id || `${row.date}-${row.match}`} row={row} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
