/**
 * lib/review-due.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Hạn hoàn tất của một phân công chấm hồ sơ hoặc phỏng vấn.
 *
 * ---------------------------------------------------------------------------
 * HẠN LÀ MỘT NGÀY, VÀ NÓ HẾT VÀO CUỐI NGÀY THEO GIỜ VIỆT NAM
 * ---------------------------------------------------------------------------
 * "Chấm xong trước 20/09" nghĩa là hết ngày 20/09 ở Việt Nam. Nên hạn được lưu
 * thành mốc 23:59:59 +07:00 của ngày đó.
 *
 * Ô nhập cũ gửi thẳng chuỗi `2026-09-20` xuống database. Postgres đọc chuỗi đó
 * theo múi giờ của phiên — trên Supabase là UTC — tức 07:00 sáng giờ Việt Nam.
 * Màn hình vẫn in đúng "20/09/2026", còn phép kiểm quá hạn so với giờ thật, nên
 * người chấm bị gắn cờ trễ từ 7 giờ sáng của chính ngày hạn. Không có lỗi nào
 * hiện ra; chỉ có cờ đỏ sớm mười bảy tiếng.
 *
 * Module thuần: màn hình và máy chủ gọi CÙNG một hàm, nên điều màn hình cho
 * qua cũng là điều máy chủ nhận.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Xa hơn chừng này là gõ nhầm năm, không phải một vòng chấm có thật. */
const MAX_DAYS_AHEAD = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const UNREADABLE =
  "Không đọc được hạn hoàn tất. Gõ theo dạng ngày/tháng/năm, ví dụ 20/09/2026.";

export type ReviewDueParse =
  | { ok: true; dueAt: string | null }
  | { ok: false; message: string };

/**
 * Giá trị ô hạn gửi lên (`YYYY-MM-DD`, hoặc rỗng) → mốc lưu vào `due_at`.
 *
 * - Rỗng: không đặt hạn. Hợp lệ — hạn là tuỳ chọn.
 * - Không đọc được: TỪ CHỐI, không coi như bỏ trống. Người vận hành đã gõ một
 *   hạn; giao việc đi mà rơi mất hạn là thứ họ chỉ phát hiện khi hỏi người
 *   chấm vì sao trễ.
 * - Đã qua, hoặc xa quá một năm: TỪ CHỐI. Gần như chắc chắn là gõ nhầm năm, và
 *   để lọt thì cả lô hồ sơ hiện cờ quá hạn ngay lúc vừa giao.
 *
 * Chỉ nhận đúng dạng ngày. Một mốc có giờ bị từ chối chứ không bị cắt bớt: ai
 * đổi ô nhập sang ngày-giờ sẽ phải sửa cả chỗ này, thay vì giờ họ chọn lặng lẽ
 * bị thay bằng 23:59.
 */
export function parseReviewDueDate(raw: unknown, now: Date = new Date()): ReviewDueParse {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, dueAt: null };

  const match = DATE_ONLY.exec(value);
  if (!match) return { ok: false, message: UNREADABLE };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return { ok: false, message: UNREADABLE };
  // `31/02` lọt qua phép kiểm "ngày từ 1 đến 31", và `new Date` sẽ lặng lẽ đổi
  // nó thành mùng 3 tháng 3.
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    return { ok: false, message: UNREADABLE };
  }

  const dueAt = new Date(`${value}T23:59:59+07:00`);
  if (Number.isNaN(dueAt.getTime())) return { ok: false, message: UNREADABLE };

  if (dueAt.getTime() < now.getTime()) {
    return { ok: false, message: "Hạn hoàn tất đã qua. Chọn một ngày từ hôm nay trở đi." };
  }
  if (dueAt.getTime() - now.getTime() > MAX_DAYS_AHEAD * DAY_MS) {
    return { ok: false, message: "Hạn hoàn tất xa hơn một năm. Kiểm lại năm." };
  }

  return { ok: true, dueAt: dueAt.toISOString() };
}

/**
 * Lời nhắc dưới ô hạn trên màn hình — hoặc null nếu gửi đi được.
 *
 * Ô nhập ngày gửi chuỗi rỗng cả khi người ta chưa gõ gì LẪN khi gõ dở
 * `20/09/20`. Máy chủ không phân biệt được hai trường hợp đó, nên màn hình phải
 * chặn trường hợp thứ hai: nếu không, lô hồ sơ được giao đi mà không có hạn,
 * trong khi người vận hành vẫn nhìn thấy một ngày trên màn hình.
 */
export function reviewDueInputProblem(
  text: string,
  dueDate: string,
  now: Date = new Date()
): string | null {
  if (!String(text ?? "").trim()) return null;
  if (!dueDate) return "Gõ đủ ngày/tháng/năm, hoặc xoá trống nếu không đặt hạn.";
  const parsed = parseReviewDueDate(dueDate, now);
  return parsed.ok ? null : parsed.message;
}
