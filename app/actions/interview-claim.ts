"use server";

import { revalidatePath } from "next/cache";
import { claimInterviewReview } from "@/lib/interview-claim";
import type { ClaimInterviewActionState } from "@/lib/interview-claim-action-types";

export async function claimInterviewReviewAction(
  _prev: ClaimInterviewActionState,
  formData: FormData
): Promise<ClaimInterviewActionState> {
  try {
    const applicationId = String(formData.get("application_id") ?? "").trim();
    if (!applicationId) return { ok: false, message: "Thiếu application_id." };

    const result = await claimInterviewReview({ applicationId });

    if (result.ok) {
      revalidatePath("/interviews");
      revalidatePath("/reviews");
      if (result.reviewId) {
        revalidatePath(`/reviews/${result.reviewId}`);
      }
    }

    return {
      ok: result.ok,
      message: result.message,
      reviewId: result.reviewId,
      alreadyClaimed: result.alreadyClaimed
    };
  } catch (err) {
    console.error("[claimInterviewReviewAction]", err);
    return { ok: false, message: "Đã xảy ra lỗi không mong đợi. Vui lòng thử lại." };
  }
}
