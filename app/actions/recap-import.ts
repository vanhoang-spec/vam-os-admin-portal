"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import { approveImportItems, assignImportItem, skipImportItems } from "@/lib/recap-import";
import type { RecapImportActionState } from "@/lib/recap-import-action-types";

/**
 * Server actions for reviewing what the collector brought back.
 *
 * Thin by design: permission and validation live in lib/recap-import.ts, so
 * posting straight to one of these gets the same treatment as pressing the
 * button.
 */

function revalidateImport() {
  revalidatePath("/operations/recap-import");
  revalidatePath("/operations/monthly");
  revalidatePath("/operations");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Checkbox lists arrive as repeated fields, not as one comma-joined string. */
function ids(formData: FormData) {
  return formData.getAll("item_ids").map((value) => String(value));
}

export async function approveImportItemsAction(
  _prev: RecapImportActionState,
  formData: FormData
): Promise<RecapImportActionState> {
  try {
    const result = await approveImportItems({ itemIds: ids(formData) });
    if (result.ok) revalidateImport();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[recap import action] approve", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function skipImportItemsAction(
  _prev: RecapImportActionState,
  formData: FormData
): Promise<RecapImportActionState> {
  try {
    const result = await skipImportItems({
      itemIds: ids(formData),
      reason: text(formData, "reason")
    });
    if (result.ok) revalidateImport();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[recap import action] skip", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function assignImportItemAction(
  _prev: RecapImportActionState,
  formData: FormData
): Promise<RecapImportActionState> {
  try {
    const result = await assignImportItem({
      itemId: text(formData, "item_id").trim(),
      menteePersonId: text(formData, "mentee_person_id").trim()
    });
    if (result.ok) revalidateImport();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[recap import action] assign", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
