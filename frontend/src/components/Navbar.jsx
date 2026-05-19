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
        <Link to={user ? '/dashboard' : '/'} className="brand">
          Vanta<span className="brand-mark">Edge</span>
        </Link>
        <div className="row" style={{ gap: 14 }}>
          {user ? (
            <>
              <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                Dashboard
              </NavLink>
              {(user.tier === 'ANALYST' || user.tier === 'EDGE') && (
                <NavLink to="/history" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                  History
                </NavLink>
              )}
              <NavLink to="/settings" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
                Settings
              </NavLink>
              <span className="badge accent mono">{user.tier}</span>
              <button className="btn btn-ghost" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <>
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
