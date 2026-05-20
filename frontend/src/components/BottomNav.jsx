import { NavLink } from 'react-router-dom';

const ICONS = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  odds: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 17l5-5 4 4 8-8" />
      <path d="M14 8h6v6" />
    </svg>
  ),
  bankroll: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="7" cy="14.5" r="1" fill="currentColor" />
    </svg>
  ),
  history: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3h0a1.65 1.65 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8v0a1.65 1.65 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z" />
    </svg>
  ),
};

export default function BottomNav({ tier }) {
  const items = [{ to: '/dashboard', label: 'Today', icon: ICONS.dashboard, end: true }];
  if (tier === 'ANALYST' || tier === 'EDGE') {
    items.push({ to: '/odds', label: 'Odds', icon: ICONS.odds });
    items.push({ to: '/bankroll', label: 'Bank', icon: ICONS.bankroll });
  }
  items.push({ to: '/history', label: 'History', icon: ICONS.history });
  items.push({ to: '/settings', label: 'Settings', icon: ICONS.settings });

  return (
    <nav className="bn-bar" aria-label="Primary">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={!!it.end}
          className={({ isActive }) => `bn-link ${isActive ? 'active' : ''}`}
        >
          <span className="bn-icon">{it.icon}</span>
          <span className="bn-label">{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
