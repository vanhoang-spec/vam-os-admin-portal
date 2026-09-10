import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function text(value: unknown, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

const EMPTY_DISPLAY_VALUES = new Set(["", "-", "nan", "undefined", "null"]);
const PLACEHOLDER_DISPLAY_VALUES = new Set(["0", "true", "false"]);

function normalizedDisplayValue(value: unknown) {
  return String(value ?? "").trim();
}

export function displayText(value: unknown, fallback = "-") {
  const raw = normalizedDisplayValue(value);
  const normalized = raw.toLowerCase();
  if (EMPTY_DISPLAY_VALUES.has(normalized) || PLACEHOLDER_DISPLAY_VALUES.has(normalized)) return fallback;
  return raw;
}

export function displayOptional(value: unknown, fallback = "-") {
  const raw = normalizedDisplayValue(value);
  const normalized = raw.toLowerCase();
  if (EMPTY_DISPLAY_VALUES.has(normalized)) return fallback;
  return raw;
}

export function displayAdminNote(value: unknown, fallback = "-") {
  const raw = normalizedDisplayValue(value);
  const normalized = raw.toLowerCase();
  if (EMPTY_DISPLAY_VALUES.has(normalized) || PLACEHOLDER_DISPLAY_VALUES.has(normalized)) return fallback;
  return raw;
}

export function displayCode(value: unknown, fallback = "-") {
  const raw = normalizedDisplayValue(value);
  const normalized = raw.toLowerCase();
  if (EMPTY_DISPLAY_VALUES.has(normalized)) return fallback;
  return raw;
}

export function displayConsent(value: unknown) {
  const normalized = normalizedDisplayValue(value).toLowerCase();
  if (["true", "yes", "y", "1", "có", "co"].includes(normalized)) return "Có";
  if (["false", "no", "n", "0", "không", "khong"].includes(normalized)) return "Không";
  return "Chưa rõ";
}

export function externalUrl(value: unknown) {
  const url = String(value ?? "").trim();
  if (!url || url === "-") return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

/**
 * Mọi ngày tháng trong CRM đọc theo giờ Việt Nam.
 *
 * Ấn định múi giờ không phải chuyện thẩm mỹ mà là chuyện đúng/sai. Máy chủ của
 * Vercel chạy giờ UTC; một buổi phỏng vấn 8 giờ tối ngày 9/9 giờ Việt Nam là
 * 13:00 UTC cùng ngày — nhưng một sự kiện lúc 1 giờ sáng ngày 9/9 lại là 18:00
 * ngày 8/9 theo UTC, và định dạng không ấn định múi giờ sẽ hiện SAI NGÀY.
 */
const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

/**
 * DD/MM/YYYY, luôn luôn, ở mọi màn hình.
 *
 * Dùng `en-GB` với day/month "2-digit" chứ không dùng `vi-VN` mặc định: locale
 * vi-VN của Intl cho ra `8/9/2026` — không đệm số 0, và ngày một chữ số cạnh
 * tháng một chữ số thì `1/2` với `2/1` chỉ khác nhau ở thói quen người đọc.
 * Bộ tuỳ chọn dưới đây cho ra đúng một hình dạng, không phụ thuộc locale của
 * máy chạy.
 */
const VN_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: VN_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

/**
 * HH:mm, 24 giờ.
 *
 * `hourCycle: "h23"` chứ không phải `hour12: false`: bản dựng ICU cũ hiểu
 * `hour12: false` là chu kỳ h24 và in nửa đêm thành `24:00`.
 */
const VN_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: VN_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Ngày, dạng DD/MM/YYYY. */
export function formatDate(value: unknown) {
  if (!value) return "-";
  const date = toDate(value);
  // Chuỗi không đọc được thì trả nguyên xi: giấu nó sau một dấu gạch làm mất
  // luôn manh mối duy nhất để lần ra dữ liệu hỏng.
  if (!date) return String(value);
  return VN_DATE.format(date);
}

/** Giờ, dạng HH:mm theo giờ Việt Nam. */
export function formatTime(value: unknown) {
  if (!value) return "-";
  const date = toDate(value);
  if (!date) return String(value);
  return VN_TIME.format(date);
}

/**
 * Ngày kèm giờ: `DD/MM/YYYY HH:mm`.
 *
 * Ngày đứng trước giờ, và năm đủ bốn chữ số. Bản cũ cho ra `14:05 8/9/26` —
 * ba thứ lệch chuẩn trong một chuỗi bảy ký tự.
 *
 * Sổ ghi thư đi cần phút chứ không chỉ ngày: người vận hành đọc nó để biết một
 * thư đi trước hay sau một thao tác khác trong cùng buổi.
 */
export function formatDateTime(value: unknown) {
  if (!value) return "-";
  const date = toDate(value);
  if (!date) return String(value);
  return `${VN_DATE.format(date)} ${VN_TIME.format(date)}`;
}

export function includesQuery(values: unknown[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(q));
}

const VN_INT_FORMAT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

export function formatInt(value: number): string {
  return VN_INT_FORMAT.format(value);
}

export function formatMonthVN(isoMonth: string): string {
  const [year, month] = isoMonth.split("-");
  if (!year || !month) return isoMonth;
  return `Tháng ${parseInt(month, 10)}/${year}`;
}
