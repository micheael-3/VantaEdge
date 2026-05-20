import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { userApi } from '../api/client.js';
import { isSharp, tierLabel, useAuth } from '../context/AuthContext.jsx';

// Settings page — restyled to use the design's card + token system.
// The visual structure stays simple (the design bundle did not include
// a Settings screen) but uses dark Syne/Mono typography and mint accents
// throughout, matching the rest of the app.
export default function Settings() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const sharp = isSharp(user);
  const tier = tierLabel(user && user.tier);

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
      {({ openUpgrade }) => (
        <div style={{ maxWidth: 720 }}>
          <div style={{ marginBottom: 28 }}>
            <h1
              className="display"
              style={{
                fontSize: 36,
                fontWeight: 700,
                margin: 0,
                letterSpacing: '-0.025em',
              }}
            >
              Settings
            </h1>
            <p
              className="mono"
              style={{
                margin: '4px 0 0',
                color: 'var(--text-3)',
                fontSize: 12,
                letterSpacing: '0.04em',
              }}
            >
              ACCOUNT · SUBSCRIPTION
            </p>
          </div>

          <div className="card" style={{ padding: 24, marginBottom: 16 }}>
            <h3
              className="display"
              style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}
            >
              Email
            </h3>
            <form onSubmit={submitEmail} style={{ display: 'grid', gap: 12 }}>
              <div>
                <label
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.1em',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  EMAIL ADDRESS
                </label>
                <input
                  className="input"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.1em',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  CURRENT PASSWORD
                </label>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  required
                />
              </div>
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
              <div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={emailBusy}
                >
                  {emailBusy ? 'Updating…' : 'Update email'}
                </button>
              </div>
            </form>
          </div>

          <div className="card" style={{ padding: 24, marginBottom: 16 }}>
            <h3
              className="display"
              style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}
            >
              Password
            </h3>
            <form onSubmit={submitPassword} style={{ display: 'grid', gap: 12 }}>
              <div>
                <label
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.1em',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  CURRENT PASSWORD
                </label>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div>
                <label
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.1em',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  NEW PASSWORD (8+ CHARS)
                </label>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
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
              <div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={pwBusy}
                >
                  {pwBusy ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          </div>

          <div
            className="card"
            style={{
              padding: 24,
              marginBottom: 16,
              borderColor: sharp ? 'rgba(110,231,183,0.3)' : 'var(--border)',
              background: sharp
                ? 'linear-gradient(180deg, rgba(110,231,183,0.05), transparent), var(--card)'
                : 'var(--card)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <h3
                className="display"
                style={{ margin: 0, fontSize: 18, fontWeight: 600 }}
              >
                Subscription
              </h3>
              <span
                className={sharp ? 'badge badge-mint' : 'badge badge-soft'}
              >
                {tier.toUpperCase()}
              </span>
            </div>
            {sharp ? (
              <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13 }}>
                You're on SHARP — EV + Kelly + Tracker are unlocked.
              </p>
            ) : (
              <>
                <p style={{ margin: '0 0 12px', color: 'var(--text-2)', fontSize: 13 }}>
                  Upgrade to unlock EV %, Kelly stakes, AI reasoning, and the
                  full bet tracker.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openUpgrade}
                >
                  Get SHARP — $9.99/mo
                </button>
              </>
            )}
          </div>

          <div className="card" style={{ padding: 24 }}>
            <h3
              className="display"
              style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}
            >
              Sign out
            </h3>
            <p style={{ margin: '0 0 12px', color: 'var(--text-2)', fontSize: 13 }}>
              You can sign back in any time from the login page.
            </p>
            <button type="button" className="btn btn-ghost" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
