"use server";

import { revalidatePath } from "next/cache";
import { saveInterviewHandbook, saveInterviewRubric, type RubricSaveResult } from "@/lib/mentee-interview-rubric";
import { OFFLINE_GUIDE_PATH, OFFLINE_PATH, RUBRIC_EDITOR_PATH } from "@/lib/mentee-offline-core";

function refresh() {
  revalidatePath(RUBRIC_EDITOR_PATH);
  revalidatePath(OFFLINE_PATH);
  revalidatePath(OFFLINE_GUIDE_PATH);
}

/** Mọi phép kiểm quyền nằm trong lib/mentee-interview-rubric.ts và trong RPC. */
export async function saveInterviewRubricAction(input: Parameters<typeof saveInterviewRubric>[0]): Promise<RubricSaveResult> {
  const result = await saveInterviewRubric(input);
  if (result.ok) refresh();
  return result;
}

export async function saveInterviewHandbookAction(_previous: RubricSaveResult | null, formData: FormData): Promise<RubricSaveResult> {
  const result = await saveInterviewHandbook(formData);
  if (result.ok) refresh();
  return result;
}
