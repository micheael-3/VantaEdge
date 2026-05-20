const KEY = 'vantaedge_ref';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function storeReferralCode(code) {
  const ls = safeStorage();
  if (!ls || !code) return;
  const normalised = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(normalised)) return;
  ls.setItem(KEY, JSON.stringify({ code: normalised, expires: Date.now() + TTL_MS }));
}

export function readReferralCode() {
  const ls = safeStorage();
  if (!ls) return null;
  const raw = ls.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.code || !parsed.expires) return null;
    if (Date.now() > parsed.expires) {
      ls.removeItem(KEY);
      return null;
    }
    return parsed.code;
  } catch {
    ls.removeItem(KEY);
    return null;
  }
}

export function clearReferralCode() {
  const ls = safeStorage();
  if (ls) ls.removeItem(KEY);
}
