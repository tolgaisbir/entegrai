import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="top-nav">
        <span className="brand">Entegrai</span>
        <nav>
          <NavLink to="/chat" className={({ isActive }) => (isActive ? "active" : "")}>
            Sohbet
          </NavLink>
          {user?.isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
              Admin
            </NavLink>
          )}
        </nav>
        <div className="spacer" />
        <span className="user-info">
          {user?.fullName} ({user?.email})
        </span>
        <button onClick={logout}>Çıkış</button>
      </header>
      <div className="app-body">
        <Outlet />
      </div>
    </div>
  );
}
