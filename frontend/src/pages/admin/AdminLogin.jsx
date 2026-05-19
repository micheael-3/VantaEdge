import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { verifyAdminPassword, setAdminToken } from '../../api/admin';

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!password) {
      setError('Password required');
      return;
    }
    setLoading(true);
    try {
      await verifyAdminPassword(password);
      setAdminToken(password);
      const from = (location.state && location.state.from) || '/admin/users';
      navigate(from, { replace: true });
    } catch (err) {
      const status = err.response && err.response.status;
      const serverMsg = err.response && err.response.data && err.response.data.error;
      // Surface what actually went wrong so we can diagnose.
      if (status === 401) setError('Invalid password');
      else if (status === 404) setError('Endpoint not found (404) — has the latest deploy completed?');
      else if (status === 503) setError(serverMsg || 'Admin disabled — ADMIN_PASSWORD env var not set on Netlify');
      else if (status) setError(`HTTP ${status}: ${serverMsg || 'Login failed'}`);
      else setError(`Network error: ${err.message || 'unknown'}`);
      setAdminToken('');
      // Also log full error to console for further detail.
      // eslint-disable-next-line no-console
      console.error('Admin login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h2>Admin login</h2>
        <p className="muted small" style={{ marginBottom: 20 }}>
          Enter the admin password to access the panel.
        </p>
        <div className="stack">
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Login'}
          </button>
        </div>
      </form>
    </div>
  );
}
