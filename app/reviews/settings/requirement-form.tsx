"use client";
import { useFormState } from "react-dom";
import { updateStageRequirementAction } from "@/app/actions/recruitment-stage-requirements";
import { initialDecisionActionState } from "@/lib/decision-action-types";

export function RequirementForm({ seasonId, stage, minimum }: { seasonId: string; stage: "profile_screening" | "interview"; minimum: number }) {
  const [state, action] = useFormState(updateStageRequirementAction, initialDecisionActionState);
  return <form action={action} className="flex items-end gap-3">
    <input type="hidden" name="season_id" value={seasonId} /><input type="hidden" name="review_stage" value={stage} />
    <label className="text-sm">{stage === "profile_screening" ? "Profile Review" : "Interview"}<input name="minimum" type="number" min={1} max={20} defaultValue={minimum} className="mt-1 block w-24 rounded-md border border-vam-line px-3 py-2" /></label>
    <button className="rounded-md bg-vam-green px-3 py-2 text-sm text-white">Lưu</button>
    {state.message && <span className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
  </form>;
}
