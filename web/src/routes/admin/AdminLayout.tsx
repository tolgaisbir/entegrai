import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "ai-providers", label: "AI Sağlayıcılar" },
  { to: "mcp-integrations", label: "MCP Entegrasyonları" },
  { to: "skills", label: "Skill'ler" },
  { to: "roles", label: "Role'ler" },
  { to: "users", label: "Kullanıcılar" },
  { to: "budget-policies", label: "Bütçe Yönetimi" },
];

export function AdminLayout() {
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? "active" : "")}>
            {l.label}
          </NavLink>
        ))}
      </aside>
      <div className="admin-content">
        <Outlet />
      </div>
    </div>
  );
}
