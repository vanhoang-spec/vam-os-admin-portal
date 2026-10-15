/**
 * Form tùy chỉnh (BTC 15/10/2026) — phần thuần, không I/O. Chạy cả trên trình duyệt (kiểm ngay
 * khi người điền bấm gửi) lẫn máy chủ (kiểm lại toàn bộ trước khi ghi): một luật, hai nơi dùng.
 *
 * Support team tự tạo form cho từng đợt (vd. tuyển mentee Job Shadowing) thay vì nhờ lập trình.
 * Định nghĩa trường lưu ở custom_forms.fields (jsonb); câu trả lời ở custom_form_responses.answers,
 * khoá theo mã trường — không theo nhãn, để sửa nhãn không làm lệch dữ liệu cũ.
 */
import { isValidEmail, normalizeEmail } from "@/lib/identity";
import { parseVietnamDateInput, toVietnamDateInput } from "@/lib/event-datetime";

export const CUSTOM_FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "student_id",
  "citizen_id",
  "date",
  "number",
  "url",
  "single_choice",
  "multi_choice",
  "dropdown",
  "section"
] as const;
export type CustomFormFieldType = (typeof CUSTOM_FORM_FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<CustomFormFieldType, string> = {
  short_text: "Chữ ngắn",
  long_text: "Đoạn văn",
  email: "Email",
  phone: "Số điện thoại",
  student_id: "MSSV",
  citizen_id: "Số CCCD",
  date: "Ngày (DD/MM/YYYY)",
  number: "Số",
  url: "Link (http/https)",
  single_choice: "Chọn một",
  multi_choice: "Chọn nhiều",
  dropdown: "Danh sách thả xuống",
  section: "Tiêu đề / đoạn giới thiệu"
};

/** Gợi ý định dạng hiện dưới ô nhập, để người điền biết luật trước khi bị báo lỗi. */
export const FIELD_FORMAT_HINTS: Partial<Record<CustomFormFieldType, string>> = {
  phone: "10 chữ số, ví dụ 0912345678",
  student_id: "Chỉ gồm chữ số, 8–12 ký tự",
  citizen_id: "Đúng 12 chữ số",
  date: "Định dạng DD/MM/YYYY, ví dụ 05/09/2004",
  url: "Bắt đầu bằng http:// hoặc https://"
};

export const CHOICE_TYPES: ReadonlySet<CustomFormFieldType> = new Set<CustomFormFieldType>(["single_choice", "multi_choice", "dropdown"]);

export const CUSTOM_FORM_LIMITS = {
  title: 200,
  description: 4000,
  thankYou: 1000,
  label: 300,
  help: 1000,
  option: 200,
  options: 50,
  fields: 60,
  shortText: 500,
  longText: 5000,
  url: 1000,
  number: 30
} as const;

export const CUSTOM_FORM_STATUSES = ["draft", "published", "closed"] as const;
export type CustomFormStatus = (typeof CUSTOM_FORM_STATUSES)[number];
export const CUSTOM_FORM_STATUS_LABELS: Record<CustomFormStatus, string> = {
  draft: "Nháp",
  published: "Đang công khai",
  closed: "Đã đóng"
};

export const CUSTOM_FORMS_PATH = "/forms";
export const CUSTOM_FORM_PUBLIC_PREFIX = "/f";

/** Câu đồng ý luôn có ở cuối mọi form: form có thể thu CCCD, ngày sinh, số điện thoại. */
export const CUSTOM_FORM_CONSENT_TEXT =
  "Tôi đồng ý để Vietnam Alumni Mentoring thu thập và xử lý các thông tin trên cho mục đích tuyển chọn và tổ chức chương trình này.";

export type CustomFormField = {
  id: string;
  type: CustomFormFieldType;
  label: string;
  help: string;
  required: boolean;
  /** Ẩn khỏi form công khai nhưng giữ dữ liệu cũ — cách "xoá" một trường đã có câu trả lời. */
  hidden: boolean;
  options: string[];
};

export type CustomFormAnswerValue = string | string[];
export type CustomFormAnswers = Record<string, CustomFormAnswerValue>;

const FIELD_ID = /^f_[a-z0-9]{6,16}$/;
const PUBLIC_CODE = /^[a-z0-9]{10,16}$/;

export function isCustomFormCode(value: unknown): boolean {
  return PUBLIC_CODE.test(String(value ?? ""));
}

export function newFieldId(random: () => number = Math.random): string {
  let out = "";
  while (out.length < 8) out += Math.floor(random() * 36).toString(36);
  return `f_${out.slice(0, 8)}`;
}

export function isQuestion(field: Pick<CustomFormField, "type">): boolean {
  return field.type !== "section";
}

const text = (value: unknown) => String(value ?? "").trim();

function fieldName(field: { label: string }, index: number): string {
  const label = field.label ? `“${field.label.slice(0, 60)}”` : "";
  return `Trường ${index + 1}${label ? ` ${label}` : ""}`;
}

/**
 * Đọc định nghĩa trường từ trình tạo form. Cái trình duyệt gửi lên là thứ người gửi tự đặt được:
 * mọi thuộc tính được kiểm lại và chép sang một đối tượng mới, thuộc tính lạ bị bỏ.
 */
export function parseFieldDefinitions(raw: unknown): { ok: true; fields: CustomFormField[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Danh sách trường không hợp lệ." };
  if (raw.length > CUSTOM_FORM_LIMITS.fields) return { ok: false, error: `Một form tối đa ${CUSTOM_FORM_LIMITS.fields} trường.` };
  const fields: CustomFormField[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const item = (raw[i] ?? {}) as Record<string, unknown>;
    const id = text(item.id);
    const type = text(item.type) as CustomFormFieldType;
    const label = text(item.label);
    const help = text(item.help);
    const draft = { label };
    if (!FIELD_ID.test(id) || ids.has(id)) return { ok: false, error: `${fieldName(draft, i)}: mã trường không hợp lệ — tải lại trang rồi thử lại.` };
    ids.add(id);
    if (!CUSTOM_FORM_FIELD_TYPES.includes(type)) return { ok: false, error: `${fieldName(draft, i)}: loại trường không hợp lệ.` };
    if (!label) return { ok: false, error: `${fieldName(draft, i)}: chưa có nội dung câu hỏi / tiêu đề.` };
    if (label.length > CUSTOM_FORM_LIMITS.label) return { ok: false, error: `${fieldName(draft, i)}: câu hỏi dài quá ${CUSTOM_FORM_LIMITS.label} ký tự.` };
    if (help.length > CUSTOM_FORM_LIMITS.help) return { ok: false, error: `${fieldName(draft, i)}: phần mô tả dài quá ${CUSTOM_FORM_LIMITS.help} ký tự.` };
    let options: string[] = [];
    if (CHOICE_TYPES.has(type)) {
      const rawOptions = Array.isArray(item.options) ? item.options : [];
      options = rawOptions.map(text).filter(Boolean);
      if (!options.length) return { ok: false, error: `${fieldName(draft, i)}: cần ít nhất một lựa chọn.` };
      if (options.length > CUSTOM_FORM_LIMITS.options) return { ok: false, error: `${fieldName(draft, i)}: tối đa ${CUSTOM_FORM_LIMITS.options} lựa chọn.` };
      if (options.some((o) => o.length > CUSTOM_FORM_LIMITS.option)) return { ok: false, error: `${fieldName(draft, i)}: mỗi lựa chọn tối đa ${CUSTOM_FORM_LIMITS.option} ký tự.` };
      const seen = new Set<string>();
      for (const option of options) {
        const key = option.toLowerCase();
        if (seen.has(key)) return { ok: false, error: `${fieldName(draft, i)}: lựa chọn “${option}” bị trùng.` };
        seen.add(key);
      }
    }
    fields.push({
      id,
      type,
      label,
      help,
      required: type === "section" ? false : item.required === true,
      hidden: item.hidden === true,
      options
    });
  }
  return { ok: true, fields };
}

/** Đọc định nghĩa đã lưu trong database (đã kiểm lúc lưu) — bỏ qua dòng hỏng thay vì vỡ trang. */
export function storedFields(raw: unknown): CustomFormField[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomFormField[] = [];
  for (const item of raw) {
    const parsed = parseFieldDefinitions([item]);
    if (parsed.ok) out.push(parsed.fields[0]);
  }
  return out;
}

export type CustomFormSettingsInput = {
  title: unknown;
  description: unknown;
  programId: unknown;
  thankYou: unknown;
  onePerEmail: unknown;
  /** ISO đã đọc theo giờ Việt Nam (parseVietnamDateTime), hoặc null. */
  opensAt: string | null;
  closesAt: string | null;
};

export type CustomFormSettings = {
  title: string;
  description: string;
  programId: string | null;
  thankYou: string;
  onePerEmail: boolean;
  opensAt: string | null;
  closesAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFormSettings(input: CustomFormSettingsInput): { ok: true; settings: CustomFormSettings } | { ok: false; error: string } {
  const title = text(input.title);
  const description = String(input.description ?? "").replace(/\r\n/g, "\n").trim();
  const thankYou = String(input.thankYou ?? "").replace(/\r\n/g, "\n").trim();
  const programRaw = text(input.programId);
  if (!title) return { ok: false, error: "Form cần có tiêu đề." };
  if (title.length > CUSTOM_FORM_LIMITS.title) return { ok: false, error: `Tiêu đề tối đa ${CUSTOM_FORM_LIMITS.title} ký tự.` };
  if (description.length > CUSTOM_FORM_LIMITS.description) return { ok: false, error: `Phần giới thiệu tối đa ${CUSTOM_FORM_LIMITS.description} ký tự.` };
  if (thankYou.length > CUSTOM_FORM_LIMITS.thankYou) return { ok: false, error: `Lời cảm ơn tối đa ${CUSTOM_FORM_LIMITS.thankYou} ký tự.` };
  if (programRaw && !UUID.test(programRaw)) return { ok: false, error: "Chương trình không hợp lệ." };
  if (input.opensAt && input.closesAt && Date.parse(input.closesAt) <= Date.parse(input.opensAt)) {
    return { ok: false, error: "Giờ đóng phải sau giờ mở." };
  }
  return {
    ok: true,
    settings: {
      title,
      description,
      programId: programRaw || null,
      thankYou,
      onePerEmail: input.onePerEmail === true || input.onePerEmail === "on" || input.onePerEmail === "true",
      opensAt: input.opensAt,
      closesAt: input.closesAt
    }
  };
}

/** Trường Email dùng để chặn gửi trùng: trường Email đầu tiên đang hiện và bắt buộc. */
export function dedupeEmailField(fields: CustomFormField[]): CustomFormField | null {
  return fields.find((f) => f.type === "email" && f.required && !f.hidden) ?? null;
}

/** Luật giữa cài đặt và danh sách trường. null = hợp lệ. */
export function checkDefinitionRules(fields: CustomFormField[], settings: Pick<CustomFormSettings, "onePerEmail">): string | null {
  if (settings.onePerEmail && !dedupeEmailField(fields)) {
    return "Đang bật “Mỗi email chỉ gửi một lần” nên form cần một trường Email bắt buộc (không ẩn).";
  }
  return null;
}

/** Công khai được khi có ít nhất một câu hỏi đang hiện. */
export function publishBlocker(fields: CustomFormField[]): string | null {
  return fields.some((f) => isQuestion(f) && !f.hidden) ? null : "Form chưa có câu hỏi nào đang hiện — thêm câu hỏi trước khi công khai.";
}

/**
 * Form đã có câu trả lời: dữ liệu cũ khoá theo mã trường, nên trường cũ không được biến mất, không
 * đổi loại, và lựa chọn cũ không được bỏ (chỉ thêm). Muốn bỏ một câu hỏi thì ẩn nó. Sửa chữ của
 * câu hỏi vẫn được. Khối tiêu đề không mang dữ liệu nên xoá tự do. null = hợp lệ.
 */
export function checkLockedChanges(oldFields: CustomFormField[], newFields: CustomFormField[]): string | null {
  const next = new Map(newFields.map((f) => [f.id, f]));
  for (const old of oldFields) {
    if (!isQuestion(old)) continue;
    const now = next.get(old.id);
    if (!now) return `Câu “${old.label}” đã có câu trả lời nên không xoá được — bấm “Ẩn” để bỏ khỏi form.`;
    if (now.type !== old.type) return `Câu “${old.label}” đã có câu trả lời nên không đổi được loại trường.`;
    if (CHOICE_TYPES.has(old.type)) {
      const kept = new Set(now.options);
      const dropped = old.options.find((o) => !kept.has(o));
      if (dropped !== undefined) return `Câu “${old.label}” đã có câu trả lời nên không bỏ hay sửa được lựa chọn “${dropped}” — chỉ thêm lựa chọn mới.`;
    }
  }
  return null;
}

export type CustomFormAvailability = "open" | "draft" | "not_open" | "closed";

export function formAvailability(form: { status: string; opensAt: string | null; closesAt: string | null }, nowMs: number): CustomFormAvailability {
  if (form.status === "draft") return "draft";
  if (form.status !== "published") return "closed";
  if (form.opensAt && nowMs < Date.parse(form.opensAt)) return "not_open";
  if (form.closesAt && nowMs >= Date.parse(form.closesAt)) return "closed";
  return "open";
}

function normalizePhone(raw: string): string {
  let digits = raw.replace(/[\s.\-()]/g, "");
  if (digits.startsWith("+84")) digits = `0${digits.slice(3)}`;
  else if (/^84\d{9}$/.test(digits)) digits = `0${digits.slice(2)}`;
  return digits;
}

function requiredMessage(field: CustomFormField): string {
  if (field.type === "multi_choice") return "Vui lòng chọn ít nhất một lựa chọn.";
  if (field.type === "single_choice" || field.type === "dropdown") return "Vui lòng chọn một lựa chọn.";
  return "Vui lòng điền mục này.";
}

/** Một câu trả lời → giá trị đã chuẩn hoá, hoặc lỗi. Rỗng trả `null` (để bên gọi xử lý bắt buộc/tùy chọn). */
function normalizeAnswer(field: CustomFormField, values: string[]): { value: CustomFormAnswerValue | null } | { error: string } {
  if (field.type === "multi_choice") {
    const picked = Array.from(new Set(values.map(text).filter(Boolean)));
    if (!picked.length) return { value: null };
    const allowed = new Set(field.options);
    if (picked.some((v) => !allowed.has(v))) return { error: "Lựa chọn không hợp lệ — tải lại trang rồi chọn lại." };
    return { value: field.options.filter((o) => picked.includes(o)) };
  }
  const raw = String(values.find((v) => text(v)) ?? "");
  const value = field.type === "long_text" ? raw.replace(/\r\n/g, "\n").trim() : text(raw).replace(/[\r\n]+/g, " ");
  if (!value) return { value: null };
  switch (field.type) {
    case "short_text":
      return value.length > CUSTOM_FORM_LIMITS.shortText ? { error: `Tối đa ${CUSTOM_FORM_LIMITS.shortText} ký tự.` } : { value };
    case "long_text":
      return value.length > CUSTOM_FORM_LIMITS.longText ? { error: `Tối đa ${CUSTOM_FORM_LIMITS.longText} ký tự.` } : { value };
    case "email": {
      const email = normalizeEmail(value);
      return isValidEmail(email) ? { value: email } : { error: "Email chưa đúng định dạng, ví dụ ten@gmail.com." };
    }
    case "phone": {
      const phone = normalizePhone(value);
      return /^0\d{9}$/.test(phone) ? { value: phone } : { error: "Số điện thoại cần đúng 10 chữ số, bắt đầu bằng 0." };
    }
    case "student_id": {
      const id = value.replace(/\s/g, "");
      return /^\d{8,12}$/.test(id) ? { value: id } : { error: "MSSV chỉ gồm chữ số, dài 8–12 ký tự." };
    }
    case "citizen_id": {
      const id = value.replace(/\s/g, "");
      return /^\d{12}$/.test(id) ? { value: id } : { error: "Số CCCD cần đúng 12 chữ số." };
    }
    case "date": {
      const iso = parseVietnamDateInput(value);
      return iso ? { value: toVietnamDateInput(iso) } : { error: "Ngày cần đúng dạng DD/MM/YYYY và là ngày có thật, ví dụ 05/09/2004." };
    }
    case "number":
      return value.length <= CUSTOM_FORM_LIMITS.number && /^-?\d+([.,]\d+)?$/.test(value) ? { value } : { error: "Vui lòng nhập một con số." };
    case "url": {
      if (value.length > CUSTOM_FORM_LIMITS.url) return { error: `Link tối đa ${CUSTOM_FORM_LIMITS.url} ký tự.` };
      try {
        const url = new URL(value);
        if (url.protocol === "http:" || url.protocol === "https:") return { value };
      } catch {
        // rơi xuống báo lỗi
      }
      return { error: "Link cần bắt đầu bằng http:// hoặc https://." };
    }
    case "single_choice":
    case "dropdown":
      return field.options.includes(value) ? { value } : { error: "Lựa chọn không hợp lệ — tải lại trang rồi chọn lại." };
    default:
      return { value: null };
  }
}

export type AnswerValidation = { ok: boolean; answers: CustomFormAnswers; errors: Record<string, string> };

/**
 * Kiểm toàn bộ câu trả lời theo định nghĩa trường. `read(fieldId)` trả các giá trị gửi lên cho
 * trường đó (FormData.getAll ở máy chủ, trạng thái ô nhập ở trình duyệt). Trường ẩn và khối tiêu
 * đề không nhận dữ liệu; mã trường lạ không được đọc tới.
 */
export function validateAnswers(fields: CustomFormField[], read: (fieldId: string) => string[]): AnswerValidation {
  const answers: CustomFormAnswers = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!isQuestion(field) || field.hidden) continue;
    const result = normalizeAnswer(field, read(field.id) ?? []);
    if ("error" in result) {
      errors[field.id] = result.error;
      continue;
    }
    if (result.value === null) {
      if (field.required) errors[field.id] = requiredMessage(field);
      continue;
    }
    answers[field.id] = result.value;
  }
  return { ok: Object.keys(errors).length === 0, answers, errors };
}

/** Khoá chặn gửi trùng: email (đã chuẩn hoá) của trường Email dùng để chặn, khi form bật tùy chọn này. */
export function dedupeKeyFor(fields: CustomFormField[], answers: CustomFormAnswers, onePerEmail: boolean): string | null {
  if (!onePerEmail) return null;
  const field = dedupeEmailField(fields);
  const value = field ? answers[field.id] : undefined;
  return typeof value === "string" && value ? value : null;
}

/** Một câu trả lời thành chữ để hiện trong bảng / CSV. */
export function answerText(value: CustomFormAnswerValue | undefined | null): string {
  if (Array.isArray(value)) return value.join("; ");
  return value ? String(value) : "";
}

/** Các cột của bảng câu trả lời: mọi câu hỏi, kể cả câu đã ẩn (dữ liệu cũ vẫn phải xem được). */
export function responseColumns(fields: CustomFormField[]): Array<{ id: string; label: string }> {
  return fields.filter(isQuestion).map((f) => ({ id: f.id, label: f.hidden ? `${f.label} (đã ẩn)` : f.label }));
}

/** Trường mặc định của một form mới: đủ để bật "Mỗi email chỉ gửi một lần" ngay. */
export function defaultFields(random: () => number = Math.random): CustomFormField[] {
  const base = { help: "", hidden: false, options: [] as string[] };
  return [
    { ...base, id: newFieldId(random), type: "short_text", label: "Họ và tên", required: true },
    { ...base, id: newFieldId(random), type: "email", label: "Email", required: true },
    { ...base, id: newFieldId(random), type: "phone", label: "Số điện thoại", required: true }
  ];
}
