import api from './client';

export const blog = {
  list: (category) =>
    api
      .get('/api/blog', { params: category && category !== 'All' ? { category } : {} })
      .then((r) => r.data),
  get: (slug) => api.get(`/api/blog/${slug}`).then((r) => r.data),
};

export const bestBet = {
  today: () => api.get('/api/best-bet').then((r) => r.data),
};

export default blog;
