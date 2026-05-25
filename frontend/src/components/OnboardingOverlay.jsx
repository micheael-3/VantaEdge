import { useState } from 'react';
import Icon from './Icon.jsx';
import { openWhopCheckout } from '../lib/checkout.js';
import api from '../api/client.js';

// Clean 2-step welcome flow.
//   Step 1 — what FastScore is, one "Next" button.
//   Step 2 — soft PRO pitch. "Maybe later" dismisses, "See PRO →" opens
//            Whop checkout and dismisses.
// Both buttons in step 2 mark onboarding_completed=TRUE on the backend
// AND set localStorage so closed states survive a logout. The backend
// flag is the authoritative source — clearing localStorage won't
// re-trigger this overlay for an already-onboarded user.
const STORAGE_KEY = 'fastscore_onboarded';

async function markCompleted() {
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* quota */ }
  }
  try {
    await api.post('/api/user/onboarding', {});
  } catch {
    // Best-effort. If the server call fails, localStorage still prevents
    // re-showing for the current session; the auth /me on next login
    // will trigger the overlay again — fine, user can dismiss again.
  }
}

export default function OnboardingOverlay({ onClose }) {
  const [step, setStep] = useState(1);

  const dismiss = async () => {
    await markCompleted();
    if (onClose) onClose();
  };

  const upgrade = async () => {
    await markCompleted();
    openWhopCheckout();
    if (onClose) onClose();
  };

  return (
    <div
      className="upgrade-modal-backdrop"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="upgrade-modal-content card scale-in"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 16,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              letterSpacing: '0.12em',
            }}
          >
            STEP {step} OF 2
          </span>
          <button
            type="button"
            onClick={dismiss}
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

        {step === 1 ? (
          <>
            <h2
              className="display"
              style={{
                margin: '0 0 12px',
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '-0.025em',
                lineHeight: 1.15,
              }}
            >
              Welcome to FastScore
            </h2>
            <p
              style={{
                margin: '0 0 24px',
                color: 'var(--text-2)',
                fontSize: 14.5,
                lineHeight: 1.6,
              }}
            >
              FastScore analyses every MLS match using AI. We tell you what to
              bet and how confident we are. That's it.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '14px 20px', fontSize: 15 }}
              onClick={() => setStep(2)}
            >
              Next <Icon name="arrow-right" size={15} />
            </button>
          </>
        ) : (
          <>
            <h2
              className="display"
              style={{
                margin: '0 0 12px',
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
              }}
            >
              Want to track if you're making money?
            </h2>
            <p
              style={{
                margin: '0 0 22px',
                color: 'var(--text-2)',
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              PRO unlocks the bet tracker, AI reasoning, and accuracy history —
              for $4.99/month. Cancel anytime.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', padding: '14px 20px', fontSize: 15 }}
                onClick={upgrade}
              >
                See PRO <Icon name="arrow-right" size={15} />
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%', padding: '12px 20px', fontSize: 14 }}
                onClick={dismiss}
              >
                Maybe later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
