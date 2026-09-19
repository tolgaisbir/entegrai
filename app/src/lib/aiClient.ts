import { AiProviderType, type AiProvider, type Prisma } from "@tegrai/db";

// DESIGN.md Bölüm 6 — Chat Bot Deneyimi: seçili AI sağlayıcısına gerçek istek atma,
// MCP tool çağrısı (bkz. lib/mcpClient.ts) desteğiyle. Token sayıları DESIGN.md Bölüm
// 12 (Bütçe) tarafından maliyet hesaplamak için kullanılır.

// chat_messages tablosundaki bir satırın (role/content/tool_call_data) sağlayıcıya
// gönderilecek geçmişteki karşılığı. assistant + toolCallData => tool_use istekleri
// ([{id,name,input}] JSON'ı); tool + toolCallData => {toolUseId, name} (sonucun hangi
// çağrıya ait olduğunu eşlemek için).
export interface HistoryMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallData?: Prisma.JsonValue;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  input: unknown;
}

export interface GenerateTurnResult {
  content: string;
  toolCalls: ToolCallRequest[];
  tokensPrompt: number;
  tokensCompletion: number;
}

interface DefaultParams {
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
}

function readDefaultParams(provider: AiProvider): DefaultParams {
  const params = provider.defaultParams;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return {};
  return params as DefaultParams;
}

function readToolCalls(data: Prisma.JsonValue | undefined): ToolCallRequest[] {
  if (!Array.isArray(data)) return [];
  return data as unknown as ToolCallRequest[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

function buildAnthropicMessages(history: HistoryMessage[]): { role: string; content: AnthropicContentBlock[] }[] {
  const messages: { role: string; content: AnthropicContentBlock[] }[] = [];
  for (const m of history) {
    if (m.role === "user") {
      messages.push({ role: "user", content: [{ type: "text", text: m.content }] });
    } else if (m.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const call of readToolCalls(m.toolCallData)) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      messages.push({ role: "assistant", content: blocks });
    } else {
      const data = m.toolCallData as { toolUseId?: string } | undefined;
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: data?.toolUseId,
        content: m.content,
      };
      const last = messages[messages.length - 1];
      if (last?.role === "user" && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        messages.push({ role: "user", content: [block] });
      }
    }
  }
  return messages;
}

function buildOpenAiMessages(
  history: HistoryMessage[],
  systemPrompt?: string,
): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  for (const m of history) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const calls = readToolCalls(m.toolCallData);
      messages.push({
        role: "assistant",
        content: m.content || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
    } else {
      const data = m.toolCallData as { toolUseId?: string } | undefined;
      messages.push({ role: "tool", tool_call_id: data?.toolUseId, content: m.content });
    }
  }
  return messages;
}

export async function generateReply(
  provider: AiProvider,
  apiKey: string,
  history: HistoryMessage[],
  tools: ToolSpec[] = [],
): Promise<GenerateTurnResult> {
  const params = readDefaultParams(provider);

  if (provider.providerType === AiProviderType.anthropic) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: params.max_tokens ?? 1024,
        temperature: params.temperature,
        system: params.system_prompt,
        messages: buildAnthropicMessages(history),
        ...(tools.length
          ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }
          : {}),
      }),
    });
    if (!resp.ok) {
      throw new Error(`Anthropic API hatası: HTTP ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      content: AnthropicContentBlock[];
      usage: { input_tokens: number; output_tokens: number };
    };
    let content = "";
    const toolCalls: ToolCallRequest[] = [];
    for (const block of data.content) {
      if (block.type === "text" && block.text) content += block.text;
      else if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
    }
    return {
      content,
      toolCalls,
      tokensPrompt: data.usage.input_tokens,
      tokensCompletion: data.usage.output_tokens,
    };
  }

  if (provider.providerType === AiProviderType.openai) {
    const base = provider.apiBaseUrl ?? "https://api.openai.com/v1";
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        messages: buildOpenAiMessages(history, params.system_prompt),
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
            }
          : {}),
      }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI API hatası: HTTP ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      choices: {
        message: {
          content: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    const message = data.choices[0]?.message;
    const toolCalls: ToolCallRequest[] = (message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: safeJsonParse(tc.function.arguments),
    }));
    return {
      content: message?.content ?? "",
      toolCalls,
      tokensPrompt: data.usage.prompt_tokens,
      tokensCompletion: data.usage.completion_tokens,
    };
  }

  throw new Error(`'${provider.providerType}' sağlayıcı tipi için chat henüz desteklenmiyor`);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
