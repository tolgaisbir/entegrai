import { Prisma, BudgetPeriod, BudgetScopeType, AiUsageSource, type AiProvider } from "@tegrai/db";
import { prisma } from "./prisma.js";

// DESIGN.md Bölüm 12 — Bütçe (Budget) Yönetimi.

export type BudgetSource = "user" | "skill" | "global";

interface ResolvedPolicy {
  source: BudgetSource;
  limitUsd: number;
}

interface PricingParams {
  price_per_1k_input_usd?: number;
  price_per_1k_output_usd?: number;
}

function readPricing(provider: AiProvider): PricingParams {
  const params = provider.defaultParams;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return {};
  return params as PricingParams;
}

export function calculateCostUsd(
  provider: AiProvider,
  tokensPrompt: number,
  tokensCompletion: number,
): number {
  const pricing = readPricing(provider);
  const input = pricing.price_per_1k_input_usd ?? 0;
  const output = pricing.price_per_1k_output_usd ?? 0;
  return (tokensPrompt / 1000) * input + (tokensCompletion / 1000) * output;
}

async function resolvePolicy(
  aiProviderId: string,
  userId: string,
  skillId: string,
  period: BudgetPeriod,
): Promise<ResolvedPolicy | null> {
  const [userPolicy, skillPolicy, globalPolicy] = await Promise.all([
    prisma.budgetPolicy.findUnique({
      where: {
        aiProviderId_scopeType_scopeId_period: {
          aiProviderId,
          scopeType: BudgetScopeType.user,
          scopeId: userId,
          period,
        },
      },
    }),
    prisma.budgetPolicy.findUnique({
      where: {
        aiProviderId_scopeType_scopeId_period: {
          aiProviderId,
          scopeType: BudgetScopeType.skill,
          scopeId: skillId,
          period,
        },
      },
    }),
    // scope_type=global için scope_id her zaman null (unique index null'ı tek bir değer
    // olarak ele alır çünkü Prisma bu alanı normal @@unique'e dahil ediyor ve global
    // kaydı zaten tekil tutuyoruz — bkz. budgetPolicies.ts validasyonu).
    prisma.budgetPolicy.findFirst({
      where: { aiProviderId, scopeType: BudgetScopeType.global, period },
    }),
  ]);

  if (userPolicy) return { source: "user", limitUsd: Number(userPolicy.limitUsd) };
  if (skillPolicy) return { source: "skill", limitUsd: Number(skillPolicy.limitUsd) };
  if (globalPolicy) return { source: "global", limitUsd: Number(globalPolicy.limitUsd) };
  return null;
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// `source` user/global ise skill ayrımı yapılmadan (o kullanıcının o provider'daki tüm
// skill'lerdeki toplamı), `skill` ise sadece o skill_id için kullanım hesaplanır
// (bkz. DESIGN.md 12.2 "Uygulama notu").
async function getUsageUsd(
  userId: string,
  aiProviderId: string,
  skillId: string,
  source: BudgetSource,
  period: BudgetPeriod,
): Promise<number> {
  const skillFilter = source === "skill" ? { skillId } : {};

  if (period === BudgetPeriod.monthly) {
    const result = await prisma.aiUsageMonthlyRollup.aggregate({
      where: { userId, aiProviderId, yearMonth: currentYearMonth(), ...skillFilter },
      _sum: { totalCostUsd: true },
    });
    return Number(result._sum.totalCostUsd ?? 0);
  }

  const result = await prisma.aiUsageRecord.aggregate({
    where: { userId, aiProviderId, createdAt: { gte: startOfTodayUtc() }, ...skillFilter },
    _sum: { costUsd: true },
  });
  return Number(result._sum.costUsd ?? 0);
}

export interface BudgetStatus {
  period: BudgetPeriod;
  source: BudgetSource;
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  exceeded: boolean;
}

export async function getBudgetStatuses(
  userId: string,
  aiProviderId: string,
  skillId: string,
): Promise<BudgetStatus[]> {
  const statuses: BudgetStatus[] = [];
  for (const period of [BudgetPeriod.daily, BudgetPeriod.monthly]) {
    const policy = await resolvePolicy(aiProviderId, userId, skillId, period);
    if (!policy) continue;
    const usedUsd = await getUsageUsd(userId, aiProviderId, skillId, policy.source, period);
    statuses.push({
      period,
      source: policy.source,
      limitUsd: policy.limitUsd,
      usedUsd,
      remainingUsd: Math.max(policy.limitUsd - usedUsd, 0),
      exceeded: usedUsd >= policy.limitUsd,
    });
  }
  return statuses;
}

export async function isBudgetExceeded(
  userId: string,
  aiProviderId: string,
  skillId: string,
): Promise<BudgetStatus | null> {
  const statuses = await getBudgetStatuses(userId, aiProviderId, skillId);
  return statuses.find((s) => s.exceeded) ?? null;
}

export interface RecordUsageInput {
  userId: string;
  aiProviderId: string;
  skillId: string | null;
  source: AiUsageSource;
  referenceId?: string;
  tokensPrompt: number;
  tokensCompletion: number;
  costUsd: number;
}

// Ham kullanım kaydını + aylık rollup'ı aynı işlemde günceller (bkz. DESIGN.md 12.4).
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const yearMonth = currentYearMonth();
  const costUsd = new Prisma.Decimal(input.costUsd);

  await prisma.$transaction(async (tx) => {
    await tx.aiUsageRecord.create({
      data: {
        userId: input.userId,
        aiProviderId: input.aiProviderId,
        skillId: input.skillId,
        source: input.source,
        referenceId: input.referenceId,
        tokensPrompt: input.tokensPrompt,
        tokensCompletion: input.tokensCompletion,
        costUsd,
      },
    });

    const totalTokens = BigInt(input.tokensPrompt + input.tokensCompletion);

    // Prisma şema dili partial unique index tanımlayamadığından (bkz. schema.prisma
    // yorumu), her iki durum için de ham SQL ile migration'daki partial index'e karşı
    // ON CONFLICT uygulanıyor — tip güvenli `upsert()` burada kullanılamıyor.
    if (input.skillId) {
      await tx.$executeRaw`
        INSERT INTO ai_usage_monthly_rollup
          (id, user_id, ai_provider_id, skill_id, year_month, total_cost_usd, total_tokens, updated_at)
        VALUES
          (gen_random_uuid(), ${input.userId}, ${input.aiProviderId}, ${input.skillId}, ${yearMonth}, ${input.costUsd}, ${totalTokens}, now())
        ON CONFLICT (user_id, ai_provider_id, skill_id, year_month) WHERE skill_id IS NOT NULL
        DO UPDATE SET
          total_cost_usd = ai_usage_monthly_rollup.total_cost_usd + EXCLUDED.total_cost_usd,
          total_tokens = ai_usage_monthly_rollup.total_tokens + EXCLUDED.total_tokens,
          updated_at = now()
      `;
    } else {
      await tx.$executeRaw`
        INSERT INTO ai_usage_monthly_rollup
          (id, user_id, ai_provider_id, skill_id, year_month, total_cost_usd, total_tokens, updated_at)
        VALUES
          (gen_random_uuid(), ${input.userId}, ${input.aiProviderId}, NULL, ${yearMonth}, ${input.costUsd}, ${totalTokens}, now())
        ON CONFLICT (user_id, ai_provider_id, year_month) WHERE skill_id IS NULL
        DO UPDATE SET
          total_cost_usd = ai_usage_monthly_rollup.total_cost_usd + EXCLUDED.total_cost_usd,
          total_tokens = ai_usage_monthly_rollup.total_tokens + EXCLUDED.total_tokens,
          updated_at = now()
      `;
    }
  });
}
