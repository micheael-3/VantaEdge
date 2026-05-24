import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';

// Bottom navigation for mobile (≤767px). Always visible on app pages,
// hidden on desktop via .bottom-nav { display:none } at >=768px.
// Five equal-width tabs with icon + mono label, active in mint.
// PRO-only tabs (Tracker, Calc) render a tiny lock dot for FREE users
// so they know the feature is gated before tapping. The link still
// resolves — the destination page renders its own locked upsell.
const TABS = [
  { to: '/dashboard', label: 'Home', icon: 'trending' },
  { to: '/results', label: 'Results', icon: 'history' },
  { to: '/bankroll', label: 'Tracker', icon: 'tracker', requiresSharp: true, guestLocked: true },
  { to: '/calculator', label: 'Calc', icon: 'calc', requiresSharp: true, guestLocked: true },
  { to: '/settings', label: 'Account', icon: 'settings' },
];

export default function BottomNav() {
  const { user, isGuest } = useAuth();
  const sharp = isSharp(user);
  return (
    <nav className="bottom-nav" role="navigation" aria-label="Primary">
      {TABS.map((t) => {
        const locked =
          (isGuest && !!t.guestLocked) || (!sharp && !!t.requiresSharp);
        return (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
          >
            <span className="ico" style={{ position: 'relative' }}>
              <Icon name={t.icon} size={20} />
              {locked && (
                <span
                  aria-label="PRO only"
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -6,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: 'var(--card-2)',
                    border: '1px solid var(--border)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-faint)',
                  }}
                >
                  <Icon name="lock" size={7} color="var(--text-faint)" />
                </span>
              )}
            </span>
            <span>{t.label.toUpperCase()}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
