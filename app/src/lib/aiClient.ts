import { AiProviderType, type AiProvider } from "@tegrai/db";

// DESIGN.md Bölüm 6 — Chat Bot Deneyimi: seçili AI sağlayıcısına gerçek istek atma.
// Token sayıları DESIGN.md Bölüm 12 (Bütçe) tarafından maliyet hesaplamak için kullanılır.

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiReply {
  content: string;
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

export async function generateReply(
  provider: AiProvider,
  apiKey: string,
  history: ChatTurn[],
): Promise<AiReply> {
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
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!resp.ok) {
      throw new Error(`Anthropic API hatası: HTTP ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      content: { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };
    const text = data.content.find((block) => block.type === "text")?.text ?? "";
    return {
      content: text,
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
        messages: [
          ...(params.system_prompt ? [{ role: "system", content: params.system_prompt }] : []),
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI API hatası: HTTP ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      content: data.choices[0]?.message.content ?? "",
      tokensPrompt: data.usage.prompt_tokens,
      tokensCompletion: data.usage.completion_tokens,
    };
  }

  throw new Error(`'${provider.providerType}' sağlayıcı tipi için chat henüz desteklenmiyor`);
}
