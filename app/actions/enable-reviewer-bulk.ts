"use server";

import { revalidatePath } from "next/cache";
import { bulkEnableMentorsAsReviewers } from "@/lib/enable-reviewer-bulk";
import type { BulkGrantActionState } from "@/lib/enable-reviewer-bulk-action-types";
import { isParticipationRole } from "@/lib/recruitment-permissions-core";

export async function bulkEnableMentorsAsReviewersAction(
  _prev: BulkGrantActionState,
  formData: FormData
): Promise<BulkGrantActionState> {
  try {
    const rawEmails = String(formData.get("emails") ?? "");
    const intakeBatchId = String(formData.get("intake_batch_id") ?? "").trim();
    const participationRole = String(formData.get("participation_role") ?? "").trim();
    if (!isParticipationRole(participationRole)) {
      return { ok: false, message: "Vai trò tham gia không hợp lệ.", granted: [], failed: [], notFound: [], skippedDueToQuota: [] };
    }

    const result = await bulkEnableMentorsAsReviewers({ rawEmails, intakeBatchId, participationRole });

    if (result.ok && (result.granted.length > 0 || result.failed.length > 0)) {
      revalidatePath("/reviews/reviewer-pool");
      revalidatePath("/reviews/assign-bulk");
      revalidatePath("/reviews/progress");
    }

    return result;
  } catch (err) {
    console.error("[enable-reviewer-bulk action]", err);
    return {
      ok: false,
      message: "Đã xảy ra lỗi không mong đợi. Vui lòng thử lại.",
      granted: [],
      failed: [],
      notFound: [],
      skippedDueToQuota: []
    };
  }
}
