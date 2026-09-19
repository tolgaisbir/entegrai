import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyAuthToken } from "../lib/jwt.js";
import { ADMIN_ROLE_NAME } from "../lib/constants.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  isAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

async function loadAuthenticatedUser(token: string): Promise<AuthenticatedUser | null> {
  let payload;
  try {
    payload = verifyAuthToken(token);
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { roles: { include: { role: true } } },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    isAdmin: user.roles.some((r) => r.role.name === ADMIN_ROLE_NAME),
  };
}

// Geçerli bir bearer token gerektirir; şifre değişikliği zorunluysa sadece
// /api/auth/me ve /api/auth/change-password'a izin verir (bkz. requireAdmin/route sırası).
export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) return res.status(401).json({ error: "unauthorized" });

    const user = await loadAuthenticatedUser(token);
    if (!user) return res.status(401).json({ error: "unauthorized" });

    req.user = user;
    next();
  };
}

// requireAuth + is_admin role kontrolü + must_change_password engeli.
export function requireAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) return res.status(401).json({ error: "unauthorized" });

    const user = await loadAuthenticatedUser(token);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    if (user.mustChangePassword) {
      return res.status(403).json({ error: "must_change_password" });
    }
    if (!user.isAdmin) return res.status(403).json({ error: "forbidden" });

    req.user = user;
    next();
  };
}
