import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import BottomNav from './BottomNav.jsx';
import UpgradeModal from './UpgradeModal.jsx';
import SignupPrompt from './SignupPrompt.jsx';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';

// Top bar shown only on mobile, sticky to the top.
// Layout (left→right): hamburger · logo · date · plan badge.
//
// The hamburger opens a slide-in drawer (Sidebar in mobile mode) for
// quick access to less-used pages — Affiliates, How It Works, Settings,
// Admin Panel. The bottom nav still owns the primary 4 tabs; the
// drawer doesn't replace it, it complements it.
function AppTop({ onMenu }) {
  const { user, isGuest } = useAuth();
  const pro = isSharp(user);
  let dateStr = '';
  try {
    const d = new Date();
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    dateStr = `${weekday} ${month} ${d.getDate()}`;
  } catch {
    dateStr = 'Today';
  }
  // Three badge states: PRO (mint), FREE (soft), GUEST (soft + "Sign up
  // free →" link wrapping). Guests get a clickable hint that takes them
  // to /register so the badge does double-duty as a conversion CTA.
  let badgeNode;
  if (isGuest && !user) {
    badgeNode = (
      <Link
        to="/register"
        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <span
          className="badge badge-soft"
          style={{ fontSize: 9, padding: '2px 6px', letterSpacing: '0.06em' }}
        >
          GUEST
        </span>
        <span
          className="mono"
          style={{ fontSize: 9, color: 'var(--mint)', letterSpacing: '0.04em' }}
        >
          Sign up →
        </span>
      </Link>
    );
  } else {
    badgeNode = (
      <span
        className={pro ? 'badge badge-mint' : 'badge badge-soft'}
        style={{ fontSize: 9, padding: '2px 6px' }}
      >
        {pro ? 'PRO' : 'FREE'}
      </span>
    );
  }
  return (
    <div className="app-top">
      <button
        type="button"
        className="app-top-menu"
        aria-label="Open menu"
        onClick={onMenu}
      >
        <Icon name="menu" size={20} />
      </button>
      <Logo size="sm" />
      <span className="date">{dateStr}</span>
      {badgeNode}
    </div>
  );
}

// Wraps Sidebar + main content for all authed pages.
// On desktop: Sidebar is a sticky left rail.
// On mobile: Sidebar slides in from the left as a drawer when the
// hamburger in AppTop is tapped. BottomNav handles the primary tabs.
// Pages call openUpgrade through the render-prop API:
//   <Layout>{({ openUpgrade }) => ...}</Layout>
//
// `tab-fade` key bound to the current pathname so that React re-mounts
// the children wrapper on every route change, replaying a 200ms opacity
// fade. Gives bottom-nav transitions the "smooth tab switch" feel the
// spec asks for without dragging in a route-transition library.
export default function Layout({ children }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const openUpgrade = () => setShowUpgrade(true);

  // Close the drawer automatically on route change. Otherwise tapping
  // a drawer link slides you to the new page with the drawer still
  // sitting open over it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the drawer is open so the page underneath
  // doesn't move when the user pans on the overlay.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = drawerOpen ? 'hidden' : prev || '';
    return () => { document.body.style.overflow = prev || ''; };
  }, [drawerOpen]);

  return (
    <div className="app-shell">
      <Sidebar
        onUpgrade={openUpgrade}
        mobileOpen={drawerOpen}
        setMobileOpen={setDrawerOpen}
      />
      <main className="app-main">
        <AppTop onMenu={() => setDrawerOpen(true)} />
        <div key={location.pathname} className="tab-fade">
          {typeof children === 'function' ? children({ openUpgrade }) : children}
        </div>
      </main>
      <BottomNav />
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      {/* Global sign-up prompt — any component opens it via
          useAuth().requestSignup({ reason }). Only one instance,
          rendered here so it sits above page content but below modals. */}
      <SignupPrompt />
    </div>
  );
}
