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
  "file_link",
  "single_choice",
  "multi_choice",
  "dropdown",
  "yes_no",
  "section",
  "page_break"
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
  file_link: "Tải file (gửi link)",
  single_choice: "Chọn một",
  multi_choice: "Chọn nhiều",
  dropdown: "Danh sách thả xuống",
  yes_no: "Có / Không (rẽ nhánh được)",
  section: "Tiêu đề / đoạn giới thiệu",
  page_break: "Ngắt trang"
};

/**
 * Ô "tải file" không nhận file (BTC 15/10/2026): form giữ nhẹ, CRM không phải lưu và quét file lạ.
 * Người điền tải file lên kho của họ, bật chia sẻ công khai, rồi dán link — câu này dạy đúng việc đó.
 */
export const FILE_LINK_HINT =
  "Tải file lên Google Drive (hoặc OneDrive, Dropbox), bật chia sẻ “Bất kỳ ai có đường liên kết đều xem được”, rồi dán link vào đây.";

/** Gợi ý định dạng hiện dưới ô nhập, để người điền biết luật trước khi bị báo lỗi. */
export const FIELD_FORMAT_HINTS: Partial<Record<CustomFormFieldType, string>> = {
  phone: "10 chữ số, ví dụ 0912345678",
  student_id: "Chỉ gồm chữ số, 8–12 ký tự",
  citizen_id: "Đúng 12 chữ số",
  date: "Định dạng DD/MM/YYYY, ví dụ 05/09/2004",
  url: "Bắt đầu bằng http:// hoặc https://",
  file_link: FILE_LINK_HINT
};

export const CHOICE_TYPES: ReadonlySet<CustomFormFieldType> = new Set<CustomFormFieldType>(["single_choice", "multi_choice", "dropdown"]);

/** Câu Có/Không (VAM00009 mục 4.3): hai lựa chọn cố định, chỉ đích đến là do người tạo form chọn. */
export const YES_NO_OPTIONS = ["Có", "Không"] as const;
/** Đích "kết thúc form": người điền tới thẳng ô đồng ý và nút Gửi. */
export const BRANCH_END = "__end";

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
  number: 30,
  autoReplySubject: 200,
  autoReplyBody: 5000
} as const;

/**
 * Trần thư tự động của MỘT form trong 24 giờ, và phần chừa lại dưới trần chung (DAILY_EMAIL_LIMIT).
 * Ai cũng gõ được email bất kỳ vào form công khai: không có trần riêng thì một người gửi form liên
 * tục với email khác nhau sẽ đốt hết hạn mức của cả hệ thống (thư mời, xác nhận lịch…).
 */
export const AUTO_REPLY_DAILY_CAP_PER_FORM = 300;
export const AUTO_REPLY_SYSTEM_HEADROOM = 40;

export const CUSTOM_FORM_STATUSES = ["draft", "published", "closed"] as const;
export type CustomFormStatus = (typeof CUSTOM_FORM_STATUSES)[number];
export const CUSTOM_FORM_STATUS_LABELS: Record<CustomFormStatus, string> = {
  draft: "Nháp",
  published: "Đang công khai",
  closed: "Đã đóng"
};

export const CUSTOM_FORMS_PATH = "/forms";
export const CUSTOM_FORM_PUBLIC_PREFIX = "/f";

/**
 * Câu đồng ý luôn có ở cuối mọi form: form có thể thu CCCD, ngày sinh, số điện thoại.
 * Mọi form /f/… đọc câu này lúc hiển thị (không lưu riêng theo form), nên đổi ở đây là
 * đổi cho mọi form, cả form đã tạo. Người điền biết chương trình là "UEH Mentoring"
 * (người dùng yêu cầu 24/10/2026), không phải tên tổ chức đứng sau.
 */
export const CUSTOM_FORM_CONSENT_TEXT =
  "Tôi đồng ý để UEH Mentoring thu thập và xử lý các thông tin trên cho mục đích tuyển chọn và tổ chức chương trình này.";

export type CustomFormField = {
  id: string;
  type: CustomFormFieldType;
  label: string;
  help: string;
  required: boolean;
  /** Ẩn khỏi form công khai nhưng giữ dữ liệu cũ — cách "xoá" một trường đã có câu trả lời. */
  hidden: boolean;
  options: string[];
  /**
   * Chỉ có ở câu Có/Không. Đích là mã của một "Ngắt trang" nằm SAU câu này, BRANCH_END, hoặc rỗng = trang
   * kế tiếp như thường. Chỉ cho nhảy tới, không cho nhảy lùi: nhờ vậy không thể có vòng lặp trang.
   */
  branches?: { yes: string; no: string };
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

/** Khối tiêu đề và ngắt trang chỉ để trình bày, không nhận câu trả lời. */
export function isQuestion(field: Pick<CustomFormField, "type">): boolean {
  return field.type !== "section" && field.type !== "page_break";
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
    // Ngắt trang được để trống tiêu đề (trang sau không có tên riêng).
    if (!label && type !== "page_break") return { ok: false, error: `${fieldName(draft, i)}: chưa có nội dung câu hỏi / tiêu đề.` };
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
    let branches: { yes: string; no: string } | undefined;
    if (type === "yes_no") {
      options = [...YES_NO_OPTIONS];
      const raw = (item.branches ?? {}) as Record<string, unknown>;
      branches = { yes: text(raw.yes), no: text(raw.no) };
      if (![branches.yes, branches.no].every((t) => !t || t === BRANCH_END || FIELD_ID.test(t))) {
        return { ok: false, error: `${fieldName(draft, i)}: đích rẽ nhánh không hợp lệ.` };
      }
    }
    fields.push({
      id,
      type,
      label,
      help,
      required: isQuestion({ type }) ? item.required === true : false,
      hidden: item.hidden === true,
      options,
      ...(branches ? { branches } : {})
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
  autoReply?: unknown;
  autoReplySubject?: unknown;
  autoReplyBody?: unknown;
  /** ISO đã đọc theo giờ Việt Nam (parseVietnamDateTime), hoặc null. */
  opensAt: string | null;
  closesAt: string | null;
  /** Sự kiện liên kết (VAM00008) — mã sự kiện, hoặc rỗng. */
  eventId?: unknown;
  /** Giới hạn số đăng ký riêng của form — số nguyên dương, hoặc rỗng. */
  registrationLimit?: unknown;
  /** VAM00009 mục 4.2: chỉ nhận người đã có trên hệ thống. */
  requireKnownPerson?: unknown;
  /** VAM00009 mục 4.1: màu chủ đạo dạng #rrggbb, hoặc rỗng = màu mặc định. */
  themeColor?: unknown;
};

export const REGISTRATION_LIMIT_MAX = 100000;

export type CustomFormSettings = {
  title: string;
  description: string;
  programId: string | null;
  thankYou: string;
  onePerEmail: boolean;
  /** Thư tự động gửi người điền ngay sau khi gửi form (BTC 15/10/2026). */
  autoReply: boolean;
  autoReplySubject: string;
  autoReplyBody: string;
  opensAt: string | null;
  closesAt: string | null;
  eventId: string | null;
  registrationLimit: number | null;
  requireKnownPerson: boolean;
  themeColor: string | null;
};

const truthy = (value: unknown) => value === true || value === "on" || value === "true";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THEME_COLOR = /^#[0-9a-f]{6}$/;

/** Chữ trên nền màu chủ đạo: trắng hay đen, tuỳ nền nào đọc được. Màu do người tạo form chọn tự do. */
export function themeTextColor(color: string): "#ffffff" | "#111827" {
  const channel = (start: number) => parseInt(color.slice(start, start + 2), 16) / 255;
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.55 ? "#111827" : "#ffffff";
}

export function parseFormSettings(input: CustomFormSettingsInput): { ok: true; settings: CustomFormSettings } | { ok: false; error: string } {
  const title = text(input.title);
  const description = String(input.description ?? "").replace(/\r\n/g, "\n").trim();
  const thankYou = String(input.thankYou ?? "").replace(/\r\n/g, "\n").trim();
  const programRaw = text(input.programId);
  const autoReplySubject = text(input.autoReplySubject).replace(/[\r\n]+/g, " ");
  const autoReplyBody = String(input.autoReplyBody ?? "").replace(/\r\n/g, "\n").trim();
  if (!title) return { ok: false, error: "Form cần có tiêu đề." };
  if (title.length > CUSTOM_FORM_LIMITS.title) return { ok: false, error: `Tiêu đề tối đa ${CUSTOM_FORM_LIMITS.title} ký tự.` };
  if (description.length > CUSTOM_FORM_LIMITS.description) return { ok: false, error: `Phần giới thiệu tối đa ${CUSTOM_FORM_LIMITS.description} ký tự.` };
  if (thankYou.length > CUSTOM_FORM_LIMITS.thankYou) return { ok: false, error: `Lời cảm ơn tối đa ${CUSTOM_FORM_LIMITS.thankYou} ký tự.` };
  if (programRaw && !UUID.test(programRaw)) return { ok: false, error: "Chương trình không hợp lệ." };
  if (autoReplySubject.length > CUSTOM_FORM_LIMITS.autoReplySubject) return { ok: false, error: `Tiêu đề thư tự động tối đa ${CUSTOM_FORM_LIMITS.autoReplySubject} ký tự.` };
  if (autoReplyBody.length > CUSTOM_FORM_LIMITS.autoReplyBody) return { ok: false, error: `Nội dung thư tự động tối đa ${CUSTOM_FORM_LIMITS.autoReplyBody} ký tự.` };
  if (input.opensAt && input.closesAt && Date.parse(input.closesAt) <= Date.parse(input.opensAt)) {
    return { ok: false, error: "Giờ đóng phải sau giờ mở." };
  }
  const eventRaw = text(input.eventId);
  if (eventRaw && !UUID.test(eventRaw)) return { ok: false, error: "Sự kiện liên kết không hợp lệ." };
  const limitRaw = text(input.registrationLimit);
  const registrationLimit = limitRaw ? Number(limitRaw) : null;
  if (registrationLimit !== null && (!Number.isInteger(registrationLimit) || registrationLimit < 1 || registrationLimit > REGISTRATION_LIMIT_MAX)) {
    return { ok: false, error: `Giới hạn số đăng ký phải là số nguyên từ 1 đến ${REGISTRATION_LIMIT_MAX}, hoặc để trống.` };
  }
  const themeRaw = text(input.themeColor).toLowerCase();
  if (themeRaw && !THEME_COLOR.test(themeRaw)) return { ok: false, error: "Màu chủ đạo không hợp lệ." };
  return {
    ok: true,
    settings: {
      title,
      description,
      programId: programRaw || null,
      thankYou,
      onePerEmail: truthy(input.onePerEmail),
      autoReply: truthy(input.autoReply),
      autoReplySubject,
      autoReplyBody,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      eventId: eventRaw || null,
      registrationLimit,
      requireKnownPerson: truthy(input.requireKnownPerson),
      themeColor: themeRaw || null
    }
  };
}

/** Trường Email dùng để chặn gửi trùng: trường Email đầu tiên đang hiện và bắt buộc. */
export function dedupeEmailField(fields: CustomFormField[]): CustomFormField | null {
  return fields.find((f) => f.type === "email" && f.required && !f.hidden) ?? null;
}

const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
/** Nhãn bỏ dấu, chữ thường — để nhận ra ô "Họ và tên" dù người tạo form gõ thế nào. */
function foldLabel(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").replace(/[đĐ]/g, "d").toLowerCase().trim().split(/\s+/).join(" ");
}
const NAME_LABEL = /(^|\s)ten(\s|$)|full name|^name$/;

/** Ô họ tên: ô chữ ngắn đầu tiên có nhãn "Họ và tên"/"Họ tên"/"Tên"; không có thì ô chữ ngắn đầu tiên. */
export function nameField(fields: CustomFormField[]): CustomFormField | null {
  const shortTexts = fields.filter((f) => f.type === "short_text");
  return shortTexts.find((f) => NAME_LABEL.test(foldLabel(f.label))) ?? shortTexts[0] ?? null;
}

/** Ô họ tên dùng để xác thực: phải là ô đang hiện và bắt buộc, nếu không người điền bỏ trống là khỏi đối chiếu. */
export function requiredNameField(fields: CustomFormField[]): CustomFormField | null {
  const field = nameField(fields.filter((f) => !f.hidden));
  return field?.required ? field : null;
}

/** Thư tự động gửi tới đâu: cùng trường Email với luật chặn trùng — Email bắt buộc đầu tiên đang hiện. */
export const replyEmailField = dedupeEmailField;

/** Luật giữa cài đặt và danh sách trường. null = hợp lệ. */
export function checkDefinitionRules(
  fields: CustomFormField[],
  settings: Pick<CustomFormSettings, "onePerEmail"> & Partial<Pick<CustomFormSettings, "autoReply" | "autoReplyBody" | "eventId" | "requireKnownPerson">>
): string | null {
  const branchError = checkBranches(fields);
  if (branchError) return branchError;
  // Xác thực người điền cần email + họ tên để đối chiếu: thiếu một trong hai thì không bao giờ qua được cổng.
  if (settings.requireKnownPerson) {
    if (!dedupeEmailField(fields)) return "Đang bật chặn người chưa có trên hệ thống nên form cần một trường Email bắt buộc (không ẩn).";
    if (!requiredNameField(fields)) return "Đang bật chặn người chưa có trên hệ thống nên form cần một ô “Họ và tên” bắt buộc (không ẩn).";
  }
  // Email và họ tên dùng cho chặn trùng, thư tự động, sự kiện, xác thực phải luôn được hỏi: nằm sau một
  // câu rẽ nhánh thì người điền có thể bị đưa qua trang đó, và những việc trên mất dữ liệu.
  const firstBranch = firstBranchPage(fields);
  if (firstBranch !== null) {
    const pages = splitPages(fields);
    const askedAlways = (field: CustomFormField | null) => !field || pages.findIndex((p) => p.fields.some((f) => f.id === field.id)) <= firstBranch;
    if ((settings.onePerEmail || settings.autoReply || settings.eventId || settings.requireKnownPerson) && !askedAlways(dedupeEmailField(fields))) {
      return "Form có rẽ nhánh: trường Email phải nằm trước hoặc cùng trang với câu rẽ nhánh đầu tiên, để ai cũng được hỏi.";
    }
    if ((settings.eventId || settings.requireKnownPerson) && !askedAlways(nameField(fields))) {
      return "Form có rẽ nhánh: ô “Họ và tên” phải nằm trước hoặc cùng trang với câu rẽ nhánh đầu tiên, để ai cũng được hỏi.";
    }
  }
  // Form gắn sự kiện ghi người điền vào danh sách người tham gia: cần đúng ba thứ danh sách đó cần —
  // một Email bắt buộc (khoá chặn trùng của sự kiện), một ô Họ tên, và "mỗi email một lần" để lần gửi
  // lại đi vào luật trùng của VAM00008 thay vì thành một đăng ký thứ hai.
  if (settings.eventId) {
    if (!dedupeEmailField(fields)) return "Form gắn sự kiện cần một trường Email bắt buộc (không ẩn) — đó là email đăng ký sự kiện.";
    if (!nameField(fields)) return "Form gắn sự kiện cần một ô chữ ngắn “Họ và tên”.";
    if (!settings.onePerEmail) return "Form gắn sự kiện phải bật “Mỗi email chỉ gửi một lần” — gửi lại sẽ cập nhật đăng ký cũ.";
  }
  if (settings.onePerEmail && !dedupeEmailField(fields)) {
    return "Đang bật “Mỗi email chỉ gửi một lần” nên form cần một trường Email bắt buộc (không ẩn).";
  }
  if (settings.autoReply) {
    if (!replyEmailField(fields)) return "Đang bật thư tự động nên form cần một trường Email bắt buộc (không ẩn) — thư gửi tới email người điền nhập ở đó.";
    if (!String(settings.autoReplyBody ?? "").trim()) return "Đang bật thư tự động nhưng chưa có nội dung thư.";
  }
  return null;
}

/** id = mã "Ngắt trang" mở đầu trang (đích rẽ nhánh trỏ vào mã này); trang đầu không có ngắt trang nên rỗng. */
export type CustomFormPage = { id: string; title: string; help: string; fields: CustomFormField[] };

/**
 * Chia form thành từng trang tại các “Ngắt trang” đang hiện (BTC 15/10/2026). Tiêu đề và mô tả của
 * một ngắt trang là của trang SAU nó. Ngắt trang ở đầu/cuối hay hai ngắt liền nhau không sinh trang
 * rỗng — người điền không bao giờ phải bấm “Tiếp” qua một trang trống. Form không có ngắt trang là
 * một trang.
 */
export function splitPages(fields: CustomFormField[]): CustomFormPage[] {
  const pages: CustomFormPage[] = [];
  let current: CustomFormPage = { id: "", title: "", help: "", fields: [] };
  for (const field of fields) {
    if (field.hidden) continue;
    if (field.type === "page_break") {
      if (current.fields.length) pages.push(current);
      current = { id: field.id, title: field.label, help: field.help, fields: [] };
      continue;
    }
    current.fields.push(field);
  }
  if (current.fields.length || !pages.length) pages.push(current);
  return pages;
}

const branchTargets = (field: CustomFormField) => [field.branches?.yes ?? "", field.branches?.no ?? ""].filter(Boolean);
const isBranching = (field: CustomFormField) => field.type === "yes_no" && !field.hidden && branchTargets(field).length > 0;

/** Form có câu Có/Không nào thật sự rẽ nhánh không. */
export function hasBranching(fields: CustomFormField[]): boolean {
  return fields.some(isBranching);
}

/** Trang của câu rẽ nhánh đầu tiên; null = form không rẽ nhánh. */
function firstBranchPage(fields: CustomFormField[]): number | null {
  const index = splitPages(fields).findIndex((p) => p.fields.some(isBranching));
  return index >= 0 ? index : null;
}

/** Đích nào cũng phải là một trang có thật, đang hiện và nằm SAU câu hỏi. null = hợp lệ. */
function checkBranches(fields: CustomFormField[]): string | null {
  const pages = splitPages(fields);
  for (let index = 0; index < pages.length; index += 1) {
    for (const field of pages[index].fields.filter(isBranching)) {
      for (const target of branchTargets(field)) {
        if (target === BRANCH_END) continue;
        if (pages.findIndex((p) => p.id === target) <= index) {
          return `Câu “${field.label.slice(0, 60)}”: trang đích không còn trên form hoặc không nằm sau câu này — chọn lại đích đến.`;
        }
      }
    }
  }
  return null;
}

/**
 * Trang kế tiếp sau trang `index` theo câu trả lời; null = đây là trang cuối của lượt điền này (hiện ô
 * đồng ý và nút Gửi). Một trang có nhiều câu rẽ nhánh thì câu đứng sau quyết định. Chưa trả lời hay đích
 * rỗng thì đi trang kế tiếp như thường.
 */
export function nextPageIndex(pages: CustomFormPage[], index: number, answerOf: (fieldId: string) => string | undefined): number | null {
  let target = "";
  for (const field of pages[index]?.fields ?? []) {
    if (field.type !== "yes_no" || !field.branches) continue;
    const answer = answerOf(field.id);
    const chosen = answer === YES_NO_OPTIONS[0] ? field.branches.yes : answer === YES_NO_OPTIONS[1] ? field.branches.no : "";
    if (chosen) target = chosen;
  }
  if (target === BRANCH_END) return null;
  const jump = target ? pages.findIndex((p) => p.id === target) : -1;
  if (jump > index) return jump;
  return index + 1 < pages.length ? index + 1 : null;
}

/** Các trang người điền đi qua, theo thứ tự. Luôn tiến tới nên vòng lặp chắc chắn dừng. */
export function visitedPages(pages: CustomFormPage[], answerOf: (fieldId: string) => string | undefined): number[] {
  const path = [0];
  for (let next = nextPageIndex(pages, 0, answerOf); next !== null; next = nextPageIndex(pages, next, answerOf)) path.push(next);
  return path;
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
  if (field.type === "single_choice" || field.type === "dropdown" || field.type === "yes_no") return "Vui lòng chọn một lựa chọn.";
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
    case "url":
    case "file_link": {
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
    case "yes_no":
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

/**
 * Kiểm câu trả lời theo đúng đường người điền đi qua: câu ở trang bị rẽ nhánh bỏ qua không bắt buộc, và
 * câu trả lời còn sót ở trang đó (điền rồi quay lại đổi Có/Không) không được ghi. Hai bên trình duyệt và
 * máy chủ cùng dùng hàm này, nên trình duyệt không thể chỉ định đường đi khác với câu trả lời đã gửi.
 */
export function validateFormAnswers(fields: CustomFormField[], read: (fieldId: string) => string[]): AnswerValidation {
  const pages = splitPages(fields);
  const path = visitedPages(pages, (id) => read(id)?.[0]);
  return validateAnswers(path.flatMap((index) => pages[index].fields), read);
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

// ---------------------------------------------------------------------------
// Lưu nháp khi đang điền (BTC 15/10/2026) — trên máy của người điền, không qua máy chủ.
//
// Nháp nằm trong bộ nhớ trình duyệt (localStorage), theo từng form. Không qua máy chủ: chưa tích đồng
// ý thì CRM chưa giữ CCCD, ngày sinh… của ai. Đổi lại, nháp chỉ mở lại được trên đúng máy và trình
// duyệt đó. Ô đồng ý và ô bẫy không bao giờ được lưu. Nội dung đọc từ bộ nhớ là thứ ai cũng sửa được,
// nên đọc lại phải lọc như đọc câu trả lời: chỉ giữ trường còn trên form, đúng kiểu, lựa chọn còn có.
// ---------------------------------------------------------------------------

export const CUSTOM_FORM_DRAFT_TTL_MS = 14 * 24 * 60 * 60_000;
const DRAFT_VERSION = 1;
const DRAFT_TEXT_MAX = CUSTOM_FORM_LIMITS.longText;

export type CustomFormDraft = { values: CustomFormAnswers; page: number; savedAt: number };

export function customFormDraftKey(code: string, preview = false): string {
  return `vam-form-nhap:${code}${preview ? ":xem-thu" : ""}`;
}

const isFilled = (value: CustomFormAnswerValue | undefined) => (Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim()));

export function hasDraftContent(values: Record<string, CustomFormAnswerValue>): boolean {
  return Object.values(values).some(isFilled);
}

/** Chuỗi để ghi vào bộ nhớ trình duyệt — chỉ các ô đã điền. */
export function serializeDraft(values: Record<string, CustomFormAnswerValue>, page: number, nowMs: number): string {
  const kept = Object.fromEntries(Object.entries(values).filter(([, value]) => isFilled(value)));
  return JSON.stringify({ v: DRAFT_VERSION, savedAt: nowMs, page: Math.max(0, Math.trunc(page) || 0), values: kept });
}

/**
 * Đọc lại nháp. null = không có, hỏng, quá hạn, hay không còn câu nào khớp form hiện tại (BTC sửa form
 * sau khi người điền lưu nháp: câu đã xoá bị bỏ, lựa chọn đã bỏ bị bỏ, phần còn lại vẫn mở lại được).
 */
export function parseDraft(fields: CustomFormField[], raw: string | null, nowMs: number): CustomFormDraft | null {
  if (!raw) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.v !== DRAFT_VERSION) return null;
  const savedAt = Number(data.savedAt);
  if (!Number.isFinite(savedAt) || savedAt > nowMs + 60_000 || nowMs - savedAt > CUSTOM_FORM_DRAFT_TTL_MS) return null;
  const stored = data.values && typeof data.values === "object" && !Array.isArray(data.values) ? (data.values as Record<string, unknown>) : {};
  const values: CustomFormAnswers = {};
  for (const field of fields) {
    if (!isQuestion(field) || field.hidden || !Object.prototype.hasOwnProperty.call(stored, field.id)) continue;
    const value = stored[field.id];
    if (field.type === "multi_choice") {
      if (!Array.isArray(value)) continue;
      const picked = field.options.filter((o) => value.includes(o));
      if (picked.length) values[field.id] = picked;
    } else if (typeof value === "string" && value.trim()) {
      if ((CHOICE_TYPES.has(field.type) || field.type === "yes_no") && !field.options.includes(value)) continue;
      values[field.id] = value.slice(0, DRAFT_TEXT_MAX);
    }
  }
  if (!Object.keys(values).length) return null;
  return { values, page: Math.max(0, Math.trunc(Number(data.page)) || 0), savedAt };
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
