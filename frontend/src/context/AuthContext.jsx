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

// Tier helpers — ANALYST and EDGE both render as "Sharp" in the UI.
export function isSharp(user) {
  if (!user || !user.tier) return false;
  return user.tier === 'ANALYST' || user.tier === 'EDGE';
}

export function tierLabel(tier) {
  if (tier === 'ANALYST' || tier === 'EDGE') return 'Sharp';
  return 'Free';
}
