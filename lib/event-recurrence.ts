/**
 * lib/event-recurrence.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sự kiện lặp lại: sinh ra các buổi, không sinh ra một quy tắc.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO SINH RA SỰ KIỆN THẬT CHỨ KHÔNG PHẢI SỰ KIỆN ẢO
 * ---------------------------------------------------------------------------
 * Một buổi training hằng tuần có sức chứa riêng, danh sách đăng ký riêng, và
 * điểm danh riêng của buổi đó. Nếu chuỗi chỉ là một quy tắc và các buổi được
 * suy ra lúc hiển thị, thì mọi thứ gắn vào một buổi cụ thể — một chỗ ngồi, một
 * lần check-in — phải gắn vào một thứ không tồn tại trong database.
 *
 * Nên tạo chuỗi là tạo N dòng `events` thật, dùng chung một `series_id`. Đổi
 * giờ của một buổi là sửa đúng buổi đó, và không buổi nào khác bị ảnh hưởng.
 *
 * Đổi lại: sửa quy tắc sau khi đã tạo là không làm được. Đó là chủ ý — quy tắc
 * chỉ là cách sinh ra danh sách ngày, và giữ nó lại sẽ tạo ra ảo giác rằng sửa
 * nó thì các buổi tự đổi theo.
 *
 * Module thuần, không I/O.
 */

/** Giờ Việt Nam, cố định +07:00 và không có giờ mùa hè — xem `toParts`. */
const VN_OFFSET_MINUTES = 7 * 60;

export const RECURRENCE_FREQUENCIES = ["weekly", "monthly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** Lặp theo tháng: theo ngày trong tháng, hay theo thứ mấy của tuần thứ mấy. */
export const MONTHLY_MODES = ["day_of_month", "weekday_of_month"] as const;
export type MonthlyMode = (typeof MONTHLY_MODES)[number];

/** Chuỗi dừng khi tới ngày, hoặc sau đủ số buổi. */
export const END_MODES = ["on_date", "after_count"] as const;
export type EndMode = (typeof END_MODES)[number];

/**
 * Trần số buổi một chuỗi được sinh ra.
 *
 * Một năm hằng tuần là 52 buổi, dài hơn bất kỳ mùa nào của chương trình. Trần
 * này không phải để tiết kiệm dòng dữ liệu mà để một lỗi gõ — "kết thúc năm
 * 2036" — không tạo ra sáu trăm sự kiện mà ai đó phải xoá tay từng cái.
 */
export const MAX_OCCURRENCES = 52;

export const WEEKDAY_LABELS = [
  "Chủ nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy"
] as const;

export const RECURRENCE_FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: "Hằng tuần",
  monthly: "Hằng tháng"
};

export function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return typeof value === "string" && (RECURRENCE_FREQUENCIES as readonly string[]).includes(value);
}

export function isMonthlyMode(value: unknown): value is MonthlyMode {
  return typeof value === "string" && (MONTHLY_MODES as readonly string[]).includes(value);
}

export function isEndMode(value: unknown): value is EndMode {
  return typeof value === "string" && (END_MODES as readonly string[]).includes(value);
}

type Parts = {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
};

/**
 * Một thời điểm, đọc theo lịch Việt Nam.
 *
 * Cộng ngày và cộng tháng phải làm trên lịch mà người dùng nhìn thấy, không
 * phải trên UTC: "8 giờ sáng mỗi Thứ Ba" nghĩa là 8 giờ sáng giờ Việt Nam.
 * Việt Nam ở múi +07 cố định và không có giờ mùa hè, nên phép dịch này chính
 * xác — với một múi giờ có DST thì cách làm này sẽ sai và phải dùng Intl.
 */
function toParts(iso: string): Parts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + VN_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

function toIso(parts: Parts): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const local = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:00+07:00`;
  return new Date(local).toISOString();
}

/** Số ngày của một tháng, theo lịch. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Thứ trong tuần (0 = Chủ nhật) của một ngày theo lịch Việt Nam. */
export function weekdayOf(iso: string): number | null {
  const parts = toParts(iso);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** Ngày này là lần thứ mấy của thứ đó trong tháng (1–5). */
export function weekdayOrdinalOf(iso: string): number | null {
  const parts = toParts(iso);
  if (!parts) return null;
  return Math.floor((parts.day - 1) / 7) + 1;
}

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  /** Cách nhau mấy tuần / mấy tháng. 1 = mỗi tuần, 2 = tuần cách tuần. */
  interval: number;
  /** Chỉ dùng khi lặp theo tháng. */
  monthlyMode: MonthlyMode;
  endMode: EndMode;
  /** Ngày cuối cùng còn được sinh, dạng YYYY-MM-DD. Dùng khi endMode = on_date. */
  endsOn?: string | null;
  /** Tổng số buổi, kể cả buổi đầu. Dùng khi endMode = after_count. */
  count?: number | null;
};

export type Occurrence = { startsAt: string; endsAt: string | null };

export type OccurrenceResult =
  | { ok: true; occurrences: Occurrence[]; capped: boolean }
  | { ok: false; message: string };

/**
 * Sinh danh sách buổi từ buổi đầu tiên và quy tắc.
 *
 * Buổi đầu tiên LUÔN nằm trong kết quả, kể cả khi quy tắc vô lý ở phần còn
 * lại: người dùng đã gõ ngày giờ đó, và một chuỗi sinh ra rỗng thì trông như
 * hệ thống nuốt mất thao tác của họ.
 *
 * Độ dài buổi được giữ nguyên qua các lần lặp: chuỗi hằng tuần của một buổi
 * hai tiếng là các buổi hai tiếng.
 */
export function generateOccurrences(input: {
  startsAt: string;
  endsAt?: string | null;
  rule: RecurrenceRule;
}): OccurrenceResult {
  const first = toParts(input.startsAt);
  if (!first) return { ok: false, message: "Thời điểm bắt đầu không hợp lệ." };

  const rule = input.rule;
  // `Number.isInteger` chứ không phải `Math.trunc` rồi mới kiểm: cắt đuôi
  // trước khi kiểm nghĩa là 1.9 lặng lẽ thành 1, và người gửi lên con số đó
  // không bao giờ biết hệ thống đã làm khác điều họ yêu cầu.
  const interval = Number(rule.interval);
  if (!Number.isInteger(interval) || interval < 1) {
    return { ok: false, message: "Khoảng lặp phải là số nguyên từ 1 trở lên." };
  }
  if (interval > 12) {
    return { ok: false, message: "Khoảng lặp tối đa là 12." };
  }

  const durationMs =
    input.endsAt && !Number.isNaN(new Date(input.endsAt).getTime())
      ? new Date(input.endsAt).getTime() - new Date(input.startsAt).getTime()
      : null;
  if (durationMs !== null && durationMs <= 0) {
    return { ok: false, message: "Giờ kết thúc phải sau giờ bắt đầu." };
  }

  let limit: number;
  let untilMs = Number.POSITIVE_INFINITY;

  if (rule.endMode === "after_count") {
    const count = Number(rule.count);
    if (!Number.isInteger(count) || count < 1) {
      return { ok: false, message: "Số buổi phải là số nguyên từ 1 trở lên." };
    }
    limit = Math.min(count, MAX_OCCURRENCES);
  } else {
    const endsOn = String(rule.endsOn ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
      return { ok: false, message: "Ngày kết thúc chuỗi không hợp lệ." };
    }
    // Hết ngày đó, không phải nửa đêm đầu ngày: một buổi lúc 19:00 ngày cuối
    // vẫn thuộc về chuỗi.
    untilMs = new Date(`${endsOn}T23:59:59+07:00`).getTime();
    if (Number.isNaN(untilMs)) {
      return { ok: false, message: "Ngày kết thúc chuỗi không hợp lệ." };
    }
    if (untilMs < new Date(input.startsAt).getTime()) {
      return { ok: false, message: "Ngày kết thúc chuỗi phải sau buổi đầu tiên." };
    }
    limit = MAX_OCCURRENCES;
  }

  const targetWeekday = weekdayOf(input.startsAt) ?? 0;
  const targetOrdinal = weekdayOrdinalOf(input.startsAt) ?? 1;

  const occurrences: Occurrence[] = [];
  let capped = false;

  // `step` đếm số chu kỳ đã đi qua, KHÔNG phải số buổi đã sinh: lặp theo tháng
  // có thể bỏ qua một tháng (ngày 31 trong tháng chỉ có 30 ngày), và nếu dùng
  // số buổi để tính mốc tiếp theo thì cả chuỗi sau đó bị trượt đi một tháng.
  for (let step = 0; occurrences.length < limit; step += 1) {
    // Trần vòng lặp riêng: chế độ theo-ngày có thể bỏ qua nhiều tháng liên
    // tiếp, và không có mốc dừng thì đây thành vòng lặp vô hạn.
    if (step > MAX_OCCURRENCES * 4) break;

    const at = rule.frequency === "weekly"
      ? weeklyStep(first, interval * step)
      : monthlyStep(first, interval * step, rule.monthlyMode, targetWeekday, targetOrdinal);

    if (!at) continue;

    const iso = toIso(at);
    const ms = new Date(iso).getTime();
    if (ms > untilMs) break;

    occurrences.push({
      startsAt: iso,
      endsAt: durationMs === null ? null : new Date(ms + durationMs).toISOString()
    });
  }

  if (!occurrences.length) {
    return { ok: false, message: "Quy tắc này không sinh ra buổi nào." };
  }

  if (rule.endMode === "after_count") {
    const wanted = Number(rule.count);
    capped = wanted > MAX_OCCURRENCES;
  } else {
    capped = occurrences.length >= MAX_OCCURRENCES;
  }

  return { ok: true, occurrences, capped };
}

function weeklyStep(first: Parts, weeks: number): Parts | null {
  const base = Date.UTC(first.year, first.month - 1, first.day);
  const moved = new Date(base + weeks * 7 * 86_400_000);
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
    hour: first.hour,
    minute: first.minute
  };
}

function monthlyStep(
  first: Parts,
  months: number,
  mode: MonthlyMode,
  weekday: number,
  ordinal: number
): Parts | null {
  const zero = first.month - 1 + months;
  const year = first.year + Math.floor(zero / 12);
  const month = (((zero % 12) + 12) % 12) + 1;

  if (mode === "day_of_month") {
    // Tháng không có ngày đó thì BỎ QUA tháng đó, không lùi về ngày cuối tháng.
    // "Ngày 31 hằng tháng" không tồn tại trong tháng Hai, và tự ý dời sang 28
    // là đổi ngày của một buổi mà không ai yêu cầu.
    if (first.day > daysInMonth(year, month)) return null;
    return { year, month, day: first.day, hour: first.hour, minute: first.minute };
  }

  // Thứ N của tháng: tìm ngày đầu tiên rơi đúng thứ đó, rồi cộng thêm tuần.
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstMatching = 1 + ((weekday - firstWeekday + 7) % 7);
  const day = firstMatching + (ordinal - 1) * 7;
  // Tháng không có "Thứ Ba thứ 5" thì bỏ qua, cùng lý do như trên.
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day, hour: first.hour, minute: first.minute };
}

/**
 * Câu mô tả quy tắc, bằng tiếng Việt, để người tạo đọc lại trước khi bấm lưu.
 *
 * Đi cùng danh sách ngày xem trước chứ không thay cho nó: câu chữ nói ý định,
 * còn danh sách ngày nói kết quả, và chỗ hai thứ đó lệch nhau là chỗ người
 * dùng phát hiện mình chọn nhầm.
 */
export function describeRecurrence(input: {
  startsAt: string;
  rule: RecurrenceRule;
  total: number;
}): string {
  const { rule } = input;
  const every = rule.interval > 1 ? `mỗi ${rule.interval} ` : "mỗi ";

  let when: string;
  if (rule.frequency === "weekly") {
    const weekday = weekdayOf(input.startsAt);
    when = `${every}tuần vào ${WEEKDAY_LABELS[weekday ?? 0]}`;
  } else if (rule.monthlyMode === "day_of_month") {
    const parts = toParts(input.startsAt);
    when = `${every}tháng vào ngày ${parts?.day ?? "?"}`;
  } else {
    const weekday = weekdayOf(input.startsAt);
    const ordinal = weekdayOrdinalOf(input.startsAt) ?? 1;
    when = `${every}tháng vào ${WEEKDAY_LABELS[weekday ?? 0]} tuần thứ ${ordinal}`;
  }

  return `Lặp ${when} — ${input.total} buổi.`;
}
