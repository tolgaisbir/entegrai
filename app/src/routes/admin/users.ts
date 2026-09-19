import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthSource, type User } from "@tegrai/db";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/asyncHandler.js";

// DESIGN.md 5.3 — Kullanıcı Yönetimi: kullanıcı listesi (manuel ekleme), kullanıcıya
// skill(ler) atama, kullanıcıya role(ler) atama.

export const usersRouter = Router();

const BCRYPT_ROUNDS = 12;

const createSchema = z
  .object({
    fullName: z.string().min(1),
    email: z.string().email(),
    authSource: z.nativeEnum(AuthSource).default(AuthSource.local),
    password: z.string().min(8).optional(),
    ldapDn: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.authSource === AuthSource.local && !data.password) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "local kullanıcı için password zorunlu" });
    }
    if (data.authSource === AuthSource.ldap && !data.ldapDn) {
      ctx.addIssue({ code: "custom", path: ["ldapDn"], message: "ldap kullanıcı için ldapDn zorunlu" });
    }
  });

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  ldapDn: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

const skillsAssignSchema = z.object({ skillIds: z.array(z.string().min(1)) });
const rolesAssignSchema = z.object({ roleIds: z.array(z.string().min(1)) });

function serialize(user: User) {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

async function withAssignments(userId: string) {
  const [skills, roles] = await Promise.all([
    prisma.userSkill.findMany({ where: { userId }, include: { skill: true } }),
    prisma.userRole.findMany({ where: { userId }, include: { role: true } }),
  ]);
  return {
    skills: skills.map((s) => s.skill),
    roles: roles.map((r) => r.role),
  };
}

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    res.json(users.map(serialize));
  }),
);

usersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "not_found" });
    const assignments = await withAssignments(user.id);
    res.json({ ...serialize(user), ...assignments });
  }),
);

usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { password, ...data } = parsed.data;
    const user = await prisma.user.create({
      data: {
        ...data,
        passwordHash: password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null,
      },
    });
    res.status(201).json(serialize(user));
  }),
);

usersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { password, ...data } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(password ? { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) } : {}),
      },
    });
    res.json(serialize(user));
  }),
);

usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

// Bir kullanıcının atanmış skill'lerinin tamamını değiştirir (replace semantics).
usersRouter.put(
  "/:id/skills",
  asyncHandler(async (req, res) => {
    const parsed = skillsAssignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    await prisma.$transaction([
      prisma.userSkill.deleteMany({ where: { userId: req.params.id } }),
      prisma.userSkill.createMany({
        data: parsed.data.skillIds.map((skillId) => ({ userId: req.params.id, skillId })),
      }),
    ]);
    res.json(await withAssignments(req.params.id));
  }),
);

// Bir kullanıcının atanmış role'lerinin tamamını değiştirir (replace semantics).
usersRouter.put(
  "/:id/roles",
  asyncHandler(async (req, res) => {
    const parsed = rolesAssignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: req.params.id } }),
      prisma.userRole.createMany({
        data: parsed.data.roleIds.map((roleId) => ({ userId: req.params.id, roleId })),
      }),
    ]);
    res.json(await withAssignments(req.params.id));
  }),
);
