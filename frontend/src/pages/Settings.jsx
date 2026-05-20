import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { user as userApi, emailPrefs } from '../api/client';

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();

  const [emailForm, setEmailForm] = useState({ email: user.email, password: '' });
  const [emailMsg, setEmailMsg] = useState({ type: '', text: '' });

  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwdMsg, setPwdMsg] = useState({ type: '', text: '' });

  const [emailNotif, setEmailNotif] = useState(
    user && typeof user.emailNotifications === 'boolean' ? user.emailNotifications : true,
  );
  const [emailNotifBusy, setEmailNotifBusy] = useState(false);
  const [emailNotifMsg, setEmailNotifMsg] = useState({ type: '', text: '' });

  useEffect(() => {
    if (user && typeof user.emailNotifications === 'boolean') setEmailNotif(user.emailNotifications);
  }, [user]);

  const isPaid = user && user.tier && user.tier !== 'FREE';

  const toggleEmailNotif = async (next) => {
    setEmailNotifBusy(true);
    setEmailNotifMsg({ type: '', text: '' });
    // Optimistic flip.
    setEmailNotif(next);
    try {
      await emailPrefs.toggle(next);
      setUser((u) => (u ? { ...u, emailNotifications: next } : u));
      setEmailNotifMsg({ type: 'success', text: next ? 'Daily digest enabled' : 'Daily digest disabled' });
    } catch (err) {
      setEmailNotif(!next);
      setEmailNotifMsg({
        type: 'error',
        text: (err.response && err.response.data && err.response.data.error) || 'Failed to update',
      });
    } finally {
      setEmailNotifBusy(false);
    }
  };

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteMsg, setDeleteMsg] = useState('');

  const submitEmail = async (e) => {
    e.preventDefault();
    setEmailMsg({ type: '', text: '' });
    try {
      const { user: updated } = await userApi.updateEmail(emailForm.email, emailForm.password);
      setUser(updated);
      setEmailForm({ email: updated.email, password: '' });
      setEmailMsg({ type: 'success', text: 'Email updated' });
    } catch (err) {
      setEmailMsg({
        type: 'error',
        text: (err.response && err.response.data && err.response.data.error) || 'Failed to update email',
      });
    }
  };

  const submitPwd = async (e) => {
    e.preventDefault();
    setPwdMsg({ type: '', text: '' });
    try {
      await userApi.updatePassword(pwdForm.currentPassword, pwdForm.newPassword);
      setPwdForm({ currentPassword: '', newPassword: '' });
      setPwdMsg({ type: 'success', text: 'Password updated — log in again next session.' });
    } catch (err) {
      setPwdMsg({
        type: 'error',
        text: (err.response && err.response.data && err.response.data.error) || 'Failed to update password',
      });
    }
  };

  const submitDelete = async () => {
    setDeleteMsg('');
    try {
      await userApi.deleteAccount(deletePassword);
      await logout();
      navigate('/');
    } catch (err) {
      setDeleteMsg((err.response && err.response.data && err.response.data.error) || 'Failed to delete account');
    }
  };

  return (
    <>
      <Navbar />
      <div className="container" style={{ paddingTop: 20, maxWidth: 760 }}>
        <h2>Settings</h2>

        <section className="card" style={{ marginBottom: 20 }}>
          <h3>Account</h3>
          <p className="muted small">Current email: <span className="mono">{user.email}</span></p>
          <form onSubmit={submitEmail} className="stack" style={{ marginTop: 12 }}>
            <div>
              <label className="label">New email</label>
              <input
                className="input"
                type="email"
                value={emailForm.email}
                onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label">Current password</label>
              <input
                className="input"
                type="password"
                value={emailForm.password}
                onChange={(e) => setEmailForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit">
              Update email
            </button>
            {emailMsg.text && (
              <div className={emailMsg.type === 'success' ? 'success-text' : 'error-text'}>{emailMsg.text}</div>
            )}
          </form>
        </section>

        <section className="card" style={{ marginBottom: 20 }}>
          <h3>Password</h3>
          <form onSubmit={submitPwd} className="stack" style={{ marginTop: 12 }}>
            <div>
              <label className="label">Current password</label>
              <input
                className="input"
                type="password"
                value={pwdForm.currentPassword}
                onChange={(e) => setPwdForm((f) => ({ ...f, currentPassword: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label">New password (min 8 chars)</label>
              <input
                className="input"
                type="password"
                minLength={8}
                value={pwdForm.newPassword}
                onChange={(e) => setPwdForm((f) => ({ ...f, newPassword: e.target.value }))}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit">
              Update password
            </button>
            {pwdMsg.text && (
              <div className={pwdMsg.type === 'success' ? 'success-text' : 'error-text'}>{pwdMsg.text}</div>
            )}
          </form>
        </section>

        <section className="card" style={{ marginBottom: 20 }}>
          <h3>Email notifications</h3>
          {isPaid ? (
            <>
              <p className="muted small" style={{ marginTop: -4 }}>
                Get a daily digest of today's top value bets across your accessible leagues, sent at 07:00 UTC.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!emailNotif}
                    onChange={(e) => toggleEmailNotif(e.target.checked)}
                    disabled={emailNotifBusy}
                  />
                  <span className="mono small">{emailNotif ? 'Daily digest ON' : 'Daily digest OFF'}</span>
                </label>
                {emailNotifBusy && <span className="muted small mono">saving…</span>}
              </div>
              {emailNotifMsg.text && (
                <div className={emailNotifMsg.type === 'success' ? 'success-text' : 'error-text'}>
                  {emailNotifMsg.text}
                </div>
              )}
            </>
          ) : (
            <p className="muted small" style={{ marginTop: -4 }}>
              Daily digest emails are a paid-tier feature. Upgrade to Scout or higher to receive
              today's top picks every morning.
            </p>
          )}
        </section>

        <section className="card" style={{ marginBottom: 20 }}>
          <h3>Subscription</h3>
          <p className="muted small">Current tier: <span className="badge accent mono">{user.tier}</span></p>
          <p className="muted small">Billing managed via RevenueCat.</p>
          <a href="#" className="btn" style={{ marginTop: 8 }}>
            Manage subscription
          </a>
        </section>

        <section className="card" style={{ borderColor: 'rgba(239,68,68,0.4)' }}>
          <h3 style={{ color: 'var(--red)' }}>Danger zone</h3>
          <p className="muted small">Permanently delete your account and all predictions.</p>
          {!deleteOpen ? (
            <button className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => setDeleteOpen(true)}>
              Delete account
            </button>
          ) : (
            <div className="stack" style={{ marginTop: 12 }}>
              <div>
                <label className="label">Confirm password</label>
                <input
                  className="input"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                />
              </div>
              <div className="row">
                <button
                  className="btn"
                  style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={submitDelete}
                >
                  Confirm delete
                </button>
                <button className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </button>
              </div>
              {deleteMsg && <div className="error-text">{deleteMsg}</div>}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
