import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { INTERVIEW_ELIGIBLE_STATUSES } from "@/lib/interview-claim";
import { canAssignReview, canReview } from "@/lib/permissions";
import { canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
import { EDITABLE_REVIEW_STATUSES, isEditableReviewStatus } from "@/lib/review-status";
import { validateReviewEligibleReviewers } from "@/lib/reviewer-eligibility";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

// All writes use service-role to bypass RLS.
// Read access is enforced at the data layer (lib/data.ts) via the auth client + RLS.

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    console.error("[application-reviews] service-role client unavailable");
    return null;
  }
  return client;
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[application-reviews]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

async function canWriteReviewWorkflowForApplication(client: any, applicationId: string) {
  const { data: application, error } = await client
    .from("applications")
    .select("id,season_id,status")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) {
    log("load application for review scope failed", error);
    return { ok: false as const, message: SAFE_ERROR };
  }
  if (!application) return { ok: false as const, message: "KhĂ´ng tĂ¬m tháº¥y Ä‘Æ¡n á»©ng tuyá»ƒn." };
  const ctx = await getAdminScopeContext();
  if (!(await canReviewSeason(ctx, application.season_id as string | null))) {
    return { ok: false as const, message: "Ban khong co quyen review trong mua cua don nay." };
  }
  return { ok: true as const, application };
}

async function requireMutationActor(
  expectedAdminUserId: string,
  permission: "review" | "assign"
) {
  const actor = await getCurrentAdminUser();
  if (!actor?.id || actor.id !== expectedAdminUserId) {
    return { ok: false as const, message: "Bạn chưa đăng nhập hoặc phiên làm việc không hợp lệ." };
  }
  const permitted = permission === "review" ? canReview(actor.role) : canAssignReview(actor.role);
  if (!permitted) {
    return { ok: false as const, message: "Bạn không có quyền thực hiện thao tác review này." };
  }
  return { ok: true as const, actor };
}

async function conditionallyCancelReview(client: any, reviewId: string) {
  const { data, error } = await client
    .from("application_reviews")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", reviewId)
    .in("status", [...EDITABLE_REVIEW_STATUSES])
    .select("id")
    .maybeSingle();
  if (error) {
    log("cancel review failed", error);
    return { ok: false as const, message: SAFE_ERROR };
  }
  if (!data) {
    return {
      ok: false as const,
      message: "Review đã thay đổi trạng thái và không còn có thể huỷ hoặc đổi người."
    };
  }
  return { ok: true as const };
}

export type ReviewActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

// ----------------------------------------------------------------
// Assign review
// ----------------------------------------------------------------

export type AssignReviewInput = {
  applicationId: string;
  reviewerAdminUserId: string;
  assignedByAdminUserId: string;
  reviewRound: "profile_screening" | "interview";
  dueAt?: string | null;
};

export async function assignApplicationReview(input: AssignReviewInput): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const actorAccess = await requireMutationActor(input.assignedByAdminUserId, "assign");
  if (!actorAccess.ok) return actorAccess;
  if (input.reviewRound !== "profile_screening" && input.reviewRound !== "interview") {
    return { ok: false, message: "Vòng review không hợp lệ." };
  }

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, input.applicationId);
  if (!scopeAccess.ok) return scopeAccess;
  if (
    input.reviewRound === "interview" &&
    !INTERVIEW_ELIGIBLE_STATUSES.has(String(scopeAccess.application.status ?? ""))
  ) {
    return { ok: false, message: "Đơn ứng tuyển chưa ở trạng thái đủ điều kiện phỏng vấn." };
  }

  const reviewerValidation = await validateReviewEligibleReviewers(client, [input.reviewerAdminUserId]);
  if (!reviewerValidation.ok) {
    if (reviewerValidation.error) log("validate target reviewer failed", reviewerValidation.error);
    return { ok: false, message: reviewerValidation.message };
  }

  // Sequential duplicate guard for every round. Durable concurrent protection
  // still requires a database uniqueness constraint (documented in handoff).
  const { data: existing, error: dupErr } = await client
    .from("application_reviews")
    .select("id")
    .eq("application_id", input.applicationId)
    .eq("review_round", input.reviewRound)
    .eq("reviewer_admin_user_id", input.reviewerAdminUserId)
    .neq("status", "cancelled")
    .limit(1);

  if (dupErr) {
    log("check duplicate review assignment failed", dupErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (existing && existing.length > 0) {
    return { ok: false, message: "Reviewer này đã được giao ứng viên này trong cùng vòng review." };
  }

  const { data, error } = await client
    .from("application_reviews")
    .insert({
      application_id: input.applicationId,
      reviewer_admin_user_id: input.reviewerAdminUserId,
      assigned_by: input.assignedByAdminUserId,
      review_round: input.reviewRound,
      due_at: input.dueAt ?? null,
      status: "assigned"
    })
    .select("id")
    .maybeSingle();

  if (error) {
    log("insert application_reviews failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!data) {
    return { ok: false, message: SAFE_ERROR };
  }

  // Advance application status to screening_assigned (only if currently submitted/ready)
  if (input.reviewRound === "profile_screening") {
    const { error: statusErr } = await client
      .from("applications")
      .update({ status: "screening_assigned" })
      .eq("id", input.applicationId)
      .in("status", ["submitted", "under_data_check", "ready_for_screening"]);
    if (statusErr) {
      // Non-fatal: log and continue; review row was already created
      log("update application status to screening_assigned failed", statusErr);
    }
  }

  return { ok: true, id: data.id as string };
}

// ----------------------------------------------------------------
// Save draft
// ----------------------------------------------------------------

export type ReviewScoreInput = {
  reviewId: string;
  adminUserId: string; // must match reviewer_admin_user_id
  scoreMotivation?: number | null;
  scoreGoalClarity?: number | null;
  scoreCommitment?: number | null;
  scoreFit?: number | null;
  scoreCommunication?: number | null;
  recommendation?: string | null;
  reviewerNote?: string | null;
};

export async function saveApplicationReviewDraft(input: ReviewScoreInput): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const actorAccess = await requireMutationActor(input.adminUserId, "review");
  if (!actorAccess.ok) return actorAccess;

  // Verify ownership — reviewer can only edit their own review
  const { data: existing, error: fetchErr } = await client
    .from("application_reviews")
    .select("id,reviewer_admin_user_id,status,application_id")
    .eq("id", input.reviewId)
    .maybeSingle();

  if (fetchErr) {
    log("fetch review for draft save failed", fetchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!existing) return { ok: false, message: "Không tìm thấy review." };
  if (existing.reviewer_admin_user_id !== input.adminUserId) {
    return { ok: false, message: "Bạn không có quyền chỉnh sửa review này." };
  }
  if (!isEditableReviewStatus(existing.status)) {
    return { ok: false, message: "Review không còn ở trạng thái cho phép chỉnh sửa." };
  }

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, existing.application_id as string);
  if (!scopeAccess.ok) return scopeAccess;

  const { data: updated, error } = await client
    .from("application_reviews")
    .update({
      status: "in_progress",
      score_motivation: input.scoreMotivation ?? null,
      score_goal_clarity: input.scoreGoalClarity ?? null,
      score_commitment: input.scoreCommitment ?? null,
      score_fit: input.scoreFit ?? null,
      score_communication: input.scoreCommunication ?? null,
      recommendation: input.recommendation ?? null,
      reviewer_note: input.reviewerNote ?? null,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.reviewId)
    .eq("reviewer_admin_user_id", input.adminUserId)
    .in("status", [...EDITABLE_REVIEW_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) {
    log("update review draft failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!updated) {
    return { ok: false, message: "Review đã thay đổi trạng thái; bản nháp không được lưu." };
  }

  return { ok: true, id: input.reviewId };
}

// ----------------------------------------------------------------
// Submit review
// ----------------------------------------------------------------

export async function submitApplicationReview(input: ReviewScoreInput): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const actorAccess = await requireMutationActor(input.adminUserId, "review");
  if (!actorAccess.ok) return actorAccess;

  // Verify ownership
  const { data: existing, error: fetchErr } = await client
    .from("application_reviews")
    .select("id,reviewer_admin_user_id,status,application_id,review_round")
    .eq("id", input.reviewId)
    .maybeSingle();

  if (fetchErr) {
    log("fetch review for submit failed", fetchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!existing) return { ok: false, message: "Không tìm thấy review." };
  if (existing.reviewer_admin_user_id !== input.adminUserId) {
    return { ok: false, message: "Bạn không có quyền submit review này." };
  }
  if (!isEditableReviewStatus(existing.status)) {
    return { ok: false, message: "Review không còn ở trạng thái cho phép submit." };
  }

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, existing.application_id as string);
  if (!scopeAccess.ok) return scopeAccess;

  // Calculate total_score from available dimensions
  const scores = [
    input.scoreMotivation,
    input.scoreGoalClarity,
    input.scoreCommitment,
    input.scoreFit,
    input.scoreCommunication
  ].filter((s): s is number => typeof s === "number" && s >= 1 && s <= 5);
  const totalScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) : null;

  const { data: updated, error } = await client
    .from("application_reviews")
    .update({
      status: "submitted",
      score_motivation: input.scoreMotivation ?? null,
      score_goal_clarity: input.scoreGoalClarity ?? null,
      score_commitment: input.scoreCommitment ?? null,
      score_fit: input.scoreFit ?? null,
      score_communication: input.scoreCommunication ?? null,
      total_score: totalScore,
      recommendation: input.recommendation ?? null,
      reviewer_note: input.reviewerNote ?? null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", input.reviewId)
    .eq("reviewer_admin_user_id", input.adminUserId)
    .in("status", [...EDITABLE_REVIEW_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) {
    log("submit review update failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!updated) {
    return { ok: false, message: "Review đã thay đổi trạng thái; thao tác submit bị từ chối." };
  }

  // Advance application.status based on review_round
  if (existing.review_round === "profile_screening") {
    const { error: statusErr } = await client
      .from("applications")
      .update({ status: "screening_completed" })
      .eq("id", existing.application_id)
      .in("status", ["screening_assigned", "screening_in_progress"]);
    if (statusErr) {
      log("update application status to screening_completed failed", statusErr);
    }
  } else if (existing.review_round === "interview") {
    const { error: statusErr } = await client
      .from("applications")
      .update({ status: "interview_completed" })
      .eq("id", existing.application_id)
      .in("status", ["interview_in_progress"]);
    if (statusErr) {
      log("update application status to interview_completed failed", statusErr);
    }
  }

  return { ok: true, id: input.reviewId };
}

// ----------------------------------------------------------------
// Admin: directly update application status
// ----------------------------------------------------------------

const ALLOWED_ADMIN_STATUS_TRANSITIONS = new Set([
  "ready_for_screening",
  "screening_passed",
  "invited_to_meeting",
  "invited_to_orientation",
  "invited_to_interview",
  "waitlisted",
  "rejected_or_not_fit",
  "withdrawn"
]);

export type UpdateApplicationStatusInput = {
  applicationId: string;
  newStatus: string;
};

export async function updateApplicationStatus(input: UpdateApplicationStatusInput): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  if (!ALLOWED_ADMIN_STATUS_TRANSITIONS.has(input.newStatus)) {
    return { ok: false, message: `Trạng thái không hợp lệ: ${input.newStatus}` };
  }

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, input.applicationId);
  if (!scopeAccess.ok) return scopeAccess;

  const { error } = await client
    .from("applications")
    .update({ status: input.newStatus })
    .eq("id", input.applicationId);

  if (error) {
    log("update application status failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, id: input.applicationId };
}

// ----------------------------------------------------------------
// Cancel / Reassign Review
// ----------------------------------------------------------------

export async function cancelApplicationReview(input: {
  reviewId: string;
  adminUserId: string;
}): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const actorAccess = await requireMutationActor(input.adminUserId, "assign");
  if (!actorAccess.ok) return actorAccess;

  const { data: existing, error: fetchErr } = await client
    .from("application_reviews")
    .select("id,status,application_id")
    .eq("id", input.reviewId)
    .maybeSingle();

  if (fetchErr) {
    log("fetch review for cancel failed", fetchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!existing) return { ok: false, message: "Không tìm thấy review." };

  if (!isEditableReviewStatus(existing.status)) {
    return { ok: false, message: "Review không còn ở trạng thái cho phép huỷ." };
  }

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, existing.application_id as string);
  if (!scopeAccess.ok) return scopeAccess;

  const cancellation = await conditionallyCancelReview(client, input.reviewId);
  if (!cancellation.ok) return cancellation;

  return { ok: true, id: input.reviewId };
}

export async function reassignApplicationReview(input: {
  reviewId: string;
  newReviewerAdminUserId: string;
  adminUserId: string;
}): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const actorAccess = await requireMutationActor(input.adminUserId, "assign");
  if (!actorAccess.ok) return actorAccess;

  const { data: existing, error: fetchErr } = await client
    .from("application_reviews")
    .select("id,status,application_id,review_round,reviewer_admin_user_id,due_at,updated_at")
    .eq("id", input.reviewId)
    .maybeSingle();

  if (fetchErr) {
    log("fetch review for reassign failed", fetchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!existing) return { ok: false, message: "Không tìm thấy review." };

  const reviewerValidation = await validateReviewEligibleReviewers(client, [input.newReviewerAdminUserId]);
  if (!reviewerValidation.ok) {
    if (reviewerValidation.error) log("validate reassignment target failed", reviewerValidation.error);
    return { ok: false, message: reviewerValidation.message };
  }

  if (existing.reviewer_admin_user_id === input.newReviewerAdminUserId) {
    return { ok: false, message: "Người review mới phải khác người review hiện tại." };
  }
  if (!isEditableReviewStatus(existing.status)) {
    return { ok: false, message: "Review không còn ở trạng thái cho phép đổi người." };
  }

  const scopeAccess = await canWriteReviewWorkflowForApplication(
    client,
    existing.application_id as string
  );
  if (!scopeAccess.ok) return scopeAccess;
  const reviewRound = existing.review_round as "profile_screening" | "interview";
  if (reviewRound !== "profile_screening" && reviewRound !== "interview") {
    return { ok: false, message: "Vòng review hiện tại không hợp lệ." };
  }
  if (
    reviewRound === "interview" &&
    !INTERVIEW_ELIGIBLE_STATUSES.has(String(scopeAccess.application.status ?? ""))
  ) {
    return { ok: false, message: "Đơn ứng tuyển không còn đủ điều kiện giao phỏng vấn." };
  }

  const { data: duplicate, error: duplicateError } = await client
    .from("application_reviews")
    .select("id")
    .eq("application_id", existing.application_id)
    .eq("review_round", reviewRound)
    .eq("reviewer_admin_user_id", input.newReviewerAdminUserId)
    .neq("status", "cancelled")
    .limit(1);
  if (duplicateError) {
    log("check reassignment duplicate failed", duplicateError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (duplicate && duplicate.length > 0) {
    return { ok: false, message: "Người review mới đã có assignment cho ứng viên này." };
  }

  const cancellation = await conditionallyCancelReview(client, input.reviewId);
  if (!cancellation.ok) return cancellation;

  const { data: replacement, error: insertError } = await client
    .from("application_reviews")
    .insert({
      application_id: existing.application_id,
      reviewer_admin_user_id: input.newReviewerAdminUserId,
      assigned_by: input.adminUserId,
      review_round: reviewRound,
      due_at: (existing.due_at as string | null) ?? null,
      status: "assigned"
    })
    .select("id")
    .maybeSingle();

  if (insertError) log("insert reassigned application review failed", insertError);
  if (insertError || !replacement) {
    const { data: restored, error: restoreError } = await client
      .from("application_reviews")
      .update({
        status: existing.status,
        updated_at: existing.updated_at ?? null
      })
      .eq("id", input.reviewId)
      .eq("status", "cancelled")
      .select("id")
      .maybeSingle();
    if (restoreError || !restored) {
      log("reassignment compensation failed", restoreError ?? "no row restored");
      return {
        ok: false,
        message: "Đổi người review thất bại và assignment cũ không thể tự động khôi phục. Vui lòng kiểm tra ngay."
      };
    }
    return { ok: false, message: "Không thể tạo assignment mới; assignment cũ đã được khôi phục." };
  }

  return { ok: true, id: replacement.id as string };
}
