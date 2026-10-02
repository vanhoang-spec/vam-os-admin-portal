import { INVITE_AUDIENCE_STATUSES } from "@/lib/mentee-invite-dispatch-core";

/**
 * Sửa email một ứng viên mentee rồi gửi lại thư mời chọn ca — phần thuần.
 *
 * Sinh ra 02/10/2026: một bạn gõ thiếu ".vn" ở đuôi email lúc nộp đơn, thư mời
 * đi vào một địa chỉ không ai đọc, và bộ gửi thư mời chỉ gửi cho người CHƯA được
 * gửi lần nào — nên không có cách nào gửi lại cho đúng một người.
 */

/** Hai lần gửi lại cùng một địa chỉ phải cách nhau chừng này — chặn bấm đúp. */
export const RESEND_COOLDOWN_MINUTES = 10;

const EMAIL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** Email đã làm gọn, hoặc null nếu không phải một địa chỉ dùng được. */
export function normalizeApplicantEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || email.length > 200 || !EMAIL.test(email)) return null;
  return email;
}

export type ResendCandidate = {
  roleApplied: string | null;
  status: string | null;
  source: string | null;
  inCurrentSeason: boolean;
  hasActiveBooking: boolean;
  hasInvite: boolean;
};

/**
 * Hồ sơ này gửi lại thư mời được không — cùng điều kiện với bộ gửi thư mời
 * (isInviteRecipient) trừ đúng một điều: đã gửi rồi vẫn gửi lại được.
 */
export function resendRefusal(c: ResendCandidate): string | null {
  if (String(c.roleApplied ?? "").trim().toLowerCase() !== "mentee") return "Chỉ gửi lại thư mời cho hồ sơ mentee.";
  if (!c.inCurrentSeason) return "Hồ sơ này không thuộc mùa đang tuyển.";
  if (String(c.source ?? "").trim() !== "vam_os_form") return "Hồ sơ này không nộp qua form VAM OS nên không có thư mời chọn ca.";
  if (!INVITE_AUDIENCE_STATUSES.has(String(c.status ?? "").trim())) return "Hồ sơ không ở bước mời phỏng vấn.";
  if (c.hasActiveBooking) return "Ứng viên đã đặt ca rồi — không cần gửi lại thư mời.";
  if (!c.hasInvite) return "Hồ sơ chưa có link đặt ca. Dùng nút Gửi thư mời ở màn hình Ca phỏng vấn mentee.";
  return null;
}

/** Cùng địa chỉ vừa gửi chưa đủ RESEND_COOLDOWN_MINUTES thì chặn — trừ khi email vừa được sửa. */
export function withinCooldown(lastSentAtIso: string | null, emailChanged: boolean, nowMs: number): boolean {
  if (emailChanged || !lastSentAtIso) return false;
  const at = new Date(lastSentAtIso).getTime();
  return Number.isFinite(at) && nowMs - at < RESEND_COOLDOWN_MINUTES * 60_000;
}
