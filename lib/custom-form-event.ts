import "server-only";

/**
 * Form tùy chỉnh ↔ Sự kiện (đề xuất VAM00008, 30/10/2026).
 *
 * Form gắn một sự kiện thì người điền được ghi THẲNG vào `event_registrations` — đúng bảng mà trang
 * Sự kiện, vé QR, check-in và nút huỷ đang dùng — chứ không phải một danh sách thứ hai được đồng bộ
 * số. Câu trả lời đầy đủ vẫn nằm ở `custom_form_responses`, nối sang đăng ký bằng
 * `event_registration_id`.
 *
 * Chỗ ngồi: hàm `vam_custom_form_event_register` (migration 20261030120000) kiểm sức chứa sự kiện và
 * giới hạn riêng của form DƯỚI KHOÁ theo sự kiện, nên hai người bấm cùng lúc không cùng lấy chỗ cuối.
 *
 * Gửi lại (luật của đề xuất):
 *   - cùng email + cùng họ tên → cập nhật bản cũ; không đăng ký mới, không gửi lại thư hay QR;
 *   - cùng email + khác họ tên → KHÔNG ghi đè; lưu một cảnh báo cho BTC (`custom_form_duplicate_flags`),
 *     người điền chỉ thấy lời cảm ơn bình thường;
 *   - khác email → là người khác (dù trùng họ tên).
 * Đăng ký cũ đã bị huỷ thì gửi lại là đăng ký mới (xin lại chỗ).
 */
import type { CustomFormSubmitResult } from "@/lib/custom-form-action-types";
import { nameField, type CustomFormAnswers, type CustomFormField } from "@/lib/custom-form-core";
import { escapeIlikePattern, normalizeEmail } from "@/lib/identity";
import type { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;
type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
/** So họ tên: bỏ dấu, chữ thường, gộp khoảng trắng — "Nguyễn  văn An" và "nguyen van an" là một tên. */
export function sameName(a: unknown, b: unknown): boolean {
  const fold = (v: unknown) =>
    String(v ?? "")
      .normalize("NFD")
      .replace(COMBINING_MARKS, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  const left = fold(a);
  return left !== "" && left === fold(b);
}

export type LinkableEvent = { id: string; name: string; startsAt: string | null; capacity: number | null; status: string };

/** Sự kiện cần thứ form tùy chỉnh không thu được (minh chứng, phí, bữa ăn) thì không gắn được. */
export function linkBlocker(event: Row | null): string | null {
  if (!event) return "Không tìm thấy sự kiện liên kết.";
  if (String(event.status ?? "active") === "cancelled") return "Sự kiện này đã huỷ — không gắn form được.";
  if (event.proof_required_for_registration === true) return "Sự kiện yêu cầu minh chứng khi đăng ký — form tùy chỉnh không thu được, hãy dùng link đăng ký của sự kiện.";
  if (event.fee_required === true || event.payment_proof_required === true) return "Sự kiện có thu phí — form tùy chỉnh không thu được ảnh chuyển khoản, hãy dùng link đăng ký của sự kiện.";
  if (event.meal_option_enabled === true) return "Sự kiện có tuỳ chọn bữa ăn — form tùy chỉnh chưa hỗ trợ, hãy dùng link đăng ký của sự kiện.";
  return null;
}

const EVENT_LINK_COLUMNS = "id,event_name,starts_at,status,capacity_limit_enabled,capacity_limit,proof_required_for_registration,fee_required,payment_proof_required,meal_option_enabled";

export async function checkLinkableEvent(client: ServiceClient, eventId: string): Promise<string | null> {
  const { data, error } = await client.from("events").select(EVENT_LINK_COLUMNS).eq("id", eventId).maybeSingle();
  if (error) throw error;
  return linkBlocker((data as Row | null) ?? null);
}

/**
 * Sự kiện chọn được để gắn: chưa huỷ, bắt đầu từ hôm qua trở đi, cộng sự kiện đang gắn (kể cả đã qua) để
 * ô chọn không mất giá trị đang lưu. Sự kiện không gắn được vẫn hiện, kèm lý do.
 */
export async function listLinkableEvents(client: ServiceClient, currentEventId: string | null, nowMs = Date.now()): Promise<Array<LinkableEvent & { blocker: string | null }>> {
  const since = new Date(nowMs - 24 * 60 * 60_000).toISOString();
  const { data, error } = await client
    .from("events")
    .select(EVENT_LINK_COLUMNS)
    .neq("status", "cancelled")
    .gte("starts_at", since)
    .order("starts_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  const rows = [...((data ?? []) as Row[])];
  if (currentEventId && !rows.some((r) => String(r.id) === currentEventId)) {
    const { data: current, error: currentError } = await client.from("events").select(EVENT_LINK_COLUMNS).eq("id", currentEventId).maybeSingle();
    if (currentError) throw currentError;
    if (current) rows.unshift(current as Row);
  }
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.event_name ?? ""),
    startsAt: r.starts_at ?? null,
    capacity: r.capacity_limit_enabled === true && r.capacity_limit != null ? Number(r.capacity_limit) : null,
    status: String(r.status ?? "active"),
    blocker: linkBlocker(r)
  }));
}

export type DuplicateFlag = { id: string; createdAt: string; submittedName: string; submittedEmail: string; existingName: string; resolvedAt: string | null };

export async function listDuplicateFlags(client: ServiceClient, formId: string): Promise<DuplicateFlag[]> {
  const { data, error } = await client
    .from("custom_form_duplicate_flags")
    .select("id,created_at,submitted_name,submitted_email,existing_name,resolved_at")
    .eq("form_id", formId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at ?? ""),
    submittedName: String(r.submitted_name ?? ""),
    submittedEmail: String(r.submitted_email ?? ""),
    existingName: String(r.existing_name ?? ""),
    resolvedAt: r.resolved_at ?? null
  }));
}

type RegisterResult = { status: string; id?: string; full_name?: string; registration_status?: string };

export const EVENT_FORM_MESSAGES = {
  updated: "Đã cập nhật đăng ký của bạn.",
  eventFull: "Sự kiện đã đủ số lượng đăng ký. Vui lòng liên hệ BTC nếu cần hỗ trợ.",
  formFull: "Form đã đủ số lượng đăng ký.",
  eventClosed: "Sự kiện đã đóng đăng ký."
} as const;

/**
 * Nhận một lần gửi của form gắn sự kiện. Câu trả lời đã qua `validateAnswers`; email đã chuẩn hoá.
 * Lỗi hạ tầng ném ra để nơi gọi trả "Hệ thống đang bận" — không bao giờ báo "đã đăng ký" khi chưa ghi.
 */
export async function submitEventLinkedForm(input: {
  client: ServiceClient;
  form: Row;
  fields: CustomFormField[];
  answers: CustomFormAnswers;
  email: string;
  thanks: string;
  nowMs: number;
}): Promise<CustomFormSubmitResult> {
  const { client, form, fields, answers, thanks, nowMs } = input;
  const ok = (message: string): CustomFormSubmitResult => ({ ok: true, message, errors: {} });
  const fail = (message: string): CustomFormSubmitResult => ({ ok: false, message, errors: {} });
  const formId = String(form.id);
  const eventId = String(form.event_id);
  const email = normalizeEmail(input.email);
  const nameF = nameField(fields);
  const fullName = nameF ? String(answers[nameF.id] ?? "").trim() : "";
  const phoneF = fields.find((f) => f.type === "phone");
  const phone = phoneF && typeof answers[phoneF.id] === "string" ? String(answers[phoneF.id]) : null;
  const nowIso = new Date(nowMs).toISOString();

  const { data: event, error: eventError } = await client.from("events").select("*").eq("id", eventId).maybeSingle();
  if (eventError) throw eventError;
  if (linkBlocker((event as Row | null) ?? null)) return fail(EVENT_FORM_MESSAGES.eventClosed);

  const flag = async (existingName: string, refs: { existingResponseId?: string | null; registrationId?: string | null }) => {
    const { error } = await client.from("custom_form_duplicate_flags").insert({
      form_id: formId,
      existing_response_id: refs.existingResponseId ?? null,
      event_registration_id: refs.registrationId ?? null,
      submitted_name: fullName,
      submitted_email: email,
      existing_name: existingName,
      answers,
      reason: "email_trung_ten_khac"
    });
    if (error) throw error;
    // Người điền không được biết có cảnh báo (đề xuất): họ thấy lời cảm ơn như mọi lần gửi.
    return ok(thanks);
  };

  // Chỉ cập nhật phần người ta vừa khai lại. Trạng thái chỗ, điểm danh và vé (checkin_code) giữ nguyên —
  // cùng nếp với registerForEvent khi ghi đè.
  const refreshRegistration = async (registrationId: string, claimForm: boolean) => {
    const update: Row = { full_name: fullName, phone, updated_at: nowIso };
    let query = client.from("event_registrations").update(update).eq("id", registrationId);
    const { error } = await query;
    if (error) throw error;
    if (claimForm) {
      query = client.from("event_registrations").update({ custom_form_id: formId }).eq("id", registrationId).is("custom_form_id", null);
      const { error: claimError } = await query;
      if (claimError) throw claimError;
    }
  };

  const register = async (): Promise<RegisterResult> => {
    const { data: people, error: peopleError } = await client
      .from("people")
      .select("id,email_primary")
      .ilike("email_primary", escapeIlikePattern(email))
      .limit(5);
    if (peopleError) throw peopleError;
    const person = ((people ?? []) as Row[]).find((p) => normalizeEmail(p.email_primary) === email);
    const ev = event as Row;
    const payload: Row = {
      series_id: ev.series_id ?? null,
      linked_person_id: person?.id ?? null,
      full_name: fullName,
      email,
      phone,
      notes: `Đăng ký qua form “${String(form.title ?? "")}”`,
      consent_given: true,
      registration_source: "public_form",
      attendance_status: "pending",
      is_walk_in: false,
      match_method: person ? "exact_email" : "unlinked",
      match_review_status: person ? "auto_linked" : "pending_review",
      matched_at: person ? nowIso : null,
      proof_status: "not_required",
      payment_status: "not_required",
      review_status: ev.approval_required === true ? "pending" : "not_required",
      meal_selected: false,
      schedule_notified_for: ev.starts_at ?? null
    };
    const limit = form.registration_limit === null || form.registration_limit === undefined ? null : Number(form.registration_limit);
    const { data, error } = await client.rpc("vam_custom_form_event_register", {
      p_event_id: eventId,
      p_form_id: formId,
      p_form_limit: limit,
      p_payload: payload
    });
    if (error) throw error;
    return (data ?? { status: "error" }) as RegisterResult;
  };

  const confirm = async (registrationId: string, registrationStatus: string | undefined) => {
    // Nạp chậm: lib/events kéo theo cả phần quyền của trang Sự kiện; chỉ cần khi có vé mới để gửi.
    const { issueTicketAndConfirm } = await import("@/lib/events");
    await issueTicketAndConfirm({
      registrationId,
      event: event as Row,
      toEmail: email,
      fullName,
      pendingApproval: (registrationStatus ?? "registered") !== "registered"
    });
  };

  const fullOrClosed = (status: string): CustomFormSubmitResult | null => {
    if (status === "event_full") return fail(EVENT_FORM_MESSAGES.eventFull);
    if (status === "form_full") return fail(EVENT_FORM_MESSAGES.formFull);
    if (status === "event_closed") return fail(EVENT_FORM_MESSAGES.eventClosed);
    if (status !== "inserted" && status !== "existing") throw new Error(`register returned ${status}`);
    return null;
  };

  // 1) Đã có câu trả lời của email này ở form này?
  const { data: prior, error: priorError } = await client
    .from("custom_form_responses")
    .select("id,answers,event_registration_id")
    .eq("form_id", formId)
    .eq("dedupe_key", email)
    .maybeSingle();
  if (priorError) throw priorError;

  if (prior) {
    const priorRow = prior as Row;
    const priorName = nameF ? String((priorRow.answers ?? {})[nameF.id] ?? "") : "";
    if (!sameName(priorName, fullName)) return flag(priorName, { existingResponseId: String(priorRow.id), registrationId: priorRow.event_registration_id ?? null });

    let active: Row | null = null;
    if (priorRow.event_registration_id) {
      const { data: reg, error: regError } = await client
        .from("event_registrations")
        .select("id,registration_status")
        .eq("id", String(priorRow.event_registration_id))
        .maybeSingle();
      if (regError) throw regError;
      if (reg && String((reg as Row).registration_status) !== "cancelled") active = reg as Row;
    }
    if (active) {
      await refreshRegistration(String(active.id), false);
      const { error } = await client.from("custom_form_responses").update({ answers, updated_at: nowIso }).eq("id", String(priorRow.id));
      if (error) throw error;
      return ok(EVENT_FORM_MESSAGES.updated);
    }
    // Đăng ký cũ đã huỷ (hoặc không còn): xin lại chỗ.
    const result = await register();
    const stop = fullOrClosed(result.status);
    if (stop) return stop;
    if (result.status === "existing") {
      if (!sameName(result.full_name, fullName)) return flag(String(result.full_name ?? ""), { existingResponseId: String(priorRow.id), registrationId: result.id ?? null });
      await refreshRegistration(String(result.id), true);
    }
    const { error } = await client
      .from("custom_form_responses")
      .update({ answers, event_registration_id: result.id ?? null, updated_at: nowIso })
      .eq("id", String(priorRow.id));
    if (error) throw error;
    if (result.status === "inserted") {
      await confirm(String(result.id), result.registration_status);
      return ok(thanks);
    }
    return ok(EVENT_FORM_MESSAGES.updated);
  }

  // 2) Lần gửi đầu ở form này.
  const result = await register();
  const stop = fullOrClosed(result.status);
  if (stop) return stop;
  if (result.status === "existing" && !sameName(result.full_name, fullName)) {
    return flag(String(result.full_name ?? ""), { registrationId: result.id ?? null });
  }
  if (result.status === "existing") await refreshRegistration(String(result.id), true);
  const { error: insertError } = await client.from("custom_form_responses").insert({
    form_id: formId,
    answers,
    dedupe_key: email,
    consent_at: nowIso,
    event_registration_id: result.id ?? null
  });
  // Hai lần bấm gần nhau: lần kia đã ghi câu trả lời; đăng ký đã có — không báo lỗi cho người điền.
  if (insertError && (insertError as { code?: string }).code !== "23505") throw insertError;
  if (result.status === "inserted") {
    await confirm(String(result.id), result.registration_status);
    return ok(thanks);
  }
  return ok(EVENT_FORM_MESSAGES.updated);
}
