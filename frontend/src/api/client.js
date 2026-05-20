import axios from 'axios';

// Same-origin: frontend and Netlify Functions live on the same domain,
// so we use a relative baseURL and rely on netlify.toml redirects mapping
// /api/* -> /.netlify/functions/*.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
});

let refreshing = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const status = error.response && error.response.status;
    const code = error.response && error.response.data && error.response.data.error;

    if (status === 401 && code === 'TOKEN_EXPIRED' && !original._retried) {
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

    if (status === 403 && code === 'UPGRADE_REQUIRED') {
      const requiredTier = error.response.data.requiredTier || 'SCOUT';
      window.dispatchEvent(new CustomEvent('upgrade-required', { detail: { requiredTier } }));
    }

    return Promise.reject(error);
  },
);

export const auth = {
  register: (email, password) => api.post('/api/auth/register', { email, password }).then((r) => r.data),
  login: (email, password) => api.post('/api/auth/login', { email, password }).then((r) => r.data),
  logout: () => api.post('/api/auth/logout').then((r) => r.data),
  refresh: () => api.post('/api/auth/refresh').then((r) => r.data),
  me: () => api.get('/api/auth/me').then((r) => r.data),
};

export const predictions = {
  getByLeague: (leagueId, opts = {}) =>
    api.get(`/api/predictions/${leagueId}`, { params: opts }).then((r) => r.data),
  getUpcoming: (leagueId, opts = {}) =>
    api.get(`/api/predictions/upcoming/${leagueId}`, { params: opts }).then((r) => r.data),
};

export const history = {
  getHistory: (window) =>
    api.get('/api/history', { params: window && window !== 'default' ? { window } : {} }).then((r) => r.data),
  getAccuracy: () => api.get('/api/history/accuracy').then((r) => r.data),
};

export const user = {
  updateEmail: (email, password) => api.post('/api/user/email', { email, password }).then((r) => r.data),
  updatePassword: (currentPassword, newPassword) =>
    api.post('/api/user/password', { currentPassword, newPassword }).then((r) => r.data),
  deleteAccount: (password) => api.delete('/api/user', { data: { password } }).then((r) => r.data),
  completeOnboarding: (payload) => api.post('/api/user/onboarding', payload).then((r) => r.data),
  savePreferences: (payload) => api.post('/api/user/preferences', payload).then((r) => r.data),
};

export const emailPrefs = {
  toggle: (enabled) => api.post('/api/email/toggle', { enabled }).then((r) => r.data),
};

export default api;
