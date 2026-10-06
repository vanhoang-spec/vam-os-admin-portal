/**
 * lib/email-quota-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Trần thư MỘT cho cả hệ thống — mọi bộ gửi (thư mời mentee, lời mời tài khoản,
 * thư xác nhận mentor, cấp quyền reviewer, thư báo mở lại ca) đếm cùng một sổ
 * `outbound_emails` và so với cùng một con số này.
 *
 * Trước 06/10/2026 có HAI con số: 1.000 cho phần lớn bộ gửi và 300 (gói miễn
 * phí của Brevo) cho lời mời tài khoản — hai trần cho một sổ thư nghĩa là ô
 * "Thư đã gửi trong 24 giờ" của trang lời mời báo 300 đã đầy trong khi các
 * trang khác vẫn gửi tiếp tới 1.000.
 *
 * Module thuần, không I/O.
 */

/** Ai đang thật sự gửi thư — chữ hiện trên màn hình và trong hướng dẫn. */
export const EMAIL_PROVIDER_NAME = "Resend";

/**
 * Trần thư trong 24 giờ trượt — mức TỰ ĐẶT, không phải trần của nhà cung cấp.
 *
 * Từ 06/10/2026 thư đi qua Resend gói Pro: 50.000 thư/THÁNG, không giới hạn theo
 * ngày, và dùng chung với các dự án khác trong cùng nhóm Resend. 1.000 thư/ngày
 * đủ cho đợt dồn nhất của một mùa (khoảng 2.700 thư rải vài ngày) mà một lần
 * bấm nhầm cũng không đốt hết ngân sách tháng của cả nhóm. Đổi gói thì đổi số này.
 */
export const DAILY_EMAIL_LIMIT = 1000;

/**
 * Cửa sổ đếm thư đã gửi: 24 GIỜ TRƯỢT, không theo ngày lịch — không có gì bảo
 * đảm nhà cung cấp đặt lại hạn mức lúc nửa đêm giờ Việt Nam. Đếm trượt có thể
 * dùng chưa hết trần một chút, nhưng không bao giờ gửi vượt.
 */
export const QUOTA_WINDOW_MS = 24 * 60 * 60_000;

/** "1.000 thư/24 giờ" — cùng cách viết số với mọi con số khác trên màn hình. */
export function dailyEmailLimitLabel(): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(DAILY_EMAIL_LIMIT)} thư/24 giờ`;
}
