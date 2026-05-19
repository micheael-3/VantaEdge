import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import History from './pages/History';
import Settings from './pages/Settings';
import UpgradeModal from './components/UpgradeModal';
import { useAuth } from './context/AuthContext';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="container" style={{ paddingTop: 60 }}>
        <div className="card">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function HistoryGuard({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.tier !== 'ANALYST' && user.tier !== 'EDGE') {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

export default function App() {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [requiredTier, setRequiredTier] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onUpgrade = (e) => {
      setRequiredTier((e.detail && e.detail.requiredTier) || 'SCOUT');
      setUpgradeOpen(true);
    };
    const onLogout = () => navigate('/login');
    window.addEventListener('upgrade-required', onUpgrade);
    window.addEventListener('auth-logout', onLogout);
    return () => {
      window.removeEventListener('upgrade-required', onUpgrade);
      window.removeEventListener('auth-logout', onLogout);
    };
  }, [navigate]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <Register />
            </PublicOnly>
          }
        />
        <Route
          path="/dashboard"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/history"
          element={
            <Protected>
              <HistoryGuard>
                <History />
              </HistoryGuard>
            </Protected>
          }
        />
        <Route
          path="/settings"
          element={
            <Protected>
              <Settings />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpgradeModal
        open={upgradeOpen}
        requiredTier={requiredTier}
        onClose={() => setUpgradeOpen(false)}
      />
    </>
  );
}
