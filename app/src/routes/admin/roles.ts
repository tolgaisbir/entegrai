import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@tegrai/db";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/asyncHandler.js";

// DESIGN.md 5.5 — Role Yönetimi: Role CRUD, hangi MCP entegrasyonlarına/tool'larına
// erişim izni var + GET filtreleri (role_mcp_permissions), hangi AI sağlayıcılarına
// erişim izni var (role_ai_providers).

export const rolesRouter = Router();

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

const mcpPermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      mcpIntegrationId: z.string().min(1),
      allowedOperations: z.array(z.unknown()).optional(),
      getFilters: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

const aiProvidersSchema = z.object({
  aiProviderIds: z.array(z.string().min(1)),
});

const roleInclude = {
  mcpPermissions: { include: { mcpIntegration: { select: { id: true, name: true, type: true } } } },
  aiProviders: { include: { aiProvider: { select: { id: true, name: true, providerType: true } } } },
} satisfies Prisma.RoleInclude;

rolesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({ orderBy: { createdAt: "asc" }, include: roleInclude });
    res.json(roles);
  }),
);

rolesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: roleInclude });
    if (!role) return res.status(404).json({ error: "not_found" });
    res.json(role);
  }),
);

rolesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const role = await prisma.role.create({ data: parsed.data, include: roleInclude });
    res.status(201).json(role);
  }),
);

rolesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    const role = await prisma.role.update({
      where: { id: req.params.id },
      data: parsed.data,
      include: roleInclude,
    });
    res.json(role);
  }),
);

rolesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    if (existing.isSystem) {
      return res.status(400).json({ error: "system_role_protected", message: "Sistem role'ü silinemez" });
    }
    await prisma.role.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

// Bir role'ün MCP entegrasyon izinlerinin tamamını değiştirir (replace semantics).
rolesRouter.put(
  "/:id/mcp-permissions",
  asyncHandler(async (req, res) => {
    const parsed = mcpPermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    await prisma.$transaction([
      prisma.roleMcpPermission.deleteMany({ where: { roleId: req.params.id } }),
      prisma.roleMcpPermission.createMany({
        data: parsed.data.permissions.map((p) => ({
          roleId: req.params.id,
          mcpIntegrationId: p.mcpIntegrationId,
          allowedOperations: (p.allowedOperations ?? []) as Prisma.InputJsonValue,
          getFilters: (p.getFilters ?? {}) as Prisma.InputJsonValue,
        })),
      }),
    ]);

    const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: roleInclude });
    res.json(role);
  }),
);

// Bir role'ün erişebildiği AI sağlayıcı listesinin tamamını değiştirir (replace semantics).
rolesRouter.put(
  "/:id/ai-providers",
  asyncHandler(async (req, res) => {
    const parsed = aiProvidersSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    await prisma.$transaction([
      prisma.roleAiProvider.deleteMany({ where: { roleId: req.params.id } }),
      prisma.roleAiProvider.createMany({
        data: parsed.data.aiProviderIds.map((aiProviderId) => ({
          roleId: req.params.id,
          aiProviderId,
        })),
      }),
    ]);

    const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: roleInclude });
    res.json(role);
  }),
);
