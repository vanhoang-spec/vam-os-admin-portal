"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { updateMentoringRecapCorrection } from "@/lib/data";
import { addManualRecap } from "@/lib/admin-corrections";

export type CorrectionActionState = {
  ok: boolean;
  message: string | null;
};

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function correctMentoringRecapAction(
  _previousState: CorrectionActionState,
  formData: FormData
): Promise<CorrectionActionState> {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return { ok: false, message: "Bạn không có quyền sửa mentoring recap." };
  }

  const id = formText(formData, "id");
  const personId = formText(formData, "person_id");
  const issueFlagValue = formData.get("issue_flag");
  const correctedByFromForm = formText(formData, "corrected_by");
  const correctedBy = adminUser?.full_name ? `${adminUser.full_name} <${adminUser.email}>` : adminUser?.email;

  const result = await updateMentoringRecapCorrection({
    id,
    meeting_date: formText(formData, "meeting_date"),
    status: formText(formData, "status"),
    issue_flag: issueFlagValue === "true",
    admin_notes: formText(formData, "admin_notes"),
    reason: formText(formData, "reason"),
    corrected_by: correctedBy || correctedByFromForm || "admin"
  });

  if (result.error) {
    return { ok: false, message: result.error };
  }

  revalidatePath("/operations");
  revalidatePath("/data-issues");
  revalidatePath(`/recaps/${id}/edit`);
  if (personId) revalidatePath(`/people/${personId}`);

  return { ok: true, message: "Đã lưu correction và ghi audit log." };
}

export async function createMentoringRecapAction(
  _previousState: CorrectionActionState,
  formData: FormData
): Promise<CorrectionActionState> {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return { ok: false, message: "Bạn không có quyền thêm mentoring recap." };
  }

  const meeting_date = formText(formData, "meeting_date");
  if (!meeting_date) return { ok: false, message: "Thiếu ngày meeting." };

  const result = await addManualRecap({
    season_code: formText(formData, "season_code") || undefined,
    match_id: formText(formData, "match_id") || undefined,
    mentor_person_id: formText(formData, "mentor_person_id") || undefined,
    mentee_person_id: formText(formData, "mentee_person_id") || undefined,
    meeting_date,
    meeting_type: formText(formData, "meeting_type") || undefined,
    recap_note: formText(formData, "recap_note") || undefined,
    recap_url: formText(formData, "recap_url") || undefined,
    status: formText(formData, "status") || undefined,
    issue_flag: formData.get("issue_flag") === "true",
    admin_notes: formText(formData, "admin_notes") || undefined
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/operations");
  revalidatePath("/data-issues");
  revalidatePath("/recaps");
  
  // Note: we can't cleanly redirect inside the action if it returns state because redirect throws an error that gets caught by React hook. 
  // We'll return success and handle redirect on client, or just show success message.
  return { ok: true, message: "Đã tạo recap thành công." };
}
