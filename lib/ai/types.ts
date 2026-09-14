/**
 * Hợp đồng chung của lớp gọi AI: một kiểu tin nhắn, một kiểu lỗi, một dạng kết quả.
 *
 * Chép từ module AI của TCM CRM. File CỐ Ý không import "server-only": nó chỉ có
 * kiểu và một class lỗi, không chạm khoá API nào — nên file core thuần và test
 * dùng được mà không phải dựng môi trường server.
 */

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

/** Mã lỗi để màn hình dịch sang câu tiếng Việt — KHÔNG trả thẳng lỗi thô của API cho người dùng. */
export type AiErrorCode = "NOT_CONFIGURED" | "AUTH" | "RATE_LIMIT" | "TIMEOUT" | "SERVER" | "EMPTY" | "UNKNOWN";

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** Chi tiết kỹ thuật — chỉ ghi log phía server, không hiện cho người dùng. */
  readonly detail?: string;

  constructor(code: AiErrorCode, detail?: string) {
    super(code);
    this.name = "AiError";
    this.code = code;
    this.detail = detail;
  }
}

export type AiUsage = { promptTokens: number; completionTokens: number; totalTokens: number };
export type AiResult = { text: string; usage: AiUsage | null };

export type ChatOptions = {
  /** 0 = bám sát dữ liệu (tổng hợp số liệu); cao hơn = sáng tạo (tìm ý tưởng). */
  temperature?: number;
  maxTokens?: number;
  /** Ép model trả JSON thuần — dùng cho mọi công cụ trả tài liệu có cấu trúc. */
  json?: boolean;
  model?: string;
};

/**
 * Trần thời gian cho MỘT lượt gọi AI.
 *
 * Trang `/ai` đặt `maxDuration = 120` vì công cụ Xu hướng ngành có thể tốn 25 giây
 * tìm web cộng 75 giây chờ DeepSeek. Nâng số này thì phải nâng `maxDuration` theo:
 * nếu Vercel cắt function trước, người dùng thấy trang lỗi chung chung thay vì câu
 * "trợ lý phản hồi quá lâu" — và không biết là bấm lại có ích hay không.
 */
export const AI_TIMEOUT_MS = 75_000;

/** Gỡ ```json ... ``` nếu model lỡ bọc, rồi parse. */
export function parseAiJson<T>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AiError("EMPTY", `Không parse được JSON: ${cleaned.slice(0, 300)}`);
  }
}
