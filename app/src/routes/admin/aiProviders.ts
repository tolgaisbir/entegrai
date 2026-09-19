import { Router } from "express";
import { z } from "zod";
import { AiProviderType, Prisma, type AiProvider } from "@tegrai/db";
import { prisma } from "../../lib/prisma.js";
import { decryptSecret, encryptSecret, maskSecret } from "../../lib/crypto.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { isForeignKeyRestrictError } from "../../lib/prismaErrors.js";

// DESIGN.md 5.1 — AI Ayarları: sağlayıcı listesi (CRUD), API key girişi (maskeli),
// model/parametre düzenleme, bağlantı testi.

export const aiProvidersRouter = Router();

const createSchema = z.object({
  name: z.string().min(1),
  providerType: z.nativeEnum(AiProviderType),
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  defaultParams: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  providerType: z.nativeEnum(AiProviderType).optional(),
  apiBaseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  defaultParams: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

function serialize(provider: AiProvider) {
  let keyPreview = "****";
  try {
    keyPreview = maskSecret(decryptSecret(provider.apiKeyEncrypted));
  } catch {
    // şifre çözülemezse (ör. ENCRYPTION_KEY değişmişse) maskeli varsayılan gösterilir
  }
  const { apiKeyEncrypted: _omit, ...rest } = provider;
  return { ...rest, apiKeyPreview: keyPreview };
}

aiProvidersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const providers = await prisma.aiProvider.findMany({ orderBy: { createdAt: "asc" } });
    res.json(providers.map(serialize));
  }),
);

aiProvidersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const provider = await prisma.aiProvider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ error: "not_found" });
    res.json(serialize(provider));
  }),
);

aiProvidersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { apiKey, ...data } = parsed.data;
    const provider = await prisma.aiProvider.create({
      data: {
        ...data,
        defaultParams: (data.defaultParams ?? {}) as Prisma.InputJsonValue,
        apiKeyEncrypted: encryptSecret(apiKey),
      },
    });
    res.status(201).json(serialize(provider));
  }),
);

aiProvidersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { apiKey, defaultParams, ...data } = parsed.data;
    const existing = await prisma.aiProvider.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    const provider = await prisma.aiProvider.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(defaultParams ? { defaultParams: defaultParams as Prisma.InputJsonValue } : {}),
        ...(apiKey ? { apiKeyEncrypted: encryptSecret(apiKey) } : {}),
      },
    });
    res.json(serialize(provider));
  }),
);

aiProvidersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.aiProvider.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    try {
      await prisma.aiProvider.delete({ where: { id: req.params.id } });
    } catch (err) {
      // ai_usage_records/ai_usage_monthly_rollup kalıcı saklanır (DESIGN.md 12.4) ve
      // ai_provider_id FK'si RESTRICT'tir — kullanım geçmişi olan bir sağlayıcı silinemez.
      if (isForeignKeyRestrictError(err)) {
        return res.status(409).json({
          error: "ai_provider_has_dependent_records",
          message: "Bu sağlayıcıya ait kullanım geçmişi/atamalar var, silinemez. Önce pasife alın.",
        });
      }
      throw err;
    }
    res.status(204).send();
  }),
);

aiProvidersRouter.post(
  "/:id/test",
  asyncHandler(async (req, res) => {
    const provider = await prisma.aiProvider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ error: "not_found" });

    const apiKey = decryptSecret(provider.apiKeyEncrypted);
    const result = await testConnection(provider, apiKey);
    res.json(result);
  }),
);

async function testConnection(
  provider: AiProvider,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (provider.providerType === AiProviderType.anthropic) {
      const resp = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      return resp.ok
        ? { ok: true, message: "Bağlantı başarılı" }
        : { ok: false, message: `HTTP ${resp.status}` };
    }
    if (provider.providerType === AiProviderType.openai) {
      const base = provider.apiBaseUrl ?? "https://api.openai.com/v1";
      const resp = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return resp.ok
        ? { ok: true, message: "Bağlantı başarılı" }
        : { ok: false, message: `HTTP ${resp.status}` };
    }
    return {
      ok: false,
      message: `'${provider.providerType}' için otomatik bağlantı testi henüz desteklenmiyor`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Bilinmeyen hata" };
  }
}
