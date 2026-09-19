// DESIGN.md Bölüm 6/9 — chat akışının mcp-server'daki (internal HTTP API, bkz.
// mcp-server/src/index.ts) tool listesini/çağrısını kullanması için ince istemci.

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

function baseUrl(): string {
  const port = process.env.MCP_PORT ?? "3100";
  return `http://127.0.0.1:${port}`;
}

function headers(): Record<string, string> {
  const secret = process.env.MCP_INTERNAL_SECRET;
  if (!secret) throw new Error("MCP_INTERNAL_SECRET tanımlı değil");
  return { "x-internal-secret": secret, "content-type": "application/json" };
}

// mcp-server'a ulaşılamaması (henüz başlatılmamış, ağ hatası vb.) chat'i tamamen
// durdurmamalı — bu durumda kullanıcı hiç tool'suz, düz metin AI yanıtı almaya devam eder.
export async function listToolsForUser(userId: string): Promise<McpToolDefinition[]> {
  try {
    const resp = await fetch(`${baseUrl()}/tools?userId=${encodeURIComponent(userId)}`, {
      headers: headers(),
    });
    if (!resp.ok) return [];
    return (await resp.json()) as McpToolDefinition[];
  } catch {
    return [];
  }
}

export async function callTool(
  userId: string,
  toolName: string,
  toolArgs: unknown,
): Promise<McpToolCallResult> {
  try {
    const resp = await fetch(`${baseUrl()}/tools/call`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ userId, toolName, arguments: toolArgs }),
    });
    return (await resp.json()) as McpToolCallResult;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "mcp-server'a ulaşılamadı" };
  }
}
