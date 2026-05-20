import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
//
// Progressive loading flow (was a single 22s blocking fetch):
//   1. predictions.quick()       → fixtures + form + stats, NO Claude (~2-3s)
//   2. predictions.analyze(id)   → fires N times in parallel, one per fixture
//      Each .then() splices the prediction into that one card. Other cards
//      stay live throughout — no Promise.all gate.
export default function Dashboard() {
  const { user } = useAuth();
  const sharp = isSharp(user);
  const [data, setData] = useState(null);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [pinnedDate, setPinnedDate] = useState(null);
  const [error, setError] = useState('');
  // Token to invalidate in-flight /analyze responses when the user switches
  // days mid-fetch (otherwise a slow Claude call could splice into the
  // wrong day's fixtures after the user moved on).
  const fetchTokenRef = useRef(0);

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

  // Splice one analyzed fixture's prediction into `data.fixtures` by fixtureId.
  // Guarded by fetchToken so a stale analyze response from a previous day
  // doesn't corrupt the current view.
  const applyAnalysis = useCallback((fixtureId, partial, token) => {
    setData((prev) => {
      if (!prev || token !== fetchTokenRef.current) return prev;
      const list = prev.fixtures || [];
      const idx = list.findIndex((f) => Number(f.fixtureId) === Number(fixtureId));
      if (idx === -1) return prev;
      const updated = list.slice();
      updated[idx] = { ...updated[idx], ...partial };
      return { ...prev, fixtures: updated };
    });
  }, []);

  const fetchDay = useCallback(
    async (date, isInitial) => {
      const myToken = ++fetchTokenRef.current;
      if (isInitial) setLoading(true);
      else setSwitching(true);
      setError('');
      try {
        const params = {};
        if (date) params.date = date;
        if (isInitial) params.initial = 1;
        const res = await predictions.quick(params);
        if (myToken !== fetchTokenRef.current) return; // user moved on
        setData(res);

        // Fan-out one analyze() per fixture in parallel. We don't await
        // Promise.all — each promise settles independently and splices
        // its result into the matching card so cards turn live one-by-one.
        const list = (res.fixtures || []).filter(
          (f) => f && f.fixtureId && f.aiStatus === 'pending',
        );
        for (const fx of list) {
          const fid = fx.fixtureId;
          predictions
            .analyze(fid)
            .then((row) => {
              applyAnalysis(
                fid,
                {
                  id: row.id || null,
                  predictions: row.predictions || null,
                  aiStatus: row.aiStatus || 'ok',
                  aiReason: row.aiReason || null,
                  ev: row.ev || null,
                  oddsData: row.oddsData || null,
                  actualResult: row.actualResult ?? fx.actualResult ?? null,
                },
                myToken,
              );
            })
            .catch((err) => {
              applyAnalysis(
                fid,
                {
                  aiStatus: 'error',
                  aiReason:
                    err?.response?.data?.error || err?.message || 'analysis failed',
                  error:
                    err?.response?.data?.error || err?.message || 'analysis failed',
                },
                myToken,
              );
            });
        }
      } catch (err) {
        if (myToken !== fetchTokenRef.current) return;
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          'Failed to load predictions';
        setError(msg);
      } finally {
        if (myToken === fetchTokenRef.current) {
          setLoading(false);
          setSwitching(false);
        }
      }
    },
    [applyAnalysis],
  );

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
  // Pending fixtures get a score of 0; once /analyze splices in the real
  // confidence the list re-sorts on the next render.
  const sortedFixtures = useMemo(() => {
    const list = (data?.fixtures || []).slice();
    list.sort((a, b) => agentScore(b) - agentScore(a));
    return list;
  }, [data]);

  // Loading progress for the per-fixture analyze() fan-out. Counts any
  // fixture whose aiStatus has resolved (ok / fallback / error) — anything
  // non-pending is "done".
  const loadingProgress = useMemo(() => {
    const list = data?.fixtures || [];
    const total = list.length;
    let done = 0;
    for (const fx of list) {
      if (fx && fx.aiStatus && fx.aiStatus !== 'pending') done += 1;
    }
    return { total, done, pending: total - done };
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

              {loadingProgress.pending > 0 && (
                <div
                  className="mono"
                  style={{
                    marginTop: 16,
                    textAlign: 'center',
                    color: 'var(--text-3)',
                    fontSize: 12,
                    letterSpacing: '0.06em',
                  }}
                >
                  ANALYSING MATCH {loadingProgress.done + 1} OF{' '}
                  {loadingProgress.total}…
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Layout>
  );
}
