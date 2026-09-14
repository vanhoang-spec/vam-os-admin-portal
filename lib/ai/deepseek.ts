import "server-only";

import { evaluateAiConfig } from "./ai-core";
import { AI_TIMEOUT_MS, AiError, parseAiJson, type AiMessage, type AiResult, type ChatOptions } from "./types";

/**
 * Client gọi DeepSeek API.
 *
 * DeepSeek dùng giao thức tương thích OpenAI nên chỉ cần `fetch` thuần — không
 * thêm SDK nào, cùng lối với lib/email.ts gọi Brevo.
 *
 * Khoá API CHỈ tồn tại phía server (`process.env.DEEPSEEK_API_KEY`). `import
 * "server-only"` ở trên khiến build LỖI ngay nếu ai đó lỡ import file này vào
 * component client.
 *
 * Biến môi trường (đặt trên Vercel, không bao giờ có tiền tố NEXT_PUBLIC_):
 *   DEEPSEEK_API_KEY
 *   DEEPSEEK_MODEL      (tuỳ chọn — mặc định deepseek-chat)
 *   DEEPSEEK_BASE_URL   (tuỳ chọn)
 */

const DEFAULT_BASE_URL = "https://api.deepseek.com";

export function isAiConfigured(): boolean {
  return evaluateAiConfig(process.env).deepseek;
}

/**
 * Gọi chat completion. Ném `AiError` khi thất bại.
 *
 * KHÔNG tự thử lại: mọi công cụ ở đây do người dùng bấm nút, tự bấm lại rẻ hơn,
 * và thử lại lúc API đang quá tải là nhân đôi tiền token cho cùng một câu trả lời.
 */
export async function aiChat(messages: AiMessage[], opts: ChatOptions = {}): Promise<AiResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new AiError("NOT_CONFIGURED");

  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = opts.model ?? evaluateAiConfig(process.env).model;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2400,
        ...(opts.json ? { response_format: { type: "json_object" } } : {})
      }),
      signal: controller.signal,
      cache: "no-store"
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new AiError("TIMEOUT");
    throw new AiError("UNKNOWN", e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) throw new AiError("AUTH", body);
    // 402 là "Insufficient Balance" của DeepSeek. Xếp vào UNKNOWN thì người dùng
    // thấy "lỗi không xác định" và không ai biết phải đi nạp tiền.
    if (res.status === 402 || res.status === 429) throw new AiError("RATE_LIMIT", `${res.status} ${body}`);
    if (res.status >= 500) throw new AiError("SERVER", `${res.status} ${body}`);
    throw new AiError("UNKNOWN", `${res.status} ${body}`);
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  } | null;

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AiError("EMPTY");

  const u = data?.usage;
  return {
    text,
    usage: u
      ? {
          promptTokens: u.prompt_tokens ?? 0,
          completionTokens: u.completion_tokens ?? 0,
          totalTokens: u.total_tokens ?? 0
        }
      : null
  };
}

/** Gọi và parse JSON. Model đôi khi bọc JSON trong ```json — hàm này gỡ trước khi parse. */
export async function aiChatJson<T>(messages: AiMessage[], opts: Omit<ChatOptions, "json"> = {}): Promise<T> {
  const { text } = await aiChat(messages, { ...opts, json: true });
  return parseAiJson<T>(text);
}
