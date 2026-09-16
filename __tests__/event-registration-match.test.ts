/**
 * Nhận ra "vẫn là người đó" trong một buổi.
 *
 * Hai cách hỏng mà không ai thấy:
 *   - số điện thoại viết khác kiểu (`+84`, dấu chấm, khoảng trắng) bị coi là hai
 *     người, nên lần nộp lại tạo thêm một dòng thay vì ghi đè;
 *   - dòng đã huỷ bị tính là đăng ký cũ, nên người huỷ rồi đăng ký lại bị ghi đè
 *     vào chính dòng đã huỷ và chỗ ngồi không bao giờ quay lại.
 *
 * Ca cuối khoá lại CÁI GIÁ đã chọn: hai người khai chung một số điện thoại bị
 * coi là một người. Chủ dự án chốt như vậy 16/09/2026.
 */
import { describe, expect, it } from "vitest";
import { findExistingRegistration, normalizeRegistrationPhone } from "@/lib/event-registration-match";

const rows = [
  { id: "r1", email: "an@example.com", phone: "0905.376.392", registration_status: "registered" },
  { id: "r2", email: "binh@example.com", phone: "0936 359 670", registration_status: "waitlisted" },
  { id: "r3", email: "cuc@example.com", phone: "0394983679", registration_status: "cancelled" }
];

describe("1. chuẩn hoá số điện thoại", () => {
  it.each([
    ["0905.376.392", "0905376392"],
    ["0905 376 392", "0905376392"],
    ["+84905376392", "0905376392"],
    ["84905376392", "0905376392"],
    ["(090) 537-6392", "0905376392"],
    ["", ""],
    [null, ""],
    ["không có số", ""]
  ])("%s → %s", (input, expected) => {
    expect(normalizeRegistrationPhone(input)).toBe(expected);
  });

  it("không cắt nhầm số bắt đầu bằng 84 mà đúng 10 chữ số", () => {
    // 0849xxxxxx là số nội địa thật; cắt "84" đi là ra một số khác hẳn.
    expect(normalizeRegistrationPhone("0849123456")).toBe("0849123456");
  });
});

describe("2. tìm đăng ký cũ trong cùng một buổi", () => {
  it("trùng email: nhận ra, dù chữ hoa chữ thường khác nhau", () => {
    expect(findExistingRegistration(rows, { email: "AN@Example.com" })).toEqual({ row: rows[0], by: "email" });
  });

  it("email khác nhưng trùng số điện thoại viết kiểu khác: vẫn là người đó", () => {
    expect(findExistingRegistration(rows, { email: "an.moi@example.com", phone: "+84 905 376 392" })).toEqual({
      row: rows[0],
      by: "phone"
    });
  });

  it("email xét trước số điện thoại", () => {
    const match = findExistingRegistration(rows, { email: "binh@example.com", phone: "0905376392" });
    expect(match).toEqual({ row: rows[1], by: "email" });
  });

  it("dòng đã huỷ không tính là đăng ký cũ", () => {
    expect(findExistingRegistration(rows, { email: "cuc@example.com", phone: "0394983679" })).toBeNull();
  });

  it("người mới hoàn toàn: không có gì để ghi đè", () => {
    expect(findExistingRegistration(rows, { email: "moi@example.com", phone: "0900000000" })).toBeNull();
  });

  it("không khai số điện thoại thì chỉ xét email", () => {
    expect(findExistingRegistration(rows, { email: "moi@example.com" })).toBeNull();
    expect(findExistingRegistration(rows, { email: "moi@example.com", phone: "   " })).toBeNull();
  });

  it("CÁI GIÁ đã chọn: hai người khai chung một số bị coi là một người", () => {
    const match = findExistingRegistration(rows, { email: "em-cua-an@example.com", phone: "0905376392" });
    expect(match?.by).toBe("phone");
    expect(match?.row.id).toBe("r1");
  });
});
