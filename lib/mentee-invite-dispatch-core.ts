/**
 * lib/mentee-invite-dispatch-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của bộ gửi thư mời mentee chọn ca: ai nhận thư, và một lần bấm
 * được gửi bao nhiêu thư.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN "CHỪA HẠN MỨC"
 * ---------------------------------------------------------------------------
 * Gói Brevo 300 thư/ngày dùng chung cả hệ thống. Chọn ca hiện QR trực tiếp,
 * không gửi email xác nhận nữa. Vẫn chừa hạn mức cho đặt lại mật khẩu,
 * thông báo sự kiện và các thư khác của hệ thống.
 *
 * Đếm theo 24 GIỜ TRƯỢT, không theo ngày lịch: không có gì bảo đảm Brevo đặt
 * lại hạn mức lúc nửa đêm giờ Việt Nam. Đếm trượt có thể dùng chưa hết hạn mức
 * một chút, nhưng không bao giờ gửi vượt.
 *
 * Module thuần, không I/O.
 */

/** Trần thư trong 24 giờ của gói Brevo đang dùng. Đổi gói thì đổi con số này. */
export const DAILY_EMAIL_LIMIT = 300;

/**
 * Phần hạn mức để dành cho mọi thư khác của hệ thống.
 *
 * Bộ gửi thư mời không bao giờ ăn vào phần này. Nó không phải trần cứng cho các thư khác — chỉ là khoảng trống bộ gửi thư mời cố ý chừa ra.
 */
export const DISPATCH_RESERVE = 80;

/** Số thư tối đa một lần bấm — trần thời gian của một request, không phải trần lịch sự. */
export const DISPATCH_MAX_PER_RUN = 40;

/** Ngân sách thời gian một lần bấm, nằm dưới maxDuration 60 giây của trang. */
export const DISPATCH_TIME_BUDGET_MS = 45_000;

/** Claim bị bỏ dở (tab đóng giữa chừng, request chết) quá lâu thì thu hồi. */
export const DISPATCH_STALE_CLAIM_MS = 10 * 60_000;

/** Cửa sổ đếm thư đã gửi. */
export const QUOTA_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Trạng thái đơn được nhận thư mời chọn ca.
 *
 * CỐ Ý hẹp hơn BOOKING_ELIGIBLE_STATUSES: `interview_scheduled` đặt được ca
 * nhưng KHÔNG được mời — trạng thái đó nghĩa là bạn ấy đã có ca rồi, và một thư
 * "mời bạn chọn ca" gửi cho người đã chọn là thư làm họ tưởng chỗ của mình mất.
 */
export const INVITE_AUDIENCE_STATUSES: ReadonlySet<string> = new Set([
  "invited_to_interview",
  // Còn lại từ luồng hai bước cũ, để hồ sơ nằm lại ở đây không bị bỏ sót.
  "screening_passed"
]);

/**
 * Một lần bấm được gửi bao nhiêu thư mời.
 *
 * Không bao giờ âm, không bao giờ vượt `DISPATCH_MAX_PER_RUN`. Trả 0 nghĩa là
 * hôm nay đã chạm phần hạn mức của thư mời — phải chờ cửa sổ 24 giờ trượt đi.
 */
export function dispatchAllowance(sentInWindow: number): number {
  const sent = Number.isFinite(sentInWindow) && sentInWindow > 0 ? Math.floor(sentInWindow) : 0;
  const room = DAILY_EMAIL_LIMIT - DISPATCH_RESERVE - sent;
  return Math.max(0, Math.min(DISPATCH_MAX_PER_RUN, room));
}

export type InviteCandidate = {
  roleApplied: unknown;
  source: unknown;
  status: unknown;
  hasActiveBooking: boolean;
  /** Số lần đã gửi thư mời. Null khi chưa có dòng mời nào. */
  sendCount: number | null;
};

/**
 * Đơn này có đang chờ thư mời không.
 *
 * Giai đoạn 1 chỉ gửi thư mời ĐẦU — `sendCount` 0 hoặc chưa có dòng. Một người
 * đã nhận thư mời thì bấm lại nút không gửi thêm lần nữa: bấm hai lần là hai
 * thư, và hạn mức 300 thư/ngày không chịu nổi một lần bấm nhầm như thế.
 */
export function isInviteRecipient(candidate: InviteCandidate): boolean {
  if (String(candidate.roleApplied ?? "").trim().toLowerCase() !== "mentee") return false;
  if (String(candidate.source ?? "").trim() !== "vam_os_form") return false;
  if (!INVITE_AUDIENCE_STATUSES.has(String(candidate.status ?? "").trim())) return false;
  if (candidate.hasActiveBooking) return false;
  return (candidate.sendCount ?? 0) === 0;
}

export type InviteDispatchSummary = {
  /** Đang chờ thư mời đầu. */
  waiting: number;
  /** Đã nhận thư mời, chưa chọn ca. */
  invitedNotBooked: number;
  /** Đã chọn ca. */
  booked: number;
  /** Lần gửi gần nhất lỗi, vẫn đang chờ. */
  lastFailed: number;
};
