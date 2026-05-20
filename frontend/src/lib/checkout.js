// Whop checkout helpers — used by UpgradeModal, Sidebar, and Settings.
//
// VITE_WHOP_CHECKOUT_URL is a public URL baked into the bundle at build time.
// We append a `redirect` query param so Whop sends the user back to
// /dashboard?checkout=success, where Dashboard.jsx polls /auth/me until the
// webhook flips the tier.

export const WHOP_CHECKOUT_URL = import.meta.env.VITE_WHOP_CHECKOUT_URL || '#';

export function openWhopCheckout() {
  if (!WHOP_CHECKOUT_URL || WHOP_CHECKOUT_URL === '#') {
    // Surfaced via alert so the build doesn't silently fail at runtime —
    // production should always have VITE_WHOP_CHECKOUT_URL set.
    // eslint-disable-next-line no-alert
    alert('Whop checkout URL is not configured. Set VITE_WHOP_CHECKOUT_URL.');
    return;
  }
  const redirect = `${window.location.origin}/dashboard?checkout=success`;
  const separator = WHOP_CHECKOUT_URL.includes('?') ? '&' : '?';
  const url = `${WHOP_CHECKOUT_URL}${separator}redirect=${encodeURIComponent(redirect)}`;
  window.open(url, '_blank', 'noopener');
}
