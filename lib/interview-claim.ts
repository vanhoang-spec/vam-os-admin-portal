import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { isApplicationReviewAssignable } from "@/lib/application-review-assignability";
import { canSelfClaimInterview } from "@/lib/permissions";
import { canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Phase 044B — Interview self-claim
//
// Behavior:
//   1. Permission check — reviewer / core_team / admin / super_admin only.
//   2. Load application, validate status is interview-eligible.
//   3. If current user already has an active (non-cancelled) interview review
//      for this application → return existing review ID (idempotent).
//   4. If ANOTHER reviewer already has an active in-progress review → return
//      a conflict message with the other reviewer's name/email.
//   5. Insert new application_reviews row:
//        review_round = 'interview'
//        reviewer_admin_user_id = current actor
//        assigned_by             = current actor
//        status                  = 'in_progress'
//        claimed_at              = now()
//        claim_source            = 'self_claim'
//   6. Advance applications.status to 'interview_in_progress' (non-fatal)
//      if current status is invited_to_interview or interview_scheduled.
// ---------------------------------------------------------------------------

const SAFE_ERROR =
  "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";



function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[interview-claim]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export type ClaimInterviewResult = {
  ok: boolean;
  message: string;
  reviewId?: string;
  /** true when another reviewer already holds an active claim. */
  alreadyClaimed?: boolean;
};

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function claimInterviewReview(input: {
  applicationId: string;
}): Promise<ClaimInterviewResult> {
  // --- Permission check
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canSelfClaimInterview(actor.role)) {
    return { ok: false, message: "Bạn không có quyền thực hiện phỏng vấn." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const appId = input.applicationId.trim();

  // --- Load and validate application
  const { data: app, error: appErr } = await client
    .from("applications")
    .select("id,status,full_name,email_primary,season_id")
    .eq("id", appId)
    .maybeSingle();

  if (appErr) {
    log("load application", appErr);
    return { ok: false, message: `Không thể tải thông tin đơn: ${appErr.message}` };
  }
  if (!app) return { ok: false, message: "Không tìm thấy đơn ứng tuyển." };

  const scopeContext = await getAdminScopeContext();
  if (!(await canReviewSeason(scopeContext, app.season_id as string | null))) {
    return { ok: false, message: "Ban khong co quyen review trong mua cua don nay." };
  }
  const { data: participant, error: participantError } = await client.rpc(
    "vam084_participant_for_stage",
    { p_admin_user_id: actor.id, p_season_id: app.season_id, p_review_stage: "interview" }
  );
  if (participantError || participant !== true) {
    return { ok: false, message: "Bạn không phải interviewer được cấp quyền cho mùa này." };
  }

  const appStatus = String(app.status ?? "").trim();
  const { data: interviewProvenance, error: provenanceError } = await client
    .from("application_reviews")
    .select("id")
    .eq("application_id", appId)
    .eq("review_round", "interview")
    .limit(1);
  if (provenanceError) {
    log("load interview provenance", provenanceError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!isApplicationReviewAssignable({
    status: appStatus,
    reviewRound: "interview",
    hasAnyInterviewReview: Boolean(interviewProvenance?.length)
  })) {
    return {
      ok: false,
      message: `Đơn này chưa được mời phỏng vấn (trạng thái hiện tại: ${appStatus || "chưa xác định"}).`
    };
  }

  // --- Check if current user already has an active interview review
  const { data: myExisting, error: myErr } = await client
    .from("application_reviews")
    .select("id,status")
    .eq("application_id", appId)
    .eq("review_round", "interview")
    .eq("reviewer_admin_user_id", actor.id)
    .neq("status", "cancelled")
    .maybeSingle();

  if (myErr) {
    log("check existing review for current user", myErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (myExisting) {
    // Idempotent — return existing review
    return {
      ok: true,
      message: "Bạn đã có interview review cho ứng viên này.",
      reviewId: String(myExisting.id)
    };
  }

  // S12 uses explicit Core Team assignment. A participant role alone never
  // grants access to another applicant or creates a self-claimed assignment.
  return {
    ok: false,
    message: "Bạn chưa được phân công phỏng vấn ứng viên này."
  };
}
