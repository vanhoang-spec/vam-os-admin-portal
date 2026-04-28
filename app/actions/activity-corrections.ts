"use server";

import { revalidatePath } from "next/cache";
import { updateMentoringRecapCorrection } from "@/lib/data";

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
  const id = formText(formData, "id");
  const personId = formText(formData, "person_id");
  const issueFlagValue = formData.get("issue_flag");

  const result = await updateMentoringRecapCorrection({
    id,
    meeting_date: formText(formData, "meeting_date"),
    status: formText(formData, "status"),
    issue_flag: issueFlagValue === "true",
    admin_notes: formText(formData, "admin_notes"),
    reason: formText(formData, "reason"),
    corrected_by: formText(formData, "corrected_by") || "admin"
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
