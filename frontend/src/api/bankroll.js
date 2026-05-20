import api from './client';

export const bankroll = {
  get: () => api.get('/api/bankroll').then((r) => r.data),
  setup: (startingAmount, currency) =>
    api.post('/api/bankroll/setup', { startingAmount, currency }).then((r) => r.data),
  addEntry: (payload) => api.post('/api/bankroll/entry', payload).then((r) => r.data),
  logBet: (payload) => api.post('/api/bankroll/bet', payload).then((r) => r.data),
};

export default bankroll;
