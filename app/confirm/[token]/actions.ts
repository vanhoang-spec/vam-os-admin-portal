"use server";

import { revalidatePath } from "next/cache";
import { submitMentorConfirmation } from "@/lib/mentor-confirmations";
import type { PublicConfirmationActionState } from "@/lib/mentor-confirmation-action-types";

/**
 * Public server action behind /confirm/<token>.
 *
 * Thin by design: the token check, the link-state rules (expired / locked) and
 * the concurrency check all live in lib/mentor-confirmations.ts, so a caller who
 * posts straight to this action gets exactly the same treatment as the form.
 */
function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitMentorConfirmationAction(
  _previousState: PublicConfirmationActionState,
  formData: FormData
): Promise<PublicConfirmationActionState> {
  try {
    const token = text(formData, "token");

    const result = await submitMentorConfirmation({
      token,
      decision: text(formData, "decision"),
      maxMentees: text(formData, "max_mentees"),
      agreeToReview: formData.get("agree_to_review"),
      agreeToInterview: formData.get("agree_to_interview"),
      note: text(formData, "note"),
      updatedAtSnapshot: text(formData, "updated_at") || null
    });

    if (result.ok) {
      revalidatePath(`/confirm/${token}`);
      revalidatePath("/mentors/season-confirmations");
    }

    // `ready` means the link is fine and the message is an ordinary validation
    // error, so the form stays on screen; only the three terminal states swap
    // the view.
    const blockedState =
      result.state === "not_found" || result.state === "expired" || result.state === "locked"
        ? result.state
        : undefined;

    return { ok: result.ok, message: result.message, state: blockedState };
  } catch (err) {
    console.error("[confirm action]", err);
    return {
      ok: false,
      message: "Không thể ghi nhận phản hồi. Vui lòng thử lại hoặc liên hệ ban tổ chức."
    };
  }
}
