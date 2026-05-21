import { useEffect } from 'react';
import Icon from './Icon.jsx';
import { openWhopCheckout } from '../lib/checkout.js';

// PRO upgrade modal. Centered card on desktop; on mobile it slides up
// from the bottom (see .upgrade-modal-* in index.css).
// Triggered when FREE users hit a locked overlay or click an upgrade CTA.
export default function UpgradeModal({ onClose }) {
  // ESC to close.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="upgrade-modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="upgrade-modal-content card scale-in"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 20,
          }}
        >
          <span
            className="badge badge-mint"
            style={{
              background: 'var(--mint)',
              color: '#001a10',
              borderColor: 'var(--mint)',
            }}
          >
            PRO
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-3)',
              padding: 4,
            }}
            aria-label="Close"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <h2
          className="display"
          style={{
            margin: '0 0 6px',
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.025em',
            lineHeight: 1.15,
          }}
        >
          Unlock PRO — $4.99/month
        </h2>
        {/* Price-anchor sub-headline — concrete framing of the value. */}
        <p
          style={{
            margin: '0 0 4px',
            color: 'var(--text-2)',
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          One correct pick covers it.
        </p>
        <p
          style={{
            margin: '0 0 20px',
            color: 'var(--text-3)',
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          Cancel anytime.
        </p>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 24px',
            display: 'grid',
            gap: 10,
          }}
        >
          {['Full AI reasoning', 'Bet Tracker', 'Accuracy history'].map((f) => (
            <li
              key={f}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
              }}
            >
              <Icon name="check" size={14} color="var(--mint)" /> {f}
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', padding: '14px 20px', fontSize: 15 }}
          onClick={openWhopCheckout}
        >
          Get PRO <Icon name="arrow-right" size={15} />
        </button>
        <p
          className="mono"
          style={{
            margin: '14px 0 0',
            fontSize: 10,
            color: 'var(--text-faint)',
            textAlign: 'center',
            letterSpacing: '0.04em',
          }}
        >
          CANCEL ANYTIME · 18+ BET RESPONSIBLY
        </p>
      </div>
    </div>
  );
}
