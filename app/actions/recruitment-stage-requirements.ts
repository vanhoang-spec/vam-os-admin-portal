"use server";
import { revalidatePath } from "next/cache";
import { updateStageRequirement } from "@/lib/recruitment-stage-requirements";
import type { DecisionActionState } from "@/lib/decision-action-types";

export async function updateStageRequirementAction(_state: DecisionActionState, formData: FormData): Promise<DecisionActionState> {
  const seasonId = String(formData.get("season_id") ?? "");
  const stage = String(formData.get("review_stage") ?? "");
  const minimum = Number(formData.get("minimum"));
  if (stage !== "profile_screening" && stage !== "interview") return { ok: false, message: "Vòng không hợp lệ." };
  const result = await updateStageRequirement({ seasonId, stage, minimum });
  if (result.ok) revalidatePath("/reviews/settings");
  return result;
}
