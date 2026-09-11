import { SEASON_CONFIG } from "@/lib/season-config";

const SEASON_AWARE_PATHS = new Set([
  "/",
  "/mentors",
  "/mentees",
  "/matches",
  "/operations",
  "/operations/tasks",
  // Lời mời tài khoản làm việc theo từng mùa: người vận hành chọn mùa rồi mới
  // thấy danh sách mentor/mentee của mùa đó.
  "/participant-accounts"
]);

export function seasonLabel(code: string, fallback?: string | null) {
  const match = String(code ?? "").trim().toUpperCase().match(/-S(\d+)$/);
  return match ? `Mùa ${Number(match[1])}` : String(fallback ?? code ?? "").trim();
}

export function isSeasonAwarePath(pathname: string) {
  return SEASON_AWARE_PATHS.has(pathname);
}

/**
 * Nhãn mùa dùng trong MỌI lá thư gửi ra.
 *
 * Định nghĩa đúng MỘT lần, ở đây. Trước đó ba nơi cùng tự dựng chuỗi này —
 * luồng nộp đơn, luồng gửi bù, luồng mời phỏng vấn — và khi đổi tên thương
 * hiệu thì hai nơi được sửa còn một nơi bị sót. Hậu quả là 25 lá thư gửi bù
 * mang tiêu đề lặp tên chương trình hai lần, trong khi đơn nộp mới thì không.
 * Không có gì báo, vì ba bản sao không ràng buộc gì với nhau.
 *
 * CỐ Ý không kèm tên chương trình: mọi tiêu đề thư đã mở đầu bằng
 * "[UEH Mentoring]", nên nhãn mùa mà cũng mang tên ấy là nhắc hai lần trong
 * một dòng.
 */
export const CURRENT_APPLICATION_SEASON_LABEL = seasonLabel(
  SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE
);

