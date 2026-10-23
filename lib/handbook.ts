/**
 * Handbook mentee / mentor — file PDF cố định trong kho mã, phát ở đường công khai /tai-lieu/… của
 * VAM OS (BTC 22/10/2026: "Handbook dùng lâu dài, lưu trên VAM OS, lấy link cũng từ VAM OS cho đồng
 * bộ"). Thư kết quả ghép cặp lấy link từ đây, không còn ô nhập link Handbook.
 *
 * `ready` chỉ bật khi file đã nằm trong kho — test khoá ready ⇔ file có thật, để không bao giờ gửi
 * một link tới file chưa có. Chưa ready thì đường dẫn trả 404 "đang cập nhật" và nút gửi thư bị khoá.
 * Thay bản mới = thay file cùng tên (link trong thư đã gửi vẫn đúng).
 */
export type HandbookRole = "mentor" | "mentee";

export type Handbook = {
  /** Đường công khai trên VAM OS. */
  path: string;
  /** File trong kho mã (đọc lúc build). */
  source: string;
  /** Tên file khi người nhận tải về. */
  filename: string;
  ready: boolean;
};

export const HANDBOOK_PATH_PREFIX = "/tai-lieu";

export const HANDBOOKS: Record<HandbookRole, Handbook> = {
  mentee: {
    path: `${HANDBOOK_PATH_PREFIX}/handbook-mentee.pdf`,
    source: "docs/handbook/handbook-mentee.pdf",
    filename: "UEH-Mentoring-Mua-12-Mentee-Handbook.pdf",
    ready: true
  },
  mentor: {
    path: `${HANDBOOK_PATH_PREFIX}/handbook-mentor.pdf`,
    source: "docs/handbook/handbook-mentor.pdf",
    filename: "UEH-Mentoring-Mua-12-Mentor-Handbook.pdf",
    ready: true
  }
};

/** Link Handbook trên VAM OS; null khi file chưa có. */
export function handbookUrl(base: string, role: HandbookRole): string | null {
  const h = HANDBOOKS[role];
  return h.ready ? `${base.replace(/\/+$/, "")}${h.path}` : null;
}

export const HANDBOOK_PENDING_MESSAGE = "Handbook đang được Ban Tổ chức cập nhật. Vui lòng quay lại sau.";
