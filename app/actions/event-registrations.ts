"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import type { RegistrationOperationActionState } from "@/lib/event-action-types";
import {
  acceptRegistrationProof,
  cancelEventRegistration,
  confirmEventRegistration,
  confirmRegistrationPayment,
  rejectEventRegistration,
  rejectRegistrationPayment,
  rejectRegistrationProof,
  updateRegistrationReviewNote,
  waitlistEventRegistration
} from "@/lib/events";

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function revalidateRegistrationOperation(eventId: string, registrationId: string) {
  // Registration detail: immediately reflects the changed row.
  revalidatePath(`/events/${eventId}/registrations/${registrationId}`);
  // Parent event detail: registration badges, counts, capacity, and payment summary can change.
  revalidatePath(`/events/${eventId}`);
  // Events list: event-level registration counts can change.
  revalidatePath("/events");
  // Operations dashboard may consume event/registration workflow state.
  revalidatePath("/operations");
}

async function runRegistrationOperation(
  formData: FormData,
  operation: (input: { event_id: string; registration_id: string; note?: string }) => Promise<{ ok: boolean; message: string }>
): Promise<RegistrationOperationActionState> {
  const eventId = formText(formData, "event_id");
  const registrationId = formText(formData, "registration_id");
  const note = formText(formData, "note");

  try {
    const result = await operation({ event_id: eventId, registration_id: registrationId, note });
    if (!result.ok) return { ok: false, message: result.message };
    revalidateRegistrationOperation(eventId, registrationId);
    return { ok: true, message: result.message };
  } catch (error) {
    return { ok: false, message: normalizeActionError(error) };
  }
}

export async function confirmEventRegistrationAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, confirmEventRegistration);
}

export async function waitlistEventRegistrationAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, waitlistEventRegistration);
}

export async function rejectEventRegistrationAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, rejectEventRegistration);
}

export async function cancelEventRegistrationAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, cancelEventRegistration);
}

export async function confirmRegistrationPaymentAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, confirmRegistrationPayment);
}

export async function rejectRegistrationPaymentAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, rejectRegistrationPayment);
}

export async function acceptRegistrationProofAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, acceptRegistrationProof);
}

export async function rejectRegistrationProofAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, rejectRegistrationProof);
}

export async function updateRegistrationReviewNoteAction(
  _previousState: RegistrationOperationActionState,
  formData: FormData
): Promise<RegistrationOperationActionState> {
  return runRegistrationOperation(formData, updateRegistrationReviewNote);
}