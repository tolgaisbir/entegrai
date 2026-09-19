import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./routes/AppShell";
import { LoginPage } from "./routes/LoginPage";
import { ChangePasswordPage } from "./routes/ChangePasswordPage";
import { RequireAuth, RequireAdmin } from "./auth/ProtectedRoute";
import { ChatPage } from "./routes/ChatPage";
import { AdminLayout } from "./routes/admin/AdminLayout";
import { AiProvidersPage } from "./routes/admin/AiProvidersPage";
import { McpIntegrationsPage } from "./routes/admin/McpIntegrationsPage";
import { SkillsPage } from "./routes/admin/SkillsPage";
import { RolesPage } from "./routes/admin/RolesPage";
import { UsersPage } from "./routes/admin/UsersPage";
import { BudgetPoliciesPage } from "./routes/admin/BudgetPoliciesPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:sessionId" element={<ChatPage />} />

          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="ai-providers" replace />} />
              <Route path="ai-providers" element={<AiProvidersPage />} />
              <Route path="mcp-integrations" element={<McpIntegrationsPage />} />
              <Route path="skills" element={<SkillsPage />} />
              <Route path="roles" element={<RolesPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="budget-policies" element={<BudgetPoliciesPage />} />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
