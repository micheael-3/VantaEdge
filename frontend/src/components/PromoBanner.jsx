import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { openWhopCheckout } from '../lib/checkout.js';
import api from '../api/client.js';

// Self-promotional banner system for GUEST and FREE users.
// PRO users (tier=ANALYST/EDGE) never see a banner — early return null.
//
// One banner is chosen per session via sessionStorage. The same banner
// is shown across the session unless dismissed; on dismissal we pick a
// different banner from the remaining pool on the next mount.
//
// Tracking: impressions / clicks / dismissals are sent to
// POST /api/analytics/banner and tallied in localStorage for fallback
// local analytics. Backend stores rows in the BannerEvent table.
//
// Placement is driven by the parent (Dashboard renders it twice — once
// with `placement="desktop"` above "All matches", once with
// `placement="mobile"` inline between match cards — and the right CSS
// hides the wrong one per breakpoint).

// Session keys
const SS_BANNER_PICK = '__fs_promo_banner_pick';
const SS_BANNER_DISMISSED = '__fs_promo_banner_dismissed'; // JSON array of ids
const SS_BANNER_IMPRESSION = '__fs_promo_banner_impression_'; // prefix per banner id

// localStorage analytics — fallback if the network call fails. Useful
// for the admin panel when the server table is empty / migration hasn't
// been run. We always send to the server too.
const LS_BANNER_STATS = '__fs_banner_stats';

// All four banners, in rotation order. The PRO banner is excluded from
// the rotation pool for FREE users who already see the regular Whop
// upgrade card in the sidebar — but the spec says all 4 rotate for
// FREE + GUEST so we keep it.
const BANNERS = [
  {
    id: 'pro_upgrade',
    icon: '⚡',
    headline: "You're missing the AI analysis",
    body:
      'PRO users see exactly why the AI picked this. Full reasoning, confidence breakdown, and bet tracker.',
    cta: 'Upgrade to PRO — $4.99/mo',
    small: 'Cancel anytime · No card required for first 7 days',
    accent: '#34d399', // mint
    bgTint: 'rgba(110,231,183,0.04)',
    // Special handler — opens Whop checkout, not a route.
    action: 'whop',
  },
  {
    id: 'ebook',
    icon: '📖',
    headline: 'New: The FastScore Betting Bible',
    body:
      '100+ page complete guide to profitable sports betting. EV, Kelly, value betting, bankroll management. $9.99 one-time.',
    cta: 'Get the Guide →',
    small: 'PDF + EPUB · 12 chapters · One-time purchase',
    accent: '#818cf8', // indigo
    bgTint: 'rgba(129,140,248,0.05)',
    action: 'route',
    to: '/ebook',
  },
  {
    id: 'affiliate',
    icon: '💰',
    headline: 'Earn $2.00 every month per referral',
    body:
      'Share your link. When someone subscribes to PRO, you earn 40% recurring. Forever. No cap.',
    cta: 'Join Affiliate Program →',
    small: '10 referrals = $240/year passive income',
    accent: '#fbbf24', // amber
    bgTint: 'rgba(251,191,36,0.05)',
    action: 'route',
    to: '/affiliate',
  },
  {
    id: 'social_proof',
    icon: '🔥',
    headline: '68% accuracy this week',
    body:
      'FastScore called 15 from 22 matches correctly. Full history visible to everyone — no cherry picking.',
    cta: 'See Full Accuracy →',
    small: 'Every prediction tracked publicly since launch',
    accent: '#10b981', // green
    bgTint: 'rgba(16,185,129,0.05)',
    action: 'route',
    to: '/history',
  },
];

function readDismissedSet() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(SS_BANNER_DISMISSED);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeDismissedSet(set) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SS_BANNER_DISMISSED, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function pickBannerForSession() {
  if (typeof window === 'undefined') return null;
  const dismissed = readDismissedSet();
  // Try previously picked banner first — gives stable banner per session
  // until dismissed.
  try {
    const pinned = window.sessionStorage.getItem(SS_BANNER_PICK);
    if (pinned && !dismissed.has(pinned)) {
      const found = BANNERS.find((b) => b.id === pinned);
      if (found) return found;
    }
  } catch { /* ignore */ }
  // Otherwise pick at random from remaining pool.
  const pool = BANNERS.filter((b) => !dismissed.has(b.id));
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  try {
    window.sessionStorage.setItem(SS_BANNER_PICK, pick.id);
  } catch { /* ignore */ }
  return pick;
}

// Append to localStorage analytics buckets — best-effort fallback so the
// admin panel always has *some* data even if the network is patchy.
function bumpLocalStat(bannerId, event) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(LS_BANNER_STATS);
    const parsed = raw ? JSON.parse(raw) : {};
    const row = parsed[bannerId] || { impression: 0, click: 0, dismiss: 0 };
    row[event] = (row[event] || 0) + 1;
    parsed[bannerId] = row;
    window.localStorage.setItem(LS_BANNER_STATS, JSON.stringify(parsed));
  } catch { /* quota — ignore */ }
}

function sendEvent(bannerId, event, userTier) {
  bumpLocalStat(bannerId, event);
  // Fire-and-forget — we don't gate UI on network success.
  api
    .post('/api/analytics/banner', { event, bannerId, userTier })
    .catch(() => { /* analytics is best-effort */ });
}

export default function PromoBanner({ placement = 'desktop' }) {
  const { user, isGuest } = useAuth();
  const sharp = isSharp(user);

  // Decide tier label for analytics. Three buckets: guest / free / pro.
  // We bail before render for pro, but include it for completeness if
  // we ever expand the rules.
  const tierLabel = sharp
    ? 'pro'
    : user
      ? 'free'
      : isGuest
        ? 'guest'
        : 'guest';

  const [banner, setBanner] = useState(() => pickBannerForSession());
  const [visible, setVisible] = useState(true);
  // Trigger fade-in on mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 16);
    return () => clearTimeout(t);
  }, []);

  // Log impression once per banner per session (the session flag
  // prevents inflating impressions when both desktop + mobile mounts
  // fire concurrently — only the first wins).
  useEffect(() => {
    if (!banner) return;
    if (sharp) return;
    const key = `${SS_BANNER_IMPRESSION}${banner.id}`;
    try {
      if (window.sessionStorage.getItem(key) === '1') return;
      window.sessionStorage.setItem(key, '1');
    } catch { /* ignore */ }
    sendEvent(banner.id, 'impression', tierLabel);
  }, [banner, sharp, tierLabel]);

  // PRO users — render nothing, ever.
  if (sharp) return null;
  if (!banner) {
    // All four dismissed. AdSense fallback slot lives here for future.
    return (
      <>
        {/*
          GOOGLE ADSENSE FALLBACK
          When all self-promo banners are dismissed, show a third-party
          ad here. Uncomment + drop in the AdSense unit when ready to
          activate. The wrapper div + placement class is the same shape
          as the self-promo banner so layout won't shift.

          <div className={`promo-banner-slot promo-${placement}-only`}>
            <ins
              className="adsbygoogle"
              style={{ display: 'block' }}
              data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
              data-ad-slot="XXXXXXXXXX"
              data-ad-format="auto"
              data-full-width-responsive="true"
            />
          </div>
        */}
      </>
    );
  }
  if (!visible) return null;

  const onDismiss = () => {
    setVisible(false);
    if (!banner) return;
    const set = readDismissedSet();
    set.add(banner.id);
    writeDismissedSet(set);
    sendEvent(banner.id, 'dismiss', tierLabel);
    // Clear the pinned pick so the next mount picks a fresh one.
    try { window.sessionStorage.removeItem(SS_BANNER_PICK); } catch { /* ignore */ }
  };

  const onCtaClick = () => {
    sendEvent(banner.id, 'click', tierLabel);
    if (banner.action === 'whop') {
      openWhopCheckout();
    }
    // For route actions, the <Link> handles navigation natively.
  };

  // The CTA renders as either a Link or a button depending on action.
  const ctaContent = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{banner.cta}</span>
  );
  const ctaCommon = {
    className: 'btn btn-primary btn-sm promo-banner-cta',
    onClick: onCtaClick,
    style: {
      whiteSpace: 'nowrap',
      minHeight: 28,
      height: 28,
      padding: '0 12px',
      fontSize: 12,
      textDecoration: 'none',
      flexShrink: 0,
    },
  };
  const cta = banner.action === 'route'
    ? <Link to={banner.to} {...ctaCommon}>{ctaContent}</Link>
    : <button type="button" {...ctaCommon}>{ctaContent}</button>;

  // Wrapper class drives mobile-only vs desktop-only visibility.
  const wrapperClass = `promo-banner promo-${placement}-only${mounted ? ' promo-banner-in' : ''}`;

  return (
    <div
      className={wrapperClass}
      role="complementary"
      aria-label="Promotional banner"
      style={{
        position: 'relative',
        padding: 16,
        borderRadius: 10,
        borderLeft: `3px solid ${banner.accent}`,
        background: `linear-gradient(90deg, ${banner.bgTint}, transparent), var(--card)`,
        border: '1px solid var(--border-soft)',
        borderLeftWidth: 3,
        borderLeftColor: banner.accent,
        overflow: 'hidden',
        opacity: mounted ? 1 : 0,
        transition: 'opacity 400ms ease-out',
      }}
    >
      {/* Dismiss X — top-right on all layouts */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss banner"
        className="promo-banner-dismiss"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-3)',
          padding: 4,
          cursor: 'pointer',
          lineHeight: 0,
        }}
      >
        <Icon name="x" size={14} />
      </button>

      {/* Inner layout — desktop is one row, mobile stacks. The
          .promo-banner-inner CSS rule in index.css drives the flip. */}
      <div className="promo-banner-inner">
        <div
          className="promo-banner-icon"
          aria-hidden="true"
          style={{
            fontSize: 20,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {banner.icon}
        </div>
        <div className="promo-banner-text" style={{ minWidth: 0, flex: 1 }}>
          <div
            className="promo-banner-headline"
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text)',
              lineHeight: 1.3,
              paddingRight: 22, // leave room for the X
            }}
          >
            {banner.headline}
          </div>
          <div
            className="promo-banner-body"
            style={{
              fontSize: 12,
              color: 'var(--text-3)',
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            {banner.body}
          </div>
          {banner.small && (
            <div
              className="promo-banner-small mono"
              style={{
                fontSize: 10,
                color: 'var(--text-faint)',
                marginTop: 6,
                letterSpacing: '0.04em',
              }}
            >
              {banner.small}
            </div>
          )}
        </div>
        <div className="promo-banner-action">{cta}</div>
      </div>
    </div>
  );
}

// Exported for the admin panel to render labels alongside stats.
export const PROMO_BANNERS = BANNERS;
