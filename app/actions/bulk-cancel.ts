"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canAssignReview } from "@/lib/permissions";
import { cancelApplicationReview } from "@/lib/application-reviews";
import {
  BULK_CANCEL_MAX,
  type BulkCancelActionState
} from "@/lib/bulk-cancel-action-types";

function fail(message: string): BulkCancelActionState {
  return { ok: false, message, cancelledCount: 0, failures: [] };
}

/**
 * Hand a set of applications back to the unassigned pool.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Cancelling an assignment was already possible, in two places: a panel inside
 * `/applications/<id>` and another inside `/reviews/<id>`. Both act on one
 * application, both sit below the fold of a detail page nobody opens unless
 * they already know the control is there. The programme owner, an admin,
 * looked for it and could not find it at all.
 *
 * So it now lives where assigning lives. Same screen, same list, same
 * selection — "Đã giao" is a tab beside "Chưa giao", and handing back is the
 * inverse of the button next to it.
 *
 * ---------------------------------------------------------------------------
 * WHY A LOOP AND NOT ONE CALL
 * ---------------------------------------------------------------------------
 * `vam084_change_review_assignment` cancels one assignment, writes the reason,
 * records who did it, and leaves the previous review row intact for audit.
 * Reproducing that as a set operation would mean a second implementation of
 * the lifecycle rules, which is the thing most likely to drift from the one
 * the single-application path uses. Twenty-five sequential calls is the cost
 * of having exactly one cancel in the system.
 *
 * A failure part-way through is reported per row rather than rolled back: the
 * assignments already returned ARE returned, and saying so is more useful than
 * claiming nothing happened.
 */
export async function bulkCancelApplicationReviewsAction(
  _previousState: BulkCancelActionState,
  formData: FormData
): Promise<BulkCancelActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canAssignReview(adminUser.role)) {
      return fail("Bạn không có quyền huỷ phân công review.");
    }

    const reviewIds = formData
      .getAll("review_id")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const uniqueIds = Array.from(new Set(reviewIds));

    if (!uniqueIds.length) return fail("Chưa chọn hồ sơ nào để huỷ phân công.");
    if (uniqueIds.length > BULK_CANCEL_MAX) {
      return fail(`Mỗi lần chỉ huỷ tối đa ${BULK_CANCEL_MAX} hồ sơ. Đang chọn ${uniqueIds.length}.`);
    }

    // The reason is stored on the assignment and shown in its history, so the
    // next person to open the application can see why it came back.
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason.length < 3) {
      return fail("Vui lòng ghi lý do huỷ phân công (tối thiểu 3 ký tự).");
    }

    let cancelledCount = 0;
    const failures: string[] = [];

    for (const reviewId of uniqueIds) {
      const result = await cancelApplicationReview({
        reviewId,
        adminUserId: adminUser.id,
        reason
      });
      if (result.ok) cancelledCount += 1;
      else failures.push(`${reviewId.slice(0, 8)}: ${result.message}`);
    }

    revalidatePath("/reviews/assign-bulk");
    revalidatePath("/reviews");
    revalidatePath("/reviews/progress");
    revalidatePath("/my-work");
    revalidatePath("/applications");

    if (!cancelledCount) {
      return {
        ok: false,
        message: "Không huỷ được phân công nào.",
        cancelledCount: 0,
        failures
      };
    }

    return {
      ok: true,
      message: failures.length
        ? `Đã trả ${cancelledCount} hồ sơ về hàng chờ. ${failures.length} hồ sơ không huỷ được.`
        : `Đã trả ${cancelledCount} hồ sơ về hàng chờ, sẵn sàng giao lại.`,
      cancelledCount,
      failures
    };
  } catch (error) {
    console.error("[bulkCancelApplicationReviewsAction]", error);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}
