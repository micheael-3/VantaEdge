import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import CalendarStrip from '../components/CalendarStrip.jsx';
import MatchCard from '../components/MatchCard.jsx';
import BestBetBanner from '../components/BestBetBanner.jsx';
import OnboardingOverlay from '../components/OnboardingOverlay.jsx';
import SettledMatchMini from '../components/SettledMatchMini.jsx';
import ConversionToast from '../components/ConversionToast.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { predictions, history as historyApi } from '../api/client.js';
import { agentScore } from '../lib/fixture.js';
import usePullToRefresh from '../lib/usePullToRefresh.js';

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

// Context-aware page title:
//   selectedDate === today  → "Today's Picks"
//   selectedDate >  today   → "Saturday's Picks"
//   selectedDate <  today   → "Saturday Results"
// Casual bettors get a clearer signal of what they're looking at than
// the old hardcoded "This Week's Picks" string.
function pageTitle(selectedDate, today) {
  if (!selectedDate) return "Today's Picks";
  if (selectedDate === today) return "Today's Picks";
  try {
    const d = new Date(`${selectedDate}T12:00:00Z`);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    return selectedDate > today ? `${weekday}'s Picks` : `${weekday} Results`;
  } catch {
    return "Today's Picks";
  }
}

// Inline daily summary line shown below the calendar strip on days with
// matches. "{count} matches · {strong} strong picks · Best: Over {line}"
// All numbers calibrated; "strong" defined as max(over, btts) >= 70.
function DailySummaryStrip({ fixtures }) {
  const total = fixtures.length;
  let strong = 0;
  let bestLine = null;
  let bestConf = -1;
  fixtures.forEach((f) => {
    const oConf =
      typeof f?.predictions?.over?.calibratedConfidence === 'number'
        ? f.predictions.over.calibratedConfidence
        : typeof f?.predictions?.over?.confidence === 'number'
          ? f.predictions.over.confidence
          : 0;
    const bConf =
      typeof f?.predictions?.btts?.calibratedConfidence === 'number'
        ? f.predictions.btts.calibratedConfidence
        : typeof f?.predictions?.btts?.confidence === 'number'
          ? f.predictions.btts.confidence
          : 0;
    if (Math.max(oConf, bConf) >= 70) strong += 1;
    if (oConf > bestConf) {
      bestConf = oConf;
      bestLine = f?.predictions?.over?.line ?? null;
    }
  });
  const pieces = [`${total} matches`];
  if (strong > 0) pieces.push(`${strong} strong pick${strong === 1 ? '' : 's'}`);
  if (bestLine != null) pieces.push(`Best: Over ${bestLine}`);
  return (
    <div
      className="mono"
      style={{
        fontSize: 11,
        color: 'var(--text-3)',
        letterSpacing: '0.04em',
        marginBottom: 16,
        marginTop: -4,
      }}
    >
      {pieces.join(' · ')}
    </div>
  );
}

export default function Dashboard() {
  const { user, isGuest, refreshUser, consumeJustRegistered } = useAuth();
  const sharp = isSharp(user);

  const [checkoutToast, setCheckoutToast] = useState(null);
  const [weekData, setWeekData] = useState(null); // { weekStart, dates, lastScanned }
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [selectedDate, setSelectedDate] = useState(null);
  const [error, setError] = useState('');
  const [streak, setStreak] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [recentSettled, setRecentSettled] = useState([]);

  // Onboarding overlay: fires once after a fresh /register. The
  // sessionStorage `__fs_just_registered` flag is set by AuthContext
  // on successful register and consumed here on first dashboard mount.
  // For pre-existing users (no flag), backend `onboardingCompleted` is
  // the legacy authoritative source so we don't re-show on every login.
  useEffect(() => {
    if (!user) return;
    if (consumeJustRegistered()) {
      setShowOnboarding(true);
      return;
    }
    if (user.onboardingCompleted) return;
    if (typeof window !== 'undefined') {
      try {
        if (window.localStorage.getItem('fastscore_onboarded') === '1') return;
      } catch { /* ignore */ }
    }
    setShowOnboarding(true);
  }, [user, consumeJustRegistered]);

  // Streak banner fetch (FREE tier accessible).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    historyApi
      .streak()
      .then((r) => { if (!cancelled) setStreak(Number(r?.streak || 0)); })
      .catch(() => { /* silent — streak is decorative */ });
    return () => { cancelled = true; };
  }, [user]);

  // Recent settled fixtures for the rich "No matches today" empty state.
  // Pulls the last 7 days of settled predictions and keeps up to 5.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    historyApi
      .get('week')
      .then((r) => {
        if (cancelled) return;
        const rows = Array.isArray(r?.recent) ? r.recent.slice(0, 5) : [];
        setRecentSettled(rows);
      })
      .catch(() => { /* silent — empty state has its own fallback */ });
    return () => { cancelled = true; };
  }, [user]);

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

  // Build day pill list for the CalendarStrip — 3 past days, today, and
  // 6 ahead = 10 pills, horizontally scrollable, today centred on mount.
  // Past pills are clickable (they show settled fixtures for that day when
  // we have data, otherwise an empty state). Spec change from the old
  // "future-only" strip per the mobile UI polish round.
  const days = useMemo(() => {
    const list = [];
    for (let offset = -3; offset <= 6; offset += 1) {
      const date = addDaysStr(today, offset);
      const count =
        (weekData && weekData.dates && (weekData.dates[date] || []).length) || 0;
      list.push({
        date,
        count,
        label: dateHeading(date),
        isToday: date === today,
        isPast: date < today,
      });
    }
    return list;
  }, [weekData, today]);

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

  // Next-non-empty-date lookup for the empty-state "next matches" pill.
  const nextFixturesDay = useMemo(() => {
    if (!weekData || !weekData.dates) return null;
    const keys = Object.keys(weekData.dates).sort();
    for (const k of keys) {
      if (k <= today) continue;
      const arr = weekData.dates[k] || [];
      if (arr.length > 0) {
        return { date: k, count: arr.length };
      }
    }
    return null;
  }, [weekData, today]);

  // Past dates are now selectable — they render an empty/results state.
  const onSelectDay = (date) => setSelectedDate(date);

  // Initial loading: no cache + no server response yet.
  const showInitialLoading = !weekData && !error;

  // Pull-to-refresh — on mobile, dragging down at scrollTop=0 triggers
  // a fresh fetch. The visible indicator follows the drag.
  const { pullDist, triggered } = usePullToRefresh(() => {
    fetchWeek().catch(() => { /* error in state */ });
  });

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
          {showOnboarding && (
            <OnboardingOverlay onClose={() => setShowOnboarding(false)} />
          )}
          {/* Guest-only soft conversion nudge: surfaces 60s after mount.
              Sits above the bottom nav, dismissible, one-shot per session. */}
          {isGuest && !user && <ConversionToast />}
          {streak >= 3 && (
            <div
              className="card mono"
              style={{
                padding: '10px 14px',
                marginBottom: 16,
                fontSize: 12,
                color: 'var(--mint)',
                borderColor: 'rgba(110,231,183,0.3)',
                background:
                  'linear-gradient(180deg, rgba(110,231,183,0.06), transparent), var(--card)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span aria-hidden>🔥</span>
              You're on a {streak}-pick winning streak
            </div>
          )}
          {/* 2px mint progress bar at the very top while a background scan
              runs. Slides left-to-right; replaces the old full-screen
              "Scanning…" card so cached cards stay visible underneath. */}
          {scanning && <div className="top-progress-bar" aria-hidden="true" />}

          {/* Pull-to-refresh indicator — follows the drag distance, fades
              in proportionally, swaps to "Release to refresh" past the
              threshold. Spec: small spinner + "Checking for updates…". */}
          {pullDist > 0 && (
            <div
              className="ptr-indicator"
              style={{
                transform: `translate(-50%, ${Math.min(pullDist, 80) - 28}px)`,
                opacity: Math.min(1, pullDist / 70),
              }}
              role="status"
              aria-live="polite"
            >
              <span className="ptr-spinner" aria-hidden="true" />
              <span>{triggered ? 'Release to refresh' : 'Checking for updates…'}</span>
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <h1
              className="display dash-page-title"
              style={{
                fontSize: 36,
                fontWeight: 700,
                margin: 0,
                letterSpacing: '-0.025em',
              }}
            >
              {pageTitle(selectedDate, today)}
            </h1>
            <p
              className="mono dash-page-sub"
              style={{
                margin: '4px 0 16px',
                color: 'var(--text-3)',
                fontSize: 12,
                letterSpacing: '0.04em',
              }}
            >
              {selectedDate ? dateHeading(selectedDate) : 'MLS'}
            </p>
            <CalendarStrip
              days={days}
              activeDate={selectedDate}
              onSelect={onSelectDay}
            />
            {fixturesForDay.length > 0 && (
              <DailySummaryStrip fixtures={fixturesForDay} />
            )}
          </div>

          {showInitialLoading ? (
            // No cache + no server response yet. Top progress bar handles
            // the loading affordance; we render a tiny placeholder card so
            // the page isn't blank if it takes a beat.
            <div
              className="card"
              style={{ padding: '32px 20px', textAlign: 'center' }}
            >
              <p className="mono" style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>
                Loading picks…
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
            selectedDate === today ? (
              // Today-with-no-matches empty state — large ⚽, "No matches
              // today", a next-picks pointer button (when we know one),
              // and (when we have them) a small strip of recent settled
              // mini-cards so the page never feels barren.
              <div>
                <div
                  className="card"
                  style={{
                    padding: '28px 20px',
                    marginBottom: 16,
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{ fontSize: 44, lineHeight: 1, marginBottom: 12 }}
                    aria-hidden="true"
                  >
                    ⚽
                  </div>
                  <h3
                    className="display"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      margin: '0 0 6px',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    No matches today
                  </h3>
                  {nextFixturesDay ? (
                    <>
                      <p
                        style={{
                          margin: '0 0 14px',
                          color: 'var(--text-2)',
                          fontSize: 13,
                        }}
                      >
                        Next picks: {dateHeading(nextFixturesDay.date)} — {nextFixturesDay.count} matches
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setSelectedDate(nextFixturesDay.date)}
                      >
                        See {(() => {
                          try {
                            return new Date(`${nextFixturesDay.date}T12:00:00Z`)
                              .toLocaleDateString('en-US', { weekday: 'long' });
                          } catch {
                            return 'next day';
                          }
                        })()}'s picks →
                      </button>
                    </>
                  ) : (
                    <p
                      style={{
                        margin: 0,
                        color: 'var(--text-3)',
                        fontSize: 13,
                      }}
                    >
                      Check back later in the week.
                    </p>
                  )}
                </div>
                {recentSettled.length > 0 && (
                  <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--text-3)',
                        letterSpacing: '0.08em',
                      }}
                    >
                      HOW THE AI DID YESTERDAY
                    </div>
                    {recentSettled.map((row) => (
                      <SettledMatchMini key={row.id || `${row.date}-${row.match}`} row={row} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">
                <h3>No matches on this day</h3>
                <p>Pick a different day from the strip above.</p>
              </div>
            )
          ) : (
            <>
              {/* Best-bet banner only on today/future. On past dates we
                  render everything as match cards since "best bet" doesn't
                  make sense after kickoff. */}
              {bestBet && selectedDate >= today && (
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
                  marginBottom: 12,
                }}
              >
                <h2
                  className="display"
                  style={{ fontSize: 20, fontWeight: 600, margin: 0 }}
                >
                  {selectedDate >= today ? 'All matches' : 'Results'}
                </h2>
              </div>

              <div
                className="mc-grid"
                style={{
                  display: 'grid',
                  // min(100%, 420px) collapses to 100% on screens narrower
                  // than 420px so cards never exceed the viewport. Above
                  // 420px the grid behaves as before — auto-fill into
                  // 420px-wide columns. Without this, iPhones (~390px
                  // viewport) had cards 30px wider than the screen and
                  // everything from the team name to "Share" got clipped.
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))',
                  gap: 12,
                }}
              >
                {(selectedDate >= today ? others : fixturesForDay).map((f) => (
                  <MatchCard
                    key={f.id || f.fixtureId}
                    fixture={f}
                    isSharp={sharp}
                    onUpgrade={openUpgrade}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Layout>
  );
}
