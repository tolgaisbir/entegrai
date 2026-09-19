import { McpIntegrationType, readConnectionConfigValue, type McpIntegration } from "@tegrai/db";
import { prisma } from "./lib/prisma.js";

// DESIGN.md Bölüm 9 / 3 — mcp_integrations + role_mcp_permissions'a göre kullanıcının
// erişebildiği tool'ları listeler ve çağırır. Şimdilik sadece `http_api` tipi
// entegrasyonlar desteklenir (bkz. PROGRESS.md); diğer tipler (database, file_share,
// smtp_mail, internal_tool) listeye hiç girmez.
//
// Her http_api entegrasyonu tek, genel bir "HTTP çağrısı yap" tool'u olarak sunulur
// (method/path/query/body serbest bırakılır) — admin panelindeki `tool_schema` alanı
// şu an kullanılmıyor, ileride entegrasyona özel şema üretmek için devreye alınabilir.

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface AccessibleIntegration {
  integration: McpIntegration;
  allowedOperations: string[];
  getFilters: Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// Bir kullanıcının sahip olduğu tüm role'lerden gelen izinler birleştirilir:
// allowedOperations birleşimi (union), getFilters merge edilir (çakışan anahtarda
// hangi role'ün kazanacağı tanımsız/deterministik değildir — DESIGN.md bunu netleştirmiyor,
// pratik bir varsayım olarak son işlenen role'ün değeri kazanır).
async function getAccessibleIntegrations(userId: string): Promise<AccessibleIntegration[]> {
  const roleIds = (await prisma.userRole.findMany({ where: { userId }, select: { roleId: true } })).map(
    (r) => r.roleId,
  );
  if (roleIds.length === 0) return [];

  const permissions = await prisma.roleMcpPermission.findMany({
    where: {
      roleId: { in: roleIds },
      mcpIntegration: { isEnabled: true, type: McpIntegrationType.http_api },
    },
    include: { mcpIntegration: true },
  });

  const byIntegration = new Map<string, AccessibleIntegration>();
  for (const perm of permissions) {
    const ops = isStringArray(perm.allowedOperations)
      ? perm.allowedOperations.map((op) => op.toLowerCase())
      : [];
    const filters = asRecord(perm.getFilters);
    const existing = byIntegration.get(perm.mcpIntegrationId);
    if (existing) {
      existing.allowedOperations = [...new Set([...existing.allowedOperations, ...ops])];
      existing.getFilters = { ...existing.getFilters, ...filters };
    } else {
      byIntegration.set(perm.mcpIntegrationId, {
        integration: perm.mcpIntegration,
        allowedOperations: ops,
        getFilters: filters,
      });
    }
  }
  return [...byIntegration.values()];
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "tool"
  );
}

function toolNameFor(integration: McpIntegration): string {
  return `${slugify(integration.name)}_${integration.id.slice(0, 8)}`;
}

export async function listToolsForUser(userId: string): Promise<ToolDefinition[]> {
  const accessible = await getAccessibleIntegrations(userId);
  return accessible
    .filter((a) => a.allowedOperations.length > 0)
    .map((a) => ({
      name: toolNameFor(a.integration),
      description: `"${a.integration.name}" harici HTTP API'sine istek atar. İzinli metodlar: ${a.allowedOperations.join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: {
          method: {
            type: "string",
            enum: a.allowedOperations,
            description: "HTTP metodu",
          },
          path: {
            type: "string",
            description: "Sağlayıcının base URL'ine eklenecek yol, ör. /users/123",
          },
          query: {
            type: "object",
            description: "Opsiyonel query string parametreleri",
          },
          body: {
            type: "object",
            description: "Opsiyonel istek gövdesi (JSON, sadece POST/PUT/PATCH için)",
          },
        },
        required: ["method", "path"],
      },
    }));
}

export interface ToolCallResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

interface ToolCallArgs {
  method?: unknown;
  path?: unknown;
  query?: unknown;
  body?: unknown;
}

export async function callToolForUser(
  userId: string,
  toolName: string,
  args: ToolCallArgs,
): Promise<ToolCallResult> {
  const accessible = await getAccessibleIntegrations(userId);
  const match = accessible.find((a) => toolNameFor(a.integration) === toolName);
  if (!match) {
    return { ok: false, error: "Tool bulunamadı ya da bu kullanıcının erişimi yok" };
  }

  const method = String(args.method ?? "").toUpperCase();
  if (!match.allowedOperations.includes(method.toLowerCase())) {
    return { ok: false, error: `'${method}' metodu bu tool için izinli değil` };
  }

  const config = match.integration.connectionConfig;
  const baseUrl = readConnectionConfigValue(config, "baseUrl") ?? readConnectionConfigValue(config, "url");
  if (!baseUrl) {
    return { ok: false, error: "connection_config içinde 'baseUrl' tanımlı değil" };
  }
  const authToken = readConnectionConfigValue(config, "apiKey") ?? readConnectionConfigValue(config, "token");

  const path = typeof args.path === "string" ? args.path : "";
  let url: URL;
  try {
    url = new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    return { ok: false, error: "Geçersiz path" };
  }

  // get_filters, AI'nin gönderdiği query'yi ezer (role için zorunlu filtre — bkz. DESIGN.md 4.3).
  const mergedQuery = { ...asRecord(args.query), ...match.getFilters };
  for (const [key, value] of Object.entries(mergedQuery)) {
    url.searchParams.set(key, String(value));
  }

  try {
    const hasBody = args.body !== undefined && args.body !== null;
    const resp = await fetch(url, {
      method,
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(args.body) : undefined,
    });
    const text = await resp.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // JSON değilse ham metin olarak bırak
    }
    return { ok: resp.ok, status: resp.status, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Bilinmeyen hata" };
  }
}
