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

/* ────────────────────────────────────────────────────────────────────────────
 * Ô nhập ngày giờ tự dựng, luôn dd/mm/yyyy
 *
 * `<input type="datetime-local">` hiển thị theo NGÔN NGỮ CỦA TRÌNH DUYỆT —
 * Chrome tiếng Anh vẽ ra `mm/dd/yyyy`, và không có thuộc tính HTML hay CSS nào
 * bắt nó đổi. Muốn định dạng ngày là một thứ của CRM chứ không phải một thứ
 * tuỳ máy người dùng thì phải tự dựng ô nhập.
 *
 * Đổi lại: mất bộ chọn lịch bật lên của trình duyệt. Với người nhập vài sự
 * kiện một mùa, gõ mười chữ số nhanh hơn mở lịch rồi bấm, và quan trọng hơn là
 * `20/09` không bao giờ bị đọc thành ngày 9 tháng 20.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Chèn dấu `/` trong lúc gõ, và chỉ nhận chữ số.
 *
 * Không tự sửa giá trị vô lý ở đây — người đang gõ `3` để tiến tới `30` sẽ bị
 * một bộ sửa quá sốt sắng đổi thành `03` ngay dưới tay họ.
 */
export function maskVietnamDate(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Chèn dấu `:` trong lúc gõ giờ. */
export function maskVietnamTime(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/**
 * `20/09/2026` → `2026-09-20`, hoặc null.
 *
 * Kiểm ngày có THẬT SỰ tồn tại, không chỉ kiểm khoảng: `31/02/2026` lọt qua
 * mọi phép kiểm "ngày từ 1 đến 31" nhưng không phải một ngày nào cả, và
 * `new Date` sẽ lặng lẽ đổi nó thành mùng 3 tháng 3.
 */
export function parseVietnamDateInput(raw: unknown): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(raw ?? "").trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2999) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** `08:00` → `08:00`, hoặc null. */
export function parseVietnamTimeInput(raw: unknown): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(String(raw ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

/** `2026-09-20` → `20/09/2026`. Dùng để đổ giá trị đang có vào ô nhập. */
export function toVietnamDateInput(isoDate: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? "").trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/**
 * Hai ô nhập → giá trị mà máy chủ đọc được (`YYYY-MM-DDTHH:mm`).
 *
 * Thiếu một trong hai thì trả chuỗi rỗng: một nửa ngày giờ không phải một mốc
 * thời gian, và gửi lên một nửa là để máy chủ đoán nốt phần còn lại.
 */
export function combineVietnamDateTime(dateInput: unknown, timeInput: unknown): string {
  const date = parseVietnamDateInput(dateInput);
  const time = parseVietnamTimeInput(timeInput);
  return date && time ? `${date}T${time}` : "";
}

/** `2026-09-20T08:00` (hoặc ISO đầy đủ) → hai ô nhập. */
export function splitVietnamDateTime(value: unknown): { date: string; time: string } {
  const local = toVietnamInputValue(value) || String(value ?? "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(local);
  if (!match) return { date: "", time: "" };
  return { date: toVietnamDateInput(match[1]), time: match[2] };
}
