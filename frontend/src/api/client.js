import axios from 'axios';

// Frontend and Netlify Functions are same-origin, with /api/* → /.netlify/functions/*
// configured in netlify.toml. Relative baseURL keeps cookies in-scope.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
});

let refreshing = null;

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config || {};
    const status = err.response && err.response.status;
    const code = err.response && err.response.data && err.response.data.error;

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
};

export const predictions = {
  // MLS only (league id 253).
  get: (opts = {}) =>
    api.get('/api/predictions/253', { params: opts }).then((r) => r.data),
  upcoming: (opts = { past: 7, future: 7 }) =>
    api.get('/api/predictions/upcoming/253', { params: opts }).then((r) => r.data),
};

export const history = {
  get: (window) =>
    api
      .get('/api/history', { params: window && window !== 'default' ? { window } : {} })
      .then((r) => r.data),
};

export const userApi = {
  // The backend exposes separate POST endpoints for email + password changes.
  updateEmail: (email, password) =>
    api.post('/api/user/email', { email, password }).then((r) => r.data),
  updatePassword: (currentPassword, newPassword) =>
    api.post('/api/user/password', { currentPassword, newPassword }).then((r) => r.data),
};

export const affiliate = {
  dashboard: () => api.get('/api/affiliate/dashboard').then((r) => r.data),
  join: () => api.post('/api/affiliate/join').then((r) => r.data),
  requestPayout: (method, destination) =>
    api.post('/api/affiliate/payout', { method, destination }).then((r) => r.data),
};

export default api;
