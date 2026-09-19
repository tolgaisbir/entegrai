import { Router } from "express";
import { aiProvidersRouter } from "./admin/aiProviders.js";
import { mcpIntegrationsRouter } from "./admin/mcpIntegrations.js";
import { usersRouter } from "./admin/users.js";
import { skillsRouter } from "./admin/skills.js";
import { rolesRouter } from "./admin/roles.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminRouter = Router();

// DESIGN.md 8 — Admin paneli tamamen is_admin role'üne sahip kullanıcılara kapalı.
adminRouter.use(requireAdmin());

// DESIGN.md 5.1 — AI Ayarları
adminRouter.use("/ai-providers", aiProvidersRouter);

// DESIGN.md 5.2 — MCP Entegrasyonları (mcp_integrations CRUD)
adminRouter.use("/mcp-integrations", mcpIntegrationsRouter);

// DESIGN.md 5.3 — Kullanıcı Yönetimi (users + skill/role atama)
adminRouter.use("/users", usersRouter);

// DESIGN.md 5.4 — Skill Yönetimi
adminRouter.use("/skills", skillsRouter);

// DESIGN.md 5.5 — Role Yönetimi (role CRUD + mcp/ai-provider erişim atamaları)
adminRouter.use("/roles", rolesRouter);

// DESIGN.md 12.7 — Bütçe & Kullanım Yönetimi — TODO
