"use server";

import { revalidatePath } from "next/cache";
import {
  addManualRecap,
  createActionItem,
  editRecap,
  softDeleteRecap,
  updateActionItem,
  type MutationResult
} from "@/lib/admin-corrections";

export type AdminCorrectionActionState = MutationResult;

const initialState: AdminCorrectionActionState = { ok: false, message: "" };

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function actionError(error: unknown): AdminCorrectionActionState {
  console.error("[admin-correction-action]", error instanceof Error ? error.message : String(error));
  return { ok: false, message: "Tác vụ không hoàn tất do lỗi server. Vui lòng kiểm tra logs." };
}

function revalidateAdminCorrectionPaths() {
  revalidatePath("/admin");
  revalidatePath("/operations");
  revalidatePath("/data-issues");
}

export async function createActionItemAction(
  _previousState: AdminCorrectionActionState = initialState,
  formData: FormData
): Promise<AdminCorrectionActionState> {
  try {
    const result = await createActionItem({
      type: text(formData, "type"),
      targetPersonId: text(formData, "target_person_id"),
      seasonCode: text(formData, "season_code"),
      ownerEmail: text(formData, "owner_email"),
      notes: text(formData, "notes"),
      issueKey: text(formData, "issue_key")
    });
    revalidateAdminCorrectionPaths();
    return result;
  } catch (error) {
    return actionError(error);
  }
}

export async function updateActionItemAction(
  _previousState: AdminCorrectionActionState = initialState,
  formData: FormData
): Promise<AdminCorrectionActionState> {
  try {
    const result = await updateActionItem({
      id: text(formData, "id"),
      status: text(formData, "status"),
      ownerEmail: text(formData, "owner_email"),
      noteToAppend: text(formData, "note")
    });
    revalidateAdminCorrectionPaths();
    return result;
  } catch (error) {
    return actionError(error);
  }
}

export async function addManualRecapAction(
  _previousState: AdminCorrectionActionState = initialState,
  formData: FormData
): Promise<AdminCorrectionActionState> {
  try {
    const result = await addManualRecap({
      season_code: text(formData, "season_code"),
      match_id: text(formData, "match_id"),
      mentor_person_id: text(formData, "mentor_person_id"),
      mentee_person_id: text(formData, "mentee_person_id"),
      meeting_date: text(formData, "meeting_date"),
      recap_url: text(formData, "recap_url"),
      recap_note: text(formData, "recap_note"),
      meeting_type: text(formData, "meeting_type"),
      issue_flag: text(formData, "issue_flag"),
      status: text(formData, "status"),
      admin_notes: text(formData, "admin_notes")
    });
    revalidateAdminCorrectionPaths();
    return result;
  } catch (error) {
    return actionError(error);
  }
}

export async function editRecapAction(
  _previousState: AdminCorrectionActionState = initialState,
  formData: FormData
): Promise<AdminCorrectionActionState> {
  try {
    const result = await editRecap({
      id: text(formData, "id"),
      match_id: text(formData, "match_id"),
      mentor_person_id: text(formData, "mentor_person_id"),
      mentee_person_id: text(formData, "mentee_person_id"),
      meeting_date: text(formData, "meeting_date"),
      recap_url: text(formData, "recap_url"),
      recap_note: text(formData, "recap_note"),
      meeting_type: text(formData, "meeting_type"),
      issue_flag: text(formData, "issue_flag"),
      status: text(formData, "status"),
      admin_notes: text(formData, "admin_notes"),
      reason: text(formData, "reason")
    });
    revalidateAdminCorrectionPaths();
    revalidatePath(`/recaps/${text(formData, "id")}/edit`);
    return result;
  } catch (error) {
    return actionError(error);
  }
}

export async function softDeleteRecapAction(
  _previousState: AdminCorrectionActionState = initialState,
  formData: FormData
): Promise<AdminCorrectionActionState> {
  try {
    const result = await softDeleteRecap({
      id: text(formData, "id"),
      reason: text(formData, "reason")
    });
    revalidateAdminCorrectionPaths();
    revalidatePath(`/recaps/${text(formData, "id")}/edit`);
    return result;
  } catch (error) {
    return actionError(error);
  }
}
