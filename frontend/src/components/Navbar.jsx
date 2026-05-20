import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { tierLabel, useAuth } from '../context/AuthContext.jsx';

const LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/history', label: 'History' },
  { to: '/affiliate', label: 'Affiliate' },
  { to: '/settings', label: 'Settings' },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setOpen(false);
    navigate('/login');
  };

  const tier = tierLabel(user && user.tier);

  return (
    <nav className={`nav ${open ? 'nav-open' : ''}`}>
      <div className="nav-inner">
        <Link to="/dashboard" className="nav-brand" onClick={() => setOpen(false)}>
          FastScore
        </Link>
        <div className="nav-links">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              {l.label}
            </NavLink>
          ))}
          <button type="button" className="nav-link" onClick={handleLogout}>
            Logout
          </button>
        </div>
        <div className="nav-user">
          <span>{user && user.email}</span>
          <span className={`tier-pill ${tier === 'Sharp' ? 'sharp' : 'free'}`}>{tier}</span>
        </div>
        <button
          type="button"
          className="hamburger"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
        </button>
      </div>
      {open && (
        <div className="mobile-sheet">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </NavLink>
          ))}
          <button type="button" className="nav-link" onClick={handleLogout}>
            Logout
          </button>
          <div className="nav-user">
            <span>{user && user.email}</span>
            <span className={`tier-pill ${tier === 'Sharp' ? 'sharp' : 'free'}`}>{tier}</span>
          </div>
        </div>
      )}
    </nav>
  );
}
