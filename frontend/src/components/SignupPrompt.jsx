import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Global sign-up prompt. Rendered in Layout; any component opens it via
// useAuth().requestSignup({ reason }). Two visual modes — controlled by
// CSS, not props:
//   ≥768px → small centred modal
//   <768px → bottom-sheet
//
// Dismissal memory (5 min) lives in AuthContext so this component stays
// dumb. A dismissed prompt won't reopen for the rest of the session
// unless the caller passes { force: true }.
export default function SignupPrompt() {
  const { signupPromptReason, closeSignupPrompt } = useAuth();
  if (!signupPromptReason) return null;
  return (
    <div
      className="signup-prompt-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSignupPrompt();
      }}
    >
      <div className="signup-prompt-content card">
        <button
          type="button"
          onClick={closeSignupPrompt}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-3)',
            padding: 6,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          <Icon name="x" size={16} />
        </button>
        <div
          style={{
            width: 48,
            height: 48,
            margin: '4px auto 14px',
            borderRadius: 12,
            background: 'rgba(110,231,183,0.12)',
            border: '1px solid rgba(110,231,183,0.3)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--mint)',
          }}
        >
          <Icon name="lock" size={22} color="var(--mint)" />
        </div>
        <h3
          className="display"
          style={{
            margin: '0 0 6px',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            textAlign: 'center',
          }}
        >
          Create a free account to unlock this
        </h3>
        <p
          style={{
            margin: '0 0 18px',
            color: 'var(--text-2)',
            fontSize: 13,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {signupPromptReason}
          <br />
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
            Takes 30 seconds. No card required.
          </span>
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          <Link
            to="/register"
            onClick={closeSignupPrompt}
            className="btn btn-primary btn-block"
            style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
          >
            Sign Up Free
          </Link>
          <Link
            to="/login"
            onClick={closeSignupPrompt}
            className="btn btn-ghost btn-block"
            style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
          >
            Log In
          </Link>
        </div>
      </div>
    </div>
  );
}
