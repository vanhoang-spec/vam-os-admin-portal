"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import type { BulkAddActionState, EventActionState } from "@/lib/event-action-types";
import {
  addParticipation,
  bulkAddEventParticipants,
  cancelEvent,
  createCheckinLinkForEvent,
  createRegistrationLinkForEvent,
  addSessionToSeries,
  removeSessionFromSeries,
  notifyScheduleChange,
  updateSessionTime,
  createEvent,
  createEventSeries,
  removeParticipation,
  setRegistrationLinkActive,
  updateEvent,
  updateParticipation
} from "@/lib/events";

const initialState: EventActionState = { ok: false, message: null };

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function ensureAuth(): Promise<EventActionState | null> {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return { ok: false, message: "Bạn không có quyền quản lý sự kiện." };
  }
  return null;
}

export async function createEventAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  // Lặp lại là một hộp tick trên form, không phải một hành động riêng: người
  // tạo nghĩ "sự kiện này lặp hằng tuần", không nghĩ "tôi muốn tạo một chuỗi".
  const repeats = formData.get("recurrence_enabled") === "true";
  const create = repeats ? createEventSeries : createEvent;

  const result = await create({
    event_name: formText(formData, "event_name"),
    recurrence_frequency: formText(formData, "recurrence_frequency"),
    recurrence_interval: formText(formData, "recurrence_interval"),
    recurrence_monthly_mode: formText(formData, "recurrence_monthly_mode"),
    recurrence_end_mode: formText(formData, "recurrence_end_mode"),
    recurrence_ends_on: formText(formData, "recurrence_ends_on"),
    recurrence_count: formText(formData, "recurrence_count"),
    event_type: formText(formData, "event_type"),
    season_code: formText(formData, "season_code"),
    intake_batch_id: formText(formData, "intake_batch_id"),
    starts_at: formText(formData, "starts_at"),
    ends_at: formText(formData, "ends_at"),
    event_format: formText(formData, "event_format"),
    location_name: formText(formData, "location_name"),
    location_address: formText(formData, "location_address"),
    location_map_url: formText(formData, "location_map_url"),
    online_join_url: formText(formData, "online_join_url"),
    source_notes: formText(formData, "source_notes"),
    legacy_event_temp_id: formText(formData, "legacy_event_temp_id"),
    registration_required: formText(formData, "registration_required"),
    approval_required: formText(formData, "approval_required"),
    capacity_limit_enabled: formText(formData, "capacity_limit_enabled"),
    capacity_limit: formText(formData, "capacity_limit"),
    waitlist_enabled: formText(formData, "waitlist_enabled"),
    // Checkboxes that default-true use has() to distinguish "unchecked" from "absent":
    // pass explicit "true"/"false" so the lib function never receives undefined.
    allow_walk_in: formData.has("allow_walk_in") ? "true" : "false",
    qr_checkin_enabled: formData.has("qr_checkin_enabled") ? "true" : "false",
    // Chỉ gửi khi form có phần thiết lập các lần quét. Hàm ghi đọc "có khoá này"
    // là "BTC vừa lưu danh sách mới"; một form không có phần đó không được đổi nó.
    ...(formData.has("checkin_steps_present")
      ? { checkin_steps: formData.getAll("checkin_steps").map((value) => String(value)) }
      : {}),
    checkin_mode: formText(formData, "checkin_mode"),
    checkin_window_enabled: formText(formData, "checkin_window_enabled"),
    checkin_opens_at: formText(formData, "checkin_opens_at"),
    checkin_closes_at: formText(formData, "checkin_closes_at"),
    proof_required: formText(formData, "proof_required"),
    proof_label: formText(formData, "proof_label"),
    proof_description: formText(formData, "proof_description"),
    proof_required_for_registration: formText(formData, "proof_required_for_registration"),
    proof_required_for_checkin: formText(formData, "proof_required_for_checkin"),
    question_collection_enabled: formText(formData, "question_collection_enabled"),
    speaker_question_label: formText(formData, "speaker_question_label"),
    no_show_policy_enabled: formText(formData, "no_show_policy_enabled"),
    no_show_policy_text: formText(formData, "no_show_policy_text"),
    fee_required: formText(formData, "fee_required"),
    fee_amount: formText(formData, "fee_amount"),
    fee_currency: formText(formData, "fee_currency"),
    fee_description: formText(formData, "fee_description"),
    payment_instruction: formText(formData, "payment_instruction"),
    payment_proof_required: formText(formData, "payment_proof_required"),
    // Phase 2B: optional meal add-on
    meal_option_enabled: formData.has("meal_option_enabled") ? "true" : "false",
    meal_label: formText(formData, "meal_label"),
    meal_fee_amount: formText(formData, "meal_fee_amount"),
    meal_fee_currency: formText(formData, "meal_fee_currency"),
    meal_payment_instruction: formText(formData, "meal_payment_instruction"),
    meal_payment_proof_required: formData.has("meal_payment_proof_required") ? "true" : "false",
    event_description: formText(formData, "event_description"),
    show_student_id_field: formData.has("show_student_id_field") ? "true" : "false",
    student_id_required: formText(formData, "student_id_required"),
    show_mentee_code_field: formText(formData, "show_mentee_code_field"),
    mentee_code_required: formText(formData, "mentee_code_required"),
    show_school_field: formText(formData, "show_school_field"),
    show_program_field: formText(formData, "show_program_field"),
    show_role_text_field: formText(formData, "show_role_text_field"),
    show_notes_field: formText(formData, "show_notes_field")
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/events");
  revalidatePath("/operations");

  return {
    ok: true,
    message: result.message,
    createdEventId: (result.data?.id as string) ?? null
  };
}

export async function updateEventAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const id = formText(formData, "id");
  if (!id) return { ok: false, message: "Thiếu event id." };

  const result = await updateEvent({
    id,
    event_name: formText(formData, "event_name"),
    event_type: formText(formData, "event_type"),
    season_code: formText(formData, "season_code"),
    intake_batch_id: formText(formData, "intake_batch_id"),
    starts_at: formText(formData, "starts_at"),
    ends_at: formText(formData, "ends_at"),
    event_format: formText(formData, "event_format"),
    location_name: formText(formData, "location_name"),
    location_address: formText(formData, "location_address"),
    location_map_url: formText(formData, "location_map_url"),
    online_join_url: formText(formData, "online_join_url"),
    source_notes: formText(formData, "source_notes"),
    legacy_event_temp_id: formText(formData, "legacy_event_temp_id"),
    registration_required: formText(formData, "registration_required"),
    approval_required: formText(formData, "approval_required"),
    capacity_limit_enabled: formText(formData, "capacity_limit_enabled"),
    capacity_limit: formText(formData, "capacity_limit"),
    waitlist_enabled: formText(formData, "waitlist_enabled"),
    // Checkboxes that default-true use has() to distinguish "unchecked" from "absent":
    // pass explicit "true"/"false" so the lib function never receives undefined.
    allow_walk_in: formData.has("allow_walk_in") ? "true" : "false",
    qr_checkin_enabled: formData.has("qr_checkin_enabled") ? "true" : "false",
    // Chỉ gửi khi form có phần thiết lập các lần quét. Hàm ghi đọc "có khoá này"
    // là "BTC vừa lưu danh sách mới"; một form không có phần đó không được đổi nó.
    ...(formData.has("checkin_steps_present")
      ? { checkin_steps: formData.getAll("checkin_steps").map((value) => String(value)) }
      : {}),
    checkin_mode: formText(formData, "checkin_mode"),
    checkin_window_enabled: formText(formData, "checkin_window_enabled"),
    checkin_opens_at: formText(formData, "checkin_opens_at"),
    checkin_closes_at: formText(formData, "checkin_closes_at"),
    proof_required: formText(formData, "proof_required"),
    proof_label: formText(formData, "proof_label"),
    proof_description: formText(formData, "proof_description"),
    proof_required_for_registration: formText(formData, "proof_required_for_registration"),
    proof_required_for_checkin: formText(formData, "proof_required_for_checkin"),
    question_collection_enabled: formText(formData, "question_collection_enabled"),
    speaker_question_label: formText(formData, "speaker_question_label"),
    no_show_policy_enabled: formText(formData, "no_show_policy_enabled"),
    no_show_policy_text: formText(formData, "no_show_policy_text"),
    fee_required: formText(formData, "fee_required"),
    fee_amount: formText(formData, "fee_amount"),
    fee_currency: formText(formData, "fee_currency"),
    fee_description: formText(formData, "fee_description"),
    payment_instruction: formText(formData, "payment_instruction"),
    payment_proof_required: formText(formData, "payment_proof_required"),
    // Phase 2B: optional meal add-on
    meal_option_enabled: formData.has("meal_option_enabled") ? "true" : "false",
    meal_label: formText(formData, "meal_label"),
    meal_fee_amount: formText(formData, "meal_fee_amount"),
    meal_fee_currency: formText(formData, "meal_fee_currency"),
    meal_payment_instruction: formText(formData, "meal_payment_instruction"),
    meal_payment_proof_required: formData.has("meal_payment_proof_required") ? "true" : "false",
    event_description: formText(formData, "event_description"),
    show_student_id_field: formData.has("show_student_id_field") ? "true" : "false",
    student_id_required: formText(formData, "student_id_required"),
    show_mentee_code_field: formText(formData, "show_mentee_code_field"),
    mentee_code_required: formText(formData, "mentee_code_required"),
    show_school_field: formText(formData, "show_school_field"),
    show_program_field: formText(formData, "show_program_field"),
    show_role_text_field: formText(formData, "show_role_text_field"),
    show_notes_field: formText(formData, "show_notes_field")
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/events");
  revalidatePath(`/events/${id}/edit`);
  revalidatePath(`/events/${id}/attendance`);
  revalidatePath("/operations");

  // Lưu làm thứ tự các buổi trong chuỗi đổi (hoặc chưa sắp lại được) thì nói ra
  // ngay tại đây: người vừa dời ngày cần biết buổi này giờ là buổi mấy, trước khi
  // gửi link hay thông báo cho người đăng ký.
  const note = result.message.startsWith(UPDATE_EVENT_OK) ? result.message.slice(UPDATE_EVENT_OK.length).trim() : "";
  return { ok: true, message: note ? `Đã lưu thay đổi sự kiện thành công. ${note}` : "Đã lưu thay đổi sự kiện thành công." };
}

/** Câu mở đầu mọi lời báo thành công của `updateEvent`; phần ghi chú nằm sau nó. */
const UPDATE_EVENT_OK = "Đã cập nhật sự kiện.";

export async function addParticipationAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const eventId = formText(formData, "event_id");
  const personId = formText(formData, "person_id");
  if (!eventId) return { ok: false, message: "Thiếu event id." };
  if (!personId) return { ok: false, message: "Vui lòng chọn người tham gia." };

  const result = await addParticipation({
    event_id: eventId,
    person_id: personId,
    role_at_event: formText(formData, "role_at_event") || "mentee",
    attendance_status: formText(formData, "attendance_status") || "unknown",
    registration_status: formText(formData, "registration_status") || "registered",
    attendance_date: formText(formData, "attendance_date"),
    admin_notes: formText(formData, "admin_notes"),
    excuse_reason: formText(formData, "excuse_reason"),
    walk_in: formText(formData, "walk_in") === "true" ? "true" : "false"
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/events/${eventId}/attendance`);
  revalidatePath("/events");
  revalidatePath("/operations");
  return { ok: true, message: result.message };
}

export async function updateParticipationAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const id = formText(formData, "id");
  const eventId = formText(formData, "event_id");
  if (!id) return { ok: false, message: "Thiếu participation id." };

  const updates: Record<string, unknown> = {
    id,
    attendance_status: formText(formData, "attendance_status") || "unknown",
    role_at_event: formText(formData, "role_at_event") || "mentee",
    admin_notes: formText(formData, "admin_notes")
  };

  if (formData.has("attendance_date")) {
    updates.attendance_date = formText(formData, "attendance_date");
  }
  if (formData.has("registration_status")) {
    updates.registration_status = formText(formData, "registration_status") || "registered";
  }

  const result = await updateParticipation(updates);
  if (!result.ok) return { ok: false, message: result.message };

  if (eventId) {
    revalidatePath(`/events/${eventId}/attendance`);
  }
  revalidatePath("/events");
  revalidatePath("/operations");
  return { ok: true, message: result.message };
}

export async function removeParticipationAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const id = formText(formData, "id");
  const eventId = formText(formData, "event_id");
  if (!id) return { ok: false, message: "Thiếu participation id." };

  const result = await removeParticipation({ id, reason: formText(formData, "reason") });
  if (!result.ok) return { ok: false, message: result.message };

  if (eventId) {
    revalidatePath(`/events/${eventId}/attendance`);
  }
  revalidatePath("/events");
  revalidatePath("/operations");
  return { ok: true, message: result.message };
}

export async function cancelEventAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const id = formText(formData, "id");
  if (!id) return { ok: false, message: "Thiếu event id." };

  const result = await cancelEvent({ id, reason: formText(formData, "reason") });
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/events");
  revalidatePath(`/events/${id}/edit`);
  revalidatePath(`/events/${id}/attendance`);
  revalidatePath("/operations");
  return { ok: true, message: result.message };
}

export async function createRegistrationLinkAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const eventId = formText(formData, "event_id");
  if (!eventId) return { ok: false, message: "Thiáº¿u event id." };

  // Ô tick trên panel. Chỉ hiện với buổi thuộc một chuỗi; tầng dữ liệu vẫn
  // kiểm lại, vì một form gửi lên được bất cứ giá trị nào.
  const coversSeries = formData.get("covers_series") === "true";

  const result = await createRegistrationLinkForEvent(eventId, coversSeries);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { ok: true, message: result.message };
}

export async function createCheckinLinkAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const eventId = formText(formData, "event_id");
  if (!eventId) return { ok: false, message: "Thiáº¿u event id." };

  const result = await createCheckinLinkForEvent(eventId);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { ok: true, message: result.message };
}

export async function toggleRegistrationLinkAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const eventId = formText(formData, "event_id");
  if (!eventId) return { ok: false, message: "Thiếu event id." };

  const isActive = formText(formData, "is_active") === "true";
  const result = await setRegistrationLinkActive(eventId, isActive);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { ok: true, message: result.message };
}

// ---------------------------------------------------------------------------
// Phase 045B — Quick mark (attendance status only, preserves role and notes)
// ---------------------------------------------------------------------------

export async function quickMarkParticipationAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const id = formText(formData, "id");
  const eventId = formText(formData, "event_id");
  if (!id) return { ok: false, message: "Thiếu participation id." };

  // Only pass attendance_status — updateParticipation uses hasOwnProperty checks,
  // so role_at_event and admin_notes are deliberately NOT included here.
  const result = await updateParticipation({
    id,
    attendance_status: formText(formData, "attendance_status") || "unknown"
  });
  if (!result.ok) return { ok: false, message: result.message };

  if (eventId) revalidatePath(`/events/${eventId}/attendance`);
  revalidatePath("/events");
  revalidatePath("/operations");
  return { ok: true, message: result.message };
}

// ---------------------------------------------------------------------------
// Phase 045B — Bulk add participants from a batch
// ---------------------------------------------------------------------------

export async function bulkAddEventParticipantsAction(
  _previousState: BulkAddActionState,
  formData: FormData
): Promise<BulkAddActionState> {
  const denied = await ensureAuth();
  if (denied) return { ok: false, message: denied.message };

  const eventId = formText(formData, "event_id");
  const group = formText(formData, "group");

  const result = await bulkAddEventParticipants({ event_id: eventId, group });
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/events/${eventId}/attendance`);
  revalidatePath("/events");
  revalidatePath("/operations");
  return {
    ok: true,
    message: result.message,
    addedCount: result.addedCount,
    skippedCount: result.skippedCount
  };
}

// NOTE: EventActionState type and initialEventActionState are in lib/event-action-types.ts

/**
 * Thêm một buổi nữa vào chuỗi của sự kiện đang mở.
 *
 * Cùng cổng quyền với việc sửa sự kiện: thêm một buổi là thay đổi lịch của
 * chương trình, và người sửa được giờ thì cũng chốt được buổi.
 */
export async function addEventSessionAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const result = await addSessionToSeries({
    eventId: formText(formData, "event_id"),
    starts_at: formText(formData, "starts_at"),
    ends_at: formText(formData, "ends_at")
  });

  if (!result.ok) return { ok: false, message: result.message };

  const eventId = formText(formData, "event_id");
  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/operations");

  return {
    ok: true,
    message: result.message,
    createdEventId: (result.data?.id as string) ?? null
  };
}

/**
 * Xoá một buổi khỏi chuỗi.
 *
 * Cùng cổng quyền với việc thêm buổi. Sau khi xoá, trang phải được vẽ lại từ
 * dữ liệu mới: danh sách buổi ngắn đi, và các buổi sau đó đã đổi số thứ tự.
 */
export async function removeEventSessionAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const targetId = formText(formData, "session_id");
  const result = await removeSessionFromSeries({ eventId: targetId });
  if (!result.ok) return { ok: false, message: result.message };

  // Buổi bị xoá có thể chính là buổi đang mở, nên vẽ lại cả hai đường dẫn —
  // nếu không, người ta ở lại trên một trang đã không còn tồn tại.
  revalidatePath("/events");
  revalidatePath(`/events/${targetId}`);
  revalidatePath(`/events/${formText(formData, "event_id")}`);
  revalidatePath("/operations");

  return { ok: true, message: result.message };
}

/**
 * Đổi giờ của một buổi trong chuỗi.
 *
 * Đường ghi hẹp, chỉ chạm giờ bắt đầu và giờ kết thúc — xem `updateSessionTime`.
 * Đổi giờ có thể làm cả chuỗi được đánh số lại, nên vẽ lại cả danh sách sự kiện
 * lẫn trang của buổi được sửa.
 */
export async function updateEventSessionTimeAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const targetId = formText(formData, "session_id");
  const result = await updateSessionTime({
    eventId: targetId,
    starts_at: formText(formData, "starts_at"),
    ends_at: formText(formData, "ends_at")
  });
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/events");
  revalidatePath(`/events/${targetId}`);
  revalidatePath(`/events/${formText(formData, "event_id")}`);
  revalidatePath("/operations");

  const change = result.data as Record<string, unknown> | undefined;
  return {
    ok: true,
    message: result.message,
    scheduleChange: change
      ? {
          previousStartsAt: (change.previous_starts_at as string | null) ?? null,
          previousEndsAt: (change.previous_ends_at as string | null) ?? null,
          holders: Number(change.holders ?? 0)
        }
      : null
  };
}

/**
 * Gửi thư báo đổi lịch cho những người đang giữ vé của một buổi.
 *
 * Một cú bấm riêng, không tự chạy sau khi lưu giờ — xem `notifyScheduleChange`
 * về lý do. Gửi theo lô, nên bấm lại là gửi tiếp cho phần còn lại.
 */
export async function notifyScheduleChangeAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const targetId = formText(formData, "session_id");
  const result = await notifyScheduleChange({
    eventId: targetId,
    previousStartsAt: formText(formData, "previous_starts_at"),
    previousEndsAt: formText(formData, "previous_ends_at")
  });
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/events/${targetId}`);
  revalidatePath(`/events/${formText(formData, "event_id")}`);
  revalidatePath("/operations/emails");

  // Còn người chưa gửi thì giữ nguyên giờ cũ trong trạng thái, để lượt bấm
  // tiếp theo vẫn nói được "đổi từ đâu sang đâu".
  return {
    ok: true,
    message: result.message,
    scheduleChange: result.remaining
      ? {
          previousStartsAt: formText(formData, "previous_starts_at") || null,
          previousEndsAt: formText(formData, "previous_ends_at") || null,
          holders: result.remaining
        }
      : null
  };
}
