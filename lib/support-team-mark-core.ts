/**
 * lib/support-team-mark-core.ts — tích "Support team" trên hồ sơ (BTC 13/10/2026). Phần thuần, không I/O.
 *
 * Support team của mỗi mùa được đặc cách làm mentee không cần phỏng vấn. Thay vì mỗi mùa phải chạy
 * lại SQL hay gửi thư xác nhận, Support team / Core team / BTC tích ô "Support team" ngay trên hồ sơ
 * từng bạn: bạn thành mentee của mùa hiện tại NGAY. Mọi luật nằm trong database
 * (vam121_set_support_team, migration 20261013160000); ở đây chỉ có câu chữ, cách đọc mã lỗi của
 * database, và trạng thái hiển thị của khung.
 */
import { exemptionBlockerLabel } from "@/lib/mentee-exemption-core";

export type SupportTeamActionState = { status: "idle" | "ok" | "error"; message: string | null };

export const SUPPORT_TEAM_IDLE: SupportTeamActionState = { status: "idle", message: null };

export const SUPPORT_TEAM_NOT_TICKED_MESSAGE = "Tích ô “Là Support team” trước khi bấm Lưu.";

const SAFE_FAILURE = "Chưa ghi nhận được. Tải lại trang rồi thử lại; nếu vẫn lỗi, báo quản trị viên.";

/**
 * Đọc lỗi database trả về thành một câu cho người dùng. Mã lỗi nằm trong thông điệp:
 *   ACCESS_DENIED · PERSON_NOT_FOUND · NEEDS_BTC:<mã điều cản>.
 * Điều không nhận ra thì nói chung chung — không để lộ chữ của database ra màn hình.
 */
export function supportTeamErrorMessage(raw: unknown): string {
  const text = String(raw ?? "");
  if (text.includes("ACCESS_DENIED")) return "Bạn không có quyền vận hành mùa này nên chưa tích được.";
  if (text.includes("PERSON_NOT_FOUND")) return "Không tìm thấy hồ sơ người này. Tải lại trang rồi thử lại.";
  const blocked = /NEEDS_BTC:([a-z_]+)/.exec(text);
  if (blocked) {
    return `Chưa tích được: ${exemptionBlockerLabel(blocked[1])}. Cần ban tổ chức kiểm tra hồ sơ rồi tích lại. Chưa có gì bị thay đổi.`;
  }
  return SAFE_FAILURE;
}

/** Câu báo kết quả; null = database trả mã lạ (không báo thành công khi không chắc). */
export function supportTeamResultMessage(code: unknown, seasonCode: string): string | null {
  if (code === "marked") {
    return `Đã ghi nhận Support team mùa ${seasonCode}: bạn đã thành mentee của mùa này (đơn đã duyệt, có hồ sơ mentee, tư cách đang hoạt động).`;
  }
  if (code === "already") return `Bạn này đã là Support team mùa ${seasonCode} từ trước — không có gì thay đổi.`;
  return null;
}

export type SupportTeamExemptionRow = {
  confirmedAt: string | null;
  revokedAt: string | null;
  sendCount: number;
} | null;

/**
 * unmarked — chưa là Support team của mùa (kể cả người từng bị gỡ khỏi danh sách).
 * listed   — đã nằm trong danh sách thư mời đặc cách nhưng chưa xác nhận: tích ở đây là xác nhận luôn.
 * marked   — đã là Support team và đã là mentee của mùa.
 * Đã xác nhận thắng mọi thứ, kể cả một dấu gỡ còn sót (cùng thứ tự ưu tiên với exemptionState).
 */
export type SupportTeamPanelState = "unmarked" | "listed" | "marked";

export function supportTeamPanelState(row: SupportTeamExemptionRow): SupportTeamPanelState {
  if (!row) return "unmarked";
  if (row.confirmedAt) return "marked";
  if (row.revokedAt) return "unmarked";
  return "listed";
}
