"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import {
  addParticipation,
  cancelEvent,
  createEvent,
  removeParticipation,
  updateEvent,
  updateParticipation
} from "@/lib/events";

export type EventActionState = {
  ok: boolean;
  message: string | null;
  createdEventId?: string | null;
};

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

  const result = await createEvent({
    event_name: formText(formData, "event_name"),
    event_type: formText(formData, "event_type"),
    season_code: formText(formData, "season_code"),
    intake_batch_id: formText(formData, "intake_batch_id"),
    starts_at: formText(formData, "starts_at"),
    source_notes: formText(formData, "source_notes"),
    legacy_event_temp_id: formText(formData, "legacy_event_temp_id")
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
    source_notes: formText(formData, "source_notes"),
    legacy_event_temp_id: formText(formData, "legacy_event_temp_id")
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/events");
  revalidatePath(`/events/${id}/edit`);
  revalidatePath(`/events/${id}/attendance`);
  revalidatePath("/operations");

  return { ok: true, message: result.message };
}

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
    attendance_status: formText(formData, "attendance_status") || "registered_absent",
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
    attendance_status: formText(formData, "attendance_status") || "registered_absent",
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

export { initialState as initialEventActionState };
