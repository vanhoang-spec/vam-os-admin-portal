/**
 * lib/event-datetime.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc và ghi giá trị của ô `<input type="datetime-local">`.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN MỘT MODULE RIÊNG CHO ĐÚNG HAI HÀM
 * ---------------------------------------------------------------------------
 * Một ô `datetime-local` cho ra chuỗi `2026-09-20T08:00` — KHÔNG mang múi giờ.
 * `new Date()` hiểu chuỗi đó theo giờ của MÁY ĐANG CHẠY. Trên máy người dùng ở
 * Việt Nam thì đúng; trên máy chủ Vercel chạy UTC thì 8 giờ sáng người ta gõ
 * biến thành 8 giờ sáng UTC, tức 15 giờ chiều giờ Việt Nam.
 *
 * Và vì màn hình sửa lại đổi ngược từ mốc đã lưu về giờ máy, mỗi lần lưu lại
 * dịch thêm bảy tiếng nữa. Người dùng sửa giờ, lưu, mở lại thấy giờ khác, sửa
 * tiếp — nó không bao giờ hội tụ, và trông y hệt như "nút lưu không có tác
 * dụng".
 *
 * Hai hàm dưới đây là hai đầu của cùng một phép đổi, nên chúng phải nằm cạnh
 * nhau và phải là bản duy nhất. Module thuần, dùng được ở cả máy chủ lẫn trình
 * duyệt.
 */

/** Việt Nam ở múi +07:00 cố định, không có giờ mùa hè. */
const VN_OFFSET = "+07:00";
const VN_OFFSET_MINUTES = 7 * 60;

/** Chuỗi đã mang sẵn `Z` hoặc `±hh:mm` thì không được gán thêm múi giờ. */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Giá trị từ ô `datetime-local` → mốc thời gian ISO.
 *
 * Chuỗi không mang múi giờ được hiểu là GIỜ VIỆT NAM, không phải giờ máy chủ.
 * Chuỗi đã mang múi giờ thì giữ nguyên — các mốc do hệ thống sinh ra (ví dụ
 * các buổi của một chuỗi lặp) luôn ở dạng đó.
 *
 * Trả về null cho giá trị rỗng hoặc không đọc được, thay vì ném: một ô đang
 * được gõ dở luôn có lúc không hợp lệ.
 */
export function parseVietnamDateTime(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalized = HAS_ZONE.test(raw) ? raw : `${raw}${VN_OFFSET}`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Mốc thời gian ISO → giá trị cho ô `datetime-local`, theo giờ Việt Nam.
 *
 * Cố ý KHÔNG dùng `getTimezoneOffset()` của máy: một quản trị viên đang ở nước
 * ngoài mở form sửa sẽ thấy giờ của nơi họ đứng, sửa một chỗ khác, và lưu đè
 * lên giờ thật của sự kiện. Sự kiện diễn ra ở Việt Nam thì form phải nói giờ
 * Việt Nam, bất kể ai đang mở nó.
 */
export function toVietnamInputValue(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  // Dịch mốc sang giờ Việt Nam rồi đọc các thành phần bằng `getUTC*`: đó là
  // cách lấy đúng "đồng hồ treo tường ở Việt Nam" mà không phụ thuộc máy chạy.
  const shifted = new Date(date.getTime() + VN_OFFSET_MINUTES * 60_000);
  const pad = (value_: number, size = 2) => String(value_).padStart(size, "0");

  return [
    pad(shifted.getUTCFullYear(), 4),
    "-",
    pad(shifted.getUTCMonth() + 1),
    "-",
    pad(shifted.getUTCDate()),
    "T",
    pad(shifted.getUTCHours()),
    ":",
    pad(shifted.getUTCMinutes())
  ].join("");
}
