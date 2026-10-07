/**
 * Ghép cặp Vòng 2 — ai nhận thư mời chọn mentee, ở đợt gửi nào (BTC 07/10/2026). Phần thuần.
 *
 * Mỗi mentor một link, dùng cho mọi đợt. Đợt 1 mời mọi mentor còn chỗ; sau đợt phỏng vấn
 * kế tiếp BTC chuyển sang đợt 2 và chỉ mentor LÚC ĐÓ vẫn còn chỗ (và chưa nhận thư của
 * đợt 2) mới nhận tiếp — mentor đã đủ không bị làm phiền.
 */
import type { Round2Row } from "@/lib/matching-round2-core";
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
