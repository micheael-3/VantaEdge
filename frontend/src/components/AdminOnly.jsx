import { Navigate } from 'react-router-dom';
import { isAdmin, useAuth } from '../context/AuthContext.jsx';
import Loading from './Loading.jsx';

// Guards admin-only routes. Requires an authenticated user (Protected
// must wrap this) AND the `is_admin` flag on the user. Non-admins are
// bounced to the dashboard rather than the login screen — they're already
// signed in, they just don't have permission.
export default function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!isAdmin(user)) return <Navigate to="/dashboard" replace />;
  return children;
}
