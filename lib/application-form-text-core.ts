/**
 * lib/application-form-text-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Các khối CHỮ trên form nộp đơn mentor (/apply/mentor) và mentee (/apply/mentee)
 * mà admin sửa được, cùng chữ mặc định của từng khối.
 *
 * Chủ dự án chốt 15/09/2026: admin tự sửa phần chữ — giới thiệu, hạn nộp, người
 * liên hệ — mà không cần deploy. Không gồm nhãn ô nhập, lựa chọn, hay các câu cam
 * kết người nộp tick đồng ý: câu cam kết được lưu kèm đơn theo phiên bản
 * (`lib/application-commitments.ts`), đổi chữ của nó là đổi điều người ta đã đồng ý.
 *
 * Bảng `application_form_texts` chỉ giữ những khối đã sửa KHÁC mặc định. Khối nào
 * không có dòng thì form hiện chữ mặc định ở đây — nên bảng trống, hay bảng chưa
 * đọc được, thì form trông y như trước.
 *
 * Thuần, không I/O: form công khai, trang quản trị và hàm ghi cùng đọc một danh mục.
 */

import { MENTOR_SUPPORT_CONTACTS } from "@/lib/mentor-intake-content";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const lines = (...rows: string[]) => rows.join(LF);

/** Trần độ dài của một khối một dòng (tiêu đề, dòng nhỏ). */
export const FORM_TEXT_LINE_MAX = 200;
/** Trần độ dài của một khối nhiều dòng. Database cho tới 20.000; đây là trần của màn hình. */
export const FORM_TEXT_RICH_MAX = 5000;

/** Trang quản trị sửa chữ trên form. */
export const APPLICATION_FORM_TEXTS_PATH = "/admin/seasons-forms/form-texts";

export type FormTextActionState = { ok: boolean; message: string | null };
export const initialFormTextActionState: FormTextActionState = { ok: false, message: null };

export const MENTEE_SUPPORT_CONTACTS = Object.freeze([
  { name: "Trần Mỹ Anh", role: "Support Team UEH Mentoring", phone: "0394983679" },
  { name: "Bùi Trần Hoàng Vy", role: "Support Team UEH Mentoring", phone: "0936359670" }
]);

function contactLines(contacts: ReadonlyArray<{ name: string; role: string; phone?: string; email?: string }>) {
  return lines(
    ...contacts.map((contact) =>
      ["- **" + contact.name + "**", contact.role, contact.phone, contact.email].filter(Boolean).join(" — ")
    )
  );
}

export const APPLICATION_FORM_TEXT_KEYS = [
  "mentor.header.eyebrow",
  "mentor.header.title",
  "mentor.header.intro",
  "mentor.header.note",
  "mentor.profile.heading",
  "mentor.profile.spirit",
  "mentor.profile.competencies_heading",
  "mentor.profile.competencies",
  "mentor.profile.commitments_heading",
  "mentor.profile.commitments",
  "mentor.process.heading",
  "mentor.process.intro",
  "mentor.process.step1_title",
  "mentor.process.step1_body",
  "mentor.process.step1_note",
  "mentor.process.step2_title",
  "mentor.process.step2_body",
  "mentor.process.step2_note",
  "mentor.process.step3_title",
  "mentor.process.step3_body",
  "mentor.process.step3_note",
  "mentor.process.closing",
  "mentor.contacts.heading",
  "mentor.contacts.intro",
  "mentor.contacts.list",
  "mentee.header.eyebrow",
  "mentee.header.title",
  "mentee.header.intro",
  "mentee.header.note",
  "mentee.profile.heading",
  "mentee.profile.body",
  "mentee.contacts.heading",
  "mentee.contacts.intro",
  "mentee.contacts.list"
] as const;

export type ApplicationFormTextKey = (typeof APPLICATION_FORM_TEXT_KEYS)[number];

export type ApplicationFormTexts = Readonly<Record<ApplicationFormTextKey, string>>;

export type ApplicationFormTextKind = "line" | "rich";

export type ApplicationFormTextGroupId =
  | "mentor.header"
  | "mentor.profile"
  | "mentor.process"
  | "mentor.contacts"
  | "mentee.header"
  | "mentee.profile"
  | "mentee.contacts";

export type ApplicationFormTextGroup = {
  id: ApplicationFormTextGroupId;
  title: string;
  /** Những trang công khai hiện khối này. */
  shownOn: string;
};

export const APPLICATION_FORM_TEXT_GROUPS: readonly ApplicationFormTextGroup[] = Object.freeze([
  { id: "mentor.header", title: "Form mentor · Đầu trang", shownOn: "Form nộp đơn mentor" },
  { id: "mentor.profile", title: "Form mentor · Chân dung Mentor", shownOn: "Form nộp đơn mentor và form gia hạn mentor" },
  { id: "mentor.process", title: "Form mentor · Quy trình 3 bước", shownOn: "Form nộp đơn mentor" },
  { id: "mentor.contacts", title: "Form mentor · Liên hệ hỗ trợ", shownOn: "Form nộp đơn mentor và form gia hạn mentor" },
  { id: "mentee.header", title: "Form mentee · Đầu trang", shownOn: "Form nộp đơn mentee" },
  { id: "mentee.profile", title: "Form mentee · Chân dung Mentee", shownOn: "Form nộp đơn mentee" },
  { id: "mentee.contacts", title: "Form mentee · Liên hệ hỗ trợ", shownOn: "Form nộp đơn mentee" }
]);

export type ApplicationFormTextSlot = {
  key: ApplicationFormTextKey;
  group: ApplicationFormTextGroupId;
  label: string;
  kind: ApplicationFormTextKind;
  /** Để trống được — khi đó form không hiện khối này. */
  optional: boolean;
  defaultText: string;
};

function slot(
  key: ApplicationFormTextKey,
  label: string,
  kind: ApplicationFormTextKind,
  defaultText: string,
  optional = false
): ApplicationFormTextSlot {
  return { key, group: key.split(".").slice(0, 2).join(".") as ApplicationFormTextGroupId, label, kind, optional, defaultText };
}

const EYEBROW = "Vietnam Alumni Mentoring - UEH Mentoring Season 12";

export const APPLICATION_FORM_TEXT_SLOTS: readonly ApplicationFormTextSlot[] = Object.freeze([
  slot("mentor.header.eyebrow", "Dòng nhỏ trên tiêu đề", "line", EYEBROW),
  slot("mentor.header.title", "Tiêu đề", "line", "Đơn đăng ký mentor"),
  slot(
    "mentor.header.intro",
    "Lời mở đầu",
    "rich",
    "Cảm ơn anh/chị đã quan tâm đồng hành cùng chương trình mentoring. Vui lòng dành khoảng **10-12 phút** để hoàn thành. Trường có dấu * là bắt buộc."
  ),
  slot(
    "mentor.header.note",
    "Lưu ý dưới lời mở đầu",
    "rich",
    "Lưu ý: việc gửi đơn không tự động trở thành mentor chính thức. BTC sẽ review hồ sơ và liên hệ về bước tiếp theo (intro call/orientation) trước khi chính thức ghép cặp.",
    true
  ),
  slot("mentor.profile.heading", "Tiêu đề phần chân dung", "line", "Chân dung Mentor mà UEH Mentoring đang tìm kiếm"),
  slot(
    "mentor.profile.spirit",
    "Tinh thần tham gia",
    "rich",
    "Mentor tham gia trên tinh thần tự nguyện, không nhận thù lao từ chương trình hoặc từ mentee. Mentor không nhất thiết phải là người “thành công” theo nghĩa chức danh, mà là người có trải nghiệm, có sự tử tế, tinh thần trách nhiệm và khả năng lắng nghe."
  ),
  slot("mentor.profile.competencies_heading", "Tiêu đề khung năng lực", "line", "Năng lực kỳ vọng đối với Mentor"),
  slot(
    "mentor.profile.competencies",
    "Năng lực kỳ vọng",
    "rich",
    lines(
      "- Có tối thiểu **08 năm** kinh nghiệm làm việc, trong đó ít nhất **03 năm** trực tiếp quản lý con người hoặc đội ngũ.",
      "- Có khả năng lắng nghe, giao tiếp, gợi mở và tôn trọng những góc nhìn khác với mình."
    )
  ),
  slot("mentor.profile.commitments_heading", "Tiêu đề khung cam kết", "line", "Cam kết"),
  slot(
    "mentor.profile.commitments",
    "Cam kết",
    "rich",
    lines(
      "- Dành tối thiểu **01–02 giờ mỗi tháng** cho mỗi mentee.",
      "- Đồng hành xuyên suốt một mùa mentoring kéo dài **09 tháng**.",
      "- Tham dự các sinh hoạt chính và tuân thủ Quy chế cùng Bộ Quy tắc ứng xử do Ban Điều hành ban hành.",
      "- Mỗi Mentor được ghép tối đa **02 mentee** trong một mùa và hiểu rằng mentee có thể không cùng ngành hoặc không hoàn toàn phù hợp với mong muốn ban đầu."
    )
  ),
  slot("mentor.process.heading", "Tiêu đề phần quy trình", "line", "Quy trình trở thành Mentor chính thức"),
  slot(
    "mentor.process.intro",
    "Câu dẫn",
    "rich",
    "👉 Để trở thành Mentor chính thức của chương trình, Anh/Chị sẽ đi qua 03 bước sau:"
  ),
  slot("mentor.process.step1_title", "Bước 1 · Tiêu đề", "line", "Bước 1 – Đăng ký tham gia"),
  slot("mentor.process.step1_body", "Bước 1 · Nội dung", "rich", "Điền form đăng ký bên dưới."),
  slot(
    "mentor.process.step1_note",
    "Bước 1 · Khung lưu ý vàng",
    "rich",
    "Lưu ý: Chương trình nhận đăng ký Mentor mới Mùa 12 đến hết ngày **19/09/2026**.",
    true
  ),
  slot("mentor.process.step2_title", "Bước 2 · Tiêu đề", "line", "Bước 2 – Trao đổi 1:1 cùng đại diện Ban Điều hành"),
  slot(
    "mentor.process.step2_body",
    "Bước 2 · Nội dung",
    "rich",
    "Dựa trên tiêu chí của chương trình, Ban Điều hành sẽ mời các hồ sơ phù hợp tham gia một buổi trao đổi 1:1 để hai bên hiểu rõ hơn về cách thức đồng hành và mức độ phù hợp."
  ),
  slot("mentor.process.step2_note", "Bước 2 · Khung lưu ý vàng", "rich", "", true),
  slot("mentor.process.step3_title", "Bước 3 · Tiêu đề", "line", "Bước 3 – Tham dự Mentor Orientation"),
  slot(
    "mentor.process.step3_body",
    "Bước 3 · Nội dung",
    "rich",
    "Tìm hiểu về vai trò của Mentor, phương thức mentoring và những kinh nghiệm cần thiết trong quá trình đồng hành."
  ),
  slot("mentor.process.step3_note", "Bước 3 · Khung lưu ý vàng", "rich", "", true),
  slot(
    "mentor.process.closing",
    "Câu kết",
    "rich",
    "Sau khi hoàn tất 03 bước trên, Anh/Chị sẽ được chính thức xác nhận là Mentor của chương trình và sẵn sàng bước vào hành trình đồng hành cùng các Mentee."
  ),
  slot("mentor.contacts.heading", "Tiêu đề", "line", "Liên hệ hỗ trợ"),
  slot(
    "mentor.contacts.intro",
    "Câu dẫn",
    "rich",
    "Nếu cần hỗ trợ khi điền hoặc gửi thông tin, anh/chị vui lòng liên hệ:",
    true
  ),
  slot("mentor.contacts.list", "Danh sách người liên hệ", "rich", contactLines(MENTOR_SUPPORT_CONTACTS)),
  slot("mentee.header.eyebrow", "Dòng nhỏ trên tiêu đề", "line", EYEBROW),
  slot("mentee.header.title", "Tiêu đề", "line", "Đơn đăng ký mentee"),
  slot(
    "mentee.header.intro",
    "Lời mở đầu",
    "rich",
    "Cảm ơn bạn quan tâm đến chương trình. Vui lòng dành khoảng **10-15 phút** để hoàn thành. Trường có dấu * là bắt buộc."
  ),
  slot(
    "mentee.header.note",
    "Lưu ý dưới lời mở đầu",
    "rich",
    "Lưu ý: Việc gửi đơn không đồng nghĩa với việc tự động trở thành Mentee chính thức. BTC sẽ xem xét hồ sơ dựa trên mức độ phù hợp với tinh thần và cam kết của chương trình, mời phỏng vấn khi cần và liên hệ về kết quả tiếp theo.",
    true
  ),
  slot("mentee.profile.heading", "Tiêu đề phần chân dung", "line", "Chân dung Mentee chúng tôi tìm kiếm"),
  slot(
    "mentee.profile.body",
    "Nội dung",
    "rich",
    lines(
      "UEH Mentoring không tìm kiếm những người “giỏi nhất” hay đã có sẵn mọi câu trả lời. Chúng tôi tìm kiếm những bạn thực sự mong muốn thay đổi và phát triển, đang cần một người Mentor có kinh nghiệm đồng hành để giúp mình nhìn rõ hơn con đường phía trước, đồng thời sẵn sàng trở thành một phần của cộng đồng mentoring nơi mọi người cùng học hỏi, hỗ trợ và thúc đẩy nhau tiến bộ.",
      "",
      "Một Mentee phù hợp là người hiểu rằng Mentor không thể thay mình giải quyết vấn đề. Bạn cần chủ động trong hành trình phát triển của chính mình, cởi mở với phản hồi, sẵn sàng thử những điều mới và biến những trao đổi với Mentor thành hành động cụ thể. Bạn cũng cần thể hiện trách nhiệm, kỷ luật và sự tôn trọng cam kết: chủ động chuẩn bị cho các buổi mentoring, đúng giờ, theo đuổi những việc đã thống nhất và thông báo sớm khi có thay đổi.",
      "",
      "Nếu bạn chưa biết chính xác mình muốn trở thành ai nhưng thật sự muốn tiến lên, sẵn sàng học hỏi và cam kết với quá trình thay đổi, UEH Mentoring có thể là một hành trình phù hợp với bạn."
    )
  ),
  slot("mentee.contacts.heading", "Tiêu đề", "line", "Liên hệ hỗ trợ"),
  slot(
    "mentee.contacts.intro",
    "Câu dẫn",
    "rich",
    "Nếu cần hỗ trợ khi điền hoặc gửi thông tin, bạn vui lòng liên hệ:",
    true
  ),
  slot("mentee.contacts.list", "Danh sách người liên hệ", "rich", contactLines(MENTEE_SUPPORT_CONTACTS))
]);

const SLOT_BY_KEY = new Map<string, ApplicationFormTextSlot>(APPLICATION_FORM_TEXT_SLOTS.map((entry) => [entry.key, entry]));

export function applicationFormTextSlot(key: unknown): ApplicationFormTextSlot | null {
  return typeof key === "string" ? SLOT_BY_KEY.get(key) ?? null : null;
}

/**
 * Chuẩn hoá chữ gửi lên: xuống dòng về một kiểu, bỏ khoảng trắng thừa ở cuối dòng,
 * gộp nhiều dòng trống liền nhau thành một. Khối một dòng thì mọi xuống dòng thành
 * một dấu cách — tiêu đề không có chỗ cho dòng thứ hai.
 */
export function normalizeFormText(value: unknown, kind: ApplicationFormTextKind): string {
  const rows = String(value ?? "").split(CR + LF).join(LF).split(CR).join(LF).split(LF);
  if (kind === "line") {
    return rows.map((row) => row.trim()).filter(Boolean).join(" ");
  }
  const kept: string[] = [];
  for (const row of rows.map((entry) => entry.trimEnd())) {
    if (row === "" && (kept.length === 0 || kept[kept.length - 1] === "")) continue;
    kept.push(row);
  }
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return kept.join(LF);
}

/** Câu báo lỗi của một khối, hoặc null nếu hợp lệ. Nhận chữ ĐÃ chuẩn hoá. */
export function validateFormText(entry: ApplicationFormTextSlot, text: string): string | null {
  if (!entry.optional && text === "") return `${entry.label} không được để trống.`;
  const max = entry.kind === "line" ? FORM_TEXT_LINE_MAX : FORM_TEXT_RICH_MAX;
  if (text.length > max) {
    return `${entry.label} dài quá ${new Intl.NumberFormat("vi-VN").format(max)} ký tự.`;
  }
  return null;
}

/**
 * Chữ đang hiện của một khối: bản đã sửa nếu có và còn hợp lệ, không thì mặc định.
 *
 * Một dòng hỏng trong database (khối bắt buộc mà trống, dài quá trần) không được
 * làm form công khai hiện một khoảng trống — nó rơi về chữ mặc định.
 */
function effectiveText(entry: ApplicationFormTextSlot, override: unknown): string {
  if (typeof override !== "string") return entry.defaultText;
  const text = normalizeFormText(override, entry.kind);
  return validateFormText(entry, text) === null ? text : entry.defaultText;
}

export const DEFAULT_APPLICATION_FORM_TEXTS: ApplicationFormTexts = Object.freeze(
  Object.fromEntries(APPLICATION_FORM_TEXT_SLOTS.map((entry) => [entry.key, entry.defaultText]))
) as ApplicationFormTexts;

/** Toàn bộ chữ của các form, từ các bản đã sửa đọc được trong database. Khoá lạ bị bỏ qua. */
export function resolveApplicationFormTexts(overrides: Readonly<Record<string, unknown>> | null | undefined): ApplicationFormTexts {
  return Object.freeze(
    Object.fromEntries(APPLICATION_FORM_TEXT_SLOTS.map((entry) => [entry.key, effectiveText(entry, overrides?.[entry.key])]))
  ) as ApplicationFormTexts;
}

export type FormTextSavePlan =
  | {
      ok: true;
      upserts: Array<{ key: ApplicationFormTextKey; body: string }>;
      deletes: ApplicationFormTextKey[];
      before: Partial<Record<ApplicationFormTextKey, string>>;
      after: Partial<Record<ApplicationFormTextKey, string>>;
    }
  | { ok: false; message: string };

/**
 * Tính những gì cần ghi cho một lần bấm lưu.
 *
 * - Chỉ các khối trong danh mục; khoá lạ gửi kèm bị bỏ qua.
 * - `expected` là chữ màn hình đã hiện lúc mở trang. Nếu chữ hiện tại đã khác —
 *   người khác vừa lưu — thì không ghi gì: ghi đè là xoá mất bản của họ mà cả hai
 *   không ai biết.
 * - Chữ trùng mặc định thì XOÁ dòng đã sửa thay vì lưu một bản sao của mặc định,
 *   để lần sau đổi mặc định trong mã thì khối này đổi theo.
 * - Khối không đổi thì không ghi.
 */
export function planFormTextSave(input: {
  submitted: Readonly<Record<string, unknown>>;
  expected: Readonly<Record<string, unknown>>;
  overrides: Readonly<Record<string, unknown>>;
}): FormTextSavePlan {
  const upserts: Array<{ key: ApplicationFormTextKey; body: string }> = [];
  const deletes: ApplicationFormTextKey[] = [];
  const before: Partial<Record<ApplicationFormTextKey, string>> = {};
  const after: Partial<Record<ApplicationFormTextKey, string>> = {};

  for (const entry of APPLICATION_FORM_TEXT_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(input.submitted, entry.key)) continue;

    const next = normalizeFormText(input.submitted[entry.key], entry.kind);
    const problem = validateFormText(entry, next);
    if (problem) return { ok: false, message: problem };

    if (!Object.prototype.hasOwnProperty.call(input.expected, entry.key)) {
      return { ok: false, message: "Yêu cầu không hợp lệ. Tải lại trang rồi sửa lại." };
    }
    const current = effectiveText(entry, input.overrides[entry.key]);
    if (normalizeFormText(input.expected[entry.key], entry.kind) !== current) {
      return {
        ok: false,
        message: `“${entry.label}” vừa được người khác sửa. Tải lại trang để xem bản mới, rồi sửa lại.`
      };
    }

    if (next === current) continue;

    before[entry.key] = current;
    after[entry.key] = next;
    if (next === entry.defaultText) {
      if (typeof input.overrides[entry.key] === "string") deletes.push(entry.key);
    } else {
      upserts.push({ key: entry.key, body: next });
    }
  }

  return { ok: true, upserts, deletes, before, after };
}

// ── Định dạng chữ ────────────────────────────────────────────────────────────
//
// Người sửa không viết HTML. Ba quy ước, đủ cho những gì các form đang có:
//   **chữ đậm** · dòng bắt đầu bằng "- " là một gạch đầu dòng · dòng trống tách đoạn.
// Email và số điện thoại tự thành đường dẫn bấm được.

export type RichInline =
  | { kind: "text"; text: string; strong: boolean }
  | { kind: "link"; text: string; href: string; strong: boolean };

export type RichBlock =
  | { kind: "paragraph"; lines: RichInline[][] }
  | { kind: "list"; items: RichInline[][] };

const LINK_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}|[+]?[0-9][0-9.]{7,16}[0-9]/g;

function linkify(segment: string, strong: boolean): RichInline[] {
  const out: RichInline[] = [];
  let cursor = 0;
  for (const match of Array.from(segment.matchAll(LINK_PATTERN))) {
    const text = match[0];
    const start = match.index ?? 0;
    let href: string | null = null;
    if (text.includes("@")) {
      href = `mailto:${text}`;
    } else {
      // Chỉ số điện thoại Việt Nam: bắt đầu bằng 0 hoặc +, 9–11 chữ số. Một ngày
      // viết kiểu 20.09.2026 có 8 chữ số nên không bị biến thành số điện thoại.
      const digits = text.split("").filter((ch) => ch >= "0" && ch <= "9").join("");
      if ((text.startsWith("0") || text.startsWith("+")) && digits.length >= 9 && digits.length <= 11) {
        href = `tel:${text.startsWith("+") ? "+" : ""}${digits}`;
      }
    }
    if (!href) continue;
    if (start > cursor) out.push({ kind: "text", text: segment.slice(cursor, start), strong });
    out.push({ kind: "link", text, href, strong });
    cursor = start + text.length;
  }
  if (cursor < segment.length) out.push({ kind: "text", text: segment.slice(cursor), strong });
  return out;
}

export function parseRichInline(text: string): RichInline[] {
  const parts = text.split("**");
  // Số dấu ** lẻ: dấu cuối không có cặp, giữ nguyên nó là chữ thường.
  if (parts.length % 2 === 0) {
    const tail = parts.pop() ?? "";
    parts[parts.length - 1] = `${parts[parts.length - 1]}**${tail}`;
  }
  return parts.flatMap((part, index) => (part ? linkify(part, index % 2 === 1) : []));
}

function bulletText(row: string): string | null {
  const trimmed = row.trimStart();
  if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) return trimmed.slice(2).trim();
  return null;
}

export function parseRichText(value: unknown): RichBlock[] {
  const text = normalizeFormText(value, "rich");
  if (!text) return [];

  const blocks: RichBlock[] = [];
  let paragraph: RichInline[][] | null = null;
  let list: RichInline[][] | null = null;

  const flush = () => {
    if (paragraph) blocks.push({ kind: "paragraph", lines: paragraph });
    if (list) blocks.push({ kind: "list", items: list });
    paragraph = null;
    list = null;
  };

  for (const row of text.split(LF)) {
    if (row.trim() === "") {
      flush();
      continue;
    }
    const bullet = bulletText(row);
    if (bullet !== null) {
      if (paragraph) {
        blocks.push({ kind: "paragraph", lines: paragraph });
        paragraph = null;
      }
      (list ??= []).push(parseRichInline(bullet));
    } else {
      if (list) {
        blocks.push({ kind: "list", items: list });
        list = null;
      }
      (paragraph ??= []).push(parseRichInline(row.trim()));
    }
  }
  flush();
  return blocks;
}
