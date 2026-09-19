import { Router } from "express";
import { z } from "zod";
import { ChatMessageRole } from "@tegrai/db";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { decryptSecret } from "../lib/crypto.js";
import { generateReply, type ChatTurn } from "../lib/aiClient.js";
import { requireAuth } from "../middleware/auth.js";

// DESIGN.md Bölüm 6 — Chat Bot Deneyimi: skill seçimi, sol frame'de skill'e göre
// gruplanmış chat geçmişi, mesaj gönderme + seçili AI sağlayıcıdan yanıt alma.
//
// MCP tool çağrısı desteği (role_mcp_permissions/get_filters uygulanması) henüz yok —
// mcp-server dinamik tool yüklemesi tamamlanınca eklenecek (bkz. PROGRESS.md).
// DESIGN.md Bölüm 10 — Şablon (Template) tetikleme/izleme uç noktaları — TODO
// DESIGN.md Bölüm 12.6 — Kullanıcının kendi kullanım/kalan bütçe görünürlüğü — TODO

export const chatRouter = Router();

chatRouter.use(requireAuth());

const createSessionSchema = z.object({
  skillId: z.string().min(1),
  aiProviderId: z.string().min(1).optional(),
});

const updateSessionSchema = z.object({
  title: z.string().min(1).max(200),
});

const createMessageSchema = z.object({
  content: z.string().min(1),
});

async function accessibleAiProviderIds(userId: string): Promise<string[]> {
  const roleIds = (await prisma.userRole.findMany({ where: { userId }, select: { roleId: true } })).map(
    (r) => r.roleId,
  );
  if (roleIds.length === 0) return [];
  const grants = await prisma.roleAiProvider.findMany({
    where: { roleId: { in: roleIds } },
    select: { aiProviderId: true },
    distinct: ["aiProviderId"],
  });
  return grants.map((g) => g.aiProviderId);
}

chatRouter.get(
  "/skills",
  asyncHandler(async (req, res) => {
    const userSkills = await prisma.userSkill.findMany({
      where: { userId: req.user!.id },
      include: { skill: true },
    });
    res.json(userSkills.map((us) => us.skill));
  }),
);

chatRouter.get(
  "/ai-providers",
  asyncHandler(async (req, res) => {
    const ids = await accessibleAiProviderIds(req.user!.id);
    const providers = await prisma.aiProvider.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, providerType: true, model: true, isActive: true },
    });
    res.json(providers);
  }),
);

chatRouter.post(
  "/sessions",
  asyncHandler(async (req, res) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { skillId, aiProviderId } = parsed.data;

    const hasSkill = await prisma.userSkill.findUnique({
      where: { userId_skillId: { userId: req.user!.id, skillId } },
    });
    if (!hasSkill) {
      return res.status(403).json({ error: "skill_not_assigned" });
    }

    const accessibleIds = await accessibleAiProviderIds(req.user!.id);
    if (accessibleIds.length === 0) {
      return res.status(403).json({ error: "no_ai_provider_access" });
    }

    let resolvedProviderId = aiProviderId;
    if (resolvedProviderId) {
      if (!accessibleIds.includes(resolvedProviderId)) {
        return res.status(403).json({ error: "ai_provider_not_accessible" });
      }
    } else {
      const candidates = await prisma.aiProvider.findMany({
        where: { id: { in: accessibleIds } },
        orderBy: { isActive: "desc" },
      });
      resolvedProviderId = candidates[0]?.id;
      if (!resolvedProviderId) {
        return res.status(403).json({ error: "no_ai_provider_access" });
      }
    }

    const session = await prisma.chatSession.create({
      data: { userId: req.user!.id, skillId, aiProviderId: resolvedProviderId },
      include: { skill: true, aiProvider: { select: { id: true, name: true, providerType: true } } },
    });
    res.status(201).json(session);
  }),
);

chatRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: "desc" },
      include: { skill: true, aiProvider: { select: { id: true, name: true, providerType: true } } },
    });

    const groups = new Map<string, { skill: (typeof sessions)[number]["skill"]; sessions: typeof sessions }>();
    for (const session of sessions) {
      const group = groups.get(session.skillId);
      if (group) {
        group.sessions.push(session);
      } else {
        groups.set(session.skillId, { skill: session.skill, sessions: [session] });
      }
    }
    res.json([...groups.values()]);
  }),
);

chatRouter.get(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const session = await prisma.chatSession.findUnique({
      where: { id: req.params.id },
      include: {
        skill: true,
        aiProvider: { select: { id: true, name: true, providerType: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!session || session.userId !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(session);
  }),
);

chatRouter.patch(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const existing = await prisma.chatSession.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }
    const session = await prisma.chatSession.update({
      where: { id: req.params.id },
      data: { title: parsed.data.title },
    });
    res.json(session);
  }),
);

chatRouter.delete(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.chatSession.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }
    await prisma.chatSession.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

chatRouter.post(
  "/sessions/:id/messages",
  asyncHandler(async (req, res) => {
    const parsed = createMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }

    const session = await prisma.chatSession.findUnique({
      where: { id: req.params.id },
      include: { aiProvider: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session || session.userId !== req.user!.id) {
      return res.status(404).json({ error: "not_found" });
    }

    const userMessage = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: ChatMessageRole.user, content: parsed.data.content },
    });

    if (!session.title) {
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { title: parsed.data.content.slice(0, 60) },
      });
    }

    const history: ChatTurn[] = [...session.messages, userMessage]
      .filter((m) => m.role === ChatMessageRole.user || m.role === ChatMessageRole.assistant)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    let assistantMessage;
    try {
      const apiKey = decryptSecret(session.aiProvider.apiKeyEncrypted);
      const reply = await generateReply(session.aiProvider, apiKey, history);
      assistantMessage = await prisma.chatMessage.create({
        data: { sessionId: session.id, role: ChatMessageRole.assistant, content: reply.content },
      });
    } catch (err) {
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });
      return res.status(502).json({
        error: "ai_provider_error",
        message: err instanceof Error ? err.message : "Bilinmeyen hata",
        userMessage,
      });
    }

    await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
    res.status(201).json({ userMessage, assistantMessage });
  }),
);
