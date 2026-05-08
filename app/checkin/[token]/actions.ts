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

  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    eventName: result.eventName ?? null,
    values: result.status === "validation_error" || result.status === "server_error" ? values : {}
  };
}
