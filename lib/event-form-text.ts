/**
 * lib/event-form-text.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần CHỮ của form đăng ký công khai mà BTC được sửa sau khi link đã gửi đi.
 *
 * Chủ dự án chốt 15/09/2026: admin và core team sửa được nội dung của form đã gửi,
 * nhưng chỉ phần chữ — không phải các ô người đăng ký phải điền. Vì vậy danh sách
 * này chỉ gồm những đoạn để ĐỌC. Nhãn của một ô nhập (nhãn minh chứng, nhãn câu hỏi
 * cho diễn giả, nhãn bữa trưa) không nằm ở đây: đổi nhãn một ô là đổi câu hỏi mà
 * những người đã đăng ký trả lời, và câu trả lời cũ sẽ nằm dưới một câu hỏi khác.
 *
 * Thuần, không I/O: khung sửa, action và hàm ghi cùng đọc một danh sách, nên không
 * có chuyện màn hình cho sửa một ô mà hàm ghi không nhận, hay ngược lại.
 */

export const REGISTRATION_FORM_TEXT_PANEL_ID = "noi-dung-form-dang-ky";

/** Trần độ dài mỗi đoạn. Đoạn giới thiệu dài nhất đang chạy khoảng 1.900 ký tự. */
export const FORM_TEXT_MAX_LENGTH = 20000;

export type FormTextField =
  | "event_description"
  | "no_show_policy_text"
  | "proof_description"
  | "fee_description"
  | "payment_instruction"
  | "meal_payment_instruction";

export type FormTextSpec = {
  key: FormTextField;
  label: string;
  hint: string;
  rows: number;
};

export const FORM_TEXT_FIELDS: readonly FormTextSpec[] = Object.freeze([
  {
    key: "event_description",
    label: "Giới thiệu sự kiện",
    hint: "Khối chữ ngay dưới tên sự kiện, phía trên các ô đăng ký.",
    rows: 12
  },
  {
    key: "no_show_policy_text",
    label: "Chính sách tham dự",
    hint: "Khung vàng cuối form, kèm ô tick đồng ý. Người đăng ký trước đó đã đồng ý với bản cũ.",
    rows: 4
  },
  {
    key: "proof_description",
    label: "Hướng dẫn gửi minh chứng",
    hint: "Dòng chữ nhỏ dưới ô dán đường dẫn minh chứng.",
    rows: 3
  },
  {
    key: "fee_description",
    label: "Mô tả phí",
    hint: "Dòng chữ dưới số tiền trong phần Thông tin thanh toán.",
    rows: 2
  },
  {
    key: "payment_instruction",
    label: "Hướng dẫn thanh toán",
    hint: "Số tài khoản, nội dung chuyển khoản, người liên hệ.",
    rows: 4
  },
  {
    key: "meal_payment_instruction",
    label: "Hướng dẫn thanh toán bữa trưa",
    hint: "Chỉ hiện khi người đăng ký chọn bữa trưa.",
    rows: 3
  }
]);

const FIELD_KEYS = new Set<string>(FORM_TEXT_FIELDS.map((spec) => spec.key));

export function isFormTextField(value: unknown): value is FormTextField {
  return typeof value === "string" && FIELD_KEYS.has(value);
}

type FormTextEvent = {
  proof_required?: boolean | null;
  proof_required_for_registration?: boolean | null;
  fee_required?: boolean | null;
  payment_proof_required?: boolean | null;
  meal_option_enabled?: boolean | null;
  no_show_policy_enabled?: boolean | null;
} & Partial<Record<FormTextField, string | null>>;

/**
 * Những đoạn chữ form công khai đang HIỆN với cấu hình hiện tại của sự kiện.
 *
 * Cùng điều kiện với `app/register/[token]/registration-form.tsx`. Đoạn nằm trong
 * một phần đang tắt thì người đăng ký không bao giờ đọc được, nên khung sửa không
 * bày nó ra — sửa một thứ không ai thấy chỉ làm người sửa tưởng đã sửa xong.
 * Giới thiệu sự kiện luôn có mặt, kể cả khi đang trống, để còn điền được.
 */
export function visibleFormTextFields(event: FormTextEvent | null | undefined): FormTextField[] {
  const e = event ?? {};
  const payment = Boolean(e.fee_required || e.payment_proof_required || e.meal_option_enabled);
  return FORM_TEXT_FIELDS.map((spec) => spec.key).filter((key) => {
    switch (key) {
      case "event_description":
        return true;
      case "no_show_policy_text":
        return Boolean(e.no_show_policy_enabled);
      case "proof_description":
        return Boolean(e.proof_required || e.proof_required_for_registration);
      case "fee_description":
      case "payment_instruction":
        return payment;
      case "meal_payment_instruction":
        return Boolean(e.meal_option_enabled);
      default:
        return false;
    }
  });
}

export type FormTextPanelField = FormTextSpec & { value: string };

/** Các ô của khung sửa, theo đúng thứ tự trong danh sách, kèm nội dung đang lưu. */
export function formTextPanelFields(event: FormTextEvent | null | undefined): FormTextPanelField[] {
  const visible = new Set(visibleFormTextFields(event));
  return FORM_TEXT_FIELDS.filter((spec) => visible.has(spec.key)).map((spec) => ({
    ...spec,
    value: String(event?.[spec.key] ?? "")
  }));
}

export type FormTextValues = Partial<Record<FormTextField, string | null>>;

export type ParsedFormText = { ok: true; texts: FormTextValues } | { ok: false; message: string };

/**
 * Đọc các đoạn chữ gửi lên. Chỉ nhận khoá có trong danh sách: một form tự chế gửi
 * kèm `show_student_id_field` hay `event_name` thì khoá đó bị bỏ qua, không ghi.
 *
 * Khoá vắng mặt nghĩa là "không đụng tới", khác với gửi chuỗi rỗng là "xoá đoạn này".
 */
export function parseFormTextInput(raw: unknown): ParsedFormText {
  const texts: FormTextValues = {};
  if (!raw || typeof raw !== "object") return { ok: true, texts };
  const record = raw as Record<string, unknown>;

  for (const spec of FORM_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, spec.key)) continue;
    const value = record[spec.key];
    if (value !== null && value !== undefined && typeof value !== "string") {
      return { ok: false, message: `${spec.label}: nội dung không hợp lệ.` };
    }
    const text = String(value ?? "").trim();
    if (text.length > FORM_TEXT_MAX_LENGTH) {
      return {
        ok: false,
        message: `${spec.label} dài quá ${new Intl.NumberFormat("vi-VN").format(FORM_TEXT_MAX_LENGTH)} ký tự.`
      };
    }
    texts[spec.key] = text || null;
  }

  return { ok: true, texts };
}

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

/**
 * So hai bản chữ như người đọc thấy. Trình duyệt gửi xuống dòng dạng CRLF, còn một
 * đoạn dán qua đường khác có thể là LF: cùng một đoạn không được tính là "đã sửa"
 * chỉ vì kiểu xuống dòng, kẻo một lần bấm lưu không sửa gì cũng ghi đè cả chuỗi.
 */
function comparable(value: unknown): string {
  return String(value ?? "").split(CR + LF).join(LF).split(CR).join(LF).trim();
}

/** Chỉ những đoạn thật sự khác bản đang lưu. */
export function changedFormText(
  before: Partial<Record<string, unknown>> | null | undefined,
  texts: FormTextValues
): FormTextValues {
  const changes: FormTextValues = {};
  for (const spec of FORM_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(texts, spec.key)) continue;
    const next = texts[spec.key] ?? null;
    if (comparable(next) !== comparable(before?.[spec.key])) changes[spec.key] = next;
  }
  return changes;
}
