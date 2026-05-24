import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from './Loading.jsx';
import Icon from './Icon.jsx';
import Layout from './Layout.jsx';

// Guards a route. Three outcomes:
//   logged-in user    → render children
//   guest             → render an in-page sign-up screen (do NOT redirect
//                       to /login — they came here intentionally)
//   neither           → redirect to /login like before (back-compat for
//                       any deep link / external nav)
//
// Used on /bankroll, /history, /calculator, /admin-panel. The dashboard,
// results, guide, affiliate and settings routes are NOT wrapped — they
// render to anyone via App.jsx.
export default function Protected({ children, featureName }) {
  const { user, isGuest, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (user) return children;
  if (isGuest) {
    return (
      <Layout>
        {() => (
          <div style={{ maxWidth: 480 }}>
            <div
              className="card"
              style={{
                padding: 28,
                borderColor: 'rgba(110,231,183,0.3)',
                background:
                  'linear-gradient(180deg, rgba(110,231,183,0.05), transparent), var(--card)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  margin: '0 auto 14px',
                  borderRadius: 14,
                  background: 'rgba(110,231,183,0.10)',
                  border: '1px solid rgba(110,231,183,0.3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--mint)',
                }}
              >
                <Icon name="lock" size={24} color="var(--mint)" />
              </div>
              <h2
                className="display"
                style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.02em' }}
              >
                {featureName || 'Create a free account to unlock this'}
              </h2>
              <p style={{ margin: '0 0 18px', color: 'var(--text-2)', fontSize: 13, lineHeight: 1.5 }}>
                Takes 30 seconds. No card required.
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                <Link
                  to="/register"
                  state={{ from: location.pathname }}
                  className="btn btn-primary btn-block"
                  style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
                >
                  Sign Up Free
                </Link>
                <Link
                  to="/login"
                  state={{ from: location.pathname }}
                  className="btn btn-ghost btn-block"
                  style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
                >
                  Log In
                </Link>
              </div>
            </div>
          </div>
        )}
      </Layout>
    );
  }
  return <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
