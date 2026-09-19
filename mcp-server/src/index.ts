import path from "node:path";
import dotenv from "dotenv";
import express from "express";
import { listToolsForUser, callToolForUser } from "./toolProvider.js";

// DESIGN.md Bölüm 3/7 — MCP Server: ayrı bir servis olarak çalışır, mcp_integrations +
// role_mcp_permissions'a göre kullanıcıya özel tool listesi/çağrısı sunar.
//
// Mimari not (bkz. DESIGN.md 8): Resmi MCP SDK, tekil/stdio istemci senaryosu için
// tasarlanmış; bu servisin tek tüketicisi app/'nin chat akışı olduğundan ve çok
// kullanıcılı, role bazlı yetkilendirme gerektiğinden, SDK'nın transport katmanını
// kullanmak yerine basit, internal-only bir HTTP JSON API (Express) olarak çalışıyor.
// `@modelcontextprotocol/sdk` bağımlılığı, ileride harici MCP istemcilerine (ör.
// Claude Desktop) doğrudan bağlanma desteği eklenmek istenirse kullanılmak üzere
// projede tutuluyor. Sadece localhost'a bind edilir ve `MCP_INTERNAL_SECRET` paylaşılan
// sırrıyla korunur — dışa açık bir servis değildir.

// npm workspace script'leri cwd'yi paket dizinine (mcp-server/) ayarlar; .env repo
// kökünde olduğundan burayı açıkça belirtiyoruz (bkz. app/src/index.ts'teki aynı düzeltme).
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const secret = req.headers["x-internal-secret"];
  const expected = process.env.MCP_INTERNAL_SECRET;
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

app.get("/tools", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  if (!userId) return res.status(400).json({ error: "user_id_required" });
  try {
    res.json(await listToolsForUser(userId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : "Bilinmeyen hata" });
  }
});

app.post("/tools/call", async (req, res) => {
  const { userId, toolName, arguments: toolArgs } = req.body ?? {};
  if (typeof userId !== "string" || typeof toolName !== "string") {
    return res.status(400).json({ error: "user_id_and_tool_name_required" });
  }
  try {
    res.json(await callToolForUser(userId, toolName, toolArgs ?? {}));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : "Bilinmeyen hata" });
  }
});

const port = process.env.MCP_PORT ? Number(process.env.MCP_PORT) : 3100;
app.listen(port, "127.0.0.1", () => {
  console.log(`mcp-server (internal HTTP API) listening on 127.0.0.1:${port}`);
});
