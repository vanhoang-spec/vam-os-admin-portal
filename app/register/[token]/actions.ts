"use server";

import { redirect } from "next/navigation";
import { registerForEvent } from "@/lib/events";
import type { PublicRegistrationActionState } from "@/lib/event-action-types";

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function submitEventRegistrationAction(
  _previousState: PublicRegistrationActionState,
  formData: FormData
): Promise<PublicRegistrationActionState> {
  const token = formText(formData, "token");
  const values = {
    full_name: formText(formData, "full_name"),
    email: formText(formData, "email"),
    phone: formText(formData, "phone"),
    student_id: formText(formData, "student_id"),
    school: formText(formData, "school"),
    program_of_study: formText(formData, "program_of_study"),
    role_text: formText(formData, "role_text"),
    notes: formText(formData, "notes")
  };
  const result = await registerForEvent({
    token,
    ...values,
    consent_given: formData.get("consent_given")
  });

  if (result.status === "success" || result.status === "already_registered") {
    redirect(`/register/${token}?status=${result.status}`);
  }

  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    eventName: result.eventName ?? null,
    values: result.status === "validation_error" || result.status === "server_error" ? values : {}
  };
}
