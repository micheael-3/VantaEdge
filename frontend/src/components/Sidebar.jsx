import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isAdmin, isSharp, useAuth } from '../context/AuthContext.jsx';
import { openWhopCheckout } from '../lib/checkout.js';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';

// Sidebar nav for authed pages.
// 230px wide, sticky to viewport, full-height. On mobile it's hidden
// entirely — the bottom-nav takes over (see BottomNav.jsx).
const ITEMS = [
  { to: '/dashboard', label: 'Home', icon: 'trending', requiresSharp: false },
  { to: '/results', label: 'Results', icon: 'history', requiresSharp: false },
  { to: '/bankroll', label: 'Bet Tracker', icon: 'tracker', requiresSharp: true },
  // Calculator sits directly below Bet Tracker — same money/staking
  // family. FREE-tier accessible: it's just math, no model data.
  { to: '/calculator', label: 'Calculator', icon: 'calc', requiresSharp: false },
  { to: '/history', label: 'Accuracy', icon: 'history', requiresSharp: false },
  { to: '/guide', label: 'How It Works', icon: 'brain', requiresSharp: false },
  { to: '/affiliate', label: 'Affiliates', icon: 'affiliate', requiresSharp: false },
  { to: '/settings', label: 'Settings', icon: 'settings', requiresSharp: false },
];

export default function Sidebar({ onUpgrade, mobileOpen = false, setMobileOpen = () => {} }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sharp = isSharp(user);
  const admin = isAdmin(user);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initial = (user && user.email && user.email[0].toUpperCase()) || 'U';

  return (
    <>
      {/* Hamburger lives in AppTop now (Layout.jsx) so it sits inside
          the sticky bar and can't overlap the brand. The Sidebar only
          renders the drawer body + backdrop here. */}

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
          {admin && (
            <NavLink
              to="/admin-panel"
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-item ${isActive || location.pathname === '/admin-panel' ? 'active' : ''}`
              }
            >
              <Icon name="shield" size={16} />
              <span style={{ flex: 1 }}>Admin Panel</span>
            </NavLink>
          )}
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
              Unlock PRO
            </div>
            <div
              className="mono"
              style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 12 }}
            >
              $4.99/mo · Cancel anytime
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ width: '100%' }}
              onClick={openWhopCheckout}
            >
              Get PRO
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
              <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span
                  className={sharp ? 'badge badge-mint' : 'badge badge-soft'}
                  style={{ fontSize: 9, padding: '2px 6px' }}
                >
                  {sharp ? 'PRO' : 'FREE'}
                </span>
                {admin && (
                  <span
                    className="badge badge-mint"
                    style={{ fontSize: 9, padding: '2px 6px' }}
                    title="Admin account"
                  >
                    ADMIN
                  </span>
                )}
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
