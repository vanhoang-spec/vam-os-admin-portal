import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
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

/** Statuses that allow a new self-claim to be created. */
export const INTERVIEW_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress"
]);

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

  const appStatus = String(app.status ?? "").trim();
  if (!INTERVIEW_ELIGIBLE_STATUSES.has(appStatus)) {
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

  // --- Check if another reviewer already has an active (in_progress) claim
  const { data: otherClaims, error: otherErr } = await client
    .from("application_reviews")
    .select("id,reviewer_admin_user_id,status")
    .eq("application_id", appId)
    .eq("review_round", "interview")
    .in("status", ["assigned", "in_progress"])
    .neq("reviewer_admin_user_id", actor.id)
    .limit(1);

  if (otherErr) {
    // Non-fatal: log and proceed with claim
    log("check other active claims (non-fatal)", otherErr);
  }

  const otherReview = (otherClaims ?? [])[0] ?? null;
  if (otherReview) {
    const otherReviewerId = otherReview.reviewer_admin_user_id as string | null;
    let who = "một interviewer khác";
    if (otherReviewerId) {
      const { data: otherUser } = await client
        .from("admin_users")
        .select("full_name,email")
        .eq("id", otherReviewerId)
        .maybeSingle();
      who =
        (otherUser as { full_name?: string | null; email?: string | null } | null)?.full_name ??
        (otherUser as { full_name?: string | null; email?: string | null } | null)?.email ??
        who;
    }
    return {
      ok: false,
      message: `Ứng viên này đang được phỏng vấn bởi ${who}.`,
      alreadyClaimed: true
    };
  }

  // --- Create new interview review row
  const now = new Date().toISOString();
  const { data: newReview, error: insertErr } = await client
    .from("application_reviews")
    .insert({
      application_id: appId,
      review_round: "interview",
      reviewer_admin_user_id: actor.id,
      assigned_by: actor.id,
      assigned_at: now,
      status: "in_progress",
      claimed_at: now,
      claim_source: "self_claim"
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    log("insert interview review", insertErr);
    return { ok: false, message: `Không thể tạo interview review: ${insertErr.message}` };
  }
  if (!newReview?.id) {
    return { ok: false, message: SAFE_ERROR };
  }

  // --- Advance application status to interview_in_progress (non-fatal)
  const { error: statusErr } = await client
    .from("applications")
    .update({ status: "interview_in_progress" })
    .eq("id", appId)
    .in("status", ["invited_to_interview", "interview_scheduled"]);

  if (statusErr) {
    log("advance status to interview_in_progress (non-fatal)", statusErr);
  }

  return {
    ok: true,
    message: "Đã bắt đầu phỏng vấn.",
    reviewId: String(newReview.id)
  };
}
