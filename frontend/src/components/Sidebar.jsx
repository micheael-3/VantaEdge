import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isAdmin, isSharp, useAuth } from '../context/AuthContext.jsx';
import { openWhopCheckout } from '../lib/checkout.js';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';

// Sidebar nav for authed pages.
// 230px wide, sticky to viewport, full-height. On mobile it's hidden
// entirely — the bottom-nav takes over (see BottomNav.jsx).
//
// `requiresSharp` — feature is PRO-only. FREE users see a lock icon
//                   and land on the in-page upgrade overlay.
// `guestLocked`   — feature is logged-in-only. Guests see a lock icon
//                   and land on the Protected sign-up screen.
const ITEMS = [
  { to: '/dashboard', label: 'Home', icon: 'trending' },
  { to: '/results', label: 'Results', icon: 'history' },
  { to: '/bankroll', label: 'Bet Tracker', icon: 'tracker', requiresSharp: true, guestLocked: true },
  { to: '/calculator', label: 'Calculator', icon: 'calc', requiresSharp: true, guestLocked: true },
  { to: '/history', label: 'Accuracy', icon: 'history', guestLocked: true },
  { to: '/guide', label: 'How It Works', icon: 'brain' },
  { to: '/affiliate', label: 'Affiliates', icon: 'affiliate' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export default function Sidebar({ onUpgrade, mobileOpen = false, setMobileOpen = () => {} }) {
  const { user, isGuest, logout } = useAuth();
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
      <aside className={`sb ${mobileOpen ? 'sb-open' : ''}`}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingRight: 8,
          }}
        >
          <div
            className="sb-logo"
            onClick={() => {
              navigate('/dashboard');
              setMobileOpen(false);
            }}
          >
            <Logo />
          </div>
          <button
            type="button"
            className="sb-close"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <nav className="sb-nav">
          {ITEMS.map((it) => {
            const isLocked =
              (isGuest && !!it.guestLocked) || (!sharp && !!it.requiresSharp);
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

        {/* Guests see a "Sign Up Free" CTA instead of the PRO upgrade
            card — they need an account first; PRO is the next step.
            FREE users get the existing Unlock PRO card. PRO users get
            neither (the upgrade card hides via the `!sharp` check). */}
        {isGuest && !user && (
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
              Save your picks · Bet Tracker · Accuracy
            </div>
            <Link
              to="/register"
              onClick={() => setMobileOpen(false)}
              className="btn btn-primary btn-sm"
              style={{ width: '100%', textDecoration: 'none' }}
            >
              Sign Up Free
            </Link>
          </div>
        )}

        {!isGuest && !sharp && user && (
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

        {/* Footer: guests get a small "Sign up" cluster; logged-in users
            get the avatar / email / tier badge / logout row. */}
        {isGuest && !user ? (
          <div
            style={{
              padding: '12px 8px',
              borderTop: '1px solid var(--border-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className="badge badge-soft"
                style={{ fontSize: 9, padding: '2px 6px' }}
              >
                GUEST
              </span>
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--text-2)',
                  textDecoration: 'none',
                  letterSpacing: '0.04em',
                }}
              >
                Log in
              </Link>
            </div>
          </div>
        ) : (
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
        )}
      </aside>

      {mobileOpen && (
        <div className="sb-backdrop" onClick={() => setMobileOpen(false)} />
      )}
    </>
  );
}
