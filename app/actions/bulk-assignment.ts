"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { bulkAssignApplicationReviews } from "@/lib/bulk-assignment";
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
    const intakeBatchId = String(formData.get("intake_batch_id") ?? "").trim() || null;
    const roleApplied = String(formData.get("role_applied") ?? "").trim();
    const statuses = formData.getAll("statuses").map((v) => String(v).trim()).filter(Boolean);
    const reviewerIds = formData.getAll("reviewer_ids").map((v) => String(v).trim()).filter(Boolean);
    const excludeAlreadyAssigned = String(formData.get("exclude_already_assigned") ?? "1") !== "0";
    const dueAt = String(formData.get("due_at") ?? "").trim() || null;
    const assignmentNote = String(formData.get("assignment_note") ?? "").trim() || null;

    if (!roleApplied) return fail("Vui lòng chọn role ứng tuyển.");
    if (!statuses.length) return fail("Vui lòng chọn ít nhất một trạng thái đơn.");
    if (!reviewerIds.length) return fail("Vui lòng chọn ít nhất một reviewer.");

    const result = await bulkAssignApplicationReviews({
      intakeBatchId,
      roleApplied,
      statuses,
      reviewerAdminUserIds: reviewerIds,
      dueAt,
      excludeAlreadyAssigned,
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
      message: `Đã giao thành công ${result.applicationsAssigned} hồ sơ cho ${result.reviewersCount} reviewer.`,
      applicationsAssigned: result.applicationsAssigned,
      reviewersCount: result.reviewersCount,
      minPerReviewer: result.minPerReviewer,
      maxPerReviewer: result.maxPerReviewer,
      skippedAlreadyAssigned: result.skippedAlreadyAssigned,
      batchId: result.batchId
    };
  } catch (err) {
    console.error("[bulk-assignment action]", err);
    return fail("Đã xảy ra lỗi không mong đợi. Vui lòng thử lại.");
  }
}
