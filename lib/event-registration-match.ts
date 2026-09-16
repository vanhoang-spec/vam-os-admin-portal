import { normalizeEmail } from "@/lib/identity";

/**
 * lib/event-registration-match.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * "Vẫn là người đó" trong CÙNG MỘT BUỔI: trùng email, hoặc trùng số điện thoại.
 *
 * Chủ dự án chốt 16/09/2026: một người đăng ký được cả hai buổi của chuỗi, và
 * nộp lại cho cùng một buổi thì bản mới GHI ĐÈ bản cũ thay vì bị chặn. Trước đó
 * hệ thống chặn cả hai: một ràng buộc "một email một chuỗi" và một câu báo
 * "Bạn đã đăng ký sự kiện này rồi".
 *
 * Email xét trước, vì nó là thứ tấm vé được gửi tới. Số điện thoại chỉ xét khi
 * email không khớp — và đây là chỗ cần biết cái giá: hai người thật sự khác nhau
 * mà khai chung một số (anh chị em, số của phụ huynh, số của lớp trưởng) sẽ bị
 * coi là một người, và người nộp sau ghi đè lên người nộp trước. Chủ dự án đã
 * chọn cách này; ai đọc lại nên biết đó là lựa chọn, không phải sơ suất.
 *
 * Thuần, không I/O.
 */

/**
 * Số điện thoại về dạng so sánh được: chỉ chữ số, và `+84`/`84` thành `0`.
 * `0905.376.392`, `0905 376 392` và `+84905376392` là cùng một số.
 */
export function normalizeRegistrationPhone(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const hasPlus = text.startsWith("+");
  const digits = text
    .split("")
    .filter((ch) => ch >= "0" && ch <= "9")
    .join("");
  if (!digits) return "";
  if (digits.startsWith("84") && (hasPlus || digits.length > 10)) return `0${digits.slice(2)}`;
  return digits;
}

export type ExistingRegistrationRow = {
  id: string;
  email?: unknown;
  phone?: unknown;
  registration_status?: unknown;
};

export type RegistrationMatch = {
  row: ExistingRegistrationRow;
  /** Khớp bằng gì — dùng cho log và cho câu báo, không dùng để quyết định ghi. */
  by: "email" | "phone";
};

/**
 * Đăng ký cũ của người này trong danh sách đăng ký CỦA MỘT BUỔI, hoặc null.
 *
 * Dòng đã huỷ không tính: huỷ rồi đăng ký lại là một đăng ký mới, không phải sửa
 * đăng ký cũ.
 */
export function findExistingRegistration(
  rows: ReadonlyArray<ExistingRegistrationRow>,
  input: { email: string; phone?: unknown }
): RegistrationMatch | null {
  const active = rows.filter((row) => String(row.registration_status ?? "") !== "cancelled");

  const email = normalizeEmail(input.email);
  if (email) {
    const byEmail = active.find((row) => normalizeEmail(row.email) === email);
    if (byEmail) return { row: byEmail, by: "email" };
  }

  const phone = normalizeRegistrationPhone(input.phone);
  if (!phone) return null;
  const byPhone = active.find((row) => normalizeRegistrationPhone(row.phone) === phone);
  return byPhone ? { row: byPhone, by: "phone" } : null;
}
