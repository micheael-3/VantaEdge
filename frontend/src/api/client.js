import axios from 'axios';

// Frontend and Netlify Functions are same-origin, with /api/* → /.netlify/functions/*
// configured in netlify.toml. Relative baseURL keeps cookies in-scope.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
});

let refreshing = null;
let guestRefreshing = null;

// Two recovery paths on a 401:
//   1. Logged-in user with TOKEN_EXPIRED → hit /api/auth/refresh
//      (uses the httpOnly refresh-token cookie).
//   2. Guest mode (sessionStorage __fs_guest === '1') → hit
//      /api/auth/guest which mints a fresh guest JWT with tier=GUEST.
//      Guests don't have a refresh token, so they can't use path 1.
//
// Previously path 2 didn't exist — guests whose 15-min guest cookie
// expired hit a hard 401 wall ("Couldn't load predictions /
// UNAUTHORIZED") on the dashboard. Now we transparently re-mint.
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config || {};
    const status = err.response && err.response.status;
    const code = err.response && err.response.data && err.response.data.error;

    if (status === 401 && !original._retried) {
      const isGuest =
        typeof window !== 'undefined' &&
        (() => {
          try { return window.sessionStorage.getItem('__fs_guest') === '1'; }
          catch { return false; }
        })();

      // Guest mode: re-mint the guest cookie. Works for any 401 reason
      // (TOKEN_EXPIRED, plain UNAUTHORIZED, missing cookie). Once the
      // new guest JWT lands the original request gets retried.
      if (isGuest) {
        original._retried = true;
        try {
          if (!guestRefreshing) {
            guestRefreshing = api.post('/api/auth/guest').finally(() => {
              guestRefreshing = null;
            });
          }
          await guestRefreshing;
          return api(original);
        } catch (e) {
          // Re-mint failed (network down, JWT_SECRET unset, etc). Drop
          // the guest flag so we don't infinite-loop, then surface.
          try { window.sessionStorage.removeItem('__fs_guest'); } catch { /* ignore */ }
          window.dispatchEvent(new CustomEvent('auth-logout'));
          return Promise.reject(e);
        }
      }

      // Logged-in user: refresh-token flow. Same as before.
      if (code === 'TOKEN_EXPIRED') {
        original._retried = true;
        try {
          if (!refreshing) {
            refreshing = api.post('/api/auth/refresh').finally(() => {
              refreshing = null;
            });
          }
          await refreshing;
          return api(original);
        } catch (e) {
          window.dispatchEvent(new CustomEvent('auth-logout'));
          return Promise.reject(e);
        }
      }

      // Unrecoverable 401 — neither a guest nor a refreshable session.
      // Rewrite the error payload so downstream `error.data.error`
      // displays don't show raw "UNAUTHORIZED" / "FORBIDDEN" strings.
      // Pages that surface this can still detect a 401 via status,
      // but the user-visible text is friendlier.
      if (err.response && err.response.data) {
        err.response.data.error = 'Please sign in to view this';
        err.response.data.friendly = true;
      }
    }
    return Promise.reject(err);
  },
);

// --- typed endpoint helpers ---

export const auth = {
  register: (email, password, referralCode) =>
    api
      .post('/api/auth/register', referralCode ? { email, password, referralCode } : { email, password })
      .then((r) => r.data),
  login: (email, password) =>
    api.post('/api/auth/login', { email, password }).then((r) => r.data),
  logout: () => api.post('/api/auth/logout').then((r) => r.data),
  me: () => api.get('/api/auth/me').then((r) => r.data),
  // Mint a guest access cookie. No DB row, 15-min TTL — the frontend
  // re-mints on demand via the sessionStorage __fs_guest flag.
  guest: () => api.post('/api/auth/guest').then((r) => r.data),
};

export const predictions = {
  // MLS only (league id 253).
  // `get` (legacy) — bundles fixtures + Claude analysis in one slow round-trip.
  // Kept for callers that still need the all-in-one shape, but the dashboard
  // now uses `quick` + per-fixture `analyze` for progressive rendering.
  get: (opts = {}) =>
    api.get('/api/predictions/253', { params: opts }).then((r) => r.data),
  // Step 1 of the progressive flow: fixtures + form + stats + actualResult.
  // Returns ~2-3s warm, ~5-7s cold. Predictions are null at this point.
  quick: (opts = {}) =>
    api.get('/api/predictions/quick', { params: opts }).then((r) => r.data),
  // Step 2 of the progressive flow: Claude analysis for one fixture.
  // ~5-10s per call, Claude-bound. The frontend fires 4 of these in parallel
  // after `quick` resolves and splices each result into its matching card.
  analyze: (fixtureId) =>
    api.get('/api/predictions/analyze', { params: { fixtureId } }).then((r) => r.data),
  upcoming: (opts = { past: 7, future: 7 }) =>
    api.get('/api/predictions/upcoming/253', { params: opts }).then((r) => r.data),
  // Weekly read endpoint. Server figures out the Monday-Sunday window, reads
  // every prediction row in it, and triggers a background scan if the table
  // is empty. Returns { dates, scanning, progress, lastScanned, weekStart }.
  week: () =>
    api.get('/api/predictions/week').then((r) => r.data),
};

export const history = {
  // Cache-buster `_t` forces iOS Safari + Netlify edge to skip any
  // stale cached copy — combined with the no-store response headers
  // this guarantees fresh data on every call.
  get: (window) =>
    api
      .get('/api/history', {
        params: {
          ...(window && window !== 'default' ? { window } : {}),
          _t: Date.now(),
        },
      })
      .then((r) => r.data),
  // Per-bucket settled-prediction hit rate vs claimed model confidence. Kept
  // running on the backend so confidence numbers shown on the dashboard are
  // already calibrated transparently — UI no longer surfaces the chart.
  calibration: () => api.get('/api/history/calibration').then((r) => r.data),
  streak: () => api.get('/api/history/streak').then((r) => r.data),
};

export const userApi = {
  // The backend exposes separate POST endpoints for email + password changes.
  updateEmail: (email, password) =>
    api.post('/api/user/email', { email, password }).then((r) => r.data),
  updatePassword: (currentPassword, newPassword) =>
    api.post('/api/user/password', { currentPassword, newPassword }).then((r) => r.data),
};

export const admin = {
  stats: () => api.get('/api/admin/stats').then((r) => r.data),
  users: () => api.get('/api/admin/users').then((r) => r.data),
  predictions: () => api.get('/api/admin/predictions').then((r) => r.data),
  setTier: (userId, tier) =>
    api.post(`/api/admin/users/${userId}/tier`, { tier }).then((r) => r.data),
  // Force a fresh weekly scan for the given league. Deletes this week's
  // predictions + scan_status, then fires the background scanner.
  forceRescan: (leagueId) =>
    api.post(`/api/admin/rescan/${leagueId}`).then((r) => r.data),
  // Wipe ALL prediction-related tables (10 of them) including settled
  // accuracy history, then trigger a fresh background scan. Requires
  // the caller to send the literal string "DELETE ALL" — the AdminPanel
  // UI prompts the user to type it before this fires.
  clearAll: (confirmation) =>
    api.post('/api/admin/clear-all', { confirmation }).then((r) => r.data),
  // Delete only synthetic 50/50 placeholder rows (legacy fallback path).
  // Safe — never touches settled rows.
  clearBad: () => api.post('/api/admin/clear-bad').then((r) => r.data),
  // Re-run the agent-results settle pipeline immediately. Walks every
  // past prediction missing hit columns, fetches the score from
  // API-Football, writes hit/miss + accuracy_score. Used to recover
  // settled data after an accidental wipe.
  resettle: () => api.post('/api/admin/resettle').then((r) => r.data),
  // Non-destructive refresh of form arrays inside match_data on every
  // upcoming row. UPDATEs match_data in place — never DELETEs anything,
  // never touches over_hit / btts_hit. Use when form dots on today's
  // cards look thin/empty because of stale stored data.
  refreshForms: () => api.post('/api/admin/refresh-forms').then((r) => r.data),
  // Score-only recovery from API-Football. Inserts placeholder rows
  // for every finished MLS fixture in the last N days that doesn't
  // already exist. Use to repopulate Results after a data loss.
  // NO fabricated AI predictions — recovered rows are flagged so the
  // UI renders them distinctly and they're excluded from accuracy stats.
  recoverHistory: (days = 30) =>
    api.post(`/api/admin/recover-history?days=${days}`).then((r) => r.data),
  // Strips ghost rows (over_confidence 0/null) and collapses duplicate
  // fixture_id rows to the highest-confidence one. Pre-migration cleanup
  // so the new UNIQUE (fixture_id) constraint can be added safely.
  deduplicate: () => api.post('/api/admin/deduplicate').then((r) => r.data),
  // Per-fixture inspector. Returns raw API-Football responses, the
  // extracted form/stats/standings, and the matchData that would be
  // sent to Claude. Used by the "Debug Fixture" UI in the admin panel.
  debugFixture: (fixtureId) =>
    api.get(`/api/admin/debug-fixture/${fixtureId}`).then((r) => r.data),
  // Run the bundled schema.sql against Neon. Idempotent (every CREATE
  // uses IF NOT EXISTS, every ALTER uses ADD COLUMN IF NOT EXISTS) so
  // safe to hit any time a new schema lands. Powered by the existing
  // splitter in admin.js — see runSchemaMigration there.
  migrate: () => api.post('/api/admin/migrate').then((r) => r.data),
  // Immediately settle every finished prediction whose hit columns
  // are still null. Same engine as the 2-hour cron — use when a match
  // just finished and the dashboard/accuracy page should reflect it now.
  settleNow: () => api.post('/api/admin/settle-now').then((r) => r.data),
};

// Self-learning upgrade: AI persona + per-user feedback.
//
// `persona.get()` is a public, no-auth GET — the BestBetBanner reads it
// on mount and renders a mood dot + catchphrase. Cached server-side
// for ~5 minutes, so calling on every dashboard load is fine.
//
// `feedback.rate()` posts a 1–5 star rating against a prediction id;
// `feedback.my()` returns the user's last 10 ratings (used by the
// account page later if we surface them).
export const persona = {
  get: () => api.get('/api/persona').then((r) => r.data),
};

// Public intelligence-score endpoint. Powers the Admin Intelligence
// tab today; the dashboard widget that reads it lives in a follow-up.
export const intelligence = {
  get: () => api.get('/api/intelligence').then((r) => r.data),
};

export const feedback = {
  rate: (predictionId, rating, comment) =>
    api
      .post('/api/feedback', comment ? { predictionId, rating, comment } : { predictionId, rating })
      .then((r) => r.data),
  my: () => api.get('/api/feedback/my').then((r) => r.data),
};

export const affiliate = {
  dashboard: () => api.get('/api/affiliate/dashboard').then((r) => r.data),
  join: () => api.post('/api/affiliate/join').then((r) => r.data),
  requestPayout: (method, destination) =>
    api.post('/api/affiliate/payout', { method, destination }).then((r) => r.data),
};

// Bet Tracker cross-device sync. The page mirrors its localStorage blob
// into the server so the same logged-in account sees the same bets on
// iPad + PC + phone. Save is debounced client-side to keep churn down.
export const bankrollApi = {
  getBets: () => api.get('/api/bankroll/bets').then((r) => r.data),
  saveBets: (bets) =>
    api.put('/api/bankroll/bets', { bets }).then((r) => r.data),
};

// Promo banner analytics. POSTs are fire-and-forget; the GET is
// admin-only and powers the Banner Stats card in the Admin Stats tab.
export const analytics = {
  bannerEvent: (bannerId, event, userTier) =>
    api.post('/api/analytics/banner', { bannerId, event, userTier }).then((r) => r.data),
  bannerStats: () =>
    api.get('/api/analytics/banner/stats').then((r) => r.data),
};

export default api;
