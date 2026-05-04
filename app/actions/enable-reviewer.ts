"use server";

import { revalidatePath } from "next/cache";
import { enableMentorAsReviewer } from "@/lib/enable-reviewer";
import type { EnableReviewerActionState } from "@/lib/enable-reviewer-action-types";

export async function enableMentorAsReviewerAction(
  _prev: EnableReviewerActionState,
  formData: FormData
): Promise<EnableReviewerActionState> {
  try {
    const personId = String(formData.get("person_id") ?? "").trim();
    if (!personId) return { ok: false, message: "Thiếu person_id." };

    const result = await enableMentorAsReviewer({ personId });

    if (result.ok) {
      revalidatePath("/reviews/reviewer-pool");
      revalidatePath("/reviews/assign-bulk");
      revalidatePath("/reviews/progress");
    }

    return {
      ok: result.ok,
      message: result.message,
      adminUserId: result.adminUserId
    };
  } catch (err) {
    console.error("[enable-reviewer action]", err);
    return { ok: false, message: "Đã xảy ra lỗi không mong đợi. Vui lòng thử lại." };
  }
}
