"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { assignSelectedApplicationReviews } from "@/lib/bulk-assignment";
import { canAssignReviewLots } from "@/lib/permissions";
import { notifyReviewerOfAssignment } from "@/lib/review-assignment-notice";
import { parseReviewDueDate } from "@/lib/review-due";
import { formatDate } from "@/lib/utils";
import type { BulkAssignmentActionState } from "@/lib/bulk-assignment-action-types";

function fail(message: string): BulkAssignmentActionState {
  return { ok: false, message };
}

/** Every screen that lists assignments, so none keeps showing the old state. */
function revalidateAssignmentScreens() {
  revalidatePath("/reviews");
  revalidatePath("/reviews/assign-bulk");
  revalidatePath("/reviews/progress");
  revalidatePath("/applications");
}

export async function bulkAssignApplicationReviewsAction(
  _prev: BulkAssignmentActionState,
  formData: FormData
): Promise<BulkAssignmentActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canAssignReviewLots(adminUser.role)) return fail("Bạn không có quyền thực hiện thao tác này.");

    // Parse form fields
    const applicationIds = formData.getAll("application_ids").map((v) => String(v).trim()).filter(Boolean);
    const reviewerId = String(formData.get("reviewer_id") ?? "").trim();
    const reviewRoundRaw = String(formData.get("review_round") ?? "profile_screening").trim();
    if (reviewRoundRaw !== "profile_screening" && reviewRoundRaw !== "interview") {
      return fail("Vòng review không hợp lệ.");
    }
    const reviewRound = reviewRoundRaw;
    const assignmentNote = String(formData.get("assignment_note") ?? "").trim() || null;
    // Profile round only. An interview needs a slot before there is anything
    // useful to tell the interviewer, and that notice belongs to scheduling.
    const notifyReviewer = reviewRound === "profile_screening" && formData.get("notify_reviewer") === "1";

    if (!applicationIds.length) return fail("Vui lòng chọn ít nhất một hồ sơ.");
    if (!reviewerId) return fail("Vui lòng chọn người phụ trách.");

    // The screen already blocks a half-typed or past deadline, but a form value
    // is whatever the sender put there. Re-check with the same function the
    // screen uses — and refuse rather than assign without the deadline.
    const due = parseReviewDueDate(formData.get("due_at"));
    if (!due.ok) return fail(due.message);

    const result = await assignSelectedApplicationReviews({
      applicationIds,
      reviewerAdminUserId: reviewerId,
      reviewRound,
      dueAt: due.dueAt,
      assignmentNote,
      assignedByAdminUserId: adminUser.id
    });

    if (!result.ok) {
      // The database refused because the screen is out of date — a lot already
      // assigned, a status that moved on. Reload it, or the operator can only
      // tick the same rows and be refused again.
      if (result.refreshList) revalidateAssignmentScreens();
      return { ok: false, message: result.message };
    }

    revalidateAssignmentScreens();

    const assigned = due.dueAt
      ? `Đã giao thành công ${result.applicationsAssigned} hồ sơ, hạn hoàn tất hết ngày ${formatDate(due.dueAt)}.`
      : `Đã giao thành công ${result.applicationsAssigned} hồ sơ.`;

    // Only once the lot is saved. The notice never throws, and a mail that did
    // not go out must not read as a failed assignment — the operator would
    // assign again a lot the reviewer already holds.
    let message = assigned;
    let emailWarning: string | null = null;
    if (notifyReviewer) {
      const notice = await notifyReviewerOfAssignment({
        reviewerAdminUserId: reviewerId,
        applicationIds,
        applicationsAssigned: result.applicationsAssigned,
        dueAt: due.dueAt,
        assignmentBatchId: result.batchId
      });
      if (notice.status === "sent") {
        message = `${assigned} Đã gửi thư báo cho ${notice.reviewerLabel}.`;
      } else {
        const reason = notice.reason.trim().replace(/[.\s]+$/, "");
        emailWarning = `Chưa gửi được thư báo cho ${notice.reviewerLabel}: ${reason}. Hồ sơ vẫn đã được giao, không cần giao lại.`;
      }
    }

    return {
      ok: true,
      message,
      emailWarning,
      applicationsAssigned: result.applicationsAssigned,
      reviewerId: result.reviewerId,
      batchId: result.batchId
    };
  } catch (err) {
    console.error("[bulk-assignment action]", err);
    return fail("Đã xảy ra lỗi không mong đợi. Vui lòng thử lại.");
  }
}
