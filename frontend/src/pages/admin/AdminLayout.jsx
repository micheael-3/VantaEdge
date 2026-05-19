import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { setAdminToken } from '../../api/admin';

export default function AdminLayout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    setAdminToken('');
    navigate('/admin/login', { replace: true });
  };

  useEffect(() => {
    const onLogout = () => navigate('/admin/login', { replace: true });
    window.addEventListener('admin-logout', onLogout);
    return () => window.removeEventListener('admin-logout', onLogout);
  }, [navigate]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand" style={{ padding: '0 8px 16px' }}>
          Vanta<span className="brand-mark">Edge</span>
          <div className="muted small mono" style={{ marginTop: 4 }}>admin</div>
        </div>
        <nav className="admin-nav">
          <NavLink
            to="/admin/users"
            className={({ isActive }) => (isActive ? 'admin-nav-link active' : 'admin-nav-link')}
          >
            Users
          </NavLink>
          <NavLink
            to="/admin/predictions"
            className={({ isActive }) => (isActive ? 'admin-nav-link active' : 'admin-nav-link')}
          >
            Predictions
          </NavLink>
          <NavLink
            to="/admin/stats"
            className={({ isActive }) => (isActive ? 'admin-nav-link active' : 'admin-nav-link')}
          >
            Stats
          </NavLink>
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <button className="btn btn-ghost" onClick={handleLogout} style={{ width: '100%' }}>
            Logout
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
