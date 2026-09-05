import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { WITHDRAWN_APPLICATION_REVIEW_MESSAGE } from "@/lib/application-review-assignability";
import { canAssignReview, canReview } from "@/lib/permissions";
import { canOperateSeason, canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
import { isEditableReviewStatus } from "@/lib/review-status";
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

function mutationErrorMessage(error: unknown): string {
  const message = String((error as { message?: string } | null)?.message ?? "");
  return message.includes("APPLICATION_WITHDRAWN")
    ? WITHDRAWN_APPLICATION_REVIEW_MESSAGE
    : SAFE_ERROR;
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
  if (!application) return { ok: false as const, message: "Không tìm thấy đơn ứng tuyển." };
  const ctx = await getAdminScopeContext();
  if (!(await canReviewSeason(ctx, application.season_id as string | null)) &&
      !(await canOperateSeason(ctx, application.season_id as string | null))) {
    return { ok: false as const, message: "Bạn không có quyền review trong mùa của đơn này." };
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

  const { data: eligibilityData, error: eligibilityError } = await client.rpc(
    "vam095_application_review_assignability",
    { p_application_id: input.applicationId, p_review_round: input.reviewRound }
  );
  if (eligibilityError) {
    log("check application assignment eligibility failed", eligibilityError);
    return { ok: false, message: mutationErrorMessage(eligibilityError) };
  }
  const eligibility = (Array.isArray(eligibilityData) ? eligibilityData[0] : eligibilityData) as
    | { assignable: boolean; reason: string }
    | null;
  if (!eligibility?.assignable) {
    return {
      ok: false,
      message: eligibility?.reason === "application_withdrawn"
        ? WITHDRAWN_APPLICATION_REVIEW_MESSAGE
        : "Đơn ứng tuyển chưa ở trạng thái phù hợp để phân công vòng đánh giá này."
    };
  }

  const reviewerValidation = await validateReviewEligibleReviewers(
    client,
    [input.reviewerAdminUserId],
    String(scopeAccess.application.season_id),
    input.reviewRound
  );
  if (!reviewerValidation.ok) {
    if (reviewerValidation.error) log("validate target reviewer failed", reviewerValidation.error);
    return { ok: false, message: reviewerValidation.message };
  }

  const { data, error } = await client.rpc("vam095_assign_application_review", {
    p_application_id: input.applicationId,
    p_reviewer_id: input.reviewerAdminUserId,
    p_review_round: input.reviewRound,
    p_due_at: input.dueAt ?? null,
    p_actor: input.assignedByAdminUserId
  });

  if (error) {
    log("atomic application review assignment failed", error);
    return { ok: false, message: mutationErrorMessage(error) };
  }
  if (!data) {
    return { ok: false, message: SAFE_ERROR };
  }
  return { ok: true, id: String(data) };
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

  const { data: updated, error } = await client.rpc("vam095_save_application_review_draft", {
    p_review_id: input.reviewId,
    p_actor: input.adminUserId,
    p_score_motivation: input.scoreMotivation ?? null,
    p_score_goal_clarity: input.scoreGoalClarity ?? null,
    p_score_commitment: input.scoreCommitment ?? null,
    p_score_fit: input.scoreFit ?? null,
    p_score_communication: input.scoreCommunication ?? null,
    p_recommendation: input.recommendation ?? null,
    p_reviewer_note: input.reviewerNote ?? null
  });

  if (error) {
    log("update review draft failed", error);
    return { ok: false, message: mutationErrorMessage(error) };
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

  const { data: updated, error } = await client.rpc("vam084_submit_application_review", {
    p_review_id: input.reviewId,
    p_actor: input.adminUserId,
    p_score_motivation: input.scoreMotivation ?? null,
    p_score_goal_clarity: input.scoreGoalClarity ?? null,
    p_score_commitment: input.scoreCommitment ?? null,
    p_score_fit: input.scoreFit ?? null,
    p_score_communication: input.scoreCommunication ?? null,
    p_recommendation: input.recommendation ?? null,
    p_reviewer_note: input.reviewerNote ?? null
  });

  if (error) {
    log("submit review update failed", error);
    return { ok: false, message: mutationErrorMessage(error) };
  }
  if (!updated) {
    return { ok: false, message: "Review đã thay đổi trạng thái; thao tác submit bị từ chối." };
  }

  return { ok: true, id: input.reviewId };
}

// ----------------------------------------------------------------
// Cancel / Reassign Review
// ----------------------------------------------------------------

export async function cancelApplicationReview(input: {
  reviewId: string;
  adminUserId: string;
  reason?: string;
}): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const actorAccess = await requireMutationActor(input.adminUserId, "assign");
  if (!actorAccess.ok) return actorAccess;

  const reason = input.reason?.trim() || "Operational cancellation";
  const { data, error } = await client.rpc("vam084_change_review_assignment", {
    p_review_id: input.reviewId,
    p_actor: input.adminUserId,
    p_reason: reason,
    p_new_reviewer: null
  });
  if (error || !data) {
    log("atomic cancel review failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  return { ok: true, id: String(data) };
}

export async function reassignApplicationReview(input: {
  reviewId: string;
  newReviewerAdminUserId: string;
  adminUserId: string;
  reason?: string;
}): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const actorAccess = await requireMutationActor(input.adminUserId, "assign");
  if (!actorAccess.ok) return actorAccess;

  const reason = input.reason?.trim() || "Operational reassignment";
  const { data, error } = await client.rpc("vam084_change_review_assignment", {
    p_review_id: input.reviewId,
    p_actor: input.adminUserId,
    p_reason: reason,
    p_new_reviewer: input.newReviewerAdminUserId
  });
  if (error || !data) {
    log("atomic reassign review failed", error);
    return { ok: false, message: mutationErrorMessage(error) };
  }
  return { ok: true, id: String(data) };
}
