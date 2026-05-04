"use server";

import { revalidatePath } from "next/cache";
import { cancelMatch, createManualMatch } from "@/lib/matches";
import type { MatchActionState } from "@/lib/match-action-types";

// NOTE: MatchActionState type and initialMatchActionState live in lib/match-action-types.ts

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function createManualMatchAction(
  _previousState: MatchActionState,
  formData: FormData
): Promise<MatchActionState> {
  const result = await createManualMatch({
    mentorProfileId: formText(formData, "mentor_profile_id"),
    menteeProfileId: formText(formData, "mentee_profile_id"),
    intakeBatchId: formText(formData, "intake_batch_id"),
    adminNotes: formText(formData, "admin_notes")
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/matches");
  return { ok: true, message: result.message, matchId: result.matchId };
}

export async function cancelMatchAction(
  _previousState: MatchActionState,
  formData: FormData
): Promise<MatchActionState> {
  const result = await cancelMatch({
    matchId: formText(formData, "match_id"),
    endReason: formText(formData, "end_reason")
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/matches");
  return { ok: true, message: result.message };
}
