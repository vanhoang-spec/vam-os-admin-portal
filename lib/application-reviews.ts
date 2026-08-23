import "server-only";

import { canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
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
    .select("id,season_id")
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
  const scopeAccess = await canWriteReviewWorkflowForApplication(client, input.applicationId);
  if (!scopeAccess.ok) return scopeAccess;

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

  const { data: existing, error: fetchErr } = await client
    .from("application_reviews")
    .select("id,application_id")
    .eq("id", input.reviewId)
    .maybeSingle();

  if (fetchErr) {
    log("fetch review for draft save failed", fetchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!existing) return { ok: false, message: "Không tìm thấy review." };

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, existing.application_id as string);
  if (!scopeAccess.ok) return scopeAccess;

  const { error } = await client.rpc("vam081_save_application_review_draft", {
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
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, id: input.reviewId };
}

// ----------------------------------------------------------------
// Submit review
// ----------------------------------------------------------------

export async function submitApplicationReview(input: ReviewScoreInput): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: existing, error: fetchErr } = await client
    .from("application_reviews")
    .select("id,application_id")
    .eq("id", input.reviewId)
    .maybeSingle();

  if (fetchErr) {
    log("fetch review for submit failed", fetchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!existing) return { ok: false, message: "Không tìm thấy review." };

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, existing.application_id as string);
  if (!scopeAccess.ok) return scopeAccess;

  const { error } = await client.rpc("vam081_submit_application_review", {
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
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, id: input.reviewId };
}

// ----------------------------------------------------------------
// Admin assignment lifecycle
// ----------------------------------------------------------------

export type UnassignReviewInput = {
  reviewId: string;
  actorAdminUserId: string;
  cancelReason: string;
};

export async function unassignApplicationReview(input: UnassignReviewInput): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: existing, error: fetchErr } = await client
    .from("application_reviews")
    .select("id,application_id")
    .eq("id", input.reviewId)
    .maybeSingle();
  if (fetchErr) {
    log("fetch review for unassign failed", fetchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!existing) return { ok: false, message: "Không tìm thấy review." };

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, existing.application_id as string);
  if (!scopeAccess.ok) return scopeAccess;

  const { error } = await client.rpc("vam081_unassign_application_review", {
    p_review_id: input.reviewId,
    p_actor: input.actorAdminUserId,
    p_cancel_reason: input.cancelReason
  });
  if (error) {
    log("unassign review RPC failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  return { ok: true, id: input.reviewId };
}

export type ReassignReviewInput = UnassignReviewInput & {
  newReviewerAdminUserId: string;
  dueAt?: string | null;
};

export async function reassignApplicationReview(input: ReassignReviewInput): Promise<ReviewActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: existing, error: fetchErr } = await client
    .from("application_reviews")
    .select("id,application_id")
    .eq("id", input.reviewId)
    .maybeSingle();
  if (fetchErr) {
    log("fetch review for reassign failed", fetchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!existing) return { ok: false, message: "Không tìm thấy review." };

  const scopeAccess = await canWriteReviewWorkflowForApplication(client, existing.application_id as string);
  if (!scopeAccess.ok) return scopeAccess;

  const { data, error } = await client.rpc("vam081_reassign_application_review", {
    p_review_id: input.reviewId,
    p_new_reviewer_admin_user_id: input.newReviewerAdminUserId,
    p_actor: input.actorAdminUserId,
    p_cancel_reason: input.cancelReason,
    p_due_at: input.dueAt ?? null
  });
  if (error) {
    log("reassign review RPC failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  return { ok: true, id: (data as string | null) ?? input.reviewId };
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
