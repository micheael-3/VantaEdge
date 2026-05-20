import api from './client';

export const affiliate = {
  join: () => api.post('/api/affiliate/join').then((r) => r.data),
  dashboard: () => api.get('/api/affiliate/dashboard').then((r) => r.data),
  requestPayout: (method, destination) =>
    api.post('/api/affiliate/payout', { method, destination }).then((r) => r.data),
  leaderboard: () => api.get('/api/affiliate/leaderboard').then((r) => r.data),
};

export default affiliate;
