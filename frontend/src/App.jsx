import { Routes, Route, Navigate } from 'react-router-dom';
import Protected from './components/Protected.jsx';
import PublicOnly from './components/PublicOnly.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import History from './pages/History.jsx';
import Settings from './pages/Settings.jsx';
import Affiliate from './pages/Affiliate.jsx';
import EVCalculator from './pages/EVCalculator.jsx';
import KellySizer from './pages/KellySizer.jsx';
import Bankroll from './pages/Bankroll.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
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
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
