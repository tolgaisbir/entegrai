import { Router } from "express";
import { z } from "zod";
import { BudgetPeriod, BudgetScopeType, Prisma } from "@tegrai/db";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { getBudgetStatuses } from "../../lib/budget.js";

// DESIGN.md 5.12.7 — Bütçe & Kullanım Yönetimi: provider seçimi, o provider için
// global/skill/user bazlı bütçe tanımları, kullanıcı bazında etkin limit/kullanım tablosu.

export const budgetPoliciesRouter = Router();

const createSchema = z
  .object({
    aiProviderId: z.string().min(1),
    scopeType: z.nativeEnum(BudgetScopeType),
    scopeId: z.string().min(1).optional(),
    period: z.nativeEnum(BudgetPeriod),
    limitUsd: z.number().positive(),
  })
  .superRefine((data, ctx) => {
    if (data.scopeType === BudgetScopeType.global && data.scopeId) {
      ctx.addIssue({ code: "custom", path: ["scopeId"], message: "global scope için scopeId verilmemeli" });
    }
    if (data.scopeType !== BudgetScopeType.global && !data.scopeId) {
      ctx.addIssue({ code: "custom", path: ["scopeId"], message: "skill/user scope için scopeId zorunlu" });
    }
  });

const updateSchema = z.object({ limitUsd: z.number().positive() });

async function assertScopeTargetExists(scopeType: BudgetScopeType, scopeId?: string) {
  if (scopeType === BudgetScopeType.skill && scopeId) {
    const skill = await prisma.skill.findUnique({ where: { id: scopeId } });
    if (!skill) return "skill_not_found";
  }
  if (scopeType === BudgetScopeType.user && scopeId) {
    const user = await prisma.user.findUnique({ where: { id: scopeId } });
    if (!user) return "user_not_found";
  }
  return null;
}

budgetPoliciesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const aiProviderId = typeof req.query.aiProviderId === "string" ? req.query.aiProviderId : undefined;
    if (!aiProviderId) {
      return res.status(400).json({ error: "ai_provider_id_required" });
    }
    const policies = await prisma.budgetPolicy.findMany({
      where: { aiProviderId },
      orderBy: [{ scopeType: "asc" }, { period: "asc" }],
    });
    res.json(policies);
  }),
);

budgetPoliciesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { aiProviderId, scopeType, scopeId, period, limitUsd } = parsed.data;

    const provider = await prisma.aiProvider.findUnique({ where: { id: aiProviderId } });
    if (!provider) return res.status(400).json({ error: "ai_provider_not_found" });

    const targetError = await assertScopeTargetExists(scopeType, scopeId);
    if (targetError) return res.status(400).json({ error: targetError });

    if (scopeType === BudgetScopeType.global) {
      // scope_id NULL olduğundan Postgres unique kısıtlaması burada tekrarları
      // engellemiyor (NULL != NULL) — uygulama katmanında kontrol ediyoruz.
      const existingGlobal = await prisma.budgetPolicy.findFirst({
        where: { aiProviderId, scopeType: BudgetScopeType.global, period },
      });
      if (existingGlobal) return res.status(409).json({ error: "global_policy_already_exists" });
    }

    try {
      const policy = await prisma.budgetPolicy.create({
        data: {
          aiProviderId,
          scopeType,
          scopeId: scopeId ?? null,
          period,
          limitUsd: new Prisma.Decimal(limitUsd),
        },
      });
      res.status(201).json(policy);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return res.status(409).json({ error: "policy_already_exists" });
      }
      throw err;
    }
  }),
);

budgetPoliciesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const existing = await prisma.budgetPolicy.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    const policy = await prisma.budgetPolicy.update({
      where: { id: req.params.id },
      data: { limitUsd: new Prisma.Decimal(parsed.data.limitUsd) },
    });
    res.json(policy);
  }),
);

budgetPoliciesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.budgetPolicy.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    await prisma.budgetPolicy.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

// DESIGN.md 12.7 — provider bazında kullanıcı x skill kırılımlı etkin limit/kullanım tablosu.
budgetPoliciesRouter.get(
  "/usage-overview",
  asyncHandler(async (req, res) => {
    const aiProviderId = typeof req.query.aiProviderId === "string" ? req.query.aiProviderId : undefined;
    if (!aiProviderId) {
      return res.status(400).json({ error: "ai_provider_id_required" });
    }
    const provider = await prisma.aiProvider.findUnique({ where: { id: aiProviderId } });
    if (!provider) return res.status(404).json({ error: "not_found" });

    // Bu provider'a role_ai_providers üzerinden erişimi olan kullanıcılar.
    const grantedRoleIds = (
      await prisma.roleAiProvider.findMany({ where: { aiProviderId }, select: { roleId: true } })
    ).map((r) => r.roleId);
    const userIds = [
      ...new Set(
        (
          await prisma.userRole.findMany({
            where: { roleId: { in: grantedRoleIds } },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      ),
    ];

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      include: { skills: { include: { skill: true } } },
    });

    const overview = [];
    for (const user of users) {
      // Her kullanıcı için, atanmış her skill'deki etkin limit/kullanım ayrı satır olarak
      // döner (kaynak user/global ise havuzlanmış toplamı, skill ise o skill'in kendi
      // kullanımını yansıtır — bkz. getBudgetStatuses / DESIGN.md 12.2 uygulama notu).
      const skillRows = await Promise.all(
        user.skills.map(async (us) => ({
          skillId: us.skill.id,
          skillName: us.skill.name,
          statuses: await getBudgetStatuses(user.id, aiProviderId, us.skill.id),
        })),
      );
      overview.push({
        userId: user.id,
        userFullName: user.fullName,
        userEmail: user.email,
        skills: skillRows,
      });
    }

    res.json(overview);
  }),
);
