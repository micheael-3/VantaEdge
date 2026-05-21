import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';

// Bottom navigation for mobile (≤767px). Always visible on app pages,
// hidden on desktop via .bottom-nav { display:none } at >=768px.
// Four equal-width tabs with icon + mono label, active in mint.
const TABS = [
  { to: '/dashboard', label: 'Home', icon: 'trending' },
  { to: '/results', label: 'Results', icon: 'history' },
  { to: '/bankroll', label: 'Tracker', icon: 'tracker' },
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
