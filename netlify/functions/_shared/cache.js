// Lightweight in-process cache. Survives within a single warm function instance,
// not across cold starts. Good enough to amortise API-Football calls inside a burst.

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const store = new Map();

function key(endpoint, params) {
  const entries = Object.entries(params || {}).sort(([a], [b]) => a.localeCompare(b));
  return `${endpoint}:${entries.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

// Optional ttlSeconds — converted to ms internally. Defaults to 30 min.
async function getOrFetch(endpoint, params, fetcher, ttlSeconds) {
  const k = key(endpoint, params);
  const hit = store.get(k);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fetcher();
  const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : DEFAULT_TTL_MS;
  store.set(k, { value, expires: Date.now() + ttlMs });
  return value;
}

module.exports = { getOrFetch };
