"use server";

import { revalidatePath } from "next/cache";
import { deletePersonFromSystem, getPersonDeleteReport, type PersonDeleteReport } from "@/lib/person-delete";

/**
 * app/actions/person-delete.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai cửa cho việc xoá một người: đọc bản kê, và xoá.
 *
 * Cả hai đều gác ở `lib/person-delete.ts` — file này không tự quyết định gì, để
 * không có hai bản luật ở hai nơi.
 */

export async function personDeleteReportAction(
  personId: string
): Promise<{ ok: boolean; message?: string; report?: PersonDeleteReport; allowed?: boolean }> {
  return getPersonDeleteReport(personId);
}

export async function deletePersonAction(input: {
  personId: string;
  reason: string;
  confirmName: string;
}): Promise<{ ok: boolean; message: string }> {
  const result = await deletePersonFromSystem(input);
  if (result.ok) {
    // Hồ sơ không còn nữa: làm mới cả danh sách lẫn những trang đếm theo người.
    revalidatePath("/people");
    revalidatePath("/mentors");
    revalidatePath("/mentees");
    revalidatePath(`/people/${input.personId}`);
  }
  return result;
}
