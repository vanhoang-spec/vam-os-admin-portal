"use server";

import { revalidatePath } from "next/cache";

import { submitInvitationResponse } from "@/lib/cross-invitations";
import type { CrossActionState } from "@/lib/cross-action-types";

/**
 * Public server action behind /cross/<token>.
 *
 * Thin, like its sibling at /confirm/<token>: the token check, the expiry, the
 * "the organisers have already decided" state and the stale-tab guard all live
 * in lib/cross-invitations.ts, so posting straight at this action is treated
 * exactly as the form is.
 */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitInvitationResponseAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  try {
    const token = text(formData, "token");

    // Up to five optional hours, posted as five separate fields so the browser
    // can render five datetime pickers without any client-side state.
    const slots = ["slot_1", "slot_2", "slot_3", "slot_4", "slot_5"]
      .map((key) => text(formData, key))
      .filter(Boolean);

    const result = await submitInvitationResponse({
      token,
      decision: text(formData, "decision"),
      slots,
      note: text(formData, "note"),
      updatedAtSnapshot: text(formData, "updated_at") || null
    });

    if (result.ok) revalidatePath(`/cross/${token}`);

    return { ok: result.ok, message: result.message };
  } catch (error) {
    console.error("[cross-invitation-action]", error);
    return {
      ok: false,
      message: "Không ghi nhận được phản hồi. Vui lòng thử lại hoặc trả lời email của ban tổ chức."
    };
  }
}
