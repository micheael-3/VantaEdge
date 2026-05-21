import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth as authApi } from '../api/client.js';
import { clearReferralCode, readReferralCode } from '../lib/referral.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const { user: u } = await authApi.me();
      setUser(u);
      return u;
    } catch {
      setUser(null);
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
    const onLogout = () => setUser(null);
    window.addEventListener('auth-logout', onLogout);
    return () => window.removeEventListener('auth-logout', onLogout);
  }, []);

  const login = async (email, password) => {
    const { user: u } = await authApi.login(email, password);
    setUser(u);
    return u;
  };

  const register = async (email, password) => {
    const referralCode = readReferralCode();
    const { user: u } = await authApi.register(email, password, referralCode);
    if (referralCode) clearReferralCode();
    setUser(u);
    return u;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* swallow — clear local state regardless */
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
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
export function isSharp(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return user.tier === 'ANALYST' || user.tier === 'EDGE';
}

// tierLabel shows what the user *sees* — admins get a clear "Admin"
// pill so they know their access is granted, not subscribed.
export function tierLabel(user) {
  if (typeof user === 'string') {
    // Back-compat: some call sites pass `user.tier` directly.
    if (user === 'ANALYST' || user === 'EDGE') return 'Pro';
    return 'Free';
  }
  if (user && user.isAdmin) return 'Admin';
  if (user && (user.tier === 'ANALYST' || user.tier === 'EDGE')) return 'Pro';
  return 'Free';
}

// True when the user has the `is_admin` flag set on the server. Always falsy
// for unauthenticated users — caller does not need to null-check.
export function isAdmin(user) {
  return !!(user && user.isAdmin);
}
