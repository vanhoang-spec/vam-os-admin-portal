/**
 * THE canonical mirror of the direct interview-invite gate.
 *
 * There is exactly one copy of these rules in TypeScript, and this is it. The
 * individual decision panel, the bulk invite list and the tests all read from
 * here, so the two surfaces cannot drift apart from each other — which is
 * precisely what a second hand-written allowlist would have allowed.
 *
 * WHAT IT MIRRORS
 *   The `invited_to_interview` branch of
 *   `vam084_application_decision_eligibility`, as rewritten by
 *   supabase/migrations/20260906090000_s12_direct_interview_invite.sql:
 *
 *     if    v_profile_submitted < v_profile_required
 *           -> profile_review_minimum_not_met
 *     elsif status = 'needs_more_review'
 *           and (v_interview_submitted > 0
 *                or no profile review submitted after the latest
 *                   needs_more_review decision)
 *           -> additional_review_not_submitted
 *     elsif status not in (screening_passed, screening_completed,
 *                          needs_admin_review, needs_more_review)
 *           -> invalid_transition
 *     else  -> eligible
 *
 * IT IS NOT THE GATE. The database re-derives all of this under a row lock on
 * every write. This module decides what an operator is SHOWN. Where the answer
 * has to be authoritative — the individual decision panel — the caller asks the
 * database itself through `getDirectInterviewInviteEligibility` and uses this
 * only as the shape of the answer.
 *
 * `__tests__/s12-direct-invite-remediation.test.ts` asserts every rule below
 * against the migration text, so a change to one without the other fails.
 */

/**
 * Statuses from which the invite is legal on status grounds alone.
 * `needs_more_review` is legal too, but only with provenance, so it is not here.
 */
export const DIRECT_INVITE_BASE_SOURCE_STATUSES: ReadonlySet<string> = new Set([
  "screening_completed",
  "needs_admin_review",
  // Retained so records left here by the old two-step flow are not stranded.
  "screening_passed"
]);

/** Every status the database will consider, provenance permitting. */
export const DIRECT_INVITE_SOURCE_STATUSES: ReadonlySet<string> = new Set([
  "screening_completed",
  "needs_admin_review",
  "screening_passed",
  "needs_more_review"
]);

export type DirectInviteReason =
  | "eligible"
  | "profile_review_minimum_not_met"
  | "additional_review_not_submitted"
  | "invalid_transition"
  /** The requirement or provenance could not be read. Never rendered as usable. */
  | "eligibility_unknown";

export const DIRECT_INVITE_REASON_MESSAGE: Record<DirectInviteReason, string> = {
  eligible: "Đủ điều kiện mời phỏng vấn.",
  profile_review_minimum_not_met: "Chưa đủ số đánh giá hồ sơ đã nộp.",
  additional_review_not_submitted:
    "Đã yêu cầu xem thêm nhưng chưa có đánh giá hồ sơ mới được nộp sau đó.",
  invalid_transition: "Trạng thái hiện tại không cho phép mời phỏng vấn.",
  eligibility_unknown:
    "Không đọc được yêu cầu số lượng review. Vui lòng thử lại hoặc liên hệ admin."
};

export type DirectInviteEvaluation = {
  eligible: boolean;
  reason: DirectInviteReason;
};

export type DirectInviteInput = {
  applicationStatus: unknown;
  /**
   * DISTINCT reviewers holding a SUBMITTED profile_screening review, mirroring
   * `count(distinct ar.reviewer_admin_user_id) filter (... status='submitted')`.
   */
  submittedProfileReviewers: number;
  /**
   * The season's configured minimum. `null` means it could not be read — the
   * evaluation then returns `eligibility_unknown` rather than assuming 1.
   */
  requiredProfileReviews: number | null;
  /** DISTINCT reviewers holding a SUBMITTED interview review. */
  submittedInterviewReviewers: number;
  /** created_at of the newest decision whose new_status is needs_more_review. */
  latestNeedsMoreReviewAt: string | null;
  /** submitted_at of the newest SUBMITTED profile_screening review. */
  latestProfileSubmissionAt: string | null;
};

function isAfter(candidate: string | null, boundary: string | null): boolean {
  if (!candidate || !boundary) return false;
  const left = Date.parse(candidate);
  const right = Date.parse(boundary);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return left > right;
}

export function evaluateDirectInterviewInvite(input: DirectInviteInput): DirectInviteEvaluation {
  const status = String(input.applicationStatus ?? "").trim();

  // Fail closed on an unreadable requirement rather than assuming a minimum.
  if (input.requiredProfileReviews === null || !Number.isFinite(input.requiredProfileReviews)) {
    return { eligible: false, reason: "eligibility_unknown" };
  }

  // Order matters: it is the order of the CASE arms in the RPC, so the reason
  // an operator sees is the reason the database would give.
  if (input.submittedProfileReviewers < input.requiredProfileReviews) {
    return { eligible: false, reason: "profile_review_minimum_not_met" };
  }

  if (status === "needs_more_review") {
    // An interview-stage needs_more_review is not a profile-stage decision, and
    // must not be routed back through screening.
    if (input.submittedInterviewReviewers > 0) {
      return { eligible: false, reason: "additional_review_not_submitted" };
    }
    // The review that prompted "cần xem thêm" cannot also satisfy it.
    if (!isAfter(input.latestProfileSubmissionAt, input.latestNeedsMoreReviewAt)) {
      return { eligible: false, reason: "additional_review_not_submitted" };
    }
    return { eligible: true, reason: "eligible" };
  }

  if (!DIRECT_INVITE_BASE_SOURCE_STATUSES.has(status)) {
    return { eligible: false, reason: "invalid_transition" };
  }

  return { eligible: true, reason: "eligible" };
}
