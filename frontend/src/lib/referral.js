// localStorage key is intentionally 'vantaedge_ref' — live affiliate links in
// the wild already set this key, so renaming would drop existing referrals.
const KEY = 'vantaedge_ref';

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readReferralCode() {
  const ls = safeStorage();
  if (!ls) return null;
  const raw = ls.getItem(KEY);
  if (!raw) return null;
  // Stored value may be a plain string or a JSON envelope { code, expires }.
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.code) {
      if (parsed.expires && Date.now() > parsed.expires) {
        ls.removeItem(KEY);
        return null;
      }
      return String(parsed.code).toUpperCase();
    }
  } catch {
    // Not JSON — treat as raw code.
    return String(raw).toUpperCase();
  }
  return null;
}

export function clearReferralCode() {
  const ls = safeStorage();
  if (ls) ls.removeItem(KEY);
}
