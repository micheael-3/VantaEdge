import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import CalendarStrip from '../components/CalendarStrip.jsx';
import MatchCard from '../components/MatchCard.jsx';
import MatchCardSkeleton from '../components/MatchCardSkeleton.jsx';
import BestBetBanner from '../components/BestBetBanner.jsx';
import Icon from '../components/Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { predictions } from '../api/client.js';
import { agentScore } from '../lib/fixture.js';

// Today's Edge — the dashboard root.
// Header → CalendarStrip → BestBetBanner → grid of MatchCards.
export default function Dashboard() {
  const { user } = useAuth();
  const sharp = isSharp(user);
  const [data, setData] = useState(null);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [pinnedDate, setPinnedDate] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await predictions.upcoming({ past: 7, future: 7 });
        if (!cancelled) setDays(u.days || []);
      } catch {
        /* strip is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDay = useCallback(async (date, isInitial) => {
    if (isInitial) setLoading(true);
    else setSwitching(true);
    setError('');
    try {
      const params = {};
      if (date) params.date = date;
      if (isInitial) params.initial = 1;
      const res = await predictions.get(params);
      setData(res);
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Failed to load predictions';
      setError(msg);
    } finally {
      setLoading(false);
      setSwitching(false);
    }
  }, []);

  useEffect(() => {
    fetchDay(null, true);
  }, [fetchDay]);

  const activeDate = pinnedDate || data?.matchDate || null;

  const headerSub = useMemo(() => {
    if (!data?.matchDate) return 'MLS predictions';
    let label = '';
    try {
      const d = new Date(`${data.matchDate}T12:00:00Z`);
      const weekday = d
        .toLocaleDateString('en-US', { weekday: 'long' })
        .toUpperCase();
      const month = d
        .toLocaleDateString('en-US', { month: 'short' })
        .toUpperCase();
      label = `${weekday} · ${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    } catch {
      label = data.matchDate;
    }
    const count = (data.fixtures || []).length;
    return `${label} · ${count} MATCH${count === 1 ? '' : 'ES'} ANALYSED`;
  }, [data]);

  const onSelectDay = (date) => {
    setPinnedDate(date);
    fetchDay(date, false);
  };

  // Sort fixtures by agent score desc so the best ones surface first.
  const sortedFixtures = useMemo(() => {
    const list = (data?.fixtures || []).slice();
    list.sort((a, b) => agentScore(b) - agentScore(a));
    return list;
  }, [data]);

  const bestBet = sortedFixtures[0];
  const others = sortedFixtures.slice(1);

  return (
    <Layout>
      {({ openUpgrade }) => (
        <div>
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 18,
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <h1
                  className="display"
                  style={{
                    fontSize: 36,
                    fontWeight: 700,
                    margin: 0,
                    letterSpacing: '-0.025em',
                  }}
                >
                  Today's Edge
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
                  {headerSub}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm">
                  <Icon name="trending" size={13} /> MLS
                </button>
              </div>
            </div>
            <CalendarStrip
              days={days}
              activeDate={activeDate}
              onSelect={onSelectDay}
            />
          </div>

          {loading ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(420px, 1fr))',
                gap: 16,
              }}
            >
              <MatchCardSkeleton />
              <MatchCardSkeleton />
              <MatchCardSkeleton />
            </div>
          ) : error ? (
            <div className="empty-state">
              <h3>Couldn't load predictions</h3>
              <p>{error}</p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => fetchDay(activeDate, false)}
                style={{ marginTop: 12 }}
              >
                Try again
              </button>
            </div>
          ) : sortedFixtures.length === 0 ? (
            <div className="empty-state">
              <h3>No matches for this day</h3>
              <p>Pick a different day from the strip above.</p>
            </div>
          ) : (
            <>
              {bestBet && (
                <BestBetBanner
                  fixture={bestBet}
                  isSharp={sharp}
                  onUpgrade={openUpgrade}
                />
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 16,
                }}
              >
                <h2
                  className="display"
                  style={{ fontSize: 22, fontWeight: 600, margin: 0 }}
                >
                  All matches
                </h2>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--text-3)' }}
                >
                  SORTED BY CONFIDENCE
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(420px, 1fr))',
                  gap: 16,
                }}
              >
                {others.map((f) => (
                  <MatchCard
                    key={f.id || f.fixtureId}
                    fixture={f}
                    isSharp={sharp}
                    onUpgrade={openUpgrade}
                  />
                ))}
                {switching && <MatchCardSkeleton />}
              </div>
            </>
          )}
        </div>
      )}
    </Layout>
  );
}
