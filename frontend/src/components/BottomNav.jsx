import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';

// Bottom navigation for mobile (≤767px). Always visible on app pages,
// hidden on desktop via .bottom-nav { display:none } at >=768px.
// Four equal-width tabs with icon + mono label, active in mint.
const TABS = [
  { to: '/dashboard', label: 'Home', icon: 'trending' },
  { to: '/results', label: 'Results', icon: 'history' },
  // Calculator sits between Tracker and Account — same money family,
  // and putting it in the middle keeps the primary nav (Home / Results)
  // and the user nav (Account) anchored at the edges where they're
  // easiest to thumb.
  { to: '/bankroll', label: 'Tracker', icon: 'tracker' },
  { to: '/calculator', label: 'Calc', icon: 'calc' },
  { to: '/settings', label: 'Account', icon: 'settings' },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav" role="navigation" aria-label="Primary">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
        >
          <span className="ico">
            <Icon name={t.icon} size={20} />
          </span>
          <span>{t.label.toUpperCase()}</span>
        </NavLink>
      ))}
    </nav>
  );
}
