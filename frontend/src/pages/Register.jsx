import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await register(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError((err.response && err.response.data && err.response.data.error) || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="container">
        <form className="card auth-card" onSubmit={onSubmit}>
          <h2>Create your account</h2>
          <p className="muted small" style={{ marginBottom: 20 }}>
            Start with the free tier — upgrade any time.
          </p>
          <div className="stack">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">Password (min 8 chars)</label>
              <input
                className="input"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create account'}
            </button>
            <div className="muted small">
              Have an account? <Link to="/login">Log in</Link>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
