/**
 * lib/email-templates-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The bodies of the post-matching emails: which placeholders each kind may
 * use, how a draft is asked for, and how a template becomes a real message.
 *
 * The design rule that makes assisted drafting safe lives here. A template
 * holds `{{ten_mentee}}`, never "Nguyễn Thị Bích Ngọc": the draft is written
 * without ever seeing a person, and the values are filled in at send time, on
 * our side. `renderTemplate` refuses to produce a message with a placeholder
 * left in it — an email that greets somebody as "{{ten_mentee}}" must never
 * leave the building.
 */

export const TEMPLATE_KINDS = [
  "mentee_selected",
  "mentee_mentor_intro",
  "mentor_mentee_package",
  "kickoff_invite"
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type TemplateAudience = "mentee" | "mentor" | "both";

export type PlaceholderSpec = {
  key: string;
  label: string;
  /** A message may not go out with this one unresolved. */
  required: boolean;
  sample: string;
};

export type TemplateSpec = {
  kind: TemplateKind;
  label: string;
  audience: TemplateAudience;
  purpose: string;
  placeholders: PlaceholderSpec[];
};

const DOC_PLACEHOLDERS: PlaceholderSpec[] = [
  {
    key: "link_quy_tac_ung_xu",
    label: "Đường dẫn quy tắc ứng xử",
    required: true,
    sample: "https://vam.example.vn/documents/uehm-s12-mentee-quy-tac-ung-xu"
  },
  {
    key: "link_cam_nang",
    label: "Đường dẫn cẩm nang",
    required: true,
    sample: "https://vam.example.vn/documents/uehm-s12-mentee-cam-nang"
  }
];

const SEASON_PLACEHOLDER: PlaceholderSpec = {
  key: "mua",
  label: "Tên mùa",
  required: true,
  sample: "UEHM-S12"
};

export const TEMPLATE_SPECS: Record<TemplateKind, TemplateSpec> = {
  mentee_selected: {
    kind: "mentee_selected",
    label: "Thư báo mentee được chọn",
    audience: "mentee",
    purpose:
      "Báo cho bạn mentee rằng bạn đã được chọn vào chương trình, kèm quy tắc ứng xử và cẩm nang.",
    placeholders: [
      { key: "ten_mentee", label: "Tên mentee", required: true, sample: "Nguyễn Văn A" },
      SEASON_PLACEHOLDER,
      ...DOC_PLACEHOLDERS
    ]
  },
  mentee_mentor_intro: {
    kind: "mentee_mentor_intro",
    label: "Thư giới thiệu mentor cho mentee",
    audience: "mentee",
    purpose:
      "Sau khi tất cả mentee đã có mentor: giới thiệu mentor của bạn ấy và báo sắp có buổi kick-off.",
    placeholders: [
      { key: "ten_mentee", label: "Tên mentee", required: true, sample: "Nguyễn Văn A" },
      { key: "ten_mentor", label: "Tên mentor", required: true, sample: "Trần Thị B" },
      {
        key: "gioi_thieu_mentor",
        label: "Giới thiệu ngắn về mentor",
        required: true,
        sample: "Hơn 8 năm trong ngành tài chính, hiện phụ trách mảng phân tích đầu tư."
      },
      SEASON_PLACEHOLDER,
      ...DOC_PLACEHOLDERS
    ]
  },
  mentor_mentee_package: {
    kind: "mentor_mentee_package",
    label: "Thư gửi mentor kèm hồ sơ mentee",
    audience: "mentor",
    purpose:
      "Gửi mentor danh sách mentee được ghép, đường dẫn xem hồ sơ chi tiết, quy tắc ứng xử và cẩm nang.",
    placeholders: [
      { key: "ten_mentor", label: "Tên mentor", required: true, sample: "Trần Thị B" },
      { key: "so_luong_mentee", label: "Số mentee được ghép", required: true, sample: "2" },
      {
        key: "danh_sach_mentee",
        label: "Danh sách mentee",
        required: true,
        sample: "Nguyễn Văn A, Lê Thị C"
      },
      {
        key: "link_ho_so",
        label: "Đường dẫn xem hồ sơ mentee",
        required: true,
        sample: "https://vam.example.vn/mentee-dossier/2f1c…"
      },
      SEASON_PLACEHOLDER,
      ...DOC_PLACEHOLDERS
    ]
  },
  kickoff_invite: {
    kind: "kickoff_invite",
    label: "Thư mời buổi kick-off",
    audience: "both",
    purpose: "Mời mentee và mentor dự buổi kick-off, kèm đường dẫn đăng ký.",
    placeholders: [
      { key: "ten_nguoi_nhan", label: "Tên người nhận", required: true, sample: "Nguyễn Văn A" },
      { key: "ten_su_kien", label: "Tên sự kiện", required: true, sample: "Kick-off UEHM mùa 12" },
      {
        key: "thoi_gian",
        label: "Thời gian",
        required: true,
        sample: "08:30 Thứ Bảy, 12/09/2026"
      },
      { key: "dia_diem", label: "Địa điểm", required: false, sample: "Hội trường A, 59C Nguyễn Đình Chiểu" },
      {
        key: "link_dang_ky",
        label: "Đường dẫn đăng ký",
        required: true,
        sample: "https://vam.example.vn/register/8ab2…"
      },
      SEASON_PLACEHOLDER
    ]
  }
};

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 8_000;

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z0-9_]{1,40})\s*\}\}/g;

/** Every placeholder the text actually uses, in order of first appearance. */
export function extractPlaceholders(text: string): string[] {
  const found: string[] = [];
  const source = String(text ?? "");
  let match: RegExpExecArray | null;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  while ((match = PLACEHOLDER_PATTERN.exec(source)) !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

export type TemplateValidation =
  | { ok: true; subject: string; body: string; warnings: string[] }
  | { ok: false; message: string };

/**
 * Check a template an organiser typed.
 *
 * An unknown placeholder is an error, not a warning: it would survive into the
 * sent message, because nothing can fill it. A known placeholder the author
 * left out is only a warning — a shorter email is a choice.
 */
export function validateTemplate(input: {
  kind: TemplateKind;
  subject?: unknown;
  body?: unknown;
}): TemplateValidation {
  const spec = TEMPLATE_SPECS[input.kind];
  if (!spec) return { ok: false, message: "Loại thư không hợp lệ." };

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

  return { ok: true, subject, body, warnings };
}

export type RenderResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; missing: string[]; message: string };

/**
 * Fill a template for one recipient.
 *
 * A placeholder with no value stops the whole message. Sending "Chào
 * {{ten_mentee}}" to a student is worse than sending nothing.
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
      const text_ = value === null || value === undefined ? "" : String(value).trim();
      if (!text_) {
        if (!missing.includes(key)) missing.push(key);
        return "";
      }
      return text_;
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

/** Values that let an operator preview a template before anyone receives it. */
export function sampleValues(kind: TemplateKind): Record<string, string> {
  const spec = TEMPLATE_SPECS[kind];
  const values: Record<string, string> = {};
  for (const placeholder of spec?.placeholders ?? []) values[placeholder.key] = placeholder.sample;
  return values;
}

// ── Asking for a draft ───────────────────────────────────────────────────────

export const DRAFT_PROMPT_VERSION = "vam-email-v1-2026-08";

export const DRAFT_SYSTEM_PROMPT = [
  "Bạn là trợ lý soạn thảo của một chương trình mentoring dành cho sinh viên Việt Nam.",
  "Bạn viết MẪU thư, không viết thư cho một người cụ thể.",
  "Bạn không bao giờ tự bịa tên người, tên trường, ngày giờ hay đường dẫn:",
  "những chỗ đó phải để nguyên dạng ô điền mà người dùng cung cấp.",
  "Giọng văn: trang trọng vừa phải, ấm áp, ngắn gọn, tiếng Việt.",
  "Chỉ trả về JSON đúng định dạng được yêu cầu, không thêm lời dẫn."
].join(" ");

/**
 * The request for a first draft.
 *
 * It contains the purpose, the tone and the exact placeholder names — and not
 * one fact about any mentee, mentor or organiser.
 */
export function buildDraftPrompt(kind: TemplateKind): string {
  const spec = TEMPLATE_SPECS[kind];
  return JSON.stringify(
    {
      nhiem_vu: "Soạn một mẫu email tiếng Việt cho chương trình mentoring.",
      loai_thu: spec.label,
      muc_dich: spec.purpose,
      nguoi_nhan: spec.audience === "mentor" ? "mentor" : spec.audience === "mentee" ? "mentee" : "mentee và mentor",
      quy_tac: [
        "Chỉ dùng đúng các ô điền được liệt kê, viết dạng {{ten_o}}.",
        "Không bịa tên người, tên trường, ngày giờ hay đường dẫn cụ thể.",
        "Không thêm ô điền mới ngoài danh sách.",
        "Độ dài 150–250 từ, chia đoạn ngắn, có thể dùng gạch đầu dòng.",
        "Kết thúc bằng lời chào của Ban tổ chức VAM Mentoring."
      ],
      cac_o_dien: spec.placeholders.map((row) => ({
        o: `{{${row.key}}}`,
        y_nghia: row.label,
        bat_buoc: row.required
      })),
      dinh_dang_tra_ve: { subject: "Tiêu đề thư", body: "Nội dung thư, xuống dòng bằng \\n" }
    },
    null,
    2
  );
}

export type DraftParseResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; message: string };

function extractJson(text: string): string {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

/**
 * Read a draft back. Anything the model invented outside the allowed
 * placeholders is reported, so the organiser is told rather than surprised.
 */
export function parseDraft(text: string, kind: TemplateKind): DraftParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, message: "Không đọc được bản nháp từ mô hình." };
  }

  const row = parsed as { subject?: unknown; body?: unknown };
  const subject = String(row?.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const body = String(row?.body ?? "").replace(/\r\n/g, "\n").trim();

  if (!subject || !body) {
    return { ok: false, message: "Bản nháp thiếu tiêu đề hoặc nội dung." };
  }

  const known = new Set(TEMPLATE_SPECS[kind].placeholders.map((item) => item.key));
  const unknown = extractPlaceholders(`${subject}\n${body}`).filter((key) => !known.has(key));

  return {
    ok: true,
    subject: subject.slice(0, MAX_SUBJECT_LENGTH),
    // An invented placeholder is left visible on purpose: the organiser edits
    // the draft anyway, and a silent deletion would hide what the model did.
    body: unknown.length
      ? `${body}\n\n[Lưu ý: mô hình đã dùng ô không hợp lệ: ${unknown
          .map((key) => `{{${key}}}`)
          .join(", ")} — vui lòng sửa trước khi duyệt.]`.slice(0, MAX_BODY_LENGTH)
      : body.slice(0, MAX_BODY_LENGTH)
  };
}
