import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="brand">
          Vanta<span className="brand-mark">·</span>Edge
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
                <NavLink to="/affiliate/dashboard" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  Affiliates
                </NavLink>
                <NavLink to="/blog" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  Blog
                </NavLink>
                <NavLink to="/settings" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  Settings
                </NavLink>
              </div>
              <span className="badge accent mono">{user.tier}</span>
              <button className="btn btn-ghost nav-mobile-hidden" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/blog" className="btn btn-ghost">
                Blog
              </Link>
              <Link to="/affiliate" className="btn btn-ghost">
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
