import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { INTERVIEW_ELIGIBLE_STATUSES } from "@/lib/bulk-assignment-action-types";
import { canSelfClaimInterview } from "@/lib/permissions";
import { canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// S12 interview day — bounded self-claim
//
// Interview day for mentee recruitment is walk-up, not scheduled. A candidate
// arrives, gives their name, and whichever eligible interviewer is free
// searches for them and claims them at that moment. Core Team does not
// pre-assign every candidate.
//
// The exception is a candidate deliberately reserved for a named interviewer.
// Core Team assigns those in advance, and the reservation is expressed by the
// existence of that interviewer's interview review — so "someone already holds
// an active interview review" is precisely the signal that the candidate is
// spoken for, whether that review arrived by Core Team assignment or by an
// earlier self-claim.
//
// Behaviour:
//   1. Permission — reviewer / core_team / admin / super_admin only.
//   2. Season scope — the actor must be able to review the candidate's season,
//      and must be an interview participant in that exact season.
//   3. Lifecycle — the application must be interview-eligible.
//   4. Claim — decided atomically by vam095_claim_interview_review:
//        actor already holds one   -> resume it (idempotent)
//        another interviewer holds -> refused, candidate is reserved
//        nobody holds one          -> created for the actor
//   5. Status — advanced by vam084_recompute_application_review_status inside
//      the same transaction as the insert.
//
// The claim decision is NOT made in this file. A read here followed by an
// insert would let two interviewers who press the button at the same instant
// both observe "no review" and both win; the existing unique index is keyed by
// reviewer and does not forbid that. See the migration header for why the
// boundary is an advisory lock in the RPC rather than a stricter index.
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

/** Names the holder, falling back to their email only when no name is set. */
function describeHolder(fullName: unknown, email: unknown): string {
  const name = String(fullName ?? "").trim();
  if (name) return name;
  const mail = String(email ?? "").trim();
  return mail || "một interviewer khác";
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

type ClaimRpcRow = {
  outcome_status?: unknown;
  review_id?: unknown;
  holder_admin_user_id?: unknown;
  holder_full_name?: unknown;
  holder_email?: unknown;
  application_status?: unknown;
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
  if (!INTERVIEW_ELIGIBLE_STATUSES.has(appStatus)) {
    return {
      ok: false,
      message: `Đơn này chưa được mời phỏng vấn (trạng thái hiện tại: ${appStatus || "chưa xác định"}).`
    };
  }

  // --- Atomic claim.
  //
  // Every check above is a fast pre-flight that produces a specific Vietnamese
  // message for the interviewer. None of them is the guard: the RPC re-proves
  // season participation and lifecycle eligibility itself, under the same lock
  // that decides the claim, so a request that slips past this file — or races a
  // status change between the read above and the write — is still refused.
  const { data: claimRows, error: claimError } = await client.rpc(
    "vam095_claim_interview_review",
    { p_application_id: appId, p_actor: actor.id }
  );

  if (claimError) {
    log("claim interview review", claimError);
    return { ok: false, message: SAFE_ERROR };
  }

  const row = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as ClaimRpcRow | null;
  const outcome = String(row?.outcome_status ?? "").trim();
  const reviewId = String(row?.review_id ?? "").trim();

  if (outcome === "already_claimed") {
    // Reserved candidate. No parallel review is created — this is how Core
    // Team keeps a specific candidate for a specific interviewer.
    return {
      ok: false,
      alreadyClaimed: true,
      message: `Ứng viên này đã được phân công cho ${describeHolder(
        row?.holder_full_name,
        row?.holder_email
      )}. Vui lòng liên hệ Core Team nếu cần đổi người phỏng vấn.`
    };
  }

  if (outcome === "existing") {
    return {
      ok: true,
      message: "Bạn đã có interview review cho ứng viên này.",
      reviewId: reviewId || undefined
    };
  }

  if (outcome === "claimed" && reviewId) {
    return {
      ok: true,
      message: "Đã nhận phỏng vấn ứng viên này. Bạn có thể bắt đầu chấm điểm.",
      reviewId
    };
  }

  log("claim interview review returned an unrecognised outcome", { code: outcome });
  return { ok: false, message: SAFE_ERROR };
}
