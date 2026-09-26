import { WEEKDAY_LABELS, weekdayOf } from "@/lib/event-recurrence";
import { formatDate, formatTime } from "@/lib/utils";

/**
 * lib/mentee-interview-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của vòng phỏng vấn mentee: 24 ca offline 30 phút ngày 3 và
 * 4/10/2026, 25 ghế mỗi ca (5 phòng × 5 mentor phỏng vấn song song).
 *
 * Khác hẳn vòng mentor. Ở đó ứng viên chọn GIỜ của một người cụ thể; ở đây ứng
 * viên chọn một CA, và ban tổ chức phân mentor tại chỗ trong ngày. Nên không có
 * lưới 14 ngày, không có FIFO, không có ai-khai-trước — chỉ có các ca và số ghế
 * còn lại của từng cái. Không có chỗ nào trong file đếm cố định số ca: lưới
 * đọc từ database, nên giai đoạn 2 (10–11/10) chỉ là thêm dòng.
 *
 * MÚI GIỜ: mọi mốc là instant UTC; nhãn hiển thị đi qua formatDate/formatTime
 * của lib/utils, vốn đã ấn định giờ Việt Nam. Vitest chạy TZ=UTC đúng như Vercel.
 */

/** Mùa mà vòng này phục vụ. */
export const MENTEE_INTERVIEW_SEASON_CODE = "UEHM-S12";

/** Đường công khai của trang đặt ca — middleware và thư cùng đọc một chỗ. */
export const MENTEE_BOOKING_PATH_PREFIX = "/dat-ca";

export const HOTLINE_ZALO = "0919144638";
export const SUPPORT_PHONE = "0777885674";
export const SUPPORT_NAME = "Bảo Châu";

/**
 * Câu thay cho địa điểm khi ban tổ chức chưa điền.
 *
 * Thư xác nhận có thể đi TRƯỚC khi địa điểm được chốt — người đặt đầu tiên không
 * chờ ai cả. Một dòng "Địa điểm:" bỏ trống là thứ khiến người nhận gọi điện; một
 * câu hẹn báo sau thì không.
 */
export const MENTEE_VENUE_PENDING_LABEL = "Ban tổ chức sẽ báo địa điểm cụ thể trước ngày phỏng vấn";

/** Đường dẫn riêng tới trang đặt ca — thư mời và thư xác nhận cùng dựng từ đây. */
export function menteeBookingUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}${MENTEE_BOOKING_PATH_PREFIX}/${token}`;
}

/**
 * Trạng thái một ca, theo thứ tự ưu tiên khi hiển thị.
 *
 * `not_configured` tồn tại vì `seat_limit` để NULL có chủ ý: ban tổ chức chưa
 * chốt số ghế. NULL là ĐÓNG chứ không phải vô hạn — xem đầu file migration
 * 20260924190000. Người dùng thấy "chưa mở", không thấy một ca trống rỗng mời
 * họ bấm vào rồi bị từ chối.
 */
export type SessionState = "open" | "full" | "not_configured" | "closed" | "past" | "deadline_passed";

export type SessionRow = {
  id: string;
  startsAtIso: string;
  endsAtIso: string;
  seatLimit: number | null;
  venue: string | null;
  bookingClosesAtIso: string;
  status: string;
};

export type MenteeSessionView = {
  id: string;
  startsAtIso: string;
  timeLabel: string;
  seatLimit: number | null;
  taken: number;
  remaining: number | null;
  state: SessionState;
  /** Câu ngắn hiện cạnh ca khi nó không bấm được. */
  note: string | null;
};

export type MenteeSessionDay = {
  dateKey: string;
  label: string;
  sessions: MenteeSessionView[];
};

/** "Thứ Bảy 03/10/2026" — nhãn ngày cho một nhóm ca. */
export function sessionDayLabel(startsAtIso: string): string {
  const weekday = weekdayOf(startsAtIso);
  const date = formatDate(startsAtIso);
  return weekday === null ? date : `${WEEKDAY_LABELS[weekday]} ${date}`;
}

/** "08:00 – 09:00". */
export function sessionTimeLabel(startsAtIso: string, endsAtIso: string): string {
  return `${formatTime(startsAtIso)} – ${formatTime(endsAtIso)}`;
}

/** "Thứ Bảy 03/10/2026, 08:00 – 09:00 (giờ Việt Nam)" — dùng cho thư. */
export function sessionFullLabel(startsAtIso: string, endsAtIso: string): string {
  return `${sessionDayLabel(startsAtIso)}, ${sessionTimeLabel(startsAtIso, endsAtIso)} (giờ Việt Nam)`;
}

/** Ngày của một instant theo giờ Việt Nam, để gom ca thành nhóm. */
export function vietnamDateKeyOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const shifted = new Date(at.getTime() + 7 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Ca này đang ở trạng thái nào.
 *
 * Thứ tự kiểm là thứ tự sự thật, không phải thứ tự tiện tay: một ca đã qua giờ
 * thì nói "đã qua" chứ không nói "hết chỗ", và hạn đăng ký chung đóng trước mọi
 * lý do riêng của từng ca. Đổi thứ tự là đổi câu người dùng đọc được.
 */
export function sessionState(row: SessionRow, taken: number, nowIso: string): SessionState {
  const now = new Date(nowIso).getTime();
  if (new Date(row.startsAtIso).getTime() <= now) return "past";
  if (now > new Date(row.bookingClosesAtIso).getTime()) return "deadline_passed";
  if (row.status !== "open") return "closed";
  if (row.seatLimit === null) return "not_configured";
  if (taken >= row.seatLimit) return "full";
  return "open";
}

const STATE_NOTE: Record<SessionState, string | null> = {
  open: null,
  full: "Đã kín chỗ",
  not_configured: "Chưa mở",
  closed: "Đã đóng",
  past: "Đã qua",
  deadline_passed: "Hết hạn đăng ký"
};

/**
 * Dựng danh sách ca, gom theo ngày.
 *
 * Số ghế còn lại chỉ hiện khi ban tổ chức đã chốt: `remaining` là null khi chưa
 * cấu hình. Hiện "còn 0 chỗ" cho một ca chưa cấu hình sẽ là nói dối theo hướng
 * ngược lại — người đọc tưởng ca đó đã kín.
 */
export function buildSessionDays(
  rows: readonly SessionRow[],
  takenBySession: ReadonlyMap<string, number>,
  nowIso: string
): MenteeSessionDay[] {
  const byDay = new Map<string, MenteeSessionView[]>();

  for (const row of [...rows].sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso))) {
    const taken = takenBySession.get(row.id) ?? 0;
    const state = sessionState(row, taken, nowIso);
    const view: MenteeSessionView = {
      id: row.id,
      startsAtIso: row.startsAtIso,
      timeLabel: sessionTimeLabel(row.startsAtIso, row.endsAtIso),
      seatLimit: row.seatLimit,
      taken,
      remaining: row.seatLimit === null ? null : Math.max(0, row.seatLimit - taken),
      state,
      note: STATE_NOTE[state]
    };
    const key = vietnamDateKeyOf(row.startsAtIso);
    byDay.set(key, [...(byDay.get(key) ?? []), view]);
  }

  return Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, sessions]) => ({
      dateKey,
      label: sessionDayLabel(sessions[0].startsAtIso),
      sessions
    }));
}

/** Còn ca nào bấm được không — quyết định trang hiện lưới hay hiện lời giải thích. */
export function hasBookableSession(days: readonly MenteeSessionDay[]): boolean {
  return days.some((day) => day.sessions.some((s) => s.state === "open"));
}

/**
 * Hạn đăng ký chung, đọc từ chính các ca chứ không từ một hằng trong mã.
 *
 * Hạn nằm ở cột `booking_closes_at` để ban tổ chức gia hạn được bằng một câu
 * update, không phải sửa mã rồi deploy — xem đầu file migration. Nên tầng này
 * cũng phải đọc từ dữ liệu, nếu không hai nơi sẽ nói hai hạn khác nhau.
 */
export function bookingClosesAt(rows: readonly SessionRow[]): string | null {
  const stamps = rows.map((r) => r.bookingClosesAtIso).filter(Boolean).sort();
  return stamps.length > 0 ? stamps[stamps.length - 1] : null;
}

/**
 * "Thứ Bảy 03/10/2026 và Chủ nhật 04/10/2026" — các ngày phỏng vấn, cho thư mời.
 *
 * Đọc từ chính các ca CÒN ĐẶT ĐƯỢC chứ không từ một hằng: giai đoạn 2 thêm ca
 * 10–11/10 thì thư mời của giai đoạn 2 tự nói đúng ngày, còn ca 03–04/10 khi ấy
 * đã quá hạn nên tự rơi khỏi câu.
 */
export function interviewDaysLabel(days: readonly MenteeSessionDay[]): string {
  const labels = days
    .filter((day) => day.sessions.some((s) => s.state === "open"))
    .map((day) => day.label);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} và ${labels[labels.length - 1]}`;
}

/** Tổng số chỗ còn lại của cả đợt — chỉ tính ca đã cấu hình và đang mở. */
export function totalRemaining(days: readonly MenteeSessionDay[]): number {
  let total = 0;
  for (const day of days) {
    for (const s of day.sessions) {
      if (s.state === "open" && s.remaining !== null) total += s.remaining;
    }
  }
  return total;
}
