import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AgentStatus from './AgentStatus';
import agentApi from '../api/agent';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { unread } = await agentApi.alerts();
        if (!cancelled) setUnreadAlerts(Number(unread) || 0);
      } catch { /* swallow */ }
    };
    load();
    const id = setInterval(load, 120 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="brand">
          FastScore
        </Link>
        <div className="row" style={{ gap: 14 }}>
          {user ? (
            <>
              <div className="row nav-mobile-hidden" style={{ gap: 14 }}>
                <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  Dashboard
                </NavLink>
                {/* TESTING MODE: History link visible to all tiers. */}
                <NavLink to="/history" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  History
                </NavLink>
                {(user.tier === 'ANALYST' || user.tier === 'EDGE') && (
                  <NavLink to="/odds" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                    Odds
                  </NavLink>
                )}
                {(user.tier === 'ANALYST' || user.tier === 'EDGE') && (
                  <NavLink to="/bankroll" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                    Bankroll
                  </NavLink>
                )}
                {user.tier === 'EDGE' && (
                  <NavLink to="/accuracy" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                    Accuracy
                  </NavLink>
                )}
                <NavLink to="/affiliate/dashboard" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  Affiliates
                </NavLink>
                <NavLink to="/blog" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  Blog
                </NavLink>
                <NavLink to="/settings" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  Settings
                </NavLink>
                <NavLink
                  to="/alerts"
                  className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
                  style={{ position: 'relative' }}
                >
                  Alerts
                  {unreadAlerts > 0 && (
                    <span
                      className="mono"
                      style={{
                        marginLeft: 6,
                        background: 'var(--accent)',
                        color: '#052e1f',
                        borderRadius: 999,
                        padding: '1px 6px',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {unreadAlerts > 99 ? '99+' : unreadAlerts}
                    </span>
                  )}
                </NavLink>
              </div>
              <AgentStatus />
              <span className="badge accent mono">{user.tier}</span>
              <button className="btn btn-ghost nav-mobile-hidden" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/blog" className="btn btn-ghost nav-mobile-hidden">
                Blog
              </Link>
              <Link to="/affiliate" className="btn btn-ghost nav-mobile-hidden">
                Affiliates
              </Link>
              <Link to="/login" className="btn btn-ghost">
                Login
              </Link>
              <Link to="/register" className="btn btn-primary">
                Start Free
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
