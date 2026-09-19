import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { isForeignKeyRestrictError } from "../../lib/prismaErrors.js";

// DESIGN.md 5.4 — Skill Yönetimi: departman/görev/yetkinlik tanımları (CRUD).

export const skillsRouter = Router();

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

skillsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const skills = await prisma.skill.findMany({ orderBy: { createdAt: "asc" } });
    res.json(skills);
  }),
);

skillsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const skill = await prisma.skill.findUnique({ where: { id: req.params.id } });
    if (!skill) return res.status(404).json({ error: "not_found" });
    res.json(skill);
  }),
);

skillsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const skill = await prisma.skill.create({ data: parsed.data });
    res.status(201).json(skill);
  }),
);

skillsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const existing = await prisma.skill.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    const skill = await prisma.skill.update({ where: { id: req.params.id }, data: parsed.data });
    res.json(skill);
  }),
);

skillsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.skill.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    try {
      await prisma.skill.delete({ where: { id: req.params.id } });
    } catch (err) {
      // chat_sessions.skill_id NOT NULL + RESTRICT'tir (ve ai_usage_records benzer) —
      // bu skill'de geçmiş sohbet/kullanım varsa silinemez.
      if (isForeignKeyRestrictError(err)) {
        return res.status(409).json({
          error: "skill_has_dependent_records",
          message: "Bu skill'e ait sohbet/kullanım geçmişi var, silinemez.",
        });
      }
      throw err;
    }
    res.status(204).send();
  }),
);
