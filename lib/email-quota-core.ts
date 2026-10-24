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
 * ngày, và dùng chung với các dự án khác trong cùng nhóm Resend.
 *
 * 1.000 → 3.000 ngày 24/10/2026 (quyết định của người dùng): một đợt "Thông báo chung"
 * 742 thư buổi sáng đã chặn thư kết quả matching cả ngày. Cái giá: trần ngày không còn
 * tự giữ ngân sách tháng — dùng kín 3.000 thư/ngày thì 50.000 thư hết sau khoảng 17 ngày.
 * Tháng 10/2026, VAM OS dùng 5.226 thư trong 24 ngày. Đổi gói thì đổi số này.
 */
export const DAILY_EMAIL_LIMIT = 3000;

/**
 * Cửa sổ đếm thư đã gửi: 24 GIỜ TRƯỢT, không theo ngày lịch — không có gì bảo
 * đảm nhà cung cấp đặt lại hạn mức lúc nửa đêm giờ Việt Nam. Đếm trượt có thể
 * dùng chưa hết trần một chút, nhưng không bao giờ gửi vượt.
 */
export const QUOTA_WINDOW_MS = 24 * 60 * 60_000;

/** "1.000 thư/24 giờ" — cùng cách viết số với mọi con số khác trên màn hình. */
export function dailyEmailLimitLabel(): string {
  return `${dailyEmailLimitNumber()} thư/24 giờ`;
}

/**
 * "3.000" — vế sau của "đã gửi x/3.000" trên các khung gửi. Bốn khung từng gõ cứng "/1.000" nên vẫn ghi
 * 1.000 sau khi trần lên 3.000 (24/10/2026): "1200/1.000" đọc như đã vượt trần trong khi còn chỗ.
 */
export function dailyEmailLimitNumber(): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(DAILY_EMAIL_LIMIT);
}
