import { WEEKDAY_LABELS, weekdayOf } from "@/lib/event-recurrence";
import { formatDate, formatTime } from "@/lib/utils";

/**
 * lib/interview-schedule-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của bộ lịch phỏng vấn mentor 1:1 — lưới giờ, luật đối tượng,
 * nhịp gửi thư mời/nhắc, và các phép đếm. Không I/O, để kiểm được mà không
 * phải dựng bản giả của database.
 *
 * MÚI GIỜ: mọi mốc ở đây là instant UTC dựng từ chuỗi có `+07:00` tường minh.
 * Vitest chạy TZ=UTC đúng như Vercel, nên 07:00 giờ Việt Nam là 00:00Z —
 * tuyệt đối không dùng new Date(year, month, ...) theo giờ máy.
 */

/** Mùa mà bộ lịch phục vụ. Đổi mùa là đổi hằng này (và đợt bên dưới). */
export const INTERVIEW_SEASON_CODE = "UEHM-S12";

/**
 * Đợt phỏng vấn: 22/09–05/10/2026 theo lời chủ dự án 22/09/2026. Biên ngày
 * nằm ở đây chứ không nằm trong CHECK của database, để mùa sau nới đợt chỉ
 * cần sửa TypeScript; database chỉ giữ luật bất biến (tròn giờ, 07..21).
 */
export const INTERVIEW_WINDOW = {
  firstDateKey: "2026-09-22",
  lastDateKey: "2026-10-05"
} as const;

/** Slot bắt đầu 07:00..21:00, mỗi slot tròn 60 phút → kết thúc muộn nhất 22:00. */
export const SLOT_FIRST_HOUR = 7;
export const SLOT_LAST_HOUR = 21;

export const VN_OFFSET = "+07:00";
export const HOTLINE_ZALO = "0919144638";
export const BTC_EMAIL = "hello@alumni-mentoring.edu.vn";

/** Đường công khai của trang đặt lịch — middleware và email cùng đọc một chỗ. */
export const INTERVIEW_BOOKING_PATH_PREFIX = "/dat-lich";

/**
 * Nhịp gửi thư cho mentor chưa đặt lịch: 1 thư mời + tối đa 3 thư nhắc, mỗi
 * 3 ngày; thư nhắc thứ 3 (lượt gửi thứ 4) CC ban tổ chức — đúng lời chốt
 * 22/09/2026. KHÔNG gửi lại mỗi lần interviewer thêm giờ: nhịp 3 ngày đã là
 * câu trả lời cho "có giờ mới rồi đấy", còn hộp thư của mentor thì hữu hạn.
 */
export const REMINDER_INTERVAL_MS = 3 * 24 * 60 * 60_000;
export const MAX_SENDS = 4;
export const CC_BTC_ON_SEND_NUMBER = 4;

/** Mentor chỉ tự huỷ được khi còn NHIỀU HƠN 24 giờ trước buổi hẹn. */
export const MENTOR_CANCEL_CUTOFF_MS = 24 * 60 * 60_000;

/**
 * Bộ gửi thư chia lô như thư khảo sát: 10 thư một lượt, ngân sách 45 giây cho
 * lượt bấm tay/cron và 8 giây khi chạy ké sau lần interviewer lưu giờ (người
 * lưu giờ không phải đứng chờ cả trăm lá thư). Claim bỏ quên quá 10 phút coi
 * như mồ côi, thu hồi được.
 */
export const INVITE_CHUNK = 10;
export const INVITE_TIME_BUDGET_MS = 45_000;
export const INVITE_INLINE_BUDGET_MS = 8_000;
export const INVITE_STALE_CLAIM_MS = 10 * 60_000;

/**
 * Đơn còn đứng ở đâu thì link đặt lịch còn hiệu lực — chủ dự án chốt
 * 22/09/2026: mọi đơn mentor qua form còn mở, kể cả đang giữa vòng hồ sơ.
 * `interview_scheduled` có mặt để người vừa được huỷ lịch đặt lại được.
 * `needs_more_review` KHÔNG có mặt: ca đó cần người thật xử lý trước.
 * Danh sách này phải khớp từng chữ với hàm vam098_book_interview_slot —
 * bài test tĩnh của migration canh điều đó.
 */
export const BOOKING_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned",
  "screening_in_progress",
  "screening_completed",
  "screening_passed",
  "invited_to_interview",
  "interview_scheduled"
]);

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Instant UTC của một ô lưới: "2026-09-22" + 7 → "2026-09-22T00:00:00.000Z". */
export function slotInstant(dateKey: string, hour: number): string {
  return new Date(`${dateKey}T${pad2(hour)}:00:00${VN_OFFSET}`).toISOString();
}

/** Ngày-giờ Việt Nam của một instant, đọc bằng phép dịch +7h rồi lấy getUTC*. */
function vnParts(iso: string): { dateKey: string; hour: number; minute: number } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const shifted = new Date(at.getTime() + 7 * 60 * 60_000);
  return {
    dateKey: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

/** 14 ngày của đợt, theo thứ tự. */
export function windowDateKeys(): string[] {
  const keys: string[] = [];
  const first = new Date(`${INTERVIEW_WINDOW.firstDateKey}T00:00:00Z`);
  const last = new Date(`${INTERVIEW_WINDOW.lastDateKey}T00:00:00Z`);
  for (let at = first.getTime(); at <= last.getTime(); at += 24 * 60 * 60_000) {
    const day = new Date(at);
    keys.push(`${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`);
  }
  return keys;
}

export type GridSlot = { startsAtIso: string; hour: number; isPast: boolean };
export type GridDay = { dateKey: string; label: string; slots: GridSlot[] };

/** Nhãn ngày cho lưới: "Thứ Ba 22/09/2026". */
export function dayLabel(dateKey: string): string {
  const iso = slotInstant(dateKey, SLOT_FIRST_HOUR);
  const weekday = weekdayOf(iso);
  const date = formatDate(iso);
  return weekday === null ? date : `${WEEKDAY_LABELS[weekday]} ${date}`;
}

/**
 * Lưới đầy đủ 14 ngày × 15 giờ. `isPast` tính tại `nowIso`: slot ĐÃ BẮT ĐẦU
 * là quá khứ — không ai đặt được buổi phỏng vấn đang diễn ra.
 */
export function buildSlotGrid(nowIso: string): GridDay[] {
  const nowMs = new Date(nowIso).getTime();
  return windowDateKeys().map((dateKey) => ({
    dateKey,
    label: dayLabel(dateKey),
    slots: Array.from({ length: SLOT_LAST_HOUR - SLOT_FIRST_HOUR + 1 }, (_, index) => {
      const hour = SLOT_FIRST_HOUR + index;
      const startsAtIso = slotInstant(dateKey, hour);
      return { startsAtIso, hour, isPast: new Date(startsAtIso).getTime() <= nowMs };
    })
  }));
}

export type SlotInstantProblem = "invalid" | "outside_window" | "bad_hour" | "in_past";

/** Một instant có phải là ô lưới hợp lệ còn ở tương lai không. */
export function isValidSlotInstant(
  iso: string,
  nowIso: string
): { ok: true; startsAtIso: string } | { ok: false; code: SlotInstantProblem } {
  const parts = vnParts(iso);
  if (!parts) return { ok: false, code: "invalid" };
  if (parts.minute !== 0) return { ok: false, code: "bad_hour" };
  if (parts.hour < SLOT_FIRST_HOUR || parts.hour > SLOT_LAST_HOUR) {
    return { ok: false, code: "bad_hour" };
  }
  if (
    parts.dateKey < INTERVIEW_WINDOW.firstDateKey ||
    parts.dateKey > INTERVIEW_WINDOW.lastDateKey
  ) {
    return { ok: false, code: "outside_window" };
  }
  const startsAtIso = slotInstant(parts.dateKey, parts.hour);
  if (new Date(startsAtIso).getTime() <= new Date(nowIso).getTime()) {
    return { ok: false, code: "in_past" };
  }
  return { ok: true, startsAtIso };
}

/**
 * Đơn này còn đặt lịch được không. `activeInterviewReviewIds` là các phiếu
 * phỏng vấn không-huỷ của đơn; `ownActiveBookingReviewId` là phiếu do chính
 * lịch đang hiệu lực của đơn tạo ra — phiếu đó không tính là "đã có người
 * phụ trách" (nó chính là buổi hẹn đang xem).
 */
export function isBookingEligibleApplication(
  app: { status: unknown; role_applied: unknown; source: unknown },
  activeInterviewReviewIds: readonly string[],
  ownActiveBookingReviewId: string | null
): boolean {
  if (String(app.role_applied ?? "").toLowerCase() !== "mentor") return false;
  if (String(app.source ?? "") !== "vam_os_form") return false;
  if (!BOOKING_ELIGIBLE_STATUSES.has(String(app.status ?? ""))) return false;
  const foreign = activeInterviewReviewIds.filter((id) => id !== ownActiveBookingReviewId);
  return foreign.length === 0;
}

export type MentorBucket = "not_booked" | "booked_upcoming" | "booked_past";

/**
 * Xếp mentor vào nhóm theo LỊCH, không theo applications.status: sau khi đặt,
 * máy trạng thái vòng phỏng vấn có thể đổi status sang interview_in_progress
 * bất cứ lúc nào — chỉ dòng giữ chỗ và giờ hẹn của nó là nói thật.
 */
export function classifyMentor(
  activeBooking: { slot_starts_at: string } | null,
  nowIso: string
): MentorBucket {
  if (!activeBooking) return "not_booked";
  const endsMs = new Date(activeBooking.slot_starts_at).getTime() + 60 * 60_000;
  return endsMs <= new Date(nowIso).getTime() ? "booked_past" : "booked_upcoming";
}

export type InviteDue = {
  due: boolean;
  /** Lượt gửi kế tiếp, đếm từ 1 (1 = thư mời, 2..4 = thư nhắc 1..3). */
  sendNumber: number;
  isReminder: boolean;
  ccBtc: boolean;
};

/** Đến lượt gửi thư cho mentor này chưa, và lượt đó là thư gì. */
export function inviteSendDue(
  invite: { send_count: number; last_sent_at: string | null },
  nowMs: number
): InviteDue {
  const sendNumber = invite.send_count + 1;
  const base = { sendNumber, isReminder: sendNumber > 1, ccBtc: sendNumber === CC_BTC_ON_SEND_NUMBER };
  if (invite.send_count >= MAX_SENDS) return { ...base, due: false };
  if (invite.send_count === 0) return { ...base, due: true };
  const lastMs = invite.last_sent_at ? new Date(invite.last_sent_at).getTime() : null;
  if (lastMs === null || Number.isNaN(lastMs)) return { ...base, due: true };
  return { ...base, due: nowMs - lastMs >= REMINDER_INTERVAL_MS };
}

export type InterviewerStats = {
  /** Giờ đã đăng ký trong đợt (không tính giờ đã gỡ). */
  total: number;
  /** Buổi đã phỏng vấn xong theo lịch: được đặt và giờ kết thúc đã qua. */
  done: number;
  /** Buổi đã có người đặt, chưa tới. */
  bookedUpcoming: number;
  /** Giờ còn trống ở tương lai. */
  open: number;
  /** Giờ trống đã trôi qua mà không ai đặt. */
  expired: number;
};

/** Các con số hiện cho interviewer ngay sau khi lưu — theo lời spec. */
export function computeInterviewerStats(
  slots: ReadonlyArray<{ slot_starts_at: string; status: string }>,
  nowIso: string
): InterviewerStats {
  const nowMs = new Date(nowIso).getTime();
  const stats: InterviewerStats = { total: 0, done: 0, bookedUpcoming: 0, open: 0, expired: 0 };
  for (const slot of slots) {
    if (slot.status === "removed") continue;
    stats.total += 1;
    const startMs = new Date(slot.slot_starts_at).getTime();
    const endMs = startMs + 60 * 60_000;
    if (slot.status === "booked") {
      if (endMs <= nowMs) stats.done += 1;
      else stats.bookedUpcoming += 1;
    } else if (startMs <= nowMs) {
      stats.expired += 1;
    } else {
      stats.open += 1;
    }
  }
  return stats;
}

/**
 * Số chỗ trống theo khung giờ — "15:00 còn 2 chỗ" nghĩa là 2 interviewer cùng
 * rảnh 15:00. Khoá là instant ISO của giờ bắt đầu.
 */
export function countOpenSlotsByHour(
  openSlots: ReadonlyArray<{ slot_starts_at: string }>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of openSlots) {
    const key = new Date(slot.slot_starts_at).toISOString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Mentor còn tự huỷ được không — phải còn NHIỀU HƠN 24 giờ trước buổi hẹn. */
export function canMentorCancel(slotStartsAtIso: string, nowIso: string): boolean {
  const startMs = new Date(slotStartsAtIso).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(nowMs)) return false;
  return startMs - nowMs > MENTOR_CANCEL_CUTOFF_MS;
}

/** "Thứ Ba 22/09/2026, 15:00–16:00 (giờ Việt Nam)" — dùng cho thư và màn hình. */
export function slotRangeLabel(startsAtIso: string): string {
  const endsAtIso = new Date(new Date(startsAtIso).getTime() + 60 * 60_000).toISOString();
  const weekday = weekdayOf(startsAtIso);
  const prefix = weekday === null ? "" : `${WEEKDAY_LABELS[weekday]} `;
  return `${prefix}${formatDate(startsAtIso)}, ${formatTime(startsAtIso)}–${formatTime(endsAtIso)} (giờ Việt Nam)`;
}

/** Link đặt lịch riêng của một mentor. */
export function bookingUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}${INTERVIEW_BOOKING_PATH_PREFIX}/${token}`;
}

/** Một khung giờ còn chỗ trên trang đặt lịch công khai. */
export type BookingPageHour = { startsAtIso: string; hour: number; openCount: number };
/** Một ngày trên trang đặt lịch công khai — chỉ mang các giờ còn chỗ. */
export type BookingPageDayGroup = { dateKey: string; label: string; hours: BookingPageHour[] };

/**
 * Kết quả một lượt của bộ gửi thư mời/nhắc. Nằm ở phần thuần để panel phía
 * client đọc được kiểu mà không chạm vào module server-only.
 */
export type DispatchResult = {
  ok: boolean;
  message: string;
  sent: number;
  failed: number;
  remaining: number;
  /** Brevo báo hết hạn mức ngày — dừng, mai gửi tiếp. */
  stopped429: boolean;
};

/** Vòng lặp "gửi tới khi xong" của panel còn nên gọi tiếp không. */
export function shouldContinueDispatch(result: DispatchResult): boolean {
  return result.ok && !result.stopped429 && result.remaining > 0;
}

/**
 * Trần số lượt gọi cho một phiên gửi — cùng lý do với surveyMaxRounds: một
 * lỗi lặp vô hạn không được phép quay mãi chỉ vì `remaining` không giảm.
 */
export function dispatchMaxRounds(firstResult: DispatchResult): number {
  return Math.ceil((firstResult.sent + firstResult.remaining) / INVITE_CHUNK) + 5;
}
