import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { user as userApi } from '../api/client';

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();

  const [emailForm, setEmailForm] = useState({ email: user.email, password: '' });
  const [emailMsg, setEmailMsg] = useState({ type: '', text: '' });

  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwdMsg, setPwdMsg] = useState({ type: '', text: '' });

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
