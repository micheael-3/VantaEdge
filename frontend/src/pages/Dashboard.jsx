import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import CalendarStrip from '../components/CalendarStrip.jsx';
import MatchCard from '../components/MatchCard.jsx';
import BestBetBanner from '../components/BestBetBanner.jsx';
import Icon from '../components/Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { predictions } from '../api/client.js';
import { agentScore } from '../lib/fixture.js';

// Small inline toast used by the post-checkout polling flow.
function CheckoutToast({ message, onClose }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 300,
        background: 'var(--mint)',
        color: '#001a10',
        padding: '12px 18px',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontSize: 14,
        fontWeight: 600,
        maxWidth: '90vw',
        animation: 'checkoutToastIn 280ms ease-out',
      }}
    >
      <style>{`
        @keyframes checkoutToastIn {
          from { transform: translate(-50%, -120%); opacity: 0; }
          to   { transform: translate(-50%, 0);     opacity: 1; }
        }
      `}</style>
      <span>{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#001a10',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

const MLS_LEAGUE_ID = 253;

function userTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function todayUtcStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysStr(baseDateStr, days) {
  const d = new Date(`${baseDateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekCacheKey(leagueId, weekStart) {
  return `fastscore_week_${leagueId}_${weekStart}`;
}

function loadWeekCache(leagueId, weekStart) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(weekCacheKey(leagueId, weekStart));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.weekStart === weekStart && parsed.dates) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function saveWeekCache(leagueId, weekStart, payload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      weekCacheKey(leagueId, weekStart),
      JSON.stringify({
        leagueId,
        weekStart,
        dates: payload.dates,
        lastScanned: payload.lastScanned,
        cachedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* quota */
  }
}

function formatScanDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: userTz(),
    });
  } catch {
    return '';
  }
}

function dateHeading(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    return `${weekday} · ${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return dateStr;
  }
}

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const sharp = isSharp(user);

  const [checkoutToast, setCheckoutToast] = useState(null);
  const [weekData, setWeekData] = useState(null); // { weekStart, dates, lastScanned }
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [selectedDate, setSelectedDate] = useState(null);
  const [error, setError] = useState('');
  const [hydratedFromCache, setHydratedFromCache] = useState(false);

  const pollTimerRef = useRef(null);

  // Post-checkout polling (unchanged behaviour).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return undefined;

    setCheckoutToast({ kind: 'pending', message: 'Payment successful — activating your PRO plan…' });

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const updated = await refreshUser();
        if (cancelled) return;
        if (updated && (updated.tier === 'ANALYST' || updated.tier === 'EDGE')) {
          setCheckoutToast({ kind: 'success', message: 'PRO plan activated! 🎉' });
          const url = new URL(window.location.href);
          url.searchParams.delete('checkout');
          window.history.replaceState({}, '', url.pathname + url.search + url.hash);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (attempts >= maxAttempts) {
        setCheckoutToast({ kind: 'timeout', message: 'Activation taking longer than expected — refresh the page in a moment.' });
        return;
      }
      setTimeout(tick, 3000);
    };
    const initial = setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [refreshUser]);

  const fetchWeek = useCallback(async () => {
    try {
      const res = await predictions.week();
      setWeekData({
        weekStart: res.weekStart,
        weekEnd: res.weekEnd,
        dates: res.dates || {},
        lastScanned: res.lastScanned,
      });
      setScanning(!!res.scanning);
      setProgress({
        done: (res.progress && res.progress.done) || 0,
        total: (res.progress && res.progress.total) || 0,
      });
      setError('');
      if (!res.scanning && res.dates && Object.keys(res.dates).length > 0) {
        saveWeekCache(MLS_LEAGUE_ID, res.weekStart, {
          dates: res.dates,
          lastScanned: res.lastScanned,
        });
      }
      return res;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || 'Failed to load predictions';
      setError(msg);
      setScanning(false);
      throw err;
    }
  }, []);

  // Mount: hydrate from cache instantly, then revalidate in the background.
  useEffect(() => {
    // We don't know weekStart yet — read whatever cache key matches today's
    // UTC Monday. The server will send the canonical weekStart on first fetch.
    if (typeof window === 'undefined') return;
    // Probe for any fastscore_week_253_* key.
    let bestCache = null;
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(`fastscore_week_${MLS_LEAGUE_ID}_`)) continue;
        try {
          const raw = window.localStorage.getItem(k);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (!parsed || !parsed.weekStart || !parsed.dates) continue;
          if (!bestCache || parsed.weekStart > bestCache.weekStart) bestCache = parsed;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    if (bestCache) {
      setWeekData({
        weekStart: bestCache.weekStart,
        weekEnd: addDaysStr(bestCache.weekStart, 6),
        dates: bestCache.dates,
        lastScanned: bestCache.lastScanned,
      });
      setHydratedFromCache(true);
    }
    fetchWeek().catch(() => { /* error stored in state */ });
  }, [fetchWeek]);

  // Poll while scanning.
  useEffect(() => {
    if (!scanning) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return undefined;
    }
    pollTimerRef.current = setInterval(() => {
      fetchWeek().catch(() => { /* error in state */ });
    }, 4000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [scanning, fetchWeek]);

  // Derive the list of future-or-today dates that actually have fixtures.
  const today = todayUtcStr();
  const futureDates = useMemo(() => {
    if (!weekData || !weekData.dates) return [];
    return Object.keys(weekData.dates).filter((d) => d >= today).sort();
  }, [weekData, today]);

  // Default selection: ALWAYS today, even if today has no matches.
  // Per user preference, don't auto-jump to the next future date —
  // they want to see "No matches today" explicitly when today is empty.
  // Users can click a future date pill to navigate forward themselves.
  useEffect(() => {
    if (selectedDate) return;
    if (!weekData) return;
    setSelectedDate(today);
  }, [weekData, selectedDate, today]);

  // Build day pill list for the CalendarStrip — Monday-Sunday, today first
  // dot, past dates hidden.
  const days = useMemo(() => {
    if (!weekData) return [];
    const list = [];
    for (let i = 0; i < 7; i++) {
      const date = addDaysStr(weekData.weekStart, i);
      if (date < today) continue; // hide past dates
      const count = (weekData.dates[date] || []).length;
      list.push({
        date,
        count,
        label: dateHeading(date),
        isToday: date === today,
        isPast: false,
      });
    }
    return list;
  }, [weekData, today]);

  const showingFutureFallback = useMemo(() => {
    if (!selectedDate) return false;
    if (selectedDate === today) return false;
    if (!futureDates.length) return false;
    if (futureDates.includes(today)) return false;
    return true;
  }, [selectedDate, today, futureDates]);

  const fixturesForDay = useMemo(() => {
    if (!weekData || !selectedDate) return [];
    const list = (weekData.dates[selectedDate] || []).slice();
    list.sort((a, b) => agentScore(b) - agentScore(a));
    return list;
  }, [weekData, selectedDate]);

  const bestBet = fixturesForDay[0];
  const others = fixturesForDay.slice(1);

  const nextMondayLabel = useMemo(() => {
    if (!weekData) return '';
    const nextMonday = addDaysStr(weekData.weekStart, 7);
    return dateHeading(nextMonday);
  }, [weekData]);

  const onSelectDay = (date) => {
    if (date < today) return; // never select past dates
    setSelectedDate(date);
  };

  // Initial loading: no cache + no server response yet.
  const showInitialLoading = !weekData && !error;

  return (
    <Layout>
      {({ openUpgrade }) => (
        <div>
          {checkoutToast && (
            <CheckoutToast
              message={checkoutToast.message}
              onClose={() => setCheckoutToast(null)}
            />
          )}
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
                  This Week's Picks
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
                  {showingFutureFallback
                    ? `SHOWING NEXT FIXTURES · ${dateHeading(selectedDate)}`
                    : selectedDate
                      ? dateHeading(selectedDate)
                      : 'MLS · Monday–Sunday'}
                </p>
                {weekData && weekData.lastScanned && (
                  <p
                    className="mono"
                    style={{ margin: '6px 0 0', color: 'var(--text-3)', fontSize: 11, letterSpacing: '0.04em' }}
                  >
                    Last scanned: {formatScanDate(weekData.lastScanned)}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" className="btn btn-ghost btn-sm">
                  <Icon name="trending" size={13} /> MLS
                </button>
              </div>
            </div>
            <CalendarStrip
              days={days}
              activeDate={selectedDate}
              onSelect={onSelectDay}
            />
          </div>

          {scanning ? (
            <div
              className="card"
              style={{
                padding: '64px 24px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <h2
                className="display"
                style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}
              >
                Scanning this week's MLS fixtures…
              </h2>
              <p
                className="mono"
                style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}
              >
                Analysing match {Math.min(progress.done + 1, Math.max(progress.total, 1))} of {progress.total || '?'}…
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
                This only happens once per week.
              </p>
              {progress.total > 0 && (
                <div
                  style={{
                    width: 260,
                    height: 4,
                    background: 'var(--border-soft)',
                    borderRadius: 2,
                    overflow: 'hidden',
                    marginTop: 4,
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.round((progress.done / Math.max(progress.total, 1)) * 100))}%`,
                      height: '100%',
                      background: 'var(--mint)',
                      transition: 'width 600ms ease-out',
                    }}
                  />
                </div>
              )}
            </div>
          ) : showInitialLoading ? (
            <div
              className="card"
              style={{ padding: '48px 24px', textAlign: 'center' }}
            >
              <p className="mono" style={{ color: 'var(--text-3)', fontSize: 13 }}>
                Loading this week's picks…
              </p>
            </div>
          ) : error ? (
            <div className="empty-state">
              <h3>Couldn't load predictions</h3>
              <p>{error}</p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => fetchWeek().catch(() => {})}
                style={{ marginTop: 12 }}
              >
                Try again
              </button>
            </div>
          ) : futureDates.length === 0 ? (
            <div className="empty-state">
              <h3>No matches this week</h3>
              <p>Next scan: {nextMondayLabel}</p>
            </div>
          ) : fixturesForDay.length === 0 ? (
            <div className="empty-state">
              <h3>No matches on this day</h3>
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
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
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
              </div>

              {hydratedFromCache && (
                <div
                  className="mono"
                  style={{ marginTop: 16, textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}
                >
                  CACHED · revalidating in background
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Layout>
  );
}
