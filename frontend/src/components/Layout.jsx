import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import BottomNav from './BottomNav.jsx';
import UpgradeModal from './UpgradeModal.jsx';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';

// Top bar shown only on mobile, sticky to the top.
// Layout: hamburger · small logo · today's date · plan badge (FREE/PRO).
//
// The hamburger lives INSIDE the bar (not floating fixed) so it can't
// overlap the logo. `onMenu` is wired to the same drawer-open state that
// the Sidebar reads, so the bar and drawer share a single source of
// truth (Layout owns it).
function AppTop({ onMenu }) {
  const { user } = useAuth();
  const pro = isSharp(user);
  let dateStr = '';
  try {
    const d = new Date();
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    dateStr = `Today · ${weekday} ${month} ${d.getDate()}`;
  } catch {
    dateStr = 'Today';
  }
  return (
    <div className="app-top">
      <button
        type="button"
        className="app-top-menu"
        aria-label="Open menu"
        onClick={onMenu}
      >
        <Icon name="menu" size={18} />
      </button>
      <Logo size="sm" />
      <span className="date">{dateStr}</span>
      <span
        className={pro ? 'badge badge-mint' : 'badge badge-soft'}
        style={{ fontSize: 9, padding: '2px 6px' }}
      >
        {pro ? 'PRO' : 'FREE'}
      </span>
    </div>
  );
}

// Wraps Sidebar + main content for all authed pages.
// Sidebar is hidden on mobile via existing CSS; BottomNav takes over.
// Pages call openUpgrade through the render-prop API:
//   <Layout>{({ openUpgrade }) => ...}</Layout>
export default function Layout({ children }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  // Mobile drawer state lives here so AppTop's hamburger and Sidebar's
  // backdrop/close handlers share one source of truth. Sidebar still
  // renders the drawer itself.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const openUpgrade = () => setShowUpgrade(true);

  return (
    <div className="app-shell">
      <Sidebar
        onUpgrade={openUpgrade}
        mobileOpen={mobileMenuOpen}
        setMobileOpen={setMobileMenuOpen}
      />
      <main className="app-main">
        <AppTop onMenu={() => setMobileMenuOpen(true)} />
        {typeof children === 'function' ? children({ openUpgrade }) : children}
      </main>
      <BottomNav />
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
