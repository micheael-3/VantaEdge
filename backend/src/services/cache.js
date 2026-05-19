const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

function buildKey(endpoint, params) {
  const entries = Object.entries(params || {}).sort(([a], [b]) => a.localeCompare(b));
  const paramString = entries.map(([k, v]) => `${k}=${v}`).join('&');
  return `${endpoint}:${paramString}`;
}

async function getOrFetch(endpoint, params, fetcher) {
  const key = buildKey(endpoint, params);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const fresh = await fetcher();
  cache.set(key, fresh);
  return fresh;
}

function invalidate(prefix) {
  const keys = cache.keys().filter((k) => k.startsWith(prefix));
  cache.del(keys);
}

module.exports = { cache, buildKey, getOrFetch, invalidate };
