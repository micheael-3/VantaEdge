import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

// One-time, soft conversion nudge for guests. Sits at the bottom of the
// viewport above the bottom nav. Fires 60s after the Dashboard mounts;
// dismissed (X) or skipped (session flag) and it never shows again
// for that browser session.
//
// Intentionally NOT a modal — never blocks reading. The whole point is
// "you've been reading for a minute, here's a nudge if you want it."
const SS_TOAST_SHOWN = '__fs_conversion_toast_shown';

function alreadyShown() {
  if (typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(SS_TOAST_SHOWN) === '1'; } catch { return false; }
}

function markShown() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(SS_TOAST_SHOWN, '1'); } catch { /* ignore */ }
}

export default function ConversionToast({ delayMs = 60000 }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (alreadyShown()) return undefined;
    const t = setTimeout(() => {
      setVisible(true);
      markShown();
    }, delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  if (!visible) return null;
  return (
    <div
      className="conversion-toast"
      role="status"
      style={{
        position: 'fixed',
        // Sits above the bottom nav (56px) + iOS safe area
        bottom: 'calc(70px + env(safe-area-inset-bottom))',
        left: 12,
        right: 12,
        zIndex: 70,
        maxWidth: 460,
        marginInline: 'auto',
        padding: '12px 14px',
        background: 'var(--card)',
        border: '1px solid rgba(110,231,183,0.35)',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        animation: 'fadeIn 0.3s ease-out both',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text)',
            lineHeight: 1.35,
          }}
        >
          Enjoying FastScore?
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            marginTop: 2,
          }}
        >
          Create a free account to save your picks.
        </div>
      </div>
      <Link
        to="/register"
        onClick={() => setVisible(false)}
        className="btn btn-primary btn-sm"
        style={{
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          minHeight: 36,
          padding: '8px 12px',
          fontSize: 12,
        }}
      >
        Sign Up Free →
      </Link>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-3)',
          padding: 6,
          cursor: 'pointer',
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
