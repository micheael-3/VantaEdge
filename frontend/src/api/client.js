import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000',
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
};

export const history = {
  getHistory: () => api.get('/api/history').then((r) => r.data),
  getAccuracy: () => api.get('/api/history/accuracy').then((r) => r.data),
};

export const user = {
  updateEmail: (email, password) => api.post('/api/user/email', { email, password }).then((r) => r.data),
  updatePassword: (currentPassword, newPassword) =>
    api.post('/api/user/password', { currentPassword, newPassword }).then((r) => r.data),
  deleteAccount: (password) => api.delete('/api/user', { data: { password } }).then((r) => r.data),
};

export default api;
