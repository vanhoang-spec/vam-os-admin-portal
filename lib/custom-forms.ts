import "server-only";

/**
 * Form tùy chỉnh (BTC 15/10/2026) — phần máy chủ.
 *
 * Hai bảng bật RLS và không cấp gì cho anon/authenticated, nên mọi đọc/ghi đi bằng service role SAU
 * KHI tự kiểm quyền ở đây: phía ban tổ chức qua `operator()` (fail-closed — thiếu tài khoản, tài
 * khoản không active, vai trò không đủ, không có client: đều là "không"); phía công khai chỉ qua
 * mã form và chỉ thấy form đang công khai, chỉ thấy trường đang hiện.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import type { CustomFormAdminResult, CustomFormSavePayload, CustomFormSubmitResult } from "@/lib/custom-form-action-types";
import {
  AUTO_REPLY_DAILY_CAP_PER_FORM,
  AUTO_REPLY_SYSTEM_HEADROOM,
  CUSTOM_FORM_LIMITS,
  replyEmailField,
  checkDefinitionRules,
  checkLockedChanges,
  dedupeEmailField,
  dedupeKeyFor,
  defaultFields,
  formAvailability,
  isCustomFormCode,
  parseFieldDefinitions,
  parseFormSettings,
  publishBlocker,
  storedFields,
  validateAnswers,
  type CustomFormAnswers,
  type CustomFormAvailability,
  type CustomFormField,
  type CustomFormStatus
} from "@/lib/custom-form-core";
import { checkLinkableEvent, listDuplicateFlags, listLinkableEvents, submitEventLinkedForm, EVENT_FORM_MESSAGES, type DuplicateFlag, type LinkableEvent } from "@/lib/custom-form-event";
import { sendCustomFormReceipt } from "@/lib/email";
import { DAILY_EMAIL_LIMIT, QUOTA_WINDOW_MS } from "@/lib/email-quota-core";
import { parseVietnamDateTime } from "@/lib/event-datetime";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import { readAllPages } from "@/lib/paged-read";
import { canManageCustomForms } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;
type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";
const FORM_COLUMNS =
  "id,public_code,title,description,program_id,status,opens_at,closes_at,thank_you,one_per_email,auto_reply,auto_reply_subject,auto_reply_body,fields,event_id,registration_limit,created_at,updated_at";

export type ProgramOption = { id: string; name: string };

export type CustomFormDetail = {
  id: string;
  publicCode: string;
  title: string;
  description: string;
  programId: string | null;
  status: CustomFormStatus;
  opensAt: string | null;
  closesAt: string | null;
  thankYou: string;
  onePerEmail: boolean;
  autoReply: boolean;
  autoReplySubject: string;
  autoReplyBody: string;
  fields: CustomFormField[];
  /** Sự kiện liên kết (VAM00008); null = form độc lập. */
  eventId: string | null;
  /** Giới hạn số đăng ký riêng của form; null = không giới hạn. */
  registrationLimit: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomFormSummary = CustomFormDetail & { programName: string | null; responseCount: number };

export type CustomFormResponse = { id: string; createdAt: string; answers: CustomFormAnswers };

function log(message: string, error?: unknown) {
  console.error(`[custom-forms] ${message}`, error instanceof Error ? error.message : (error as { message?: string })?.message ?? error ?? "");
}

function toDetail(row: Row): CustomFormDetail {
  const status = String(row.status);
  return {
    id: String(row.id),
    publicCode: String(row.public_code),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    programId: row.program_id ? String(row.program_id) : null,
    status: (status === "published" || status === "closed" ? status : "draft") as CustomFormStatus,
    opensAt: row.opens_at ?? null,
    closesAt: row.closes_at ?? null,
    thankYou: String(row.thank_you ?? ""),
    onePerEmail: row.one_per_email === true,
    autoReply: row.auto_reply === true,
    autoReplySubject: String(row.auto_reply_subject ?? ""),
    autoReplyBody: String(row.auto_reply_body ?? ""),
    fields: storedFields(row.fields),
    eventId: row.event_id ? String(row.event_id) : null,
    registrationLimit: row.registration_limit === null || row.registration_limit === undefined ? null : Number(row.registration_limit),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

/** Người đang bấm có được vận hành form không. null = không (fail-closed). */
async function operator(): Promise<{ client: ServiceClient; adminId: string; adminEmail: string } | null> {
  const admin = await getCurrentAdminUser();
  if (!admin || admin.status !== "active" || !canManageCustomForms(admin.role)) return null;
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;
  return { client, adminId: String(admin.id), adminEmail: String(admin.email ?? "").trim() };
}

export async function canOperateCustomForms(): Promise<boolean> {
  return (await operator()) !== null;
}

async function readPrograms(client: ServiceClient): Promise<ProgramOption[]> {
  const { data, error } = await client.from("programs").select("id,code,name").limit(100);
  if (error) throw error;
  return ((data ?? []) as Row[])
    .map((p) => ({ id: String(p.id), name: String(p.name ?? p.code ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

async function countResponses(client: ServiceClient, formId: string): Promise<number> {
  const { count, error } = await client.from("custom_form_responses").select("id", { count: "exact", head: true }).eq("form_id", formId);
  if (error) throw error;
  return Number(count ?? 0);
}

async function readForm(client: ServiceClient, id: string): Promise<CustomFormDetail | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await client.from("custom_forms").select(FORM_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toDetail(data as Row) : null;
}

export type FormsResult<T> = { ok: true; data: T } | { ok: false; message: string };

const DENIED = "Bạn không có quyền dùng Form tùy chỉnh.";

/** Danh sách form, mới tạo nhất trước, kèm số câu trả lời của từng form. */
export async function listCustomForms(): Promise<FormsResult<{ forms: CustomFormSummary[]; programs: ProgramOption[] }>> {
  const op = await operator();
  if (!op) return { ok: false, message: DENIED };
  try {
    const [formsRes, programs] = await Promise.all([
      readAllPages<Row>("custom_forms", FORM_COLUMNS, (columns) => op.client.from("custom_forms").select(columns)),
      readPrograms(op.client)
    ]);
    if (formsRes.error) throw formsRes.error;
    const names = new Map(programs.map((p) => [p.id, p.name]));
    const details = formsRes.data.map(toDetail).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const counts = await Promise.all(details.map((f) => countResponses(op.client, f.id)));
    const forms = details.map((f, i) => ({ ...f, programName: f.programId ? names.get(f.programId) ?? null : null, responseCount: counts[i] }));
    return { ok: true, data: { forms, programs } };
  } catch (error) {
    log("list failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

export async function getCustomFormForEdit(
  id: string
): Promise<FormsResult<{ form: CustomFormDetail; programs: ProgramOption[]; responseCount: number; events: Array<LinkableEvent & { blocker: string | null }> }>> {
  const op = await operator();
  if (!op) return { ok: false, message: DENIED };
  try {
    const form = await readForm(op.client, id);
    if (!form) return { ok: false, message: "Không tìm thấy form." };
    const [programs, responseCount, events] = await Promise.all([
      readPrograms(op.client),
      countResponses(op.client, form.id),
      listLinkableEvents(op.client, form.eventId)
    ]);
    return { ok: true, data: { form, programs, responseCount, events } };
  } catch (error) {
    log("load failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

/** Tạo một form nháp với ba trường mặc định (Họ và tên, Email, Số điện thoại). Trả mã form. */
export async function createCustomForm(): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const op = await operator();
  if (!op) return { ok: false, message: DENIED };
  try {
    const { data, error } = await op.client
      .from("custom_forms")
      .insert({ title: "Form mới", fields: defaultFields(), one_per_email: true, created_by: op.adminId, updated_by: op.adminId })
      .select("id")
      .maybeSingle();
    if (error || !data) throw error ?? new Error("insert returned nothing");
    return { ok: true, id: String((data as Row).id) };
  } catch (error) {
    log("create failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

/**
 * Lưu form từ trình tạo form. Mọi thứ trình duyệt gửi lên được kiểm lại: cài đặt, từng trường, luật
 * "mỗi email một lần cần trường Email", và — khi form đã có câu trả lời — luật không xoá / không đổi
 * loại / không bỏ lựa chọn của trường cũ. Form đang công khai phải còn ít nhất một câu hỏi đang hiện.
 */
export async function saveCustomForm(id: string, payload: CustomFormSavePayload): Promise<CustomFormAdminResult> {
  const op = await operator();
  if (!op) return { ok: false, message: DENIED };
  const input = (payload ?? {}) as Partial<CustomFormSavePayload>;
  const fieldsParsed = parseFieldDefinitions(input.fields);
  if (!fieldsParsed.ok) return { ok: false, message: fieldsParsed.error };
  const opensRaw = String(input.opensAt ?? "").trim();
  const closesRaw = String(input.closesAt ?? "").trim();
  const opensAt = opensRaw ? parseVietnamDateTime(opensRaw) : null;
  const closesAt = closesRaw ? parseVietnamDateTime(closesRaw) : null;
  if ((opensRaw && !opensAt) || (closesRaw && !closesAt)) return { ok: false, message: "Giờ mở/đóng chưa đúng định dạng." };
  const settingsParsed = parseFormSettings({
    title: input.title,
    description: input.description,
    programId: input.programId,
    thankYou: input.thankYou,
    onePerEmail: input.onePerEmail,
    autoReply: input.autoReply,
    autoReplySubject: input.autoReplySubject,
    autoReplyBody: input.autoReplyBody,
    opensAt,
    closesAt,
    eventId: input.eventId,
    registrationLimit: input.registrationLimit
  });
  if (!settingsParsed.ok) return { ok: false, message: settingsParsed.error };
  const fields = fieldsParsed.fields;
  const settings = settingsParsed.settings;
  const ruleError = checkDefinitionRules(fields, settings);
  if (ruleError) return { ok: false, message: ruleError };
  try {
    const current = await readForm(op.client, id);
    if (!current) return { ok: false, message: "Không tìm thấy form." };
    if ((await countResponses(op.client, current.id)) > 0) {
      const locked = checkLockedChanges(current.fields, fields);
      if (locked) return { ok: false, message: locked };
      // Người đã điền đang nằm trong danh sách của sự kiện cũ: đổi sự kiện là tách họ khỏi chỗ đã giữ.
      if ((current.eventId ?? null) !== settings.eventId) {
        return { ok: false, message: "Form đã có câu trả lời — không đổi hay bỏ sự kiện liên kết được nữa." };
      }
    }
    if (settings.eventId) {
      const linkable = await checkLinkableEvent(op.client, settings.eventId);
      if (linkable) return { ok: false, message: linkable };
    }
    if (current.status === "published") {
      const blocker = publishBlocker(fields);
      if (blocker) return { ok: false, message: blocker };
    }
    const { error } = await op.client
      .from("custom_forms")
      .update({
        title: settings.title,
        description: settings.description,
        program_id: settings.programId,
        thank_you: settings.thankYou,
        one_per_email: settings.onePerEmail,
        auto_reply: settings.autoReply,
        auto_reply_subject: settings.autoReplySubject,
        auto_reply_body: settings.autoReplyBody,
        opens_at: settings.opensAt,
        closes_at: settings.closesAt,
        fields,
        event_id: settings.eventId,
        registration_limit: settings.registrationLimit,
        updated_by: op.adminId,
        updated_at: new Date().toISOString()
      })
      .eq("id", current.id);
    if (error) throw error;
    return { ok: true, message: "Đã lưu form." };
  } catch (error) {
    log("save failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

/** Đổi trạng thái: công khai (kiểm form đủ điều kiện), đóng, hoặc về nháp. Chỉ chạm cột trạng thái. */
export async function setCustomFormStatus(id: string, status: string): Promise<CustomFormAdminResult> {
  const op = await operator();
  if (!op) return { ok: false, message: DENIED };
  if (status !== "published" && status !== "closed" && status !== "draft") return { ok: false, message: "Trạng thái không hợp lệ." };
  try {
    const current = await readForm(op.client, id);
    if (!current) return { ok: false, message: "Không tìm thấy form." };
    if (status === "published") {
      const blocker = publishBlocker(current.fields) ?? checkDefinitionRules(current.fields, current);
      if (blocker) return { ok: false, message: blocker };
    }
    if (status === "draft" && (await countResponses(op.client, current.id)) > 0) {
      return { ok: false, message: "Form đã có câu trả lời — không đưa về nháp được, chỉ đóng hoặc mở lại." };
    }
    const { error } = await op.client
      .from("custom_forms")
      .update({ status, updated_by: op.adminId, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    if (error) throw error;
    const message =
      status === "published" ? "Form đã công khai — gửi link cho người điền được rồi." : status === "closed" ? "Đã đóng form: link không nhận câu trả lời mới." : "Đã đưa form về nháp.";
    return { ok: true, message };
  } catch (error) {
    log("status failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

/**
 * Gửi thử thư tự động cho chính người đang soạn — dùng tiêu đề và nội dung ĐANG trên trang (chưa cần
 * lưu), để xem thư hiển thị thế nào trước khi bật. Thư thử ghi rõ là thư thử.
 */
export async function sendCustomFormReceiptTest(id: string, input: { subject: unknown; body: unknown }): Promise<CustomFormAdminResult> {
  const op = await operator();
  if (!op) return { ok: false, message: DENIED };
  if (!op.adminEmail) return { ok: false, message: "Tài khoản của bạn chưa có email để nhận thư thử." };
  const subject = String(input?.subject ?? "").trim();
  const body = String(input?.body ?? "").trim();
  if (!body) return { ok: false, message: "Chưa có nội dung thư." };
  if (subject.length > CUSTOM_FORM_LIMITS.autoReplySubject || body.length > CUSTOM_FORM_LIMITS.autoReplyBody) {
    return { ok: false, message: "Tiêu đề hoặc nội dung thư dài quá giới hạn." };
  }
  try {
    const form = await readForm(op.client, id);
    if (!form) return { ok: false, message: "Không tìm thấy form." };
    const sent = await countSentInWindow(op.client, Date.now());
    if (sent === null) return { ok: false, message: "Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi." };
    if (sent >= DAILY_EMAIL_LIMIT) return { ok: false, message: "Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ." };
    const result = await sendCustomFormReceipt({ toEmail: op.adminEmail, formId: form.id, formTitle: form.title, subject, body, test: true });
    if (result.skipped) return { ok: false, message: "Môi trường này đang tắt gửi thư — thư thử chưa đi." };
    if (!result.ok) return { ok: false, message: "Gửi thư thử không thành công. Xem Vận hành → Mail → Nhật ký gửi." };
    return { ok: true, message: `Đã gửi thư thử tới ${op.adminEmail}.` };
  } catch (error) {
    log("test receipt failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

/** Câu trả lời của một form, mới nhất trước. */
export async function listCustomFormResponses(id: string): Promise<FormsResult<{ form: CustomFormDetail; responses: CustomFormResponse[] }>> {
  const op = await operator();
  if (!op) return { ok: false, message: DENIED };
  try {
    const form = await readForm(op.client, id);
    if (!form) return { ok: false, message: "Không tìm thấy form." };
    const res = await readAllPages<Row>("custom_form_responses", "id,answers,created_at", (columns) =>
      op.client.from("custom_form_responses").select(columns).eq("form_id", form.id)
    );
    if (res.error) throw res.error;
    const responses = res.data
      .map((r) => ({ id: String(r.id), createdAt: String(r.created_at ?? ""), answers: (r.answers ?? {}) as CustomFormAnswers }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { ok: true, data: { form, responses } };
  } catch (error) {
    log("responses failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

// ---------------------------------------------------------------------------
// Phía công khai — /f/<mã>. Người điền không đăng nhập.
// ---------------------------------------------------------------------------

export type PublicCustomForm =
  | { state: "invalid" }
  | {
      state: "ready";
      availability: CustomFormAvailability;
      title: string;
      description: string;
      /** Chỉ các trường đang hiện — trường ẩn không bao giờ rời máy chủ. */
      fields: CustomFormField[];
      opensAt: string | null;
      closesAt: string | null;
    };

async function readPublicRow(client: ServiceClient, code: string): Promise<Row | null> {
  const { data, error } = await client
    .from("custom_forms")
    .select("id,title,description,status,opens_at,closes_at,thank_you,one_per_email,auto_reply,auto_reply_subject,auto_reply_body,fields,event_id,registration_limit")
    .eq("public_code", code)
    .maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}

export async function getPublicCustomForm(code: string, nowMs = Date.now()): Promise<PublicCustomForm | { state: "error" }> {
  if (!isCustomFormCode(code)) return { state: "invalid" };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { state: "error" };
  try {
    const row = await readPublicRow(client, code);
    if (!row) return { state: "invalid" };
    const availability = formAvailability({ status: String(row.status), opensAt: row.opens_at ?? null, closesAt: row.closes_at ?? null }, nowMs);
    // Form nháp: không lộ tiêu đề hay câu hỏi cho người đoán trúng mã.
    if (availability === "draft") return { state: "ready", availability, title: "", description: "", fields: [], opensAt: null, closesAt: null };
    return {
      state: "ready",
      availability,
      title: String(row.title ?? ""),
      description: String(row.description ?? ""),
      fields: storedFields(row.fields).filter((f) => !f.hidden),
      opensAt: row.opens_at ?? null,
      closesAt: row.closes_at ?? null
    };
  } catch (error) {
    log("public load failed", error);
    return { state: "error" };
  }
}

const DEFAULT_THANKS = "Đã nhận câu trả lời của bạn. Cảm ơn bạn đã dành thời gian!";

/**
 * Thư tự động sau một lần gửi đã GHI xong (BTC 15/10/2026). Không bao giờ làm hỏng lần gửi: câu trả
 * lời đã lưu, lỗi thư chỉ ghi log. Ai cũng gõ được email bất kỳ vào form công khai, nên trước khi gửi
 * kiểm hai trần: trần chung của hệ thống (chừa AUTO_REPLY_SYSTEM_HEADROOM thư cho thư mời, xác nhận
 * lịch…) và trần riêng của form — chạm trần thì bỏ qua thư, không bỏ qua câu trả lời.
 */
async function sendReceiptAfterSubmit(client: ServiceClient, row: Row, fields: CustomFormField[], answers: CustomFormAnswers, nowMs: number): Promise<void> {
  try {
    if (row.auto_reply !== true) return;
    const body = String(row.auto_reply_body ?? "").trim();
    const field = replyEmailField(fields);
    const to = field ? answers[field.id] : undefined;
    if (!body || typeof to !== "string" || !to) return;
    const sent = await countSentInWindow(client, nowMs);
    if (sent === null || sent >= DAILY_EMAIL_LIMIT - AUTO_REPLY_SYSTEM_HEADROOM) {
      log("auto reply skipped: system quota", sent);
      return;
    }
    const { count, error } = await client
      .from("outbound_emails")
      .select("id", { count: "exact", head: true })
      .eq("kind", "custom_form_receipt")
      .eq("related_id", String(row.id))
      .in("status", ["sent", "queued"])
      .gte("created_at", new Date(nowMs - QUOTA_WINDOW_MS).toISOString());
    if (error || Number(count ?? 0) >= AUTO_REPLY_DAILY_CAP_PER_FORM) {
      log("auto reply skipped: form cap", error ?? count);
      return;
    }
    const result = await sendCustomFormReceipt({
      toEmail: to,
      formId: String(row.id),
      formTitle: String(row.title ?? ""),
      subject: String(row.auto_reply_subject ?? ""),
      body
    });
    if (!result.ok) log("auto reply failed", result.reason);
  } catch (error) {
    log("auto reply crashed", error);
  }
}

/**
 * Nhận một lần gửi. Kiểm lại MỌI thứ ở máy chủ theo định nghĩa đã lưu (không theo cái trang gửi kèm):
 * form còn mở, ô đồng ý đã tích, từng câu trả lời đúng loại và đủ bắt buộc. Ô bẫy (người thật không
 * thấy) có chữ thì coi là máy tự điền: trả lời như đã nhận nhưng không ghi gì.
 */
export async function submitPublicCustomForm(
  code: string,
  input: { values: unknown; consent: unknown; trap: unknown },
  nowMs = Date.now()
): Promise<CustomFormSubmitResult> {
  const fail = (message: string, errors: Record<string, string> = {}): CustomFormSubmitResult => ({ ok: false, message, errors });
  if (!isCustomFormCode(code)) return fail("Không tìm thấy form.");
  const client = getSupabaseServiceRoleClient();
  if (!client) return fail(SAFE_ERROR);
  try {
    const row = await readPublicRow(client, code);
    if (!row) return fail("Không tìm thấy form.");
    const availability = formAvailability({ status: String(row.status), opensAt: row.opens_at ?? null, closesAt: row.closes_at ?? null }, nowMs);
    if (availability !== "open") return fail(availability === "not_open" ? "Form chưa mở nhận câu trả lời." : "Form đã đóng, không nhận thêm câu trả lời.");
    const thanks = String(row.thank_you ?? "").trim() || DEFAULT_THANKS;
    if (String(input.trap ?? "").trim()) return { ok: true, message: thanks, errors: {} };
    if (input.consent !== true) return fail("Vui lòng tích ô đồng ý ở cuối form trước khi gửi.");

    const fields = storedFields(row.fields);
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values) ? (input.values as Record<string, unknown>) : {};
    const read = (fieldId: string): string[] => {
      const value = Object.prototype.hasOwnProperty.call(values, fieldId) ? values[fieldId] : undefined;
      if (Array.isArray(value)) return value.map((v) => String(v ?? ""));
      return value === undefined || value === null ? [] : [String(value)];
    };
    const checked = validateAnswers(fields, read);
    if (!checked.ok) return fail("Một vài mục chưa đúng — xem chữ đỏ dưới từng mục.", checked.errors);

    const dedupeKey = dedupeKeyFor(fields, checked.answers, row.one_per_email === true);
    // Form gắn sự kiện (VAM00008): đăng ký đi vào danh sách người tham gia của sự kiện; thư xác nhận
    // kèm vé QR của sự kiện thay cho thư tự động của form.
    if (row.event_id) {
      if (!dedupeKey) return fail(SAFE_ERROR);
      return await submitEventLinkedForm({ client, form: row, fields, answers: checked.answers, email: dedupeKey, thanks, nowMs });
    }
    const duplicate = () => {
      const emailField = dedupeEmailField(fields);
      const message = "Email này đã gửi form rồi — mỗi email chỉ gửi một lần.";
      return fail(message, emailField ? { [emailField.id]: message } : {});
    };
    const row0 = { answers: checked.answers, dedupe_key: dedupeKey, consent_at: new Date(nowMs).toISOString() };
    if (row.registration_limit !== null && row.registration_limit !== undefined) {
      // Giới hạn riêng: đếm và ghi dưới khoá theo form, hai người bấm cùng lúc không cùng lấy chỗ cuối.
      const { data, error } = await client.rpc("vam_custom_form_insert_response", {
        p_form_id: String(row.id),
        p_limit: Number(row.registration_limit),
        p_row: row0
      });
      if (error) throw error;
      const status = String((data as { status?: string } | null)?.status ?? "");
      if (status === "full") return fail(EVENT_FORM_MESSAGES.formFull);
      if (status === "duplicate") return duplicate();
      if (status !== "inserted") throw new Error(`insert_response returned ${status}`);
    } else {
      const { error } = await client.from("custom_form_responses").insert({ form_id: String(row.id), ...row0 });
      if (error) {
        if ((error as { code?: string }).code === "23505") return duplicate();
        throw error;
      }
    }
    await sendReceiptAfterSubmit(client, row, fields, checked.answers, nowMs);
    return { ok: true, message: thanks, errors: {} };
  } catch (error) {
    log("submit failed", error);
    return fail(SAFE_ERROR);
  }
}

/** Cảnh báo "email trùng, họ tên khác" của form gắn sự kiện (VAM00008) — chỉ BTC thấy. */
export async function listCustomFormDuplicateFlags(id: string): Promise<FormsResult<DuplicateFlag[]>> {
  const op = await operator();
  if (!op) return { ok: false, message: DENIED };
  try {
    const form = await readForm(op.client, id);
    if (!form) return { ok: false, message: "Không tìm thấy form." };
    if (!form.eventId) return { ok: true, data: [] };
    return { ok: true, data: await listDuplicateFlags(op.client, form.id) };
  } catch (error) {
    log("duplicate flags failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}
