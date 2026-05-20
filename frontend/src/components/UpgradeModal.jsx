import { useEffect } from 'react';
import Icon from './Icon.jsx';
import { openWhopCheckout } from '../lib/checkout.js';

// SHARP upgrade modal. Ported from the design's app.jsx UpgradeModal.
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
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card scale-in"
        style={{
          padding: 36,
          width: 520,
          maxWidth: '100%',
          borderColor: 'rgba(110,231,183,0.35)',
          background:
            'linear-gradient(180deg, rgba(110,231,183,0.05), transparent), var(--card)',
          boxShadow:
            '0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(110,231,183,0.2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 24,
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
            SHARP
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
            margin: '0 0 12px',
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '-0.025em',
            lineHeight: 1.1,
          }}
        >
          Unlock the{' '}
          <em style={{ color: 'var(--mint)', fontStyle: 'italic' }}>full edge</em>.
        </h2>
        <p
          style={{
            margin: '0 0 24px',
            color: 'var(--text-2)',
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          See EV %, Kelly stakes, AI reasoning, and full bet history. Cancel
          anytime.
        </p>

        <div
          style={{
            padding: 20,
            borderRadius: 10,
            background: 'var(--bg-2)',
            border: '1px solid var(--border-soft)',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <span
              className="display"
              style={{
                fontSize: 38,
                fontWeight: 700,
                letterSpacing: '-0.03em',
              }}
            >
              $9.99
              <span
                className="mono"
                style={{ fontSize: 13, color: 'var(--text-3)' }}
              >
                /mo
              </span>
            </span>
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--text-3)' }}
            >
              CANCEL ANYTIME
            </span>
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 8,
            }}
          >
            {[
              'Live EV Calculator',
              'Kelly Stake % per bet',
              'Bet Tracker with P&L',
              'Full Accuracy History',
              'AI reasoning unlocked',
              'CSV Export',
            ].map((f) => (
              <li
                key={f}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13.5,
                }}
              >
                <Icon name="check" size={13} color="var(--mint)" /> {f}
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', padding: '14px 20px', fontSize: 15 }}
          onClick={openWhopCheckout}
        >
          Get SHARP — $9.99/mo <Icon name="arrow-right" size={15} />
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
