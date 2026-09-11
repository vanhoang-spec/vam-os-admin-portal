"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  assignApplicationReview,
  cancelApplicationReview,
  reassignApplicationReview,
  saveApplicationReviewDraft,
  submitApplicationReview
} from "@/lib/application-reviews";
import { canAssignReview, canReview } from "@/lib/permissions";
import type { ReviewActionState } from "@/lib/review-action-types";
import { parseReviewDueDate } from "@/lib/review-due";

function fail(message: string): ReviewActionState {
  return { ok: false, message };
}

// ----------------------------------------------------------------
// Assign reviewer (admin / core_team only)
// ----------------------------------------------------------------

export async function assignApplicationReviewAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canAssignReview(adminUser.role)) return fail("Bạn không có quyền giao review.");

    const applicationId = String(formData.get("application_id") ?? "").trim();
    const reviewerAdminUserId = String(formData.get("reviewer_admin_user_id") ?? "").trim();
    const reviewRoundRaw = String(formData.get("review_round") ?? "").trim();

    if (!applicationId) return fail("Thiếu application_id.");
    if (!reviewerAdminUserId) return fail("Vui lòng chọn reviewer.");
    if (reviewRoundRaw !== "profile_screening" && reviewRoundRaw !== "interview") {
      return fail("review_round không hợp lệ.");
    }

    // Same reading as the bulk screen: a date means the end of that day in
    // Vietnam. Passing the raw `YYYY-MM-DD` through let Postgres read it as
    // midnight UTC — 07:00 in Vietnam — so reviewers went overdue that morning.
    const due = parseReviewDueDate(formData.get("due_at"));
    if (!due.ok) return fail(due.message);

    const result = await assignApplicationReview({
      applicationId,
      reviewerAdminUserId,
      assignedByAdminUserId: adminUser.id,
      reviewRound: reviewRoundRaw,
      dueAt: due.dueAt
    });

    if (!result.ok) return fail(result.message);

    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/reviews");
    return { ok: true, message: "Đã giao review thành công.", reviewId: result.id };
  } catch (err) {
    console.error("[assignApplicationReviewAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

// ----------------------------------------------------------------
// Save draft (reviewer + admin tiers)
// ----------------------------------------------------------------

export async function saveApplicationReviewDraftAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canReview(adminUser.role)) return fail("Bạn không có quyền chỉnh sửa review.");

    const reviewId = String(formData.get("review_id") ?? "").trim();
    if (!reviewId) return fail("Thiếu review_id.");

    const result = await saveApplicationReviewDraft({
      reviewId,
      adminUserId: adminUser.id,
      scoreMotivation: parseScore(formData.get("score_motivation")),
      scoreGoalClarity: parseScore(formData.get("score_goal_clarity")),
      scoreCommitment: parseScore(formData.get("score_commitment")),
      scoreFit: parseScore(formData.get("score_fit")),
      scoreCommunication: parseScore(formData.get("score_communication")),
      recommendation: String(formData.get("recommendation") ?? "").trim() || null,
      reviewerNote: String(formData.get("reviewer_note") ?? "").trim() || null
    });

    if (!result.ok) return fail(result.message);

    revalidatePath(`/reviews/${reviewId}`);
    return { ok: true, message: "Đã lưu nháp." };
  } catch (err) {
    console.error("[saveApplicationReviewDraftAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

// ----------------------------------------------------------------
// Submit review (reviewer + admin tiers)
// ----------------------------------------------------------------

export async function submitApplicationReviewAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canReview(adminUser.role)) return fail("Bạn không có quyền submit review.");

    const reviewId = String(formData.get("review_id") ?? "").trim();
    const recommendation = String(formData.get("recommendation") ?? "").trim();
    if (!reviewId) return fail("Thiếu review_id.");
    if (!recommendation) return fail("Vui lòng chọn kết quả đề xuất (recommendation).");

    const result = await submitApplicationReview({
      reviewId,
      adminUserId: adminUser.id,
      scoreMotivation: parseScore(formData.get("score_motivation")),
      scoreGoalClarity: parseScore(formData.get("score_goal_clarity")),
      scoreCommitment: parseScore(formData.get("score_commitment")),
      scoreFit: parseScore(formData.get("score_fit")),
      scoreCommunication: parseScore(formData.get("score_communication")),
      recommendation,
      reviewerNote: String(formData.get("reviewer_note") ?? "").trim() || null
    });

    if (!result.ok) return fail(result.message);

    revalidatePath(`/reviews/${reviewId}`);
    revalidatePath("/reviews");
    return { ok: true, message: "Review đã được submit thành công." };
  } catch (err) {
    console.error("[submitApplicationReviewAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

// ----------------------------------------------------------------
// Cancel Review (admin / core_team only)
// ----------------------------------------------------------------

export async function cancelApplicationReviewAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canAssignReview(adminUser.role)) return fail("Bạn không có quyền huỷ review.");

    const reviewId = String(formData.get("review_id") ?? "").trim();
    const applicationId = String(formData.get("application_id") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reviewId) return fail("Thiếu review_id.");

    const result = await cancelApplicationReview({
      reviewId,
      adminUserId: adminUser.id,
      reason
    });

    if (!result.ok) return fail(result.message);

    revalidatePath(`/reviews/${reviewId}`);
    revalidatePath("/reviews");
    revalidatePath("/my-work");
    if (applicationId) {
      revalidatePath(`/applications/${applicationId}`);
      revalidatePath("/applications");
    }
    return { ok: true, message: "Đã huỷ review thành công." };
  } catch (err) {
    console.error("[cancelApplicationReviewAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

// ----------------------------------------------------------------
// Reassign Review (admin / core_team only)
// ----------------------------------------------------------------

export async function reassignApplicationReviewAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canAssignReview(adminUser.role)) return fail("Bạn không có quyền đổi người review.");

    const reviewId = String(formData.get("review_id") ?? "").trim();
    const applicationId = String(formData.get("application_id") ?? "").trim();
    const newReviewerAdminUserId = String(formData.get("new_reviewer_admin_user_id") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reviewId) return fail("Thiếu review_id.");
    if (!newReviewerAdminUserId) return fail("Vui lòng chọn người review mới.");

    const result = await reassignApplicationReview({
      reviewId,
      newReviewerAdminUserId,
      adminUserId: adminUser.id,
      reason
    });

    if (!result.ok) return fail(result.message);

    revalidatePath(`/reviews/${reviewId}`);
    revalidatePath("/reviews");
    if (applicationId) {
      revalidatePath(`/applications/${applicationId}`);
      revalidatePath("/applications");
    }
    return { ok: true, message: "Đã đổi người review thành công.", reviewId: result.id };
  } catch (err) {
    console.error("[reassignApplicationReviewAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

// Helpers


function parseScore(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const n = parseInt(String(value), 10);
  if (isNaN(n) || n < 1 || n > 5) return null;
  return n;
}

// ----------------------------------------------------------------
// Combined draft + submit action — driven by _intent field value.
// Used by ReviewForm so a single <form> can handle both intents.
// ----------------------------------------------------------------

export async function handleReviewFormAction(
  _prev: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  const intent = String(formData.get("_intent") ?? "").trim();
  if (intent === "draft") return saveApplicationReviewDraftAction(_prev, formData);
  if (intent === "submit") return submitApplicationReviewAction(_prev, formData);
  return fail("Hành động không hợp lệ.");
}
