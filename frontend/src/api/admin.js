import axios from 'axios';

const TOKEN_KEY = 'vantaedge_admin_token';

export function getAdminToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore (private mode etc.)
  }
}

const adminApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
});

adminApi.interceptors.request.use((cfg) => {
  const t = getAdminToken();
  if (t) cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${t}` };
  return cfg;
});

adminApi.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response && err.response.status;
    if (status === 401) {
      setAdminToken('');
      window.dispatchEvent(new CustomEvent('admin-logout'));
    }
    return Promise.reject(err);
  },
);

export async function verifyAdminPassword(password) {
  const res = await axios.post(
    `${import.meta.env.VITE_API_URL || ''}/api/admin/login`,
    {},
    { headers: { Authorization: `Bearer ${password}` } },
  );
  return res.data;
}

export const admin = {
  users: () => adminApi.get('/api/admin/users').then((r) => r.data),
  predictions: () => adminApi.get('/api/admin/predictions').then((r) => r.data),
  stats: () => adminApi.get('/api/admin/stats').then((r) => r.data),
};

export default adminApi;
