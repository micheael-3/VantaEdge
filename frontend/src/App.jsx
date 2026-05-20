import { Routes, Route, Navigate } from 'react-router-dom';
import Protected from './components/Protected.jsx';
import PublicOnly from './components/PublicOnly.jsx';
import AdminOnly from './components/AdminOnly.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import History from './pages/History.jsx';
import Settings from './pages/Settings.jsx';
import Affiliate from './pages/Affiliate.jsx';
import EVCalculator from './pages/EVCalculator.jsx';
import KellySizer from './pages/KellySizer.jsx';
import Bankroll from './pages/Bankroll.jsx';
import Guide from './pages/Guide.jsx';
import Landing from './pages/Landing.jsx';
import AdminPanel from './pages/AdminPanel.jsx';

export default function App() {
  return (
    <Routes>
      {/* Public landing for fastscore.eu. Logged-in users are redirected
          to /dashboard from inside the Landing component itself, so we
          don't end up showing them marketing copy every time they hit
          the bare domain. */}
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
            <History />
          </Protected>
        }
      />
      <Route
        path="/tools/ev"
        element={
          <Protected>
            <EVCalculator />
          </Protected>
        }
      />
      <Route
        path="/tools/kelly"
        element={
          <Protected>
            <KellySizer />
          </Protected>
        }
      />
      <Route
        path="/bankroll"
        element={
          <Protected>
            <Bankroll />
          </Protected>
        }
      />
      <Route
        path="/guide"
        element={
          <Protected>
            <Guide />
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
      <Route
        path="/affiliate"
        element={
          <Protected>
            <Affiliate />
          </Protected>
        }
      />
      <Route
        path="/admin-panel"
        element={
          <Protected>
            <AdminOnly>
              <AdminPanel />
            </AdminOnly>
          </Protected>
        }
      />
      {/* Unknown paths bounce to landing — Landing itself forwards logged-in
          users into /dashboard, so this is safe for both audiences. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
