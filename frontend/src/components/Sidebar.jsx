import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';

// Sidebar nav for authed pages.
// 230px wide, sticky to viewport, full-height. On mobile (≤720px),
// it collapses behind a hamburger and slides in when toggled.
const ITEMS = [
  { to: '/dashboard', label: "Today's Edge", icon: 'trending', requiresSharp: false },
  { to: '/history', label: 'History', icon: 'history', requiresSharp: false },
  { to: '/tools/ev', label: 'EV Calculator', icon: 'calc', requiresSharp: true },
  { to: '/tools/kelly', label: 'Kelly Sizer', icon: 'kelly', requiresSharp: true },
  { to: '/bankroll', label: 'Bet Tracker', icon: 'tracker', requiresSharp: true },
  { to: '/affiliate', label: 'Affiliates', icon: 'affiliate', requiresSharp: false },
  { to: '/settings', label: 'Settings', icon: 'settings', requiresSharp: false },
];

export default function Sidebar({ onUpgrade }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sharp = isSharp(user);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initial = (user && user.email && user.email[0].toUpperCase()) || 'U';

  return (
    <>
      {/* Mobile hamburger — only shown on small screens via CSS */}
      <button
        type="button"
        className="sb-mobile-toggle"
        aria-label="Open menu"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <Icon name="menu" size={18} />
      </button>

      <aside className={`sb ${mobileOpen ? 'sb-open' : ''}`}>
        <div
          className="sb-logo"
          onClick={() => {
            navigate('/dashboard');
            setMobileOpen(false);
          }}
        >
          <Logo />
        </div>

        <nav className="sb-nav">
          {ITEMS.map((it) => {
            const isLocked = !sharp && it.requiresSharp;
            return (
              <NavLink
                key={it.to}
                to={it.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `nav-item ${isActive || location.pathname === it.to ? 'active' : ''}`
                }
              >
                <Icon name={it.icon} size={16} />
                <span style={{ flex: 1 }}>{it.label}</span>
                {isLocked && <Icon name="lock" size={11} color="var(--text-faint)" />}
              </NavLink>
            );
          })}
        </nav>

        <div style={{ flex: 1 }} />

        {!sharp && (
          <div
            className="card sb-upgrade"
            style={{
              padding: 16,
              marginBottom: 16,
              borderColor: 'rgba(110,231,183,0.3)',
              background:
                'linear-gradient(180deg, rgba(110,231,183,0.06), transparent)',
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--mint)',
                letterSpacing: '0.1em',
                marginBottom: 6,
              }}
            >
              UPGRADE
            </div>
            <div
              className="display"
              style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}
            >
              Unlock EV + Kelly
            </div>
            <div
              className="mono"
              style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 12 }}
            >
              $9.99/mo · Cancel anytime
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ width: '100%' }}
              onClick={onUpgrade}
            >
              Get SHARP
            </button>
          </div>
        )}

        <div
          style={{
            padding: '12px 8px',
            borderTop: '1px solid var(--border-soft)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #34d399, #818cf8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                color: '#000',
                flexShrink: 0,
              }}
            >
              {initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {(user && user.email) || 'guest'}
              </div>
              <div style={{ marginTop: 2 }}>
                <span
                  className={sharp ? 'badge badge-mint' : 'badge badge-soft'}
                  style={{ fontSize: 9, padding: '2px 6px' }}
                >
                  {sharp ? 'SHARP' : 'FREE'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-3)',
                padding: 4,
              }}
              title="Sign out"
            >
              <Icon name="logout" size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="sb-backdrop" onClick={() => setMobileOpen(false)} />
      )}
    </>
  );
}
