"use server";

import { redirect } from "next/navigation";
import { checkInForEvent } from "@/lib/events";
import type { PublicCheckinActionState } from "@/lib/event-action-types";

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function submitEventCheckinAction(
  _previousState: PublicCheckinActionState,
  formData: FormData
): Promise<PublicCheckinActionState> {
  const token = formText(formData, "token");
  const values = {
    email: formText(formData, "email"),
    full_name: formText(formData, "full_name"),
    phone: formText(formData, "phone"),
    student_id: formText(formData, "student_id"),
    notes: formText(formData, "notes")
  };

  const result = await checkInForEvent({ token, ...values });

  if (result.status === "success" || result.status === "already_checked_in") {
    redirect(`/checkin/${token}?status=${result.status}`);
  }

  // For all error statuses, stay on the form and show the message.
  // Preserve field values only for form-level validation errors so the user
  // can correct and resubmit. Phase 2 registration-state errors (not_registered,
  // pending_approval, etc.) are informational — no values needed.
  const preserveValues =
    result.status === "validation_error" || result.status === "server_error";

  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    eventName: result.eventName ?? null,
    values: preserveValues ? values : {}
  };
}
