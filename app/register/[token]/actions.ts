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
    // Buổi người đăng ký chọn. Chỉ có ý nghĩa với link nhận cả chuỗi; tầng dữ
    // liệu kiểm nó có thuộc chuỗi của link này không rồi mới dùng.
    session_event_id: formText(formData, "session_event_id"),
    full_name: formText(formData, "full_name"),
    email: formText(formData, "email"),
    phone: formText(formData, "phone"),
    student_id: formText(formData, "student_id"),
    school: formText(formData, "school"),
    program_of_study: formText(formData, "program_of_study"),
    role_text: formText(formData, "role_text"),
    notes: formText(formData, "notes"),
    mentee_code: formText(formData, "mentee_code"),
    proof_url: formText(formData, "proof_url"),
    proof_note: formText(formData, "proof_note"),
    speaker_question: formText(formData, "speaker_question"),
    payment_proof_url: formText(formData, "payment_proof_url"),
    payment_proof_note: formText(formData, "payment_proof_note"),
    meal_selected: formText(formData, "meal_selected")
  };
  const result = await registerForEvent({
    token,
    ...values,
    consent_given: formData.get("consent_given")
  });

  if (result.status === "success") {
    // Redirect with the real registration ID so the page can verify server-side.
    // Never redirect to ?status=success — that param is no longer trusted.
    const regId = result.registrationId;
    redirect(regId ? `/register/${token}?registration_id=${regId}` : `/register/${token}`);
  }
  if (result.status === "already_registered") {
    redirect(`/register/${token}?status=already_registered`);
  }

  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    eventName: result.eventName ?? null,
    values: result.status === "validation_error" || result.status === "server_error" ? values : {}
  };
}
