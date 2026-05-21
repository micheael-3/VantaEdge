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
    case 'shield':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z" />
          <polyline points="9,12 11,14 15,10" />
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
    case 'help':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-0.7 0.4-1 1-1 1.7v0.5" />
          <line x1="12" y1="17" x2="12" y2="17.01" />
        </svg>
      );
    case 'share':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" {...stroke}>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" />
          <line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
        </svg>
      );
    case 'whatsapp':
      // Simple chat-bubble glyph — monochrome so it inherits color via CSS.
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill={color} stroke="none">
          <path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-2.9.9.9-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.3-.1-1.5-.7-1.8-.8-.2-.1-.4-.1-.6.1l-.8 1c-.2.2-.3.2-.5.1-.3-.1-1.1-.4-2.1-1.3-.8-.7-1.3-1.6-1.5-1.9-.1-.2 0-.4.1-.5l.4-.5c.1-.1.2-.3.2-.4 0-.2 0-.3-.1-.5-.1-.1-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.2-.9.9-.9 2.2 0 1.3.9 2.5 1.1 2.7.1.2 1.8 2.8 4.4 3.9.6.3 1.1.4 1.5.5.6.2 1.2.2 1.7.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.2-.5-.3z" />
        </svg>
      );
    case 'google':
      // Multi-color Google "G" mark. Fixed colors — `color` prop is ignored
      // on purpose so the brand colors are preserved in dark and light UI.
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M21.6 12.2c0-.7-.1-1.3-.2-2H12v3.8h5.4c-.2 1.2-.9 2.2-2 2.9v2.4h3.2c1.9-1.7 3-4.3 3-7.1z" fill="#4285F4" />
          <path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.4c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.5C4.8 19.9 8.1 22 12 22z" fill="#34A853" />
          <path d="M6.4 14.1c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V7.8H3.1A10 10 0 0 0 2 12.2c0 1.6.4 3.1 1.1 4.4l3.3-2.5z" fill="#FBBC05" />
          <path d="M12 6.4c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3.5 14.7 2.5 12 2.5c-3.9 0-7.2 2.1-8.9 5.3l3.3 2.5c.8-2.4 3-4.1 5.6-4.1z" fill="#EA4335" />
        </svg>
      );
    default:
      return null;
  }
}
