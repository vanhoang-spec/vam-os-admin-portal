/**
 * Client DeepSeek: mọi thất bại thành đúng một mã lỗi, và chi tiết thô của API
 * không bao giờ nằm trong câu người dùng thấy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreProcessState, snapshotProcessState, type ProcessStateSnapshot } from "./support/process-state";

vi.mock("server-only", () => ({}));

import { aiChat, aiChatJson, isAiConfigured } from "@/lib/ai/deepseek";
import { AI_TIMEOUT_MS, AiError } from "@/lib/ai/types";

let state: ProcessStateSnapshot;
let fetchMock: ReturnType<typeof vi.fn>;

const MESSAGES = [
  { role: "system" as const, content: "Bạn là trợ lý." },
  { role: "user" as const, content: "Xin chào" }
];

function completion(content: string | undefined, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }), {
    status
  });
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("không ném lỗi");
}

beforeEach(() => {
  state = snapshotProcessState();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env.DEEPSEEK_API_KEY = "sk-test";
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_BASE_URL;
});

afterEach(() => {
  vi.useRealTimers();
  restoreProcessState(state);
});

describe("aiChat", () => {
  it("chưa có khoá thì ném NOT_CONFIGURED và không gọi mạng", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(isAiConfigured()).toBe(false);
    const error = await codeOf(aiChat(MESSAGES));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gửi đúng yêu cầu chat completion, mặc định model deepseek-chat", async () => {
    fetchMock.mockResolvedValue(completion("Chào bạn"));
    const result = await aiChat(MESSAGES, { temperature: 0.9, maxTokens: 6000, json: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body)).toEqual({
      model: "deepseek-chat",
      messages: MESSAGES,
      temperature: 0.9,
      max_tokens: 6000,
      response_format: { type: "json_object" }
    });
    expect(result).toEqual({ text: "Chào bạn", usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 } });
  });

  it("đọc model và địa chỉ từ biến môi trường, bỏ gạch chéo thừa ở cuối", async () => {
    process.env.DEEPSEEK_MODEL = "deepseek-reasoner";
    process.env.DEEPSEEK_BASE_URL = "https://proxy.example/v1///";
    fetchMock.mockResolvedValue(completion("ok"));
    await aiChat(MESSAGES);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proxy.example/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek-reasoner");
    expect(body).not.toHaveProperty("response_format");
  });

  it.each([
    [401, "AUTH"],
    [403, "AUTH"],
    [402, "RATE_LIMIT"],
    [429, "RATE_LIMIT"],
    [500, "SERVER"],
    [503, "SERVER"],
    [400, "UNKNOWN"]
  ])("HTTP %i thành mã %s, câu lỗi không mang thân phản hồi của API", async (status, code) => {
    fetchMock.mockResolvedValue(new Response('{"error":"Insufficient Balance sk-test"}', { status }));
    const error = (await codeOf(aiChat(MESSAGES))) as AiError;
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
    expect(error.detail).toContain("Insufficient Balance");
  });

  it("model trả nội dung rỗng thì ném EMPTY", async () => {
    fetchMock.mockResolvedValue(completion("   "));
    expect(((await codeOf(aiChat(MESSAGES))) as AiError).code).toBe("EMPTY");
  });

  it("quá thời gian chờ thì huỷ yêu cầu và ném TIMEOUT", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })
    );
    const pending = codeOf(aiChat(MESSAGES));
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS);
    expect(((await pending) as AiError).code).toBe("TIMEOUT");
  });

  it("lỗi mạng khác thành UNKNOWN", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(((await codeOf(aiChat(MESSAGES))) as AiError).code).toBe("UNKNOWN");
  });
});

describe("aiChatJson", () => {
  it("gỡ khối ```json mà model lỡ bọc", async () => {
    fetchMock.mockResolvedValue(completion('```json\n{"title":"T","blocks":[]}\n```'));
    expect(await aiChatJson(MESSAGES)).toEqual({ title: "T", blocks: [] });
  });

  it("JSON hỏng thì ném EMPTY", async () => {
    fetchMock.mockResolvedValue(completion('{"title": "cắt giữa chừng'));
    expect(((await codeOf(aiChatJson(MESSAGES))) as AiError).code).toBe("EMPTY");
  });
});
