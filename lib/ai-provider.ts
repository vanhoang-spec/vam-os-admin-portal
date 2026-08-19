import "server-only";

import {
  evaluateAiMatchingGate,
  type AiMatchingEnv
} from "@/lib/ai-matching-core";

/**
 * lib/ai-provider.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The one place the application talks to the language provider.
 *
 * Two features use it — scoring the leftover pairings, and drafting the bodies
 * of the post-matching emails — and both must obey the same rule: what is sent
 * carries no names, addresses or answers belonging to a person. Keeping a
 * single call site is what makes that rule checkable; each caller assembles its
 * payload in a pure module that is unit-tested for exactly this.
 *
 * The API is the OpenAI-compatible one DeepSeek serves.
 */

const TIMEOUT_MS = 45_000;

export type ProviderReply = {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
};

export type ProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type ProviderAvailability =
  | ({ ok: true } & ProviderConfig)
  | { ok: false; reason: string };

/** Is the provider configured and switched on? */
export function getProviderConfig(): ProviderAvailability {
  // ProcessEnv shares no declared key with AiMatchingEnv, hence the cast.
  const gate = evaluateAiMatchingGate(process.env as unknown as AiMatchingEnv);
  if (!gate.canRun) return { ok: false, reason: gate.reason };
  return { ok: true, apiKey: gate.apiKey, model: gate.model, baseUrl: gate.baseUrl };
}

/**
 * One request. Retries once on a network failure or a 5xx, never on a 4xx —
 * a rejected key does not get better by asking again.
 */
export async function callProvider(input: {
  config: ProviderConfig;
  systemPrompt: string;
  userPrompt: string;
  /** Ask the provider to answer with a JSON object. */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  attempt?: number;
}): Promise<ProviderReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.config.apiKey}`
      },
      body: JSON.stringify({
        model: input.config.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt }
        ],
        ...(input.jsonMode === false ? {} : { response_format: { type: "json_object" } }),
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 2000
      }),
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      if (response.status >= 500 && (input.attempt ?? 0) < 1) {
        return callProvider({ ...input, attempt: (input.attempt ?? 0) + 1 });
      }
      throw new Error(`Provider trả về HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      content: String(payload?.choices?.[0]?.message?.content ?? ""),
      promptTokens: Number(payload?.usage?.prompt_tokens ?? 0) || 0,
      completionTokens: Number(payload?.usage?.completion_tokens ?? 0) || 0,
      model: input.config.model
    };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    if (!aborted && (input.attempt ?? 0) < 1) {
      return callProvider({ ...input, attempt: (input.attempt ?? 0) + 1 });
    }
    throw new Error(
      aborted ? "Provider không phản hồi kịp thời." : String((err as Error)?.message ?? err)
    );
  } finally {
    clearTimeout(timer);
  }
}
