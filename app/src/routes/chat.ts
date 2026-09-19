import { Router } from "express";
import { z } from "zod";
import { AiUsageSource, ChatMessageRole, decryptSecret, Prisma } from "@tegrai/db";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { generateReply, type HistoryMessage } from "../lib/aiClient.js";
import { listToolsForUser, callTool } from "../lib/mcpClient.js";
import { requireAuth } from "../middleware/auth.js";
import { calculateCostUsd, getBudgetStatuses, isBudgetExceeded, recordUsage } from "../lib/budget.js";

// DESIGN.md Bölüm 6 — Chat Bot Deneyimi: skill seçimi, sol frame'de skill'e göre
// gruplanmış chat geçmişi, mesaj gönderme + seçili AI sağlayıcıdan yanıt alma.
// DESIGN.md Bölüm 12 — Bütçe: mesaj göndermeden önce kontrol edilir, başarılı yanıttan
// sonra (döngüdeki tüm AI çağrılarının toplamı için) token/maliyet kaydedilir (bkz.
// lib/budget.ts). DESIGN.md 12.5 — MCP tabanlı tool çağrıları bütçeden etkilenmez,
// sadece gerçek AI isteği yapan turlar sayılır.
//
// MCP tool çağrısı — kullanıcının role'lerine göre erişebildiği tool'lar mcp-server'dan
// (bkz. lib/mcpClient.ts) alınır, AI tool_use isterse çağrılır, sonuç modele geri
// verilir (max ~5 tur); role_mcp_permissions/get_filters uygulaması mcp-server
// tarafında yapılır (bkz. mcp-server/src/toolProvider.ts).
// DESIGN.md Bölüm 10 — Şablon (Template) tetikleme/izleme uç noktaları — TODO

const MAX_TOOL_ITERATIONS = 5;

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

    // DESIGN.md 12.6 — skillId verilirse her provider'ın yanında kalan bütçe özeti dönülür.
    const skillId = typeof req.query.skillId === "string" ? req.query.skillId : undefined;
    if (!skillId) return res.json(providers);

    const withBudget = await Promise.all(
      providers.map(async (provider) => ({
        ...provider,
        budget: await getBudgetStatuses(req.user!.id, provider.id, skillId),
      })),
    );
    res.json(withBudget);
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
    const budget = await getBudgetStatuses(req.user!.id, session.aiProviderId, session.skillId);
    res.json({ ...session, budget });
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

    const exceeded = await isBudgetExceeded(req.user!.id, session.aiProviderId, session.skillId);
    if (exceeded) {
      const otherProviderIds = (await accessibleAiProviderIds(req.user!.id)).filter(
        (id) => id !== session.aiProviderId,
      );
      const alternatives = await prisma.aiProvider.findMany({
        where: { id: { in: otherProviderIds } },
        select: { id: true, name: true, providerType: true },
      });
      return res.status(403).json({
        error: "budget_exceeded",
        period: exceeded.period,
        source: exceeded.source,
        limitUsd: exceeded.limitUsd,
        usedUsd: exceeded.usedUsd,
        alternativeAiProviders: alternatives,
      });
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

    const history: HistoryMessage[] = [...session.messages, userMessage].map((m) => ({
      role: m.role as "user" | "assistant" | "tool",
      content: m.content,
      toolCallData: m.toolCallData ?? undefined,
    }));

    const tools = await listToolsForUser(req.user!.id);
    const newMessages = [];
    let totalTokensPrompt = 0;
    let totalTokensCompletion = 0;
    let finalAssistantMessage;

    try {
      const apiKey = decryptSecret(session.aiProvider.apiKeyEncrypted);

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const reply = await generateReply(session.aiProvider, apiKey, history, tools);
        totalTokensPrompt += reply.tokensPrompt;
        totalTokensCompletion += reply.tokensCompletion;

        const assistantMessage = await prisma.chatMessage.create({
          data: {
            sessionId: session.id,
            role: ChatMessageRole.assistant,
            content: reply.content,
            toolCallData: reply.toolCalls.length
              ? (reply.toolCalls as unknown as Prisma.InputJsonValue)
              : undefined,
          },
        });
        newMessages.push(assistantMessage);
        history.push({ role: "assistant", content: reply.content, toolCallData: assistantMessage.toolCallData ?? undefined });

        if (reply.toolCalls.length === 0) {
          finalAssistantMessage = assistantMessage;
          break;
        }

        for (const call of reply.toolCalls) {
          const result = await callTool(req.user!.id, call.name, call.input);
          const resultText = JSON.stringify(result);
          const toolMessage = await prisma.chatMessage.create({
            data: {
              sessionId: session.id,
              role: ChatMessageRole.tool,
              content: resultText,
              toolCallData: { toolUseId: call.id, name: call.name } as Prisma.InputJsonValue,
            },
          });
          newMessages.push(toolMessage);
          history.push({
            role: "tool",
            content: resultText,
            toolCallData: toolMessage.toolCallData ?? undefined,
          });
        }
      }

      if (!finalAssistantMessage) {
        finalAssistantMessage = await prisma.chatMessage.create({
          data: {
            sessionId: session.id,
            role: ChatMessageRole.assistant,
            content: "Çok fazla araç çağrısı gerekti, işlem tamamlanamadı.",
          },
        });
        newMessages.push(finalAssistantMessage);
      }

      await recordUsage({
        userId: req.user!.id,
        aiProviderId: session.aiProviderId,
        skillId: session.skillId,
        source: AiUsageSource.chat,
        referenceId: finalAssistantMessage.id,
        tokensPrompt: totalTokensPrompt,
        tokensCompletion: totalTokensCompletion,
        costUsd: calculateCostUsd(session.aiProvider, totalTokensPrompt, totalTokensCompletion),
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
    res.status(201).json({ userMessage, messages: newMessages });
  }),
);
