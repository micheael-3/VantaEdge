import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isSharp, useAuth } from '../context/AuthContext.jsx';

// Google AdSense ad slot for secondary pages only.
//
// Visibility rules:
//   - PRO users (tier ANALYST / EDGE / admin → isSharp()) see no ads, ever.
//   - Only renders on the secondary content pages listed below — never on
//     /dashboard, /calculator, /bankroll, /settings, or /admin-panel.
//   - Guests + FREE users see ads on the allowed pages.
//
// AdSense activation:
//   - Real publisher ID + slot IDs replace the XXXXXX placeholders once
//     Google approves the site. Until then the <ins> renders but
//     adsbygoogle.push() is a no-op (the runtime stays inert without a
//     valid publisher ID), so the page just shows a blank reserved
//     block — no broken iframe, no console error.
//
// Hooks rule note: useAuth / useLocation / useEffect MUST all be called
// before any conditional return — React's rules-of-hooks. We decide
// `shouldRender` inside the component, and the JSX collapses to `null`
// rather than short-circuiting before the hooks resolve.
const ALLOWED_PAGES = ['/results', '/history', '/affiliate', '/guide'];

// Placeholder publisher ID. Mirrors the one in index.html — keep them
// in sync when swapping in the real ca-pub-… string.
const ADSENSE_CLIENT = 'ca-pub-XXXXXXXXXXXXXXXXX';

export default function AdUnit({ slot, format = 'auto' }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const sharp = isSharp(user);
  const isAllowed = ALLOWED_PAGES.some((p) => pathname.startsWith(p));
  const shouldRender = !sharp && isAllowed;

  useEffect(() => {
    if (!shouldRender) return;
    // Push a render request to the AdSense runtime. Wrapped in a try/catch
    // because the runtime throws if the script hasn't loaded yet (e.g.
    // adblocker, slow network) — we never want a bad ad to take the page
    // down.
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* swallow — AdSense will retry on next render */
    }
  }, [shouldRender, pathname, slot]);

  if (!shouldRender) return null;

  return (
    <div
      // Subtle visual frame so the empty slot doesn't look broken pre-
      // approval, and gives the ad a defined container post-approval.
      className="ad-slot"
      style={{
        margin: '24px 0',
        minHeight: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
