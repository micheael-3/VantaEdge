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
import Bankroll from './pages/Bankroll.jsx';
import Calculator from './pages/Calculator.jsx';
import Guide from './pages/Guide.jsx';
import Landing from './pages/Landing.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import Results from './pages/Results.jsx';

// Route gating rules (updated for guest mode):
//
//   Public (no wrapper):
//     /, /login, /register
//
//   Guest-accessible (no Protected wrapper — render to anyone):
//     /dashboard, /results, /guide, /affiliate, /settings
//
//   Guest-blocked (Protected wrapper renders sign-up screen for guests,
//   redirects to /login for anonymous):
//     /bankroll, /history, /calculator, /admin-panel
//
//   The Settings, Sidebar, BottomNav, and individual gated pages handle
//   their own "if isGuest, show sign-up content" logic for in-page UX —
//   Protected is just the route-level guard.
export default function App() {
  return (
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

      {/* Guest-accessible — render to anyone. Guard logic lives in the
          page components / Sidebar / BottomNav for fine-grained gating. */}
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/results" element={<Results />} />
      <Route path="/guide" element={<Guide />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/affiliate" element={<Affiliate />} />

      {/* Guest-blocked — Protected renders a sign-up screen for guests,
          redirects anonymous visitors to /login. */}
      <Route
        path="/bankroll"
        element={
          <Protected featureName="Sign up to track your bets">
            <Bankroll />
          </Protected>
        }
      />
      <Route
        path="/history"
        element={
          <Protected featureName="Sign up to see your accuracy history">
            <History />
          </Protected>
        }
      />
      <Route
        path="/calculator"
        element={
          <Protected featureName="Sign up to use the stake calculator">
            <Calculator />
          </Protected>
        }
      />
      <Route
        path="/admin-panel"
        element={
          <Protected featureName="Admin access required">
            <AdminOnly>
              <AdminPanel />
            </AdminOnly>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
