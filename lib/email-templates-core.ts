/**
 * lib/email-templates-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Nội dung các thư gửi hàng loạt: mỗi loại thư được dùng những ô điền nào, gõ
 * sai thì bị chặn ở đâu, và một mẫu thư trở thành một bức thư thật ra sao.
 *
 * Nguyên tắc thiết kế nằm ở đây, và nó là lý do toàn bộ module này an toàn:
 * mẫu thư giữ `{{ten_nguoi_nhan}}`, không bao giờ giữ "Nguyễn Thị Bích Ngọc".
 * Giá trị thật được điền lúc gửi, ở phía máy chủ. Nhờ vậy một mẫu thư có thể
 * được soạn, sửa, đưa người khác đọc, hay nhờ trợ lý viết hộ, mà không một
 * dòng dữ liệu cá nhân nào rời khỏi hệ thống.
 *
 * Và `renderTemplate` từ chối tạo ra một bức thư còn sót ô điền: gửi cho một
 * bạn sinh viên bức thư mở đầu bằng "Chào {{ten_nguoi_nhan}}" tệ hơn là không
 * gửi gì cả.
 *
 * Module thuần, không I/O — để test chạy được mà không cần database.
 */

/**
 * Các loại thư soạn được trên giao diện.
 *
 * Bắt đầu bằng đúng một giá trị, khớp với ràng buộc `email_templates_kind_check`
 * trong migration 20260909150000. Mỗi loại thư mới là một `alter` riêng có
 * người ký — không phải một chuỗi ai gõ cũng được.
 *
 * CỐ Ý CHƯA CÓ ở đây: `reviewer_invite` và `interview_round_invite`. Thân thư
 * của hai loại đó do builder trong `lib/email-core.ts` dựng và đang chạy thật
 * giữa đợt tuyển; chuyển chúng sang mẫu-thư-sửa-được là việc của lát sau, khi
 * không có đợt gửi nào đang dở.
 */
export const TEMPLATE_KINDS = ["general_announcement"] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type TemplateAudience = "mentee" | "mentor" | "both";

export type TemplateStatus = "draft" | "approved" | "archived";

export type PlaceholderSpec = {
  /** Tên ô, đúng như khi gõ vào thư: `{{key}}`. */
  key: string;
  /** Nhãn tiếng Việt hiện trên nút chèn ô. */
  label: string;
  /**
   * Chỉ ảnh hưởng tới lời nhắc "thư chưa dùng ô này" lúc soạn.
   *
   * KHÔNG phải là "được phép để trống": một ô đã dùng trong thư mà không có
   * giá trị thì chặn cả bức thư đó, dù `required` là gì — xem `renderTemplate`.
   */
  required: boolean;
  /** Giá trị mẫu, để xem trước thư trước khi có người nhận thật. */
  sample: string;
  /** Câu giải thích hiện dưới nút chèn ô. */
  hint: string;
};

export type TemplateSpec = {
  kind: TemplateKind;
  label: string;
  audience: TemplateAudience;
  purpose: string;
  placeholders: PlaceholderSpec[];
};

/**
 * Danh mục ô điền — DANH SÁCH ĐÓNG, và đó là điểm quan trọng nhất của file này.
 *
 * Không mở thẳng vào `raw_payload` của đơn đăng ký. Cho người soạn tự chọn bất
 * kỳ trường nào trong đơn nghe thì tiện, nhưng nghĩa là một cú bấm nhầm gửi số
 * điện thoại của bạn mentee này cho bạn mentee khác — và thư đã đi thì không
 * rút lại được. Mỗi ô ở đây là một quyết định có người chịu trách nhiệm.
 */
export const TEMPLATE_SPECS: Record<TemplateKind, TemplateSpec> = {
  general_announcement: {
    kind: "general_announcement",
    label: "Thông báo chung",
    audience: "both",
    purpose:
      "Thư thông báo do Core Team tự soạn, gửi hàng loạt cho mentor hoặc mentee của một mùa.",
    placeholders: [
      {
        key: "ten_nguoi_nhan",
        label: "Tên người nhận",
        required: true,
        sample: "Nguyễn Văn A",
        hint: "Họ tên đầy đủ đang lưu trong hệ thống."
      },
      {
        key: "mua",
        label: "Tên mùa",
        required: true,
        sample: "UEHM-S12",
        hint: "Mã mùa của lô gửi, ví dụ UEHM-S12."
      },
      {
        key: "vai_tro",
        label: "Vai trò",
        required: false,
        sample: "mentee",
        hint: "'mentor', 'mentee', 'ban tổ chức' hoặc 'người tham dự', theo nhóm nhận thư."
      }
    ]
  }
};

export const MAX_NAME_LENGTH = 120;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 8_000;

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z0-9_]{1,40})\s*\}\}/g;

/**
 * Mọi ô điền đoạn văn bản thực sự dùng, theo thứ tự xuất hiện lần đầu.
 *
 * Dùng `matchAll` chứ không phải vòng lặp `exec`: một regex mang cờ `g` giữ
 * `lastIndex` trên chính nó, nên hai chỗ cùng gọi một hằng số regex có thể
 * giẫm lên nhau. `matchAll` duyệt trên một bản sao, còn `PLACEHOLDER_PATTERN`
 * thì không bao giờ bị đụng tới — hết hẳn cả loại lỗi đó thay vì canh nó.
 */
export function extractPlaceholders(text: string): string[] {
  const found: string[] = [];
  // `Array.from` chứ không phải `for...of`: dự án biên dịch xuống ES5, nơi
  // duyệt thẳng một iterator cần bật `downlevelIteration` cho toàn bộ codebase.
  for (const match of Array.from(String(text ?? "").matchAll(PLACEHOLDER_PATTERN))) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

export type TemplateValidation =
  | { ok: true; name: string; subject: string; body: string; warnings: string[] }
  | { ok: false; message: string };

/**
 * Kiểm một mẫu thư người soạn vừa gõ.
 *
 * Ô lạ là LỖI chứ không phải cảnh báo: không gì điền được nó, nên nó sẽ sống
 * sót vào bức thư gửi đi. Ngược lại, một ô hợp lệ mà người soạn không dùng chỉ
 * là cảnh báo — viết thư ngắn hơn là quyền của họ.
 */
export function validateTemplate(input: {
  kind: TemplateKind;
  name?: unknown;
  subject?: unknown;
  body?: unknown;
}): TemplateValidation {
  const spec = TEMPLATE_SPECS[input.kind];
  if (!spec) return { ok: false, message: "Loại thư không hợp lệ." };

  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, message: "Vui lòng đặt tên cho mẫu thư (chỉ Core Team thấy)." };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `Tên mẫu thư không được dài quá ${MAX_NAME_LENGTH} ký tự.` };
  }

  // Xuống dòng trong tiêu đề bị một số máy chủ thư hiểu là ranh giới header.
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!subject) return { ok: false, message: "Vui lòng nhập tiêu đề thư." };
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, message: `Tiêu đề không được dài quá ${MAX_SUBJECT_LENGTH} ký tự.` };
  }

  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, message: "Vui lòng nhập nội dung thư." };
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, message: `Nội dung không được dài quá ${MAX_BODY_LENGTH} ký tự.` };
  }

  // Mẫu thư là VĂN BẢN THUẦN. Phần HTML do `lib/email-core.ts` dựng, và nó
  // escape mọi thứ đi qua nó.
  //
  // Cho phép gõ thẻ HTML vào đây nghĩa là mở một đường cho bất kỳ ai soạn được
  // thư chèn thẳng đánh dấu vào hộp thư hàng trăm người — một liên kết đội lốt
  // chữ khác, một khối ẩn. Chặn ở đây, lúc soạn, là chỗ báo lỗi còn đọc được;
  // chặn lúc gửi thì đã muộn.
  const tagged = [subject, body].find((text) => /[<>]/.test(text));
  if (tagged !== undefined) {
    return {
      ok: false,
      message:
        "Thư chỉ nhận văn bản thuần, không nhận thẻ HTML (dấu < và >). Định dạng do hệ thống tự dựng."
    };
  }

  const known = new Set(spec.placeholders.map((row) => row.key));
  const used = extractPlaceholders(`${subject}\n${body}`);
  const unknown = used.filter((key) => !known.has(key));
  if (unknown.length) {
    return {
      ok: false,
      message: `Thư đang dùng ô không có dữ liệu: ${unknown
        .map((key) => `{{${key}}}`)
        .join(", ")}. Vui lòng xoá hoặc thay bằng ô hợp lệ.`
    };
  }

  const warnings: string[] = [];
  for (const placeholder of spec.placeholders) {
    if (placeholder.required && !used.includes(placeholder.key)) {
      warnings.push(`Thư chưa dùng ô {{${placeholder.key}}} (${placeholder.label}).`);
    }
  }

  return { ok: true, name, subject, body, warnings };
}

export type RenderResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; missing: string[]; message: string };

/**
 * Điền một mẫu thư cho MỘT người nhận.
 *
 * Ô nào không có giá trị thì chặn cả bức thư đó — kể cả ô khai báo
 * `required: false`. Cờ đó chỉ nói "thư không bắt buộc phải dùng ô này"; đã
 * dùng rồi thì phải có gì để điền. Người nhận không bao giờ được thấy một chỗ
 * trống ở nơi lẽ ra là tên mình.
 *
 * Bức thư hỏng bị bỏ lại một mình: các thư khác trong cùng lô vẫn đi, và người
 * bị thiếu dữ liệu được báo theo tên ô để còn sửa.
 */
export function renderTemplate(input: {
  kind: TemplateKind;
  subject: string;
  body: string;
  values: Record<string, string | number | null | undefined>;
}): RenderResult {
  const missing: string[] = [];

  const fill = (text: string) =>
    String(text ?? "").replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
      const value = input.values[key];
      const filled = value === null || value === undefined ? "" : String(value).trim();
      if (!filled) {
        if (!missing.includes(key)) missing.push(key);
        return "";
      }
      return filled;
    });

  const subject = fill(input.subject).replace(/\s+/g, " ").trim();
  const body = fill(input.body).trim();

  if (missing.length) {
    return {
      ok: false,
      missing,
      message: `Thiếu dữ liệu cho ô: ${missing.map((key) => `{{${key}}}`).join(", ")}.`
    };
  }

  return { ok: true, subject, body };
}

/** Giá trị mẫu, để xem trước một mẫu thư trước khi có người nhận thật. */
export function sampleValues(kind: TemplateKind): Record<string, string> {
  const values: Record<string, string> = {};
  for (const placeholder of TEMPLATE_SPECS[kind]?.placeholders ?? []) {
    values[placeholder.key] = placeholder.sample;
  }
  return values;
}

/** Dạng gõ vào thư của một ô — dùng chung cho nút chèn ô và cho phần trợ giúp. */
export function placeholderToken(key: string): string {
  return `{{${key}}}`;
}

export function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === "string" && (TEMPLATE_KINDS as readonly string[]).includes(value);
}

export function isTemplateStatus(value: unknown): value is TemplateStatus {
  return value === "draft" || value === "approved" || value === "archived";
}

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  draft: "Bản nháp",
  approved: "Đã duyệt",
  archived: "Đã lưu trữ"
};
