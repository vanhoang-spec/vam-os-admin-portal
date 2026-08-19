"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import {
  ensureSeasonDocuments,
  saveProgramDocument,
  setDocumentStatus
} from "@/lib/program-documents";
import type { ProgramDocumentActionState } from "@/lib/program-documents-action-types";

/**
 * Server actions for the program documents (code of conduct, tips).
 *
 * Thin by design: validation, permission and season scope live in
 * lib/program-documents.ts, so posting straight to one of these gets the same
 * treatment as pressing the button.
 */

function revalidateDocuments(slug?: string | null) {
  revalidatePath("/operations/documents");
  revalidatePath("/operations/communications");
  if (slug) revalidatePath(`/documents/${slug}`);
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function ensureSeasonDocumentsAction(
  _prev: ProgramDocumentActionState,
  formData: FormData
): Promise<ProgramDocumentActionState> {
  try {
    const result = await ensureSeasonDocuments({ seasonIdOrCode: text(formData, "season_id").trim() });
    if (result.ok) revalidateDocuments();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[program documents action] ensure", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function saveProgramDocumentAction(
  _prev: ProgramDocumentActionState,
  formData: FormData
): Promise<ProgramDocumentActionState> {
  try {
    const result = await saveProgramDocument({
      documentId: text(formData, "document_id").trim(),
      title: text(formData, "title"),
      body: text(formData, "body")
    });
    if (result.ok) revalidateDocuments(text(formData, "slug").trim());
    return { ok: result.ok, message: result.message, documentId: result.documentId };
  } catch (err) {
    console.error("[program documents action] save", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function setDocumentStatusAction(
  _prev: ProgramDocumentActionState,
  formData: FormData
): Promise<ProgramDocumentActionState> {
  try {
    const result = await setDocumentStatus({
      documentId: text(formData, "document_id").trim(),
      status: text(formData, "status").trim()
    });
    if (result.ok) revalidateDocuments(text(formData, "slug").trim());
    return { ok: result.ok, message: result.message, documentId: result.documentId };
  } catch (err) {
    console.error("[program documents action] status", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
