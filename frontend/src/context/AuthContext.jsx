import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { auth as authApi } from '../api/client';
import { readReferralCode, clearReferralCode } from '../lib/referral';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await authApi.me();
      setUser(user);
      return user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('auth-logout', onLogout);
    return () => window.removeEventListener('auth-logout', onLogout);
  }, []);

  const login = async (email, password) => {
    const { user } = await authApi.login(email, password);
    setUser(user);
    return user;
  };

  const register = async (email, password) => {
    const referralCode = readReferralCode();
    const { data } = await api.post('/api/auth/register', {
      email,
      password,
      ...(referralCode ? { referralCode } : {}),
    });
    if (referralCode) clearReferralCode();
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
