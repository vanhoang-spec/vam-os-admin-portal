/**
 * lib/ai/ai-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của Công cụ AI: câu báo lỗi, trạng thái cấu hình, giới hạn ô nhập.
 *
 * Không I/O, không "server-only": trang trạng thái, server action và test dùng
 * chung một câu trả lời. Khoá API không bao giờ đi ra khỏi file này — hàm trạng
 * thái chỉ nói "đã khai hay chưa".
 */

import type { AiErrorCode } from "./types";

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

/** Lỗi do chính luồng của app sinh ra, ngoài bộ mã của nhà cung cấp AI. */
export type AiActionErrorCode =
  | "NOT_LOGGED_IN"
  | "SESSION_CHECK_FAILED"
  | "NOT_ALLOWED"
  | "REPORT_NOT_ALLOWED"
  | "MISSING_INPUT"
  | "BAD_FORMAT"
  | "SEASON_UNAVAILABLE"
  | "REPORT_DATA_UNAVAILABLE";

export const AI_ERROR_MESSAGES: Record<AiErrorCode | AiActionErrorCode, string> = {
  NOT_CONFIGURED: "Chưa cấu hình khoá API DeepSeek cho Công cụ AI. Liên hệ quản trị viên.",
  AUTH: "Khoá API DeepSeek không hợp lệ hoặc đã hết hiệu lực. Liên hệ quản trị viên.",
  RATE_LIMIT:
    "DeepSeek đang từ chối yêu cầu: gọi quá nhiều lần hoặc tài khoản đã hết tiền. Thử lại sau ít phút, hoặc báo quản trị viên kiểm tra số dư.",
  TIMEOUT: "Trợ lý phản hồi quá lâu. Vui lòng thử lại.",
  SERVER: "Dịch vụ AI đang gặp sự cố. Vui lòng thử lại sau.",
  EMPTY: "Trợ lý không trả về nội dung. Vui lòng thử lại.",
  UNKNOWN: "Có lỗi xảy ra khi gọi trợ lý AI. Vui lòng thử lại.",
  NOT_LOGGED_IN: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  SESSION_CHECK_FAILED: "Không xác minh được phiên đăng nhập lúc này. Tải lại trang rồi thử lại.",
  NOT_ALLOWED: "Vai trò của bạn không dùng được Công cụ AI.",
  REPORT_NOT_ALLOWED: "Chỉ super admin và admin chạy được báo cáo Ban điều hành.",
  MISSING_INPUT: "Vui lòng nhập đủ thông tin.",
  BAD_FORMAT:
    "Trợ lý trả về nội dung sai khuôn (có thể do bài quá dài nên bị cắt giữa chừng). Thử lại, hoặc rút gọn phần thông tin đầu vào.",
  SEASON_UNAVAILABLE: "Không xác minh được mùa bạn được cấp quyền. Chọn lại mùa rồi thử lại.",
  REPORT_DATA_UNAVAILABLE: "Không đọc được số liệu nào của mùa này nên chưa gửi gì cho trợ lý. Thử lại sau."
};

export function aiErrorMessage(code: AiErrorCode | AiActionErrorCode): string {
  return AI_ERROR_MESSAGES[code] ?? AI_ERROR_MESSAGES.UNKNOWN;
}

/**
 * Chữ ký rộng để nhận thẳng `process.env`: một kiểu toàn trường tuỳ chọn là "kiểu yếu"
 * với TypeScript, và `NodeJS.ProcessEnv` không khai trường nào trùng tên nên bị từ chối.
 */
export type AiConfigEnv = Readonly<Record<string, string | undefined>>;

export type AiConfigStatus = {
  deepseek: boolean;
  model: string;
  tavily: boolean;
};

/**
 * Đã khai khoá nào, dùng model nào — không bao giờ trả chính khoá.
 *
 * Đọc lúc gọi chứ không lúc nạp module: CI build không có secret nào, và một giá
 * trị chốt lúc build sẽ nói "chưa cấu hình" mãi dù khoá đã được khai trên Vercel.
 */
export function evaluateAiConfig(env: AiConfigEnv): AiConfigStatus {
  return {
    deepseek: Boolean(env.DEEPSEEK_API_KEY?.trim()),
    model: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
    tavily: Boolean(env.TAVILY_API_KEY?.trim())
  };
}

/** Trần ký tự từng ô nhập — chặn dán nhầm cả tệp vào ô, và giữ prompt trong ngân sách token. */
export const AI_INPUT_LIMITS = {
  topic: 200,
  brief: 6000,
  deliverable: 300,
  note: 3000,
  question: 1000,
  subject: 300
} as const;

/** Trần chữ lấy từ MỖI file đính kèm của ba công cụ sáng tạo. */
export const AI_ATTACHMENT_CHARS = 6000;

export function clampText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Dòng cảnh báo đặt trên mọi form gửi dữ liệu cho AI. */
export const AI_PRIVACY_NOTICE =
  "Nội dung bạn nhập và file đính kèm được gửi sang DeepSeek (máy chủ ở nước ngoài) để xử lý. Không dán họ tên, email, số điện thoại, MSSV của mentor/mentee. App không lưu kết quả — hãy tải Word/PDF về máy, rời trang là mất.";

/** Dòng đóng dấu cuối mọi tài liệu AI soạn, trên màn hình lẫn trong file Word. */
export const AI_RESULT_NOTE = "Nội dung do AI soạn — người đọc phải kiểm lại trước khi dùng.";
