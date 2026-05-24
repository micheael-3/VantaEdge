import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth as authApi } from '../api/client.js';
import { clearReferralCode, readReferralCode } from '../lib/referral.js';

const AuthContext = createContext(null);

// sessionStorage flags used by the guest flow:
//   __fs_guest          → "this visitor entered guest mode this session"
//   __fs_just_registered → set briefly after /register so OnboardingOverlay
//                          knows to fire once
const SS_GUEST_FLAG = '__fs_guest';
const SS_JUST_REGISTERED = '__fs_just_registered';

function readSessionFlag(key) {
  if (typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(key) === '1'; } catch { return false; }
}

function setSessionFlag(key, value) {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.sessionStorage.setItem(key, '1');
    else window.sessionStorage.removeItem(key);
  } catch { /* private browsing — ignore */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Guest mode — set when the user clicks "Start Free" on the landing
  // page (or when /me returns isGuest:true because a guest cookie is
  // still valid from earlier in the session).
  const [isGuest, setIsGuest] = useState(false);
  // Global sign-up prompt state. Any component can request it via
  // requestSignup({ reason }); Layout renders the modal.
  const [signupPromptReason, setSignupPromptReason] = useState(null);

  const refreshUser = useCallback(async () => {
    try {
      const res = await authApi.me();
      if (res && res.isGuest) {
        setUser(null);
        setIsGuest(true);
        return null;
      }
      setUser(res && res.user ? res.user : null);
      setIsGuest(false);
      return res && res.user ? res.user : null;
    } catch (err) {
      // 401 here means either "no session" (landing visitor) or "guest
      // cookie expired". If the sessionStorage guest flag is still set,
      // re-mint a guest cookie so the dashboard can keep working.
      setUser(null);
      const sessionWantsGuest = readSessionFlag(SS_GUEST_FLAG);
      if (sessionWantsGuest) {
        try {
          await authApi.guest();
          setIsGuest(true);
        } catch {
          setIsGuest(false);
          setSessionFlag(SS_GUEST_FLAG, false);
        }
      } else {
        setIsGuest(false);
      }
      void err;
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refreshUser();
      setLoading(false);
    })();
  }, [refreshUser]);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setIsGuest(false);
      setSessionFlag(SS_GUEST_FLAG, false);
    };
    window.addEventListener('auth-logout', onLogout);
    return () => window.removeEventListener('auth-logout', onLogout);
  }, []);

  // Enter guest mode — landing page "Start Free" calls this then routes
  // to /dashboard. Mints a guest cookie server-side so /api/predictions
  // and friends return data instead of 401.
  const enterGuestMode = useCallback(async () => {
    try {
      await authApi.guest();
      setSessionFlag(SS_GUEST_FLAG, true);
      setIsGuest(true);
      setUser(null);
      return true;
    } catch (err) {
      console.error('enterGuestMode failed:', err);
      return false;
    }
  }, []);

  const login = async (email, password) => {
    const { user: u } = await authApi.login(email, password);
    setUser(u);
    setIsGuest(false);
    setSessionFlag(SS_GUEST_FLAG, false);
    setSessionFlag(SS_JUST_REGISTERED, false);
    return u;
  };

  const register = async (email, password) => {
    const referralCode = readReferralCode();
    const { user: u } = await authApi.register(email, password, referralCode);
    if (referralCode) clearReferralCode();
    setUser(u);
    setIsGuest(false);
    setSessionFlag(SS_GUEST_FLAG, false);
    setSessionFlag(SS_JUST_REGISTERED, true);
    return u;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* swallow — clear local state regardless */
    }
    setUser(null);
    setIsGuest(false);
    setSessionFlag(SS_GUEST_FLAG, false);
  };

  // Sign-up prompt orchestration. requestSignup({ reason }) opens the
  // global modal. closeSignupPrompt() dismisses it. The 5-minute dismiss
  // memory lives in sessionStorage so a single rejection doesn't spam
  // the user for the rest of their session.
  const SS_PROMPT_DISMISSED_AT = '__fs_signup_dismissed_at';
  const DISMISS_WINDOW_MS = 5 * 60 * 1000;

  const wasRecentlyDismissed = () => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.sessionStorage.getItem(SS_PROMPT_DISMISSED_AT);
      if (!raw) return false;
      const t = Number(raw);
      return Number.isFinite(t) && Date.now() - t < DISMISS_WINDOW_MS;
    } catch { return false; }
  };

  const requestSignup = useCallback((opts = {}) => {
    // For logged-in users this is a no-op — the gated feature should
    // call openUpgrade() (Whop PRO) instead, not the sign-up prompt.
    if (user) return false;
    if (wasRecentlyDismissed() && !opts.force) return false;
    setSignupPromptReason(opts.reason || 'Create a free account to unlock this');
    return true;
  }, [user]);

  const closeSignupPrompt = useCallback(() => {
    setSignupPromptReason(null);
    if (typeof window !== 'undefined') {
      try { window.sessionStorage.setItem(SS_PROMPT_DISMISSED_AT, String(Date.now())); } catch { /* ignore */ }
    }
  }, []);

  const consumeJustRegistered = useCallback(() => {
    const v = readSessionFlag(SS_JUST_REGISTERED);
    if (v) setSessionFlag(SS_JUST_REGISTERED, false);
    return v;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isGuest,
        login,
        register,
        logout,
        refreshUser,
        enterGuestMode,
        signupPromptReason,
        requestSignup,
        closeSignupPrompt,
        consumeJustRegistered,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// Tier helpers — ANALYST and EDGE both render as "Pro" in the UI.
// Backend enum values stay as ANALYST/EDGE; only the visible label changed.
// Admins always count as Pro regardless of their stored tier so they
// bypass the FREE paywall everywhere (Bet Tracker, AI analysis blur,
// upgrade prompts, etc.).
// NOTE: function name stays `isSharp` for back-compat — it's used in 40+
// call sites. The check still resolves against tier === 'ANALYST'/'EDGE'.
// Guests are never sharp.
export function isSharp(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return user.tier === 'ANALYST' || user.tier === 'EDGE';
}

// tierLabel shows what the user *sees* — admins get a clear "Admin"
// pill so they know their access is granted, not subscribed.
export function tierLabel(user) {
  if (typeof user === 'string') {
    if (user === 'ANALYST' || user === 'EDGE') return 'Pro';
    return 'Free';
  }
  if (user && user.isAdmin) return 'Admin';
  if (user && (user.tier === 'ANALYST' || user.tier === 'EDGE')) return 'Pro';
  return 'Free';
}

// True when the user has the `is_admin` flag set on the server. Always falsy
// for unauthenticated users / guests.
export function isAdmin(user) {
  return !!(user && user.isAdmin);
}
