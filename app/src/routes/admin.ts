import { Router } from "express";

export const adminRouter = Router();

// DESIGN.md 5.1 — AI Ayarları (ai_providers CRUD) — TODO
// DESIGN.md 5.2 — MCP Entegrasyonları (mcp_integrations CRUD) — TODO
// DESIGN.md 5.3 — Kullanıcı Yönetimi (users + skill/role atama) — TODO
// DESIGN.md 5.4 — Skill Yönetimi — TODO
// DESIGN.md 5.5 — Role Yönetimi — TODO
// DESIGN.md 12.7 — Bütçe & Kullanım Yönetimi — TODO

adminRouter.get("/", (_req, res) => {
  res.json({ message: "admin api placeholder" });
});
