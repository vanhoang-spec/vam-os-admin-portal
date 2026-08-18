/**
 * lib/interview-scheduling-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure helpers for booking interviews: reading the operator's input, laying out
 * consecutive slots, and printing a time a Vietnamese reader recognises.
 *
 * No Supabase, no cookies — so every rule here is unit-testable, which matters
 * most for the time zone. The organisers type a local time into a
 * `datetime-local` field, which sends "2026-08-25T14:30" with no zone at all.
 * Parsed on a server running in UTC that same string means 21:30 in Vietnam,
 * and the candidate is told the wrong hour. `parseScheduleInput` therefore
 * resolves a bare wall-clock time as Vietnam time, always, wherever the server
 * happens to run.
 */

export const INTERVIEW_MODES = ["online", "offline"] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

/** The program is run from Vietnam; every wall-clock time in it is ICT. */
export const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const VN_UTC_OFFSET = "+07:00";

/** Minutes between two consecutive interviews when the operator does not say. */
export const DEFAULT_SLOT_MINUTES = 30;

/** 0 means "everyone at the same time" — a panel, not a queue. */
export const MIN_SLOT_MINUTES = 0;
export const MAX_SLOT_MINUTES = 240;

/** How many interviews one operator action may book. */
export const MAX_INTERVIEWS_PER_RUN = 60;

/** How far into the past a start time may fall before it reads as a typo. */
const PAST_TOLERANCE_MS = 24 * 60 * 60 * 1000;

const MAX_LOCATION_LENGTH = 300;

const BARE_LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export type ParsedSchedule = {
  /** Absolute instant, safe to store in a timestamptz column. */
  startAtIso: string;
  mode: InterviewMode | null;
  location: string | null;
  slotMinutes: number;
};

export type ParseScheduleResult =
  | ({ ok: true } & ParsedSchedule)
  | { ok: false; message: string };

/**
 * Turn a bare wall-clock string into an absolute instant in Vietnam time.
 * A value that already carries a zone (or a trailing Z) is left alone.
 */
export function toVietnamInstant(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const withZone = BARE_LOCAL_DATETIME.test(text) ? `${text}${VN_UTC_OFFSET}` : text;
  const parsed = new Date(withZone);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function parseScheduleInput(input: {
  startAt?: unknown;
  mode?: unknown;
  location?: unknown;
  slotMinutes?: unknown;
  now?: Date;
}): ParseScheduleResult {
  const startRaw = String(input.startAt ?? "").trim();
  if (!startRaw) {
    return { ok: false, message: "Vui lòng chọn thời gian bắt đầu phỏng vấn." };
  }

  const startAtIso = toVietnamInstant(startRaw);
  if (!startAtIso) {
    return { ok: false, message: "Thời gian phỏng vấn không hợp lệ." };
  }

  const now = input.now ?? new Date();
  if (new Date(startAtIso).getTime() < now.getTime() - PAST_TOLERANCE_MS) {
    return {
      ok: false,
      message: "Thời gian phỏng vấn đã ở quá khứ. Vui lòng kiểm tra lại ngày giờ."
    };
  }

  const modeRaw = String(input.mode ?? "").trim();
  let mode: InterviewMode | null = null;
  if (modeRaw) {
    if (!(INTERVIEW_MODES as readonly string[]).includes(modeRaw)) {
      return { ok: false, message: "Hình thức phỏng vấn không hợp lệ." };
    }
    mode = modeRaw as InterviewMode;
  }

  const locationRaw = String(input.location ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (locationRaw.length > MAX_LOCATION_LENGTH) {
    return {
      ok: false,
      message: `Địa điểm / đường dẫn không được dài quá ${MAX_LOCATION_LENGTH} ký tự.`
    };
  }

  const slotRaw = String(input.slotMinutes ?? "").trim();
  let slotMinutes = DEFAULT_SLOT_MINUTES;
  if (slotRaw !== "") {
    const parsed = Number(slotRaw);
    if (!Number.isFinite(parsed) || parsed < MIN_SLOT_MINUTES || parsed > MAX_SLOT_MINUTES) {
      return {
        ok: false,
        message: `Khoảng cách giữa hai ca phỏng vấn phải từ ${MIN_SLOT_MINUTES} đến ${MAX_SLOT_MINUTES} phút.`
      };
    }
    slotMinutes = Math.floor(parsed);
  }

  return {
    ok: true,
    startAtIso,
    mode,
    location: locationRaw || null,
    slotMinutes
  };
}

/**
 * Consecutive appointment times, one per candidate, in the order given.
 * With slotMinutes = 0 every candidate gets the same instant.
 */
export function buildSlotTimes(startAtIso: string, slotMinutes: number, count: number): string[] {
  const start = new Date(startAtIso).getTime();
  if (Number.isNaN(start) || count <= 0) return [];
  const step = Math.max(0, Math.floor(slotMinutes)) * 60_000;
  return Array.from({ length: count }, (_, index) => new Date(start + index * step).toISOString());
}

const VN_DATE_TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: VN_TIME_ZONE,
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

/** "14:30 Thứ Ba, 25/08/2026" — the form an invitation email should carry. */
export function formatInterviewTimeVi(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = VN_DATE_TIME.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = pick("weekday");
  const day = `${pick("day")}/${pick("month")}/${pick("year")}`;
  const time = `${pick("hour")}:${pick("minute")}`;
  return weekday ? `${time} ${weekday}, ${day}` : `${time} ${day}`;
}

/** The value a `datetime-local` input needs to show an existing appointment. */
export function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return `${pick("year")}-${pick("month")}-${pick("day")}T${hour}:${pick("minute")}`;
}

export const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  online: "Trực tuyến",
  offline: "Trực tiếp"
};
