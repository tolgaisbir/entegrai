import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthSource } from "@tegrai/db";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { signAuthToken } from "../lib/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import { ADMIN_ROLE_NAME } from "../lib/constants.js";
import { authenticateLdapUser } from "../lib/ldap.js";

// DESIGN.md 8 — Auth mekanizması: local kullanıcılar için email+password login (bcrypt),
// `ldap` kullanıcılar için ldapjs ile bind + login-time (just-in-time) senkronizasyon
// (karar 170) — ikisi de aynı JWT bearer token'ı üretir.

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

async function userProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    authSource: user.authSource,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    isAdmin: user.roles.some((r) => r.role.name === ADMIN_ROLE_NAME),
  };
}

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !existing.isActive) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    let userId: string;
    if (existing && existing.authSource === AuthSource.local) {
      if (!existing.passwordHash || !(await bcrypt.compare(password, existing.passwordHash))) {
        return res.status(401).json({ error: "invalid_credentials" });
      }
      userId = existing.id;
    } else {
      // Ya yeni bir LDAP kullanıcısı (yerelde hiç kaydı yok) ya da daha önce
      // senkronize edilmiş bir `ldap` kullanıcısı — her ikisinde de LDAP'a karşı
      // doğrulanır ve yerel kayıt login anında oluşturulur/güncellenir (just-in-time sync).
      const ldapUser = await authenticateLdapUser(email, password);
      if (!ldapUser) {
        return res.status(401).json({ error: "invalid_credentials" });
      }
      const synced = await prisma.user.upsert({
        where: { email: ldapUser.email },
        create: {
          email: ldapUser.email,
          fullName: ldapUser.fullName,
          authSource: AuthSource.ldap,
          ldapDn: ldapUser.dn,
          isActive: true,
        },
        update: {
          fullName: ldapUser.fullName,
          ldapDn: ldapUser.dn,
          authSource: AuthSource.ldap,
        },
      });
      userId = synced.id;
    }

    const token = signAuthToken(userId);
    res.json({ token, user: await userProfile(userId) });
  }),
);

authRouter.get(
  "/me",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await userProfile(req.user!.id));
  }),
);

authRouter.post(
  "/change-password",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.authSource !== AuthSource.local || !user.passwordHash) {
      return res.status(400).json({ error: "not_a_local_user" });
    }
    const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
      },
    });
    res.json({ ok: true });
  }),
);
