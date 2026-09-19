import { Router } from "express";
import { z } from "zod";
import {
  McpIntegrationType,
  type McpIntegration,
  type Prisma,
  encryptConnectionConfig,
  maskConnectionConfig,
  readConnectionConfigValue,
} from "@tegrai/db";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/asyncHandler.js";

// DESIGN.md 5.2 / 9 — MCP Entegrasyonları: entegrasyon listesi (CRUD),
// bağlantı bilgisi/auth formu (connection_config içindeki hassas alanlar şifreli —
// bkz. packages/db/src/mcpConnectionConfig.ts, mcp-server ile paylaşılan tek kaynak),
// tool şeması düzenleme, aktif/pasif toggle, bağlantı testi.

export const mcpIntegrationsRouter = Router();

const connectionConfigSchema = z.record(z.string(), z.unknown());

const createSchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(McpIntegrationType),
  connectionConfig: connectionConfigSchema,
  toolSchema: z.record(z.string(), z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.nativeEnum(McpIntegrationType).optional(),
  connectionConfig: connectionConfigSchema.optional(),
  toolSchema: z.record(z.string(), z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
});

function serialize(integration: McpIntegration) {
  return { ...integration, connectionConfig: maskConnectionConfig(integration.connectionConfig) };
}

mcpIntegrationsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const integrations = await prisma.mcpIntegration.findMany({ orderBy: { createdAt: "asc" } });
    res.json(integrations.map(serialize));
  }),
);

mcpIntegrationsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const integration = await prisma.mcpIntegration.findUnique({ where: { id: req.params.id } });
    if (!integration) return res.status(404).json({ error: "not_found" });
    res.json(serialize(integration));
  }),
);

mcpIntegrationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { connectionConfig, toolSchema, ...data } = parsed.data;
    const integration = await prisma.mcpIntegration.create({
      data: {
        ...data,
        connectionConfig: encryptConnectionConfig(connectionConfig) as Prisma.InputJsonValue,
        toolSchema: (toolSchema ?? {}) as Prisma.InputJsonValue,
      },
    });
    res.status(201).json(serialize(integration));
  }),
);

mcpIntegrationsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { connectionConfig, toolSchema, ...data } = parsed.data;
    const existing = await prisma.mcpIntegration.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    const integration = await prisma.mcpIntegration.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(connectionConfig
          ? { connectionConfig: encryptConnectionConfig(connectionConfig) as Prisma.InputJsonValue }
          : {}),
        ...(toolSchema ? { toolSchema: toolSchema as Prisma.InputJsonValue } : {}),
      },
    });
    res.json(serialize(integration));
  }),
);

mcpIntegrationsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.mcpIntegration.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    await prisma.mcpIntegration.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

mcpIntegrationsRouter.post(
  "/:id/test",
  asyncHandler(async (req, res) => {
    const integration = await prisma.mcpIntegration.findUnique({ where: { id: req.params.id } });
    if (!integration) return res.status(404).json({ error: "not_found" });
    const result = await testConnection(integration);
    res.json(result);
  }),
);

async function testConnection(
  integration: McpIntegration,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (integration.type === McpIntegrationType.http_api) {
      const config = integration.connectionConfig;
      const baseUrl =
        readConnectionConfigValue(config, "baseUrl") ?? readConnectionConfigValue(config, "url");
      if (!baseUrl) {
        return { ok: false, message: "connection_config içinde 'baseUrl' veya 'url' tanımlı değil" };
      }
      const authToken =
        readConnectionConfigValue(config, "apiKey") ?? readConnectionConfigValue(config, "token");
      const resp = await fetch(baseUrl, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      return resp.ok
        ? { ok: true, message: "Bağlantı başarılı" }
        : { ok: false, message: `HTTP ${resp.status}` };
    }
    return {
      ok: false,
      message: `'${integration.type}' tipi için otomatik bağlantı testi henüz desteklenmiyor`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Bilinmeyen hata" };
  }
}
