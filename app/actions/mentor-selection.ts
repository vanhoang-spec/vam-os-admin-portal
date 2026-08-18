"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import { selectMenteeAfterInterview } from "@/lib/mentor-selection";
import type { MentorSelectionActionState } from "@/lib/mentor-selection-action-types";

/**
 * Server action for "chọn làm mentee của tôi" on the interview screen.
 *
 * Thin by design: the interview ownership check, the identity resolution, the
 * capacity arithmetic and the logging all live in lib/mentor-selection.ts, so
 * posting straight to this action gets exactly the same treatment as pressing
 * the button.
 */
export async function selectMenteeAction(
  _prev: MentorSelectionActionState,
  formData: FormData
): Promise<MentorSelectionActionState> {
  try {
    const applicationId = formData.get("application_id");
    const note = formData.get("note");

    const result = await selectMenteeAfterInterview({
      applicationId: typeof applicationId === "string" ? applicationId.trim() : "",
      note: typeof note === "string" ? note : ""
    });

    if (result.ok) {
      revalidatePath("/interviews");
      revalidatePath("/matches");
      revalidatePath("/matches/unmatched");
      revalidatePath("/applications");
    }

    return {
      ok: result.ok,
      message: result.message,
      capExceeded: result.capExceeded,
      matchId: result.matchId ?? null
    };
  } catch (err) {
    console.error("[mentor selection action] select", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
