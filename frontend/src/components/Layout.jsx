import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import UpgradeModal from './UpgradeModal.jsx';

// Wraps Sidebar + main content for all authed pages.
// Provides the `openUpgrade` callback via React children prop pattern —
// pages call it through context-free prop drilling: <Layout>{(o) => ...}</Layout>
// or just pass `onUpgrade` to children that need it via React.cloneElement.
// For simplicity we expose a render-prop API.
export default function Layout({ children }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const openUpgrade = () => setShowUpgrade(true);

  return (
    <div className="app-shell">
      <Sidebar onUpgrade={openUpgrade} />
      <main className="app-main">
        {typeof children === 'function' ? children({ openUpgrade }) : children}
      </main>
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
