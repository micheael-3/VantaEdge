// Icon set ported from the design's shared.jsx.
// Hand-tuned SVGs sized via the `size` prop, coloured via `color`.
export default function Icon({ name, size = 16, color = 'currentColor' }) {
  const s = size;
  const stroke = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  };
  switch (name) {
    case 'trending':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <polyline points="3,17 9,11 13,15 21,7" />
          <polyline points="14,7 21,7 21,14" />
        </svg>
      );
    case 'history':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3,4 3,10 9,10" />
          <polyline points="12,7 12,12 15,14" />
        </svg>
      );
    case 'calc':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <line x1="8" y1="8" x2="16" y2="8" />
          <line x1="8" y1="13" x2="9" y2="13" />
          <line x1="12" y1="13" x2="13" y2="13" />
          <line x1="15" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="9" y2="17" />
          <line x1="12" y1="17" x2="16" y2="17" />
        </svg>
      );
    case 'kelly':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <path d="M3 21V9l5 4 4-6 4 7 5-3v10z" />
        </svg>
      );
    case 'tracker':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="4" x2="9" y2="20" />
        </svg>
      );
    case 'affiliate':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="15" r="3" />
          <line x1="11" y1="10" x2="15" y2="13" />
        </svg>
      );
    case 'settings':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case 'logout':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16,17 21,12 16,7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );
    case 'lock':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12,5 19,12 12,19" />
        </svg>
      );
    case 'check':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <polyline points="4,12 10,18 20,6" />
        </svg>
      );
    case 'x':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      );
    case 'star':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill={color} stroke="none">
          <polygon points="12,2 15,9 22,9.5 17,14.5 18.5,22 12,18.5 5.5,22 7,14.5 2,9.5 9,9" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <polyline points="6,9 12,15 18,9" />
        </svg>
      );
    case 'plus':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'copy':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <rect x="8" y="8" width="13" height="13" rx="2" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </svg>
      );
    case 'brain':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <path d="M9 3a3 3 0 0 0-3 3v.5a3 3 0 0 0-2 2.8v.4a3 3 0 0 0 1.5 2.6A3 3 0 0 0 6 16v.5a3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z" />
          <path d="M15 3a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 2.8v.4a3 3 0 0 1-1.5 2.6A3 3 0 0 1 18 16v.5a3 3 0 0 1-3 3 3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" />
        </svg>
      );
    case 'target':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill={color} stroke="none" />
        </svg>
      );
    case 'bolt':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill={color} stroke="none">
          <polygon points="13,2 4,14 11,14 9,22 20,10 13,10" />
        </svg>
      );
    case 'menu':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      );
    default:
      return null;
  }
}
