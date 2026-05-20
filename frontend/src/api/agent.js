import api from './client';

export const agentApi = {
  status: () => api.get('/api/agent/status').then((r) => r.data),
  alerts: () => api.get('/api/alerts').then((r) => r.data),
  feed: () => api.get('/api/alerts/feed').then((r) => r.data),
  markAllRead: () => api.post('/api/alerts/read').then((r) => r.data),
  accuracy: () => api.get('/api/accuracy').then((r) => r.data),
  oddsMovement: (fixtureId) => api.get(`/api/odds/movement/${fixtureId}`).then((r) => r.data),
};

export default agentApi;
