import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { userApi } from '../api/client.js';
import { isAdmin, isSharp, useAuth } from '../context/AuthContext.jsx';
import { openWhopCheckout } from '../lib/checkout.js';
import Icon from '../components/Icon.jsx';

// Account page — radically simplified in the mobile UI polish round.
//
// Primary view (always visible):
//   - User email
//   - Plan badge (FREE / PRO)
//   - Upgrade to PRO button (FREE) or Manage subscription link (PRO)
//   - Sign out (red text, no button background)
//
// "Manage credentials" expander (collapsed by default) keeps the
// email-change and password-change forms accessible without polluting
// the casual-bettor account view. Removing them outright would have
// taken away the only in-app way to update creds.
//
// Admin and footer links (How It Works / Affiliates) preserved below
// the primary view for admins / power users who need them.
export default function Settings() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const sharp = isSharp(user);
  const admin = isAdmin(user);

  const [credsOpen, setCredsOpen] = useState(false);

  const [newEmail, setNewEmail] = useState(user ? user.email : '');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailMsg, setEmailMsg] = useState(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);

  const submitEmail = async (e) => {
    e.preventDefault();
    setEmailMsg(null);
    setEmailBusy(true);
    try {
      await userApi.updateEmail(newEmail.trim(), emailPassword);
      setEmailMsg({ ok: true, text: 'Email updated.' });
      setEmailPassword('');
      await refreshUser();
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Email update failed';
      setEmailMsg({ ok: false, text: msg });
    } finally {
      setEmailBusy(false);
    }
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword.length < 8) {
      setPwMsg({ ok: false, text: 'New password must be at least 8 characters.' });
      return;
    }
    setPwBusy(true);
    try {
      await userApi.updatePassword(currentPassword, newPassword);
      setPwMsg({ ok: true, text: 'Password changed.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Password change failed';
      setPwMsg({ ok: false, text: msg });
    } finally {
      setPwBusy(false);
    }
  };

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Layout>
      {() => (
        <div style={{ maxWidth: 480 }}>
          <h1
            className="display dash-page-title"
            style={{
              fontSize: 36,
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-0.025em',
            }}
          >
            Account
          </h1>

          {/* Primary card — email + plan badge */}
          <div
            className="card"
            style={{
              padding: 20,
              marginTop: 18,
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--text-3)',
                  letterSpacing: '0.1em',
                  marginBottom: 4,
                }}
              >
                SIGNED IN AS
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {(user && user.email) || 'guest'}
              </div>
            </div>
            <span
              className={sharp ? 'badge badge-mint' : 'badge badge-soft'}
              style={{ flexShrink: 0 }}
            >
              {sharp ? 'PRO' : 'FREE'}
            </span>
          </div>

          {/* Upgrade / Manage button — primary action */}
          {sharp ? (
            <a
              href="https://whop.com/hub"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-block"
              style={{ width: '100%', marginBottom: 14 }}
            >
              ✓ PRO Active · Manage subscription
            </a>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ width: '100%', marginBottom: 14 }}
              onClick={openWhopCheckout}
            >
              Upgrade to PRO — €4.99/mo
            </button>
          )}

          {/* Manage credentials — collapsed by default */}
          <div className="card" style={{ padding: 0, marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setCredsOpen((v) => !v)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                padding: '14px 18px',
                color: 'var(--text-2)',
                fontSize: 13,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
              aria-expanded={credsOpen}
            >
              <span>Manage credentials</span>
              <span
                style={{
                  transform: credsOpen ? 'rotate(180deg)' : 'rotate(0)',
                  transition: 'transform 0.2s',
                  display: 'inline-flex',
                }}
              >
                <Icon name="chevron-down" size={14} />
              </span>
            </button>
            {credsOpen && (
              <div
                style={{
                  borderTop: '1px solid var(--border-soft)',
                  padding: 18,
                  display: 'grid',
                  gap: 18,
                }}
              >
                {/* Email form */}
                <form onSubmit={submitEmail} style={{ display: 'grid', gap: 10 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    CHANGE EMAIL
                  </div>
                  <input
                    className="input"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="New email"
                    required
                  />
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="Current password"
                    required
                  />
                  {emailMsg && (
                    <div
                      style={{
                        fontSize: 13,
                        color: emailMsg.ok ? 'var(--mint)' : 'var(--red)',
                      }}
                    >
                      {emailMsg.text}
                    </div>
                  )}
                  <button
                    type="submit"
                    className="btn btn-ghost btn-sm"
                    disabled={emailBusy}
                    style={{ justifySelf: 'start' }}
                  >
                    {emailBusy ? 'Updating…' : 'Update email'}
                  </button>
                </form>

                {/* Password form */}
                <form onSubmit={submitPassword} style={{ display: 'grid', gap: 10 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    CHANGE PASSWORD
                  </div>
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    required
                  />
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (8+ chars)"
                    required
                  />
                  {pwMsg && (
                    <div
                      style={{
                        fontSize: 13,
                        color: pwMsg.ok ? 'var(--mint)' : 'var(--red)',
                      }}
                    >
                      {pwMsg.text}
                    </div>
                  )}
                  <button
                    type="submit"
                    className="btn btn-ghost btn-sm"
                    disabled={pwBusy}
                    style={{ justifySelf: 'start' }}
                  >
                    {pwBusy ? 'Changing…' : 'Change password'}
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Admin / utility links */}
          {admin && (
            <Link
              to="/admin-panel"
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '14px 18px',
                marginBottom: 14,
                textDecoration: 'none',
                color: 'var(--mint)',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <Icon name="shield" size={14} />
              <span style={{ flex: 1 }}>Admin Panel</span>
              <span className="badge badge-mint" style={{ fontSize: 9, padding: '2px 6px' }}>
                ADMIN
              </span>
            </Link>
          )}

          {/* Logout — red text, no button background */}
          <button
            type="button"
            onClick={onLogout}
            style={{
              background: 'none',
              border: 'none',
              padding: '12px 0',
              color: 'var(--red)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>

          <div
            style={{
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              padding: '18px 0 0',
              borderTop: '1px solid var(--border-soft)',
              marginTop: 12,
            }}
          >
            <Link
              to="/history"
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.04em',
              }}
            >
              Accuracy History
            </Link>
            <Link
              to="/guide"
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.04em',
              }}
            >
              How It Works
            </Link>
            <Link
              to="/affiliate"
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.04em',
              }}
            >
              Affiliates
            </Link>
          </div>
        </div>
      )}
    </Layout>
  );
}
