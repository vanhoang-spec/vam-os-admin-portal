import "server-only";

import { callProvider } from "@/lib/ai-provider";
import { evaluateMktAiGate, readJsonObject, type MktAiEnv } from "@/lib/mkt-core";

/**
 * lib/mkt-ai.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Asking DeepSeek, and refusing to believe it the first time.
 *
 * DeepSeek and nothing else. The owner asked for this module to run entirely on
 * DeepSeek, and the application's provider call site speaks only the
 * OpenAI-compatible API DeepSeek serves — there is no Anthropic branch here and
 * none is being added.
 *
 * Two habits worth keeping:
 *
 *   * One retry, carrying the previous parse error. A model told "your last
 *     answer failed with: Unexpected token }" fixes it far more often than the
 *     same request sent again unchanged. Exactly one retry: a second failure is
 *     a signal, not a temporary blip, and a loop here spends the owner's money.
 *
 *   * Nothing written here reaches the database. Every function returns what
 *     the model said; a person looks at it and presses save.
 */

const MAX_ATTEMPTS = 2;

export type MktAiResult<T> =
  | { ok: true; data: T; model: string; raw: unknown }
  | { ok: false; message: string };

function log(scope: string, error: unknown) {
  const err = error as { message?: string };
  console.error("[mkt-ai]", scope, { message: err?.message ?? String(error) });
}

/** Is the feature switched on and configured? Reported, never guessed at. */
export function mktAiStatus(): { ready: boolean; reason?: string; model?: string } {
  const gate = evaluateMktAiGate(process.env as unknown as MktAiEnv);
  if (!gate.canRun) return { ready: false, reason: gate.reason };
  return { ready: true, model: gate.model };
}

/**
 * One request, and one retry that says what went wrong last time.
 *
 * Returns a plain result rather than throwing: every caller of this is a server
 * action whose job is to put a Vietnamese sentence on a screen, and an
 * exception crossing that boundary becomes a blank page.
 */
export async function callMktJson<T = Record<string, unknown>>(input: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}): Promise<MktAiResult<T>> {
  const gate = evaluateMktAiGate(process.env as unknown as MktAiEnv);
  if (!gate.canRun) {
    return {
      ok: false,
      message: `Tính năng AI chưa bật: ${gate.reason}. Vẫn soạn tay được ở các ô bên dưới.`
    };
  }

  const config = { apiKey: gate.apiKey, model: gate.model, baseUrl: gate.baseUrl };
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let reply;

    try {
      reply = await callProvider({
        config,
        systemPrompt: `${input.systemPrompt}\n\nCHỈ trả về MỘT khối JSON hợp lệ, không lời dẫn, không giải thích.`,
        userPrompt: lastError
          ? `${input.userPrompt}\n\nLần trước JSON lỗi: ${lastError}. Trả lại JSON hợp lệ.`
          : input.userPrompt,
        jsonMode: true,
        temperature: 0.7,
        maxTokens: input.maxTokens ?? 6000,
        attempt
      });
    } catch (error) {
      log("provider call failed", error);
      return {
        ok: false,
        message: "Không gọi được DeepSeek lúc này. Vui lòng thử lại sau ít phút."
      };
    }

    try {
      const parsed = readJsonObject(reply.content) as T;
      return { ok: true, data: parsed, model: reply.model, raw: parsed };
    } catch (error) {
      lastError = String((error as { message?: string })?.message ?? error).slice(0, 160);
      log(`unparseable answer (attempt ${attempt + 1})`, error);
    }
  }

  return {
    ok: false,
    message: "DeepSeek trả về không đúng cấu trúc sau 2 lần. Vui lòng thử lại hoặc soạn tay."
  };
}
