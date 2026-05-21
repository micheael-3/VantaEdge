import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import BottomNav from './BottomNav.jsx';
import UpgradeModal from './UpgradeModal.jsx';
import Logo from './Logo.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';

// Top bar shown only on mobile, sticky to the top.
// Layout: small logo · today's date · plan badge (FREE/PRO).
function AppTop() {
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
  const openUpgrade = () => setShowUpgrade(true);

  return (
    <div className="app-shell">
      <Sidebar onUpgrade={openUpgrade} />
      <main className="app-main">
        <AppTop />
        {typeof children === 'function' ? children({ openUpgrade }) : children}
      </main>
      <BottomNav />
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
