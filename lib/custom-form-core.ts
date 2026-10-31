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

/** Câu chọn một đáp án thì mỗi lựa chọn có thể mang đích riêng; câu chọn nhiều thì không, vì nhiều đáp án là nhiều đích. */
export const BRANCHING_CHOICE_TYPES: ReadonlySet<CustomFormFieldType> = new Set<CustomFormFieldType>(["single_choice", "dropdown"]);

/** Câu Có/Không (VAM00009 mục 4.3): hai lựa chọn cố định, chỉ đích đến là do người tạo form chọn. */
export const YES_NO_OPTIONS = ["Có", "Không"] as const;
/** Đích "kết thúc form": người điền tới thẳng ô đồng ý và nút Gửi. */
export const BRANCH_END = "__end";

/** Banner và logo riêng từng form (VAM00009 mục 4.1): kho riêng, đường dẫn <mã form>/<loại>-<uuid>. */
export const CUSTOM_FORM_IMAGE_BUCKET = "form-anh";
export const CUSTOM_FORM_IMAGE_KINDS = ["banner", "logo"] as const;
export type CustomFormImageKind = (typeof CUSTOM_FORM_IMAGE_KINDS)[number];
export const LOGO_POSITIONS = ["left", "center", "right"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];
export const LOGO_POSITION_LABELS: Record<LogoPosition, string> = { left: "Bên trái", center: "Ở giữa", right: "Bên phải" };

export function newFormImagePath(formId: string, kind: CustomFormImageKind, uuid: string): string {
  return `${formId}/${kind}-${uuid}`;
}

/** Đường dẫn có đúng là ảnh của form này không. Cái trình duyệt gửi lên là thứ người gửi tự đặt được. */
export function isFormImagePath(formId: string, path: unknown, kind?: CustomFormImageKind): path is string {
  const value = String(path ?? "");
  if (!value.startsWith(`${formId}/`)) return false;
  const match = /^(banner|logo)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(value.slice(formId.length + 1));
  return Boolean(match) && (!kind || match?.[1] === kind);
}

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
  /**
   * Chỉ có ở câu chọn một / thả xuống: lựa chọn → đích, cùng luật đích với `branches`. Câu Có/Không giữ
   * `branches` đúng dạng cũ thay vì đổi sang đây: dữ liệu đã lưu không phải viết lại, và bản mã cũ vẫn đọc
   * được nếu phải quay lui. Mọi nơi đọc đích đi qua `optionTargetsOf`, nên hai dạng không rẽ thành hai luật.
   */
  optionTargets?: Record<string, string>;
  /** Chỉ có ở ngắt trang: đích mặc định khi xong trang mở đầu bằng ngắt trang này. Rỗng = trang kế tiếp. */
  nextPage?: string;
};

export type CustomFormAnswerValue = string | string[];
export type CustomFormAnswers = Record<string, CustomFormAnswerValue>;

const FIELD_ID = /^f_[a-z0-9]{6,16}$/;
const isTargetValue = (target: string) => !target || target === BRANCH_END || FIELD_ID.test(target);
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
    let optionTargets: Record<string, string> | undefined;
    if (BRANCHING_CHOICE_TYPES.has(type) && item.optionTargets !== undefined && item.optionTargets !== null) {
      const raw = item.optionTargets;
      if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${fieldName(draft, i)}: đích rẽ nhánh không hợp lệ.` };
      // Duyệt theo lựa chọn hiện có: đích của lựa chọn đã bỏ tự rơi, và khoá lạ gửi lên không lọt vào định nghĩa.
      const kept = options.flatMap((option): Array<[string, string]> => (Object.prototype.hasOwnProperty.call(raw, option) ? [[option, text((raw as Record<string, unknown>)[option])]] : []));
      if (!kept.every(([, target]) => isTargetValue(target))) return { ok: false, error: `${fieldName(draft, i)}: đích rẽ nhánh không hợp lệ.` };
      const set = kept.filter(([, target]) => target);
      if (set.length) optionTargets = Object.fromEntries(set);
    }
    const nextPage = type === "page_break" ? text(item.nextPage) : "";
    if (!isTargetValue(nextPage)) return { ok: false, error: `${fieldName(draft, i)}: đích của trang không hợp lệ.` };
    fields.push({
      id,
      type,
      label,
      help,
      required: isQuestion({ type }) ? item.required === true : false,
      hidden: item.hidden === true,
      options,
      ...(branches ? { branches } : {}),
      ...(optionTargets ? { optionTargets } : {}),
      ...(nextPage ? { nextPage } : {})
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
  /** VAM00009 mục 4.1: vị trí logo. */
  logoPosition?: unknown;
  /** VAM00011: tự động gửi câu trả lời cho mentor đang ghép cặp. */
  mentorForward?: unknown;
  mentorForwardSubject?: unknown;
  mentorForwardBody?: unknown;
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
  logoPosition: LogoPosition;
  /** Gửi câu trả lời cho mentor đang ghép cặp (VAM00011). Mặc định tắt. */
  mentorForward: boolean;
  mentorForwardSubject: string;
  mentorForwardBody: string;
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
  const mentorForwardSubject = text(input.mentorForwardSubject).replace(/[\r\n]+/g, " ");
  const mentorForwardBody = String(input.mentorForwardBody ?? "").replace(/\r\n/g, "\n").trim();
  if (mentorForwardSubject.length > CUSTOM_FORM_LIMITS.autoReplySubject) return { ok: false, error: `Tiêu đề thư gửi mentor tối đa ${CUSTOM_FORM_LIMITS.autoReplySubject} ký tự.` };
  if (mentorForwardBody.length > CUSTOM_FORM_LIMITS.autoReplyBody) return { ok: false, error: `Nội dung thư gửi mentor tối đa ${CUSTOM_FORM_LIMITS.autoReplyBody} ký tự.` };
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
  const logoRaw = text(input.logoPosition) || "left";
  if (!(LOGO_POSITIONS as readonly string[]).includes(logoRaw)) return { ok: false, error: "Vị trí logo không hợp lệ." };
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
      themeColor: themeRaw || null,
      logoPosition: logoRaw as LogoPosition,
      mentorForward: truthy(input.mentorForward),
      mentorForwardSubject,
      mentorForwardBody
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
  settings: Pick<CustomFormSettings, "onePerEmail"> & Partial<Pick<CustomFormSettings, "autoReply" | "autoReplyBody" | "eventId" | "requireKnownPerson" | "mentorForward" | "mentorForwardBody">>
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
    if ((settings.onePerEmail || settings.autoReply || settings.eventId || settings.requireKnownPerson || settings.mentorForward) && !askedAlways(dedupeEmailField(fields))) {
      return "Form có rẽ nhánh: trường Email phải nằm trước hoặc cùng trang với chỗ rẽ nhánh đầu tiên (câu rẽ nhánh, hoặc trang có đặt “Trang tiếp theo”), để ai cũng được hỏi.";
    }
    if ((settings.eventId || settings.requireKnownPerson) && !askedAlways(nameField(fields))) {
      return "Form có rẽ nhánh: ô “Họ và tên” phải nằm trước hoặc cùng trang với chỗ rẽ nhánh đầu tiên (câu rẽ nhánh, hoặc trang có đặt “Trang tiếp theo”), để ai cũng được hỏi.";
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
  if (settings.mentorForward) {
    // Form gắn sự kiện đi đường ghi riêng, và gửi lại thì SỬA câu trả lời cũ: bản mentor đã nhận sẽ lệch với
    // bản đang lưu. Chặn bật cùng lúc đơn giản và rõ hơn là dựng thêm luật gửi lại.
    if (settings.eventId) return "Form gắn sự kiện chưa dùng được “Tự động gửi Submission cho Mentor”: bỏ sự kiện liên kết hoặc tắt tùy chọn này.";
    if (!dedupeEmailField(fields)) return "Đang bật “Tự động gửi Submission cho Mentor” nên form cần một trường Email bắt buộc (không ẩn): hệ thống nhận ra mentee bằng email đó.";
    if (!String(settings.mentorForwardBody ?? "").trim()) return "Đang bật “Tự động gửi Submission cho Mentor” nhưng chưa có nội dung thư.";
  }
  return null;
}

/** id = mã "Ngắt trang" mở đầu trang (đích rẽ nhánh trỏ vào mã này); trang đầu không có ngắt trang nên rỗng. */
export type CustomFormPage = { id: string; title: string; help: string; nextPage: string; fields: CustomFormField[] };

/**
 * Chia form thành từng trang tại các “Ngắt trang” đang hiện (BTC 15/10/2026). Tiêu đề và mô tả của
 * một ngắt trang là của trang SAU nó. Ngắt trang ở đầu/cuối hay hai ngắt liền nhau không sinh trang
 * rỗng — người điền không bao giờ phải bấm “Tiếp” qua một trang trống. Form không có ngắt trang là
 * một trang.
 */
export function splitPages(fields: CustomFormField[]): CustomFormPage[] {
  const pages: CustomFormPage[] = [];
  let current: CustomFormPage = { id: "", title: "", help: "", nextPage: "", fields: [] };
  for (const field of fields) {
    if (field.hidden) continue;
    if (field.type === "page_break") {
      if (current.fields.length) pages.push(current);
      current = { id: field.id, title: field.label, help: field.help, nextPage: field.nextPage ?? "", fields: [] };
      continue;
    }
    current.fields.push(field);
  }
  if (current.fields.length || !pages.length) pages.push(current);
  return pages;
}

/**
 * Lựa chọn → đích của một câu, rỗng = chưa đặt. Là một cửa đọc cho cả `branches` cũ lẫn `optionTargets`.
 * Trả Map và chỉ gồm lựa chọn còn trên câu hỏi: câu trả lời là chữ người gửi tự đặt, đọc thẳng vào object
 * thì "constructor" sẽ trả về một hàm và thành đích giả.
 */
export function optionTargetsOf(field: CustomFormField): Map<string, string> {
  if (field.type === "yes_no") return new Map([[YES_NO_OPTIONS[0], field.branches?.yes ?? ""], [YES_NO_OPTIONS[1], field.branches?.no ?? ""]]);
  if (!BRANCHING_CHOICE_TYPES.has(field.type)) return new Map();
  const own = (option: string) => (field.optionTargets && Object.prototype.hasOwnProperty.call(field.optionTargets, option) ? field.optionTargets[option] : "");
  return new Map(field.options.map((option) => [option, own(option)]));
}

const isBranching = (field: CustomFormField) => !field.hidden && Array.from(optionTargetsOf(field).values()).some(Boolean);

/** Form có đổi đường đi không: câu rẽ nhánh, hoặc trang có đích mặc định. */
export function hasBranching(fields: CustomFormField[]): boolean {
  return fields.some(isBranching) || splitPages(fields).some((p) => p.nextPage);
}

/** Trang rẽ nhánh đầu tiên; null = form không rẽ nhánh. Mọi trang tới đó (kể cả nó) ai cũng đi qua. */
function firstBranchPage(fields: CustomFormField[]): number | null {
  const index = splitPages(fields).findIndex((p) => p.nextPage || p.fields.some(isBranching));
  return index >= 0 ? index : null;
}

/** Tên trang trong thông báo cho người tạo form. */
function pageName(page: CustomFormPage, index: number): string {
  return page.title ? `Trang “${page.title.slice(0, 60)}”` : `Trang ${index + 1}`;
}

/** Đích nào cũng phải là một trang có thật, đang hiện và nằm SAU trang đang xét. Trả lý do sai, null = hợp lệ. */
function targetProblem(fields: CustomFormField[], pages: CustomFormPage[], index: number, target: string): string | null {
  if (target === BRANCH_END) return null;
  const at = pages.findIndex((p) => p.id === target);
  if (at > index) return null;
  if (at >= 0) return "trang đích nằm trước hoặc chính là trang này, mà form chỉ nhảy tới";
  const breakField = fields.find((f) => f.id === target && f.type === "page_break");
  if (!breakField) return "trang đích không còn trên form";
  return breakField.hidden ? "trang đích đang ẩn" : "trang đích chưa có câu hỏi nào";
}

/** Mọi đích sai của form. Dùng cho cả lúc lưu lẫn bảng cảnh báo trên trình tạo form, để hai nơi nói một lời. */
function branchErrors(fields: CustomFormField[]): string[] {
  const pages = splitPages(fields);
  const out: string[] = [];
  pages.forEach((page, index) => {
    for (const field of page.fields.filter(isBranching)) {
      optionTargetsOf(field).forEach((target, option) => {
        const problem = target ? targetProblem(fields, pages, index, target) : null;
        if (problem) out.push(`Câu “${field.label.slice(0, 60)}”, lựa chọn “${option.slice(0, 60)}”: ${problem} — chọn lại đích đến.`);
      });
    }
    const problem = page.nextPage ? targetProblem(fields, pages, index, page.nextPage) : null;
    if (problem) out.push(`${pageName(page, index)}, mục Trang tiếp theo: ${problem} — chọn lại đích đến.`);
  });
  return out;
}

function checkBranches(fields: CustomFormField[]): string | null {
  return branchErrors(fields)[0] ?? null;
}

/**
 * Trang kế theo đích đã chọn; undefined = đích không dùng được (lùi, đã xoá) thì bên gọi đi tiếp theo đường
 * mặc định. Đích lùi không được phép dù lưu sót: nhờ luôn tiến tới mà form không thể có vòng lặp.
 */
function resolveTarget(pages: CustomFormPage[], index: number, target: string): number | null | undefined {
  if (target === BRANCH_END) return null;
  const jump = target ? pages.findIndex((p) => p.id === target) : -1;
  return jump > index ? jump : undefined;
}

/**
 * Trang kế tiếp sau trang `index` theo câu trả lời; null = đây là trang cuối của lượt điền này (hiện ô
 * đồng ý và nút Gửi). Thứ tự ưu tiên: đích theo câu trả lời (một trang có nhiều câu rẽ nhánh thì câu đứng
 * sau quyết định), đích mặc định của trang, rồi trang kế tiếp như thường.
 */
export function nextPageIndex(pages: CustomFormPage[], index: number, answerOf: (fieldId: string) => string | undefined): number | null {
  const page = pages[index];
  let target = "";
  for (const field of page?.fields ?? []) {
    // Cắt khoảng trắng như normalizeAnswer: không thì " Có" qua được kiểm tra mà lại né được nhánh của "Có".
    const chosen = optionTargetsOf(field).get(text(answerOf(field.id)));
    if (chosen) target = chosen;
  }
  const byAnswer = resolveTarget(pages, index, target);
  if (byAnswer !== undefined) return byAnswer;
  const byPage = resolveTarget(pages, index, page?.nextPage ?? "");
  if (byPage !== undefined) return byPage;
  return index + 1 < pages.length ? index + 1 : null;
}

/** Các trang người điền đi qua, theo thứ tự. Luôn tiến tới nên vòng lặp chắc chắn dừng. */
export function visitedPages(pages: CustomFormPage[], answerOf: (fieldId: string) => string | undefined): number[] {
  const path = [0];
  for (let next = nextPageIndex(pages, 0, answerOf); next !== null; next = nextPageIndex(pages, next, answerOf)) path.push(next);
  return path;
}

/**
 * Các trang có thể đi tới ngay sau trang `index`. Đường mặc định bị loại khi trang có một câu bắt buộc mà
 * lựa chọn nào cũng có đích: người điền buộc phải đi theo đích đó. Bỏ sót điều này thì trang kế sẽ bị
 * coi là tới được dù không ai vào, đúng ca kiểm tra này phải bắt.
 */
function pageExits(pages: CustomFormPage[], index: number): number[] {
  const page = pages[index];
  const exits: number[] = [];
  let defaultRoute = true;
  for (const field of page.fields.filter(isBranching)) {
    const resolved = Array.from(optionTargetsOf(field).values()).map((target) => resolveTarget(pages, index, target));
    for (const exit of resolved) if (typeof exit === "number") exits.push(exit);
    if (field.required && resolved.every((exit) => exit !== undefined)) defaultRoute = false;
  }
  if (defaultRoute) {
    const byPage = resolveTarget(pages, index, page.nextPage);
    if (typeof byPage === "number") exits.push(byPage);
    else if (byPage === undefined && index + 1 < pages.length) exits.push(index + 1);
  }
  return exits;
}

/** Các trang không câu trả lời nào đi tới được. Đích chỉ trỏ tới nên duyệt một lượt từ đầu là đủ. */
function unreachablePages(fields: CustomFormField[]): Array<{ page: CustomFormPage; index: number }> {
  const pages = splitPages(fields);
  const reached = new Set([0]);
  pages.forEach((_, index) => {
    if (reached.has(index)) for (const exit of pageExits(pages, index)) reached.add(exit);
  });
  return pages.flatMap((page, index) => (reached.has(index) ? [] : [{ page, index }]));
}

const unreachableMessage = ({ page, index }: { page: CustomFormPage; index: number }) =>
  `${pageName(page, index)} không có đường tới: không câu trả lời hay trang nào dẫn tới trang này — đặt đích tới trang, hoặc xoá trang.`;

/** Cảnh báo cho người tạo form: không chặn gì, vì lựa chọn chưa đặt đích vẫn đi được theo đường mặc định. */
export function branchWarnings(fields: CustomFormField[]): string[] {
  return fields.filter(isBranching).flatMap((field) => {
    const unset = Array.from(optionTargetsOf(field).entries()).filter(([, target]) => !target).map(([option]) => `“${option.slice(0, 60)}”`);
    if (!unset.length) return [];
    return [`Câu “${field.label.slice(0, 60)}”: lựa chọn ${unset.join(", ")} chưa đặt đích — sẽ đi theo Trang tiếp theo của trang này (chưa đặt thì sang trang kế).`];
  });
}

/** Những lỗi sẽ chặn lưu hoặc công khai, để trình tạo form báo trước khi người tạo bấm nút. */
export function branchBlockers(fields: CustomFormField[]): string[] {
  return [...branchErrors(fields), ...unreachablePages(fields).map(unreachableMessage)];
}

/**
 * Xoá liên kết tới một trang khi xoá trang đó, trả kèm danh sách chỗ bị mất đích để báo người tạo form.
 * Để liên kết lại thì form bị từ chối lúc lưu với đích không còn nhìn thấy trên trang, và người tạo không
 * biết phải sửa ở đâu.
 */
export function removePageLinks(fields: CustomFormField[], pageId: string): { fields: CustomFormField[]; lost: string[] } {
  const lost: string[] = [];
  const kept = fields.filter((f) => f.id !== pageId).map((field): CustomFormField => {
    const name = field.label.slice(0, 60);
    if (field.nextPage === pageId) {
      lost.push(`Trang “${name || "chưa đặt tên"}”, mục Trang tiếp theo`);
      return { ...field, nextPage: "" };
    }
    if (field.branches) {
      const { yes, no } = field.branches;
      if (yes === pageId) lost.push(`Câu “${name}”, lựa chọn “${YES_NO_OPTIONS[0]}”`);
      if (no === pageId) lost.push(`Câu “${name}”, lựa chọn “${YES_NO_OPTIONS[1]}”`);
      return { ...field, branches: { yes: yes === pageId ? "" : yes, no: no === pageId ? "" : no } };
    }
    if (field.optionTargets) {
      const entries = Object.entries(field.optionTargets);
      for (const [option, target] of entries) if (target === pageId) lost.push(`Câu “${name}”, lựa chọn “${option.slice(0, 60)}”`);
      return { ...field, optionTargets: Object.fromEntries(entries.filter(([, target]) => target !== pageId)) };
    }
    return field;
  });
  return { fields: kept, lost };
}

/**
 * Công khai được khi có ít nhất một câu hỏi đang hiện và trang nào cũng có đường tới. Không đặt trong
 * checkDefinitionRules vì nháp phải lưu được giữa chừng, lúc người tạo chưa nối xong các trang.
 *
 * `previous`: định nghĩa đang chạy khi LƯU một form đã công khai. Form rẽ nhánh Có/Không cũ có thể đã sẵn
 * một trang không ai tới; trang cũ đó không được cản BTC sửa một lỗi chính tả, chỉ trang mới phát sinh mới chặn.
 */
export function publishBlocker(fields: CustomFormField[], previous: CustomFormField[] = []): string | null {
  if (!fields.some((f) => isQuestion(f) && !f.hidden)) return "Form chưa có câu hỏi nào đang hiện — thêm câu hỏi trước khi công khai.";
  const known = new Set(unreachablePages(previous).map(({ page }) => page.id));
  const dead = unreachablePages(fields).find(({ page }) => !known.has(page.id));
  return dead ? unreachableMessage(dead) : null;
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
  // Lấy giá trị như normalizeAnswer (giá trị khác rỗng đầu tiên): đường đi và câu trả lời phải đọc cùng một thứ.
  const path = visitedPages(pages, (id) => read(id)?.find((value) => text(value)));
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
