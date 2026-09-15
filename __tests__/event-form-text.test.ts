/**
 * Phần chữ của form đăng ký mà BTC được sửa sau khi link đã gửi đi.
 *
 * Ba cách nó hỏng mà không ai thấy, và bộ test canh cả ba:
 *   - một khoá ngoài danh sách lọt xuống hàm ghi — "sửa chữ" ghi được cả ô cần điền;
 *   - đổi kiểu xuống dòng bị tính là "đã sửa" — một lần bấm lưu ghi đè cả chuỗi;
 *   - khung sửa bày ra đoạn mà form không hiện — người sửa tưởng đã sửa xong.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FORM_TEXT_FIELDS,
  FORM_TEXT_MAX_LENGTH,
  changedFormText,
  formTextPanelFields,
  isFormTextField,
  parseFormTextInput,
  visibleFormTextFields
} from "@/lib/event-form-text";

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

describe("1. danh sách chỉ gồm chữ để đọc", () => {
  it("đúng sáu đoạn, theo thứ tự trên form", () => {
    expect(FORM_TEXT_FIELDS.map((spec) => spec.key)).toEqual([
      "event_description",
      "no_show_policy_text",
      "proof_description",
      "fee_description",
      "payment_instruction",
      "meal_payment_instruction"
    ]);
  });

  it.each(["proof_label", "speaker_question_label", "meal_label", "event_name", "show_student_id_field", "fee_amount"])(
    "%s không sửa được ở đây — nhãn ô nhập, tên hay cấu hình",
    (key) => {
      expect(isFormTextField(key)).toBe(false);
    }
  );
});

describe("2. đọc nội dung gửi lên", () => {
  it("chỉ nhận khoá trong danh sách; cắt khoảng trắng; rỗng là xoá đoạn đó", () => {
    expect(
      parseFormTextInput({
        event_description: "  Mới  ",
        payment_instruction: "   ",
        event_name: "Đổi tên",
        show_student_id_field: "false"
      })
    ).toEqual({ ok: true, texts: { event_description: "Mới", payment_instruction: null } });
  });

  it("khoá vắng mặt là không đụng tới", () => {
    expect(parseFormTextInput({})).toEqual({ ok: true, texts: {} });
    expect(parseFormTextInput(null)).toEqual({ ok: true, texts: {} });
  });

  it("dài quá trần: từ chối, nói đúng tên đoạn", () => {
    const parsed = parseFormTextInput({ proof_description: "a".repeat(FORM_TEXT_MAX_LENGTH + 1) });
    expect(parsed).toEqual({ ok: false, message: "Hướng dẫn gửi minh chứng dài quá 20.000 ký tự." });
    expect(parseFormTextInput({ proof_description: "a".repeat(FORM_TEXT_MAX_LENGTH) }).ok).toBe(true);
  });

  it("không phải chuỗi: từ chối", () => {
    expect(parseFormTextInput({ event_description: ["a"] }).ok).toBe(false);
  });
});

describe("3. chỉ những đoạn thật sự đổi", () => {
  it("CRLF và LF là cùng một đoạn", () => {
    const before = { event_description: `Dòng 1${CR}${LF}Dòng 2` };
    expect(changedFormText(before, { event_description: `Dòng 1${LF}Dòng 2` })).toEqual({});
    expect(changedFormText({ event_description: `Dòng 1${LF}Dòng 2` }, { event_description: `Dòng 1${CR}${LF}Dòng 2` })).toEqual({});
  });

  it("trống và chưa có là như nhau", () => {
    expect(changedFormText({ fee_description: null }, { fee_description: null })).toEqual({});
    expect(changedFormText({ fee_description: "" }, { fee_description: null })).toEqual({});
    expect(changedFormText({}, { fee_description: null })).toEqual({});
  });

  it("đoạn đổi thì có, đoạn giữ nguyên thì không", () => {
    const before = { event_description: "🕒 AGENDA – 20.09.2026 & 27.09.2026", payment_instruction: "STK 123" };
    expect(
      changedFormText(before, { event_description: "🕒 AGENDA – 27.09.2026 & 04.10.2026", payment_instruction: "STK 123" })
    ).toEqual({ event_description: "🕒 AGENDA – 27.09.2026 & 04.10.2026" });
  });

  it("xoá một đoạn là một thay đổi", () => {
    expect(changedFormText({ no_show_policy_text: "Vắng 2 lần..." }, { no_show_policy_text: null })).toEqual({
      no_show_policy_text: null
    });
  });

  it("khoá không gửi lên thì không so, dù bản đang lưu khác", () => {
    expect(changedFormText({ event_description: "A", payment_instruction: "B" }, { event_description: "A" })).toEqual({});
  });
});

describe("4. khung sửa chỉ bày đoạn form đang hiện", () => {
  it("không bật phần nào: chỉ giới thiệu, kể cả khi đang trống", () => {
    expect(visibleFormTextFields({})).toEqual(["event_description"]);
    expect(visibleFormTextFields(null)).toEqual(["event_description"]);
  });

  it.each([
    [{ no_show_policy_enabled: true }, ["event_description", "no_show_policy_text"]],
    [{ proof_required: true }, ["event_description", "proof_description"]],
    [{ proof_required_for_registration: true }, ["event_description", "proof_description"]],
    [{ fee_required: true }, ["event_description", "fee_description", "payment_instruction"]],
    [{ payment_proof_required: true }, ["event_description", "fee_description", "payment_instruction"]],
    [{ meal_option_enabled: true }, ["event_description", "fee_description", "payment_instruction", "meal_payment_instruction"]],
    [{ no_show_policy_enabled: false, proof_required: false, fee_required: false }, ["event_description"]]
  ])("%o → %o", (event, expected) => {
    expect(visibleFormTextFields(event)).toEqual(expected);
  });

  it("mang nội dung đang lưu; chưa có thì là chuỗi rỗng", () => {
    expect(
      formTextPanelFields({ event_description: "Giới thiệu", fee_required: true, payment_instruction: null }).map((field) => [
        field.key,
        field.value
      ])
    ).toEqual([
      ["event_description", "Giới thiệu"],
      ["fee_description", ""],
      ["payment_instruction", ""]
    ]);
  });

  it("cùng điều kiện với form công khai", () => {
    const form = readFileSync("app/register/[token]/registration-form.tsx", "utf8");
    expect(form).toContain("(event.proof_required || event.proof_required_for_registration)");
    expect(form).toContain("(event.fee_required || event.payment_proof_required || (mealSelected && event.meal_option_enabled))");
    expect(form).toContain("event.no_show_policy_enabled && event.no_show_policy_text");
    expect(form).toContain("mealSelected && event.meal_payment_instruction");
    const page = readFileSync("app/register/[token]/page.tsx", "utf8");
    expect(page).toContain("data.event?.event_description &&");
  });
});
