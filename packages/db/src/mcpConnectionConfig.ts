import type { Prisma } from "@prisma/client";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto.js";

// DESIGN.md 5.2 / 9 — mcp_integrations.connection_config (JSONB) içindeki hassas
// alanlar (adında key/password/secret/token/connectionString geçenler) şifreli
// saklanır. Admin panel (app/) yazarken şifreler ve maskeler; mcp-server tool
// çağrısı sırasında çözer — ikisi de bu tek yerden aynı kuralları kullanır.

const SENSITIVE_KEY_HINTS = ["key", "password", "secret", "token", "connectionstring"];
const ENC_PREFIX = "enc:";

export function isSensitiveConfigKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_HINTS.some((hint) => lower.includes(hint));
}

export function encryptConnectionConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isSensitiveConfigKey(key) && typeof value === "string" && value.length > 0) {
      result[key] = `${ENC_PREFIX}${encryptSecret(value)}`;
    } else {
      result[key] = value;
    }
  }
  return result;
}

// GET yanıtlarında hassas alanlar asla düz metin dönmez, sadece maskeli önizleme gösterilir.
export function maskConnectionConfig(config: Prisma.JsonValue): Record<string, unknown> {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (isSensitiveConfigKey(key) && typeof value === "string" && value.startsWith(ENC_PREFIX)) {
      try {
        result[key] = maskSecret(decryptSecret(value.slice(ENC_PREFIX.length)));
      } catch {
        result[key] = "****";
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

// mcp-server tool çağrısında gerçek (çözülmüş) değeri okumak için kullanılır.
export function readConnectionConfigValue(config: Prisma.JsonValue, key: string): string | undefined {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return undefined;
  const value = (config as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  if (value.startsWith(ENC_PREFIX)) {
    try {
      return decryptSecret(value.slice(ENC_PREFIX.length));
    } catch {
      return undefined;
    }
  }
  return value;
}
