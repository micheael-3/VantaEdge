import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Login failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--bg)',
      }}
    >
      <div
        className="card"
        style={{
          padding: 36,
          width: 400,
          maxWidth: '100%',
          background:
            'linear-gradient(180deg, rgba(110,231,183,0.04), transparent), var(--card)',
        }}
      >
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'center' }}>
          <Logo size="lg" />
        </div>
        <h1
          className="display"
          style={{
            fontSize: 24,
            fontWeight: 700,
            margin: '0 0 6px',
            letterSpacing: '-0.02em',
          }}
        >
          Welcome back
        </h1>
        <p
          style={{
            color: 'var(--text-2)',
            fontSize: 14,
            margin: '0 0 20px',
          }}
        >
          Log in to see today's edge.
        </p>
        <form
          onSubmit={onSubmit}
          style={{ display: 'grid', gap: 14 }}
        >
          <div>
            <label
              className="mono"
              style={{
                display: 'block',
                fontSize: 10,
                color: 'var(--text-3)',
                letterSpacing: '0.1em',
                marginBottom: 6,
              }}
            >
              EMAIL
            </label>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label
              className="mono"
              style={{
                display: 'block',
                fontSize: 10,
                color: 'var(--text-3)',
                letterSpacing: '0.1em',
                marginBottom: 6,
              }}
            >
              PASSWORD
            </label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div
              style={{ color: 'var(--red)', fontSize: 13 }}
              role="alert"
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 6 }}
            disabled={busy}
          >
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <div
          style={{
            marginTop: 18,
            fontSize: 13,
            color: 'var(--text-2)',
            textAlign: 'center',
          }}
        >
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--mint)' }}>
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
