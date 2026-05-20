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
import AdminLogin from './pages/admin/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';
import AdminUsers from './pages/admin/AdminUsers';
import AdminPredictions from './pages/admin/AdminPredictions';
import AdminStats from './pages/admin/AdminStats';
import { getAdminToken } from './api/admin';
import Affiliate from './pages/Affiliate';
import AffiliateDashboard from './pages/AffiliateDashboard';
import RefCapture from './pages/RefCapture';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import Odds from './pages/Odds';
import AdminOdds from './pages/admin/AdminOdds';

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

// TESTING MODE: history page open to all tiers.
function HistoryGuard({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminProtected({ children }) {
  const location = useLocation();
  if (!getAdminToken()) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function OddsGuard({ children }) {
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
          path="/odds"
          element={
            <Protected>
              <OddsGuard>
                <Odds />
              </OddsGuard>
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
        <Route path="/ref/:code" element={<RefCapture />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/affiliate" element={<Affiliate />} />
        <Route
          path="/affiliate/dashboard"
          element={
            <Protected>
              <AffiliateDashboard />
            </Protected>
          }
        />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <AdminProtected>
              <AdminLayout />
            </AdminProtected>
          }
        >
          <Route index element={<Navigate to="/admin/users" replace />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="predictions" element={<AdminPredictions />} />
          <Route path="stats" element={<AdminStats />} />
          <Route path="odds" element={<AdminOdds />} />
        </Route>
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
