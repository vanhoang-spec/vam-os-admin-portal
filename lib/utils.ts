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

export function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("vi-VN").format(date);
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
