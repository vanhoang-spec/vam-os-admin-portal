/**
 * Ghép cặp Vòng 2 — ai nhận thư mời chọn mentee, ở đợt gửi nào (BTC 07/10/2026). Phần thuần.
 *
 * Mỗi mentor một link, dùng cho mọi đợt. Đợt 1 mời mọi mentor còn chỗ; sau đợt phỏng vấn
 * kế tiếp BTC chuyển sang đợt 2 và chỉ mentor LÚC ĐÓ vẫn còn chỗ (và chưa nhận thư của
 * đợt 2) mới nhận tiếp — mentor đã đủ không bị làm phiền.
 */
import type { Round2Row } from "@/lib/matching-round2-core";
import { windowState } from "@/lib/matching-round2-link-core";
import { formatDateTime } from "@/lib/utils";

export function isRound2Recipient(row: Round2Row, lastSentWave: number, wave: number): boolean {
  return (
    row.person.role === "mentor" &&
    row.receivesList === true &&
    Boolean(row.person.email) &&
    Number.isInteger(wave) &&
    wave >= 1 &&
    lastSentWave < wave
  );
}

export function round2WaveNote(wave: number): string {
  return wave <= 1
    ? "Ban tổ chức mời anh/chị chọn mentee ở Vòng 2 ghép cặp: các bạn mentee đã đạt phỏng vấn, cùng nhóm ngành với anh/chị, đang chờ mentor."
    : "Danh sách mentee chờ mentor ở Vòng 2 vừa có thêm hồ sơ mới (các bạn đạt đợt phỏng vấn sau). Anh/chị vẫn còn chỗ nhận mentee, mời anh/chị mở lại đường dẫn để chọn.";
}

export function round2DeadlineLabel(closesAt: string | null): string {
  return closesAt ? `${formatDateTime(closesAt)} (giờ Việt Nam)` : "khi ban tổ chức thông báo đóng vòng";
}

/**
 * Gửi được khi đã ĐẶT giờ mở và vòng chưa đóng — kể cả khi giờ mở còn ở tương lai (BTC 14/10/2026).
 * Trước đây chỉ gửi khi vòng đã mở; 368 thư cần khoảng 10 lần bấm, nên người nhận thư sớm được chọn
 * trước người nhận sau vài phút. Gửi hết trước giờ mở thì mọi mentor bắt đầu cùng một lúc; trước
 * giờ đó đường dẫn báo "chưa mở", và database tự từ chối mọi lượt chọn.
 */
export function round2DispatchBlocked(settings: { opensAt: string | null; closesAt: string | null } | null, nowMs: number): string | null {
  if (!settings?.opensAt || !Number.isFinite(Date.parse(settings.opensAt))) return "Chưa đặt giờ mở vòng 2 — đặt giờ mở trước khi gửi link.";
  if (windowState(settings, nowMs) === "closed") return "Vòng 2 đã đóng — không gửi link.";
  return null;
}

/**
 * Thư NHẮC mentor chưa chọn mentee (BTC 16/10/2026: "trưa mai gửi nhắc các mentor chưa đăng ký, kèm
 * đường link đã gửi trước đó"). Khác thư mời: không theo đợt gửi, dùng lại ĐÚNG link cũ của từng mentor
 * (không tạo link mới, không đổi mã), và danh sách người nhận được tính lúc bấm gửi — ai đã chọn xong
 * trước giờ đó thì không bị nhắc.
 *
 * "Chưa chọn" = chưa có cặp Vòng 2 nào đang hoạt động; mentor đã nhận một bạn ở Vòng 1 mà còn chỗ vẫn
 * được nhắc (họ chưa chọn gì ở Vòng 2). Mentor đã chọn một bạn và còn chỗ thứ hai thì KHÔNG nhắc: họ
 * đang tham gia, thư nhắc "chưa chọn" nói sai về họ.
 */
export const ROUND2_REMINDER_COOLDOWN_MS = 18 * 3_600_000;

export type ReminderLink = { id?: unknown; token?: unknown; revoked_at?: unknown; last_sent_wave?: unknown };

export function isRound2ReminderRecipient(row: Round2Row, link: ReminderLink | undefined, remindedLinkIds: ReadonlySet<string>): boolean {
  if (!link) return false;
  return (
    row.person.role === "mentor" &&
    row.receivesList === true &&
    Boolean(row.person.email) &&
    !link.revoked_at &&
    Boolean(link.token) &&
    // Chưa nhận thư mời thì thư nhắc "đường link đã gửi trước đó" nói sai — người đó thuộc nút gửi mời.
    Number(link.last_sent_wave ?? 0) >= 1 &&
    !row.activeMatches.some((m) => m.round === 2) &&
    !remindedLinkIds.has(String(link.id))
  );
}

/** Chỉ nhắc khi vòng đang mở: chưa mở thì link báo "chưa mở", đã đóng thì không còn gì để nhắc. */
export function round2ReminderBlocked(settings: { opensAt: string | null; closesAt: string | null } | null, nowMs: number): string | null {
  const state = windowState(settings, nowMs);
  if (state === "not_open") return "Vòng 2 chưa mở — chưa nhắc được.";
  if (state === "closed") return "Vòng 2 đã đóng — không gửi thư nhắc.";
  return null;
}

export function round2OpensLabel(opensAt: string | null): string {
  return opensAt ? `${formatDateTime(opensAt)} (giờ Việt Nam)` : "khi ban tổ chức thông báo mở vòng";
}
