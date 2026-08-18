"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import {
  applySelectionRun,
  createSelectionRun,
  discardSelectionRun,
  promoteReserveApplication
} from "@/lib/selection";
import type { SelectionActionState } from "@/lib/selection-action-types";

/**
 * Server actions for the interview-selection screen.
 *
 * Thin by design: every authorization and business rule lives in
 * lib/selection.ts, so posting straight to one of these gets the same treatment
 * as pressing the button.
 */

function revalidateSelection() {
  revalidatePath("/reviews/selection");
  revalidatePath("/reviews/progress");
  revalidatePath("/applications");
  revalidatePath("/interviews");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Compute a ranking and store it as a draft for the organisers to look at. */
export async function createSelectionRunAction(
  _prev: SelectionActionState,
  formData: FormData
): Promise<SelectionActionState> {
  try {
    const reservePctRaw = text(formData, "reserve_pct");
    const result = await createSelectionRun({
      intakeBatchId: text(formData, "intake_batch_id"),
      roleApplied: text(formData, "role_applied") || "mentee",
      reservePct: reservePctRaw ? Number(reservePctRaw) : undefined,
      note: text(formData, "note") || null
    });

    if (result.ok) revalidateSelection();
    return { ok: result.ok, message: result.message, runId: result.runId };
  } catch (err) {
    console.error("[selection action] create", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

/** Apply the draft: invite the main group, waitlist the reserve. */
export async function applySelectionRunAction(
  _prev: SelectionActionState,
  formData: FormData
): Promise<SelectionActionState> {
  try {
    const result = await applySelectionRun({ runId: text(formData, "run_id") });
    if (result.ok) revalidateSelection();
    return { ok: result.ok, message: result.message, runId: result.runId };
  } catch (err) {
    console.error("[selection action] apply", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

/** Throw the draft away so a fresh ranking can be computed. */
export async function discardSelectionRunAction(
  _prev: SelectionActionState,
  formData: FormData
): Promise<SelectionActionState> {
  try {
    const result = await discardSelectionRun({ runId: text(formData, "run_id") });
    if (result.ok) revalidateSelection();
    return { ok: result.ok, message: result.message, runId: result.runId };
  } catch (err) {
    console.error("[selection action] discard", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

/** Move one standby applicant into the interview list. */
export async function promoteReserveApplicationAction(
  _prev: SelectionActionState,
  formData: FormData
): Promise<SelectionActionState> {
  try {
    const result = await promoteReserveApplication({
      runId: text(formData, "run_id"),
      applicationId: text(formData, "application_id"),
      reason: text(formData, "reason") || null
    });
    if (result.ok) revalidateSelection();
    return { ok: result.ok, message: result.message, runId: result.runId };
  } catch (err) {
    console.error("[selection action] promote", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
