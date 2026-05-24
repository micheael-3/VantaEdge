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

// (Legacy dateLabel helper removed — the page now labels the list as a
// 7-day window rather than implying every row is from yesterday.)

// Pretty-print the row's date — history returns p.kickoff (ISO) as
// `row.date`. Surface a readable "SUN MAY 18" header so the user can
// see WHICH day each settled card is from (the page is a 7-day window,
// not a single day).
function formatRowDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${month} ${d.getDate()}`.toUpperCase();
}

// One pill = one market call + its HIT/MISS badge. Used twice per
// settled row (Over/Under + BTTS) so the user sees both predictions
// inline instead of only the higher-confidence side.
function MarketPill({ label, hit, tone }) {
  const isMint = tone !== 'red';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        background: isMint ? 'rgba(110,231,183,0.10)' : 'rgba(239,68,68,0.10)',
        border: `1px solid ${isMint ? 'rgba(110,231,183,0.30)' : 'rgba(239,68,68,0.30)'}`,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: isMint ? 'var(--mint)' : 'var(--red)',
        letterSpacing: '0.02em',
      }}
    >
      {label}
      {hit === true && <Icon name="check" size={12} color="var(--mint)" />}
      {hit === false && <Icon name="x" size={11} color="var(--red)" />}
      {hit == null && (
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>·</span>
      )}
    </span>
  );
}

function ResultCard({ row }) {
  // Recovered rows have no real AI prediction — they're score-only
  // placeholders from /api/admin/recover-history. Render them with a
  // distinct chip + just the score; no "OVER 2.5 · 0%" badge because
  // that confidence wasn't a real AI call.
  const isRecovered = !!row.recovered;

  // Both markets are shown — Over/Under and BTTS each get their own
  // pill + HIT/MISS badge. Previously we picked the higher-confidence
  // side and dropped the other, which meant users couldn't see how
  // the BTTS call actually went.
  const overConf = row.overConfidence;
  const bttsConf = row.bttsConfidence;
  const hasOver = !isRecovered && overConf != null && Number(overConf) > 0;
  const hasBtts = !isRecovered && bttsConf != null && Number(bttsConf) > 0;

  const ft =
    row.finalScore ||
    (row.homeGoals != null && row.awayGoals != null
      ? `FT ${row.homeGoals}-${row.awayGoals}`
      : null);

  return (
    <div
      className="card"
      style={{
        padding: 18,
        opacity: isRecovered ? 0.85 : 1,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: '0.08em',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>{formatRowDate(row.date)}</span>
        {isRecovered && (
          <span
            style={{
              fontSize: 9,
              padding: '2px 6px',
              borderRadius: 3,
              background: 'rgba(251,191,36,0.12)',
              color: 'var(--amber)',
              border: '1px solid rgba(251,191,36,0.3)',
              letterSpacing: '0.08em',
            }}
          >
            RECOVERED
          </span>
        )}
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
        {isRecovered && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--text-3)',
              padding: '4px 10px',
              background: 'var(--bg-2)',
              borderRadius: 6,
              fontStyle: 'italic',
            }}
          >
            no AI prediction
          </span>
        )}
        {hasOver && (
          <MarketPill
            label={`OVER ${row.overLine ?? 2.5} · ${overConf}%`}
            hit={row.overHit}
            tone="mint"
          />
        )}
        {hasBtts && (
          <MarketPill
            label={`BTTS ${row.btts || 'YES'} · ${bttsConf}%`}
            hit={row.bttsHit}
            // BTTS NO is a valid call — render it in red.
            tone={String(row.btts || 'YES').toUpperCase() === 'NO' ? 'red' : 'mint'}
          />
        )}
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
            LAST 7 DAYS · SETTLED MATCHES
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
