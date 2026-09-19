import jwt from "jsonwebtoken";

// DESIGN.md 8 — Auth mekanizması: local kullanıcılar için JWT bearer token.

export interface AuthTokenPayload {
  sub: string; // user id
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET tanımlı değil");
  return secret;
}

export function signAuthToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies AuthTokenPayload, getSecret(), { expiresIn: "12h" });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, getSecret()) as AuthTokenPayload;
}
