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

// Small inline toast used by the post-checkout polling flow. Mint background,
// slide-in from the top, manual close. No library — this is the only place we
// need a toast right now.
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

// MLS-only build; we still need a per-league cache key so a future
// multi-league switch doesn't need a key-format migration.
const MLS_LEAGUE_ID = 253;

// User's browser timezone — used to compute their local "today" and to
// timestamp the "Last updated" label in the right wall-clock hour. We
// intentionally do NOT hardcode Asia/Nicosia so a Cyprus user travelling
// to NYC still sees the right thing.
function userTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// YYYY-MM-DD in the user's local timezone via en-CA (ISO format).
function todayLocalStr() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: userTz() });
  } catch {
    // Fall back to UTC slice — same risk window as the legacy path.
    return new Date().toISOString().slice(0, 10);
  }
}

function cacheKeyFor(leagueId, dateStr) {
  return `fastscore_predictions_${leagueId}_${dateStr}`;
}

function loadCache(leagueId, dateStr) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cacheKeyFor(leagueId, dateStr));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.date === dateStr && parsed.data) return parsed;
  } catch {
    /* ignore quota / parse errors */
  }
  return null;
}

function saveCache(leagueId, dateStr, data) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      cacheKeyFor(leagueId, dateStr),
      JSON.stringify({ data, cachedAt: new Date().toISOString(), date: dateStr }),
    );
  } catch {
    /* quota — silently drop */
  }
}

function formatLastUpdated(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: userTz(),
    });
  } catch {
    return '';
  }
}

// Today's Edge — the dashboard root.
//
// Progressive loading flow (was a single 22s blocking fetch):
//   1. predictions.quick()       → fixtures + form + stats, NO Claude (~2-3s)
//   2. predictions.analyze(id)   → fires N times in parallel, one per fixture
//      Each .then() splices the prediction into that one card. Other cards
//      stay live throughout — no Promise.all gate.
//
// Same-day reloads are served from localStorage so refresh doesn't re-run
// any Claude calls. The cache key embeds the user's local "today" date,
// so a midnight crossing automatically invalidates yesterday's payload.
export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const sharp = isSharp(user);
  const [checkoutToast, setCheckoutToast] = useState(null);
  const [data, setData] = useState(null);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [pinnedDate, setPinnedDate] = useState(null);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState(null);
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

  // Post-checkout polling. Whop opens its checkout in a new tab; on success it
  // sends the user to /dashboard?checkout=success. The webhook is racing this
  // redirect, so we poll /auth/me up to 10× (every 3s = 30s) until the tier
  // flips to ANALYST/EDGE. Strip the query param on success so a manual reload
  // doesn't re-trigger the toast.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return undefined;

    setCheckoutToast({
      kind: 'pending',
      message: 'Payment successful — activating your SHARP plan…',
    });

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
          setCheckoutToast({
            kind: 'success',
            message: 'SHARP plan activated! 🎉',
          });
          const url = new URL(window.location.href);
          url.searchParams.delete('checkout');
          window.history.replaceState({}, '', url.pathname + url.search + url.hash);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (attempts >= maxAttempts) {
        setCheckoutToast({
          kind: 'timeout',
          message:
            'Activation taking longer than expected — refresh the page in a moment.',
        });
        return;
      }
      setTimeout(tick, 3000);
    };

    // Kick off after a short delay so the first poll lets the webhook race.
    const initial = setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [refreshUser]);

  // Splice one analyzed fixture's prediction into `data.fixtures` by fixtureId.
  // Guarded by fetchToken so a stale analyze response from a previous day
  // doesn't corrupt the current view. Also overwrites the matching slot in
  // the localStorage cache so a same-day reload doesn't re-run the Claude
  // call for this fixture.
  const applyAnalysis = useCallback((fixtureId, partial, token) => {
    setData((prev) => {
      if (!prev || token !== fetchTokenRef.current) return prev;
      const list = prev.fixtures || [];
      const idx = list.findIndex((f) => Number(f.fixtureId) === Number(fixtureId));
      if (idx === -1) return prev;
      const updated = list.slice();
      updated[idx] = { ...updated[idx], ...partial };
      const next = { ...prev, fixtures: updated };
      // Mirror the splice into the localStorage cache. Key off the
      // resolved matchDate (handles auto-selected next dates) and fall
      // back to the user's local today if the server didn't send one.
      const cacheDate = next.matchDate || todayLocalStr();
      saveCache(MLS_LEAGUE_ID, cacheDate, next);
      return next;
    });
  }, []);

  const fetchDay = useCallback(
    async (date, isInitial, opts = {}) => {
      const myToken = ++fetchTokenRef.current;
      const force = !!opts.force;
      // Effective target date — when no explicit date, use the user's
      // local "today" so the server gets a TZ-correct calendar day.
      const targetDate = date || todayLocalStr();

      // Cache short-circuit: same-day reload renders instantly with no
      // network calls. Refresh button bypasses by passing force=true.
      if (!force) {
        const cached = loadCache(MLS_LEAGUE_ID, targetDate);
        if (
          cached &&
          cached.data &&
          Array.isArray(cached.data.fixtures) &&
          cached.data.fixtures.length > 0
        ) {
          setData(cached.data);
          setCachedAt(cached.cachedAt || null);
          setLoading(false);
          setSwitching(false);
          setError('');
          return;
        }
      }

      if (isInitial) setLoading(true);
      else setSwitching(true);
      setError('');
      try {
        const params = { date: targetDate };
        if (isInitial) params.initial = 1;
        const res = await predictions.quick(params);
        if (myToken !== fetchTokenRef.current) return; // user moved on
        setData(res);
        const stamp = new Date().toISOString();
        setCachedAt(stamp);
        // Cache under the date the server actually resolved to (could be
        // a future date when autoSelected fired) AND the date we asked for
        // so the next reload of either key short-circuits.
        const resolvedDate = res.matchDate || targetDate;
        saveCache(MLS_LEAGUE_ID, resolvedDate, res);
        if (resolvedDate !== targetDate) {
          saveCache(MLS_LEAGUE_ID, targetDate, res);
        }

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
                  error: 'Data temporarily unavailable',
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
    // When the backend auto-jumped past an empty "today" to the next
    // playable date, prefix the line so users see why the date moved.
    const prefix = data.autoSelected
      ? `NEXT MATCHES · ${label}`
      : label;
    return `${prefix} · ${count} MATCH${count === 1 ? '' : 'ES'} ANALYSED`;
  }, [data]);

  const onSelectDay = (date) => {
    setPinnedDate(date);
    fetchDay(date, false);
  };

  // Force-refresh button: skips the localStorage cache, hits /quick,
  // and re-runs analyze() for each fixture. Overwrites the cache so
  // subsequent reloads short-circuit on the fresh payload.
  const onRefresh = () => {
    fetchDay(pinnedDate, false, { force: true });
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {cachedAt && (
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text-3)' }}
                    title={new Date(cachedAt).toString()}
                  >
                    Last updated · {formatLastUpdated(cachedAt)}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onRefresh}
                  title="Force a fresh fetch (bypasses cache)"
                >
                  Refresh
                </button>
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
