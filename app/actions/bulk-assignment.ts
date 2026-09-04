"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { assignSelectedApplicationReviews } from "@/lib/bulk-assignment";
import { canBulkAssignReviews } from "@/lib/permissions";
import type { BulkAssignmentActionState } from "@/lib/bulk-assignment-action-types";

function fail(message: string): BulkAssignmentActionState {
  return { ok: false, message };
}

export async function bulkAssignApplicationReviewsAction(
  _prev: BulkAssignmentActionState,
  formData: FormData
): Promise<BulkAssignmentActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canBulkAssignReviews(adminUser.role)) return fail("Bạn không có quyền thực hiện thao tác này.");

    // Parse form fields
    const applicationIds = formData.getAll("application_ids").map((v) => String(v).trim()).filter(Boolean);
    const reviewerId = String(formData.get("reviewer_id") ?? "").trim();
    const reviewRoundRaw = String(formData.get("review_round") ?? "profile_screening").trim();
    if (reviewRoundRaw !== "profile_screening" && reviewRoundRaw !== "interview") {
      return fail("Vòng review không hợp lệ.");
    }
    const reviewRound = reviewRoundRaw;
    const dueAt = String(formData.get("due_at") ?? "").trim() || null;
    const assignmentNote = String(formData.get("assignment_note") ?? "").trim() || null;

    if (!applicationIds.length) return fail("Vui lòng chọn ít nhất một hồ sơ.");
    if (!reviewerId) return fail("Vui lòng chọn người phụ trách.");

    const result = await assignSelectedApplicationReviews({
      applicationIds,
      reviewerAdminUserId: reviewerId,
      reviewRound,
      dueAt,
      assignmentNote,
      assignedByAdminUserId: adminUser.id
    });

    if (!result.ok) return { ok: false, message: result.message };

    revalidatePath("/reviews");
    revalidatePath("/reviews/assign-bulk");
    revalidatePath("/reviews/progress");
    revalidatePath("/applications");

    return {
      ok: true,
      message: `Đã giao thành công ${result.applicationsAssigned} hồ sơ.`,
      applicationsAssigned: result.applicationsAssigned,
      reviewerId: result.reviewerId,
      batchId: result.batchId
    };
  } catch (err) {
    console.error("[bulk-assignment action]", err);
    return fail("Đã xảy ra lỗi không mong đợi. Vui lòng thử lại.");
  }
}
