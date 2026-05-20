import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import { userApi } from '../api/client.js';
import { isSharp, tierLabel, useAuth } from '../context/AuthContext.jsx';

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

  const [upgradeMsg, setUpgradeMsg] = useState('');

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
        (err.response && err.response.data && err.response.data.message) ||
        (err.response && err.response.data && err.response.data.error) ||
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
        (err.response && err.response.data && err.response.data.message) ||
        (err.response && err.response.data && err.response.data.error) ||
        'Password change failed';
      setPwMsg({ ok: false, text: msg });
    } finally {
      setPwBusy(false);
    }
  };

  const onLogout = async () => {
    await logout();
    navigate('/');
  };

  const onUpgrade = () => {
    setUpgradeMsg('Sharp upgrades are coming soon — keep an eye on your inbox.');
  };

  return (
    <>
      <Navbar />
      <main className="page">
        <div className="container">
          <div className="dash-header">
            <div>
              <h1>Settings</h1>
              <div className="date-label">Account and subscription.</div>
            </div>
          </div>

          <section className="settings-section">
            <h2>Account</h2>
            <form onSubmit={submitEmail} className="stack" style={{ marginBottom: 24 }}>
              <div className="field-row">
                <div>
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="email-password">Current password</label>
                  <input
                    id="email-password"
                    type="password"
                    autoComplete="current-password"
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              {emailMsg && (
                <div className={emailMsg.ok ? 'success-text' : 'error-text'}>{emailMsg.text}</div>
              )}
              <div>
                <button type="submit" className="btn btn-primary" disabled={emailBusy}>
                  {emailBusy ? 'Updating…' : 'Update email'}
                </button>
              </div>
            </form>

            <form onSubmit={submitPassword} className="stack">
              <h3 style={{ fontSize: 15, color: 'var(--text-dim)', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>
                Change password
              </h3>
              <div className="field-row">
                <div>
                  <label htmlFor="current-password">Current password</label>
                  <input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="new-password">New password (8+ chars)</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              {pwMsg && <div className={pwMsg.ok ? 'success-text' : 'error-text'}>{pwMsg.text}</div>}
              <div>
                <button type="submit" className="btn btn-primary" disabled={pwBusy}>
                  {pwBusy ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          </section>

          <section className="settings-section">
            <h2>Subscription</h2>
            <div className="spread" style={{ marginBottom: 16 }}>
              <div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Current tier</div>
                <span className={`tier-pill ${sharp ? 'sharp' : 'free'}`}>{tier}</span>
              </div>
            </div>
            {!sharp && (
              <div className="upgrade-card">
                <h3>Upgrade to Sharp</h3>
                <div className="muted">Unlock EV + Kelly on every pick.</div>
                <div className="upgrade-price">$9.99<span style={{ fontSize: 14, color: 'var(--text-dim)' }}>/month</span></div>
                <button type="button" className="btn btn-primary" onClick={onUpgrade}>
                  Upgrade
                </button>
                {upgradeMsg && (
                  <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>{upgradeMsg}</div>
                )}
              </div>
            )}
            {sharp && (
              <div className="muted">You’re on Sharp — EV + Kelly are live on every prediction.</div>
            )}
          </section>

          <section className="settings-section">
            <h2>Sign out</h2>
            <p className="muted" style={{ marginBottom: 14 }}>
              You can sign back in any time from the login page.
            </p>
            <button type="button" className="btn" onClick={onLogout}>
              Sign out
            </button>
          </section>
        </div>
      </main>
    </>
  );
}
