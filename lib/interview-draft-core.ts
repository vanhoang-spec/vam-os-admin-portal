/**
 * lib/interview-draft-core.ts — bản nháp phiếu chấm phỏng vấn, lưu trên máy mentor.
 *
 * BTC 03/10/2026 (đang phỏng vấn): mentor chuyển tab / chuyển app giữa chừng thì
 * điện thoại tải lại trang và mất hết phần đang chấm. Nháp nằm trong localStorage
 * của trình duyệt — không đi qua máy chủ, không cần migration — và chỉ là bản nháp:
 * kết quả chỉ được ghi khi bấm "Xác nhận kết quả" như cũ.
 *
 * Phần thuần (không đụng localStorage) để kiểm được mà không cần trình duyệt.
 */

/** Đổi tiền tố là bỏ mọi nháp cũ — tăng v khi đổi hình dạng nháp. */
export const DRAFT_PREFIX = "vam:pv-nhap:v1:";
/** Nháp quá 24 giờ bị bỏ: nó chứa nhận xét về một người thật, không nên nằm lại trên máy. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60_000;

export type InterviewDraft = {
  savedAt: number;
  rubricVersion: number;
  outcome: string;
  takeChoice: string;
  /** Giá trị các ô select/textarea theo `name`. */
  fields: Record<string, string>;
};

/** Khoá theo CẢ mentor lẫn hồ sơ: hai mentor dùng chung một máy không thấy nháp của nhau. */
export function draftKey(actorId: string, applicationId: string): string {
  return `${DRAFT_PREFIX}${actorId}:${applicationId}`;
}

/** Có gì đáng giữ không — form trống thì không ghi nháp. */
export function draftHasContent(draft: Pick<InterviewDraft, "fields" | "takeChoice">): boolean {
  return Boolean(draft.takeChoice) || Object.values(draft.fields).some((value) => value.trim() !== "");
}

/**
 * Đọc một nháp đã lưu. Trả null — và người gọi nên xoá nháp đó — khi:
 * hỏng/không đúng hình dạng; quá DRAFT_MAX_AGE_MS; phiếu chấm đã lên phiên bản
 * khác (tiêu chí có thể đã đổi); hoặc nháp cũ hơn kết quả đã lưu (đã nộp ở máy
 * khác rồi — khôi phục nháp cũ sẽ đè lên kết quả mới hơn).
 */
export function parseDraft(
  raw: string | null,
  ctx: { rubricVersion: number; nowMs: number; savedResultAtMs?: number | null }
): InterviewDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const savedAt = Number(d.savedAt);
  if (!Number.isFinite(savedAt) || savedAt > ctx.nowMs + 60_000) return null;
  if (ctx.nowMs - savedAt > DRAFT_MAX_AGE_MS) return null;
  if (Number(d.rubricVersion) !== ctx.rubricVersion) return null;
  if (ctx.savedResultAtMs != null && Number.isFinite(ctx.savedResultAtMs) && savedAt <= ctx.savedResultAtMs) return null;
  if (!d.fields || typeof d.fields !== "object") return null;
  const fields: Record<string, string> = {};
  for (const [key, field] of Object.entries(d.fields as Record<string, unknown>)) {
    if (typeof field === "string") fields[key] = field;
  }
  return {
    savedAt,
    rubricVersion: ctx.rubricVersion,
    outcome: typeof d.outcome === "string" ? d.outcome : "",
    takeChoice: typeof d.takeChoice === "string" ? d.takeChoice : "",
    fields
  };
}

/** Nháp này đã hết hạn chưa (để dọn mọi nháp cũ trên máy, kể cả của hồ sơ khác). */
export function draftExpired(raw: string | null, nowMs: number): boolean {
  if (!raw) return true;
  try {
    const savedAt = Number((JSON.parse(raw) as { savedAt?: unknown })?.savedAt);
    return !Number.isFinite(savedAt) || nowMs - savedAt > DRAFT_MAX_AGE_MS;
  } catch {
    return true;
  }
}
