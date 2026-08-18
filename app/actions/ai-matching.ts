"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import {
  approveRecommendation,
  discardRecommendationRun,
  rejectRecommendation,
  runMatchRecommendations
} from "@/lib/ai-matching";
import type { AiMatchingActionState } from "@/lib/ai-matching-action-types";

/**
 * Server actions for the assisted-matching screen.
 *
 * Thin by design: the anonymisation, the provider call, the capacity rules and
 * every authorization check live in lib/ai-matching.ts, so posting straight to
 * one of these gets the same treatment as pressing the button.
 */

function revalidateMatching() {
  revalidatePath("/matches/recommendations");
  revalidatePath("/matches/unmatched");
  revalidatePath("/matches");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Ask the provider for a proposal. Creates no match. */
export async function runMatchRecommendationsAction(
  _prev: AiMatchingActionState,
  formData: FormData
): Promise<AiMatchingActionState> {
  try {
    const result = await runMatchRecommendations({
      seasonId: text(formData, "season_id"),
      intakeBatchId: text(formData, "intake_batch_id") || null,
      rounds: text(formData, "rounds"),
      shortlistSize: text(formData, "shortlist_size"),
      batchSize: text(formData, "batch_size")
    });

    if (result.ok) revalidateMatching();
    return { ok: result.ok, message: result.message, runId: result.runId ?? null };
  } catch (err) {
    console.error("[ai matching action] run", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

/** Approve one proposed pair — the match is created by the manual path. */
export async function approveRecommendationAction(
  _prev: AiMatchingActionState,
  formData: FormData
): Promise<AiMatchingActionState> {
  try {
    const result = await approveRecommendation({
      recommendationId: text(formData, "recommendation_id")
    });
    if (result.ok) revalidateMatching();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[ai matching action] approve", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function rejectRecommendationAction(
  _prev: AiMatchingActionState,
  formData: FormData
): Promise<AiMatchingActionState> {
  try {
    const result = await rejectRecommendation({
      recommendationId: text(formData, "recommendation_id"),
      reason: text(formData, "reason")
    });
    if (result.ok) revalidateMatching();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[ai matching action] reject", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function discardRecommendationRunAction(
  _prev: AiMatchingActionState,
  formData: FormData
): Promise<AiMatchingActionState> {
  try {
    const result = await discardRecommendationRun({ runId: text(formData, "run_id") });
    if (result.ok) revalidateMatching();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[ai matching action] discard", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
