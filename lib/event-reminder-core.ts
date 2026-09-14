/**
 * lib/event-reminder-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của "Gửi remind": ai nhận, khi nào được gửi, ngày nhập lại có khớp
 * không, và đọc tiến độ một lượt gửi. Không I/O — màn hình và máy chủ dùng
 * chung đúng một câu trả lời, nên nút bấm không thể nói "gửi được" trong khi hàm
 * gửi nói "không".
 */
import { parseVietnamDateInput, toVietnamInputValue } from "@/lib/event-datetime";
import { isEventFormat, needsJoinUrl } from "@/lib/event-location";

/**
 * Những người nhận thư nhắc: đang GIỮ CHỖ ở buổi này.
 *
 * Không gồm danh sách chờ — nhắc "hẹn gặp bạn" với người chưa có chỗ là hứa một
 * thứ ban tổ chức chưa trao. Không gồm người bị từ chối hay đã huỷ. Người đang
 * chờ duyệt thì có: với sự kiện cần duyệt, trước giờ diễn ra đó có thể là gần hết
 * danh sách, và thư nói rõ đăng ký của họ đang chờ xác nhận.
 */
export const REMINDER_RECIPIENT_STATUSES = ["registered", "confirmed", "pending_review"] as const;

/**
 * Số thư mỗi lần gọi máy chủ.
 *
 * Nhỏ có chủ ý: mỗi thư có thể mất tới vài giây ở nhà cung cấp, và một lần gọi
 * bị cắt vì quá giờ là thư cuối đã đi mà dòng đánh dấu chưa kịp ghi.
 */
export const REMINDER_CHUNK = 10;

/** Quá thời gian này trong một lần gọi thì dừng gửi, trả phần chưa gửi về hàng đợi. */
export const REMINDER_TIME_BUDGET_MS = 45_000;

/**
 * Một dòng "đang gửi" cũ hơn mốc này là của một lần gọi đã chết giữa chừng.
 * Nó được chốt thành LỖI, không đưa lại hàng đợi: không biết thư đã đi hay chưa,
 * và gửi lại tự động là có thể gửi hai lần.
 */
export const REMINDER_STALE_SENDING_MS = 10 * 60_000;

export const REMINDER_RECIPIENT_STATES = ["queued", "sending", "sent", "failed", "skipped"] as const;
export type ReminderRecipientState = (typeof REMINDER_RECIPIENT_STATES)[number];
export type ReminderCounts = Record<ReminderRecipientState, number>;

export const EMPTY_REMINDER_COUNTS: ReminderCounts = { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };

export const REMINDER_RUN_STATES = ["running", "completed", "cancelled"] as const;
export type ReminderRunState = (typeof REMINDER_RUN_STATES)[number];

/** Câu hỏi xác nhận, đúng nguyên văn chủ chương trình yêu cầu. */
export const REMINDER_CONFIRM_QUESTION =
  "Hệ thống sẽ gửi email đến toàn bộ người đăng ký tham dự Event/buổi này với đầy đủ thông tin cập nhật mới nhất đến thời điểm hiện tại. Bạn xác nhận đồng ý tiến hành?";

export const REMINDER_DATE_INVALID = "Nhập ngày theo dạng dd/mm/yyyy, ví dụ 20/09/2026.";

/**
 * Không nói ngày đúng là ngày nào. Nhập lại ngày là để người bấm nhìn lại buổi
 * mình đang đứng; đọc ngày đúng ra cho họ chép là biến bước này thành thủ tục.
 */
export const REMINDER_DATE_MISMATCH =
  "Ngày bạn nhập không khớp ngày diễn ra của buổi này. Kiểm lại đúng buổi bạn định gửi remind.";

export type ReminderChunk = { sent: number; failed: number; skipped: number; released: number };

export type ReminderRunSummary = {
  id: string;
  status: ReminderRunState;
  createdAt: string | null;
  createdByName: string | null;
  confirmedDate: string | null;
  total: number;
  counts: ReminderCounts;
};

export type ReminderProgress = {
  ok: boolean;
  message: string;
  runId?: string;
  counts?: ReminderCounts;
  total?: number;
  /** Lượt đã kết thúc: gửi hết, hoặc đã dừng. */
  done?: boolean;
  /** Kết quả của riêng lần gọi này. Vắng khi lần gọi không gửi thư nào. */
  chunk?: ReminderChunk;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/** Dòng đăng ký này có nhận thư nhắc không. */
export function isReminderRecipient(row: {
  registration_status?: unknown;
  attendance_status?: unknown;
  email?: unknown;
}): boolean {
  const status = text(row.registration_status);
  if (!(REMINDER_RECIPIENT_STATUSES as readonly string[]).includes(status)) return false;
  // Đã check-in là đã ở hội trường — nhắc họ tới là thừa.
  if (text(row.attendance_status) === "checked_in") return false;
  return text(row.email) !== "";
}

/** Ngày diễn ra theo giờ Việt Nam, `YYYY-MM-DD`, hoặc null. */
export function eventVietnamDate(startsAt: unknown): string | null {
  const local = toVietnamInputValue(startsAt);
  return /^\d{4}-\d{2}-\d{2}/.test(local) ? local.slice(0, 10) : null;
}

export type ReminderDateCheck = { ok: true; isoDate: string } | { ok: false; message: string };

/**
 * Ngày người bấm nhập lại có đúng là ngày của buổi này không.
 *
 * So theo NGÀY VIỆT NAM của giờ bắt đầu: buổi 07:00 sáng 20/09 lưu trong
 * database là 00:00 UTC ngày 20, còn buổi 06:00 sáng là 23:00 UTC ngày 19 — so
 * theo ngày UTC là bắt người vận hành nhập một ngày không ai dùng.
 */
export function checkReminderDate(typed: unknown, startsAt: unknown): ReminderDateCheck {
  const isoDate = parseVietnamDateInput(text(typed));
  if (!isoDate) return { ok: false, message: REMINDER_DATE_INVALID };
  const expected = eventVietnamDate(startsAt);
  if (!expected || expected !== isoDate) return { ok: false, message: REMINDER_DATE_MISMATCH };
  return { ok: true, isoDate };
}

/**
 * Lý do KHÔNG được gửi remind cho buổi này lúc này, hoặc null.
 *
 * Buổi trực tuyến chưa có link họp bị chặn: thư nhắc là lá người ta mở ngay
 * trước giờ vào, và một lá thiếu link là một người đứng ngoài phòng họp.
 */
export function reminderBlockReason(
  event: {
    status?: unknown;
    starts_at?: unknown;
    event_format?: unknown;
    online_join_url?: unknown;
  } | null,
  nowMs: number
): string | null {
  if (!event) return "Không tìm thấy buổi này.";
  if (text(event.status) === "cancelled") {
    return "Buổi này đã huỷ — không gửi remind cho một buổi không diễn ra.";
  }
  const startsAt = text(event.starts_at);
  const startsMs = Date.parse(startsAt);
  if (!startsAt || Number.isNaN(startsMs)) return "Buổi này chưa có giờ bắt đầu.";
  if (startsMs <= nowMs) {
    return "Buổi này đã bắt đầu hoặc đã diễn ra — gửi remind lúc này không còn tác dụng.";
  }
  const format = isEventFormat(event.event_format) ? event.event_format : "offline";
  if (needsJoinUrl(format) && !text(event.online_join_url)) {
    return "Buổi có phần trực tuyến này chưa có link họp. Thêm link trong Sửa sự kiện rồi mới gửi remind — thư nhắc thiếu link thì người nhận không vào được.";
  }
  return null;
}

export function countReminderStates(rows: Array<{ status?: unknown }>): ReminderCounts {
  const counts: ReminderCounts = { ...EMPTY_REMINDER_COUNTS };
  for (const row of rows) {
    const status = text(row.status) as ReminderRecipientState;
    if ((REMINDER_RECIPIENT_STATES as readonly string[]).includes(status)) counts[status] += 1;
  }
  return counts;
}

/** Còn bao nhiêu thư chưa có kết quả. */
export function reminderRemaining(counts: ReminderCounts): number {
  return counts.queued + counts.sending;
}

export function reminderTotal(counts: ReminderCounts): number {
  return counts.queued + counts.sending + counts.sent + counts.failed + counts.skipped;
}

/** "Đã gửi 12/40 · lỗi 1 · bỏ qua 2 · còn 25" — chỉ nói những con số khác 0. */
export function describeReminderCounts(counts: ReminderCounts, total = reminderTotal(counts)): string {
  const parts = [`Đã gửi ${counts.sent}/${total}`];
  if (counts.failed) parts.push(`lỗi ${counts.failed}`);
  if (counts.skipped) parts.push(`bỏ qua ${counts.skipped}`);
  const remaining = reminderRemaining(counts);
  if (remaining) parts.push(`còn ${remaining}`);
  return parts.join(" · ");
}

/**
 * Vòng gửi tự động của màn hình có gọi tiếp không.
 *
 * Dừng khi một lần gọi không gửi được thư nào: nếu cả lô đều lỗi thì lỗi nằm ở
 * nhà cung cấp hay hạn mức, và gọi tiếp chỉ đốt nốt phần còn lại của danh sách
 * thành thư lỗi.
 */
export function shouldContinueReminder(result: ReminderProgress): boolean {
  if (!result.ok || result.done || !result.chunk) return false;
  return result.chunk.sent + result.chunk.skipped > 0;
}

/** Trần số lần gọi của một vòng tự động, để một lỗi không biến thành vòng lặp vô tận. */
export function reminderMaxRounds(total: number): number {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  return Math.ceil(safeTotal / REMINDER_CHUNK) + 5;
}

export const REMINDER_RUN_STATE_LABELS: Record<ReminderRunState, string> = {
  running: "Đang gửi dở",
  completed: "Đã gửi xong",
  cancelled: "Đã dừng"
};
