import { Router } from "express";
import { aiProvidersRouter } from "./admin/aiProviders.js";
import { mcpIntegrationsRouter } from "./admin/mcpIntegrations.js";

export const adminRouter = Router();

// DESIGN.md 5.1 — AI Ayarları
adminRouter.use("/ai-providers", aiProvidersRouter);

// DESIGN.md 5.2 — MCP Entegrasyonları (mcp_integrations CRUD)
adminRouter.use("/mcp-integrations", mcpIntegrationsRouter);

// DESIGN.md 5.3 — Kullanıcı Yönetimi (users + skill/role atama) — TODO
// DESIGN.md 5.4 — Skill Yönetimi — TODO
// DESIGN.md 5.5 — Role Yönetimi — TODO
// DESIGN.md 12.7 — Bütçe & Kullanım Yönetimi — TODO
