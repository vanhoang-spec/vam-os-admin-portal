/**
 * Bulk "Mời phỏng vấn" — shared constants and row eligibility.
 *
 * Plain module (no "use server", no "server-only") so the page and its client
 * form read one definition rather than two that happen to agree.
 *
 * ELIGIBILITY IS NOT DECIDED HERE. It delegates to
 * `evaluateDirectInterviewInvite`, the single canonical mirror of the
 * `invited_to_interview` branch of `vam084_application_decision_eligibility`,
 * which the individual decision panel also answers from. A second hand-written
 * allowlist here was the drift Codex found: it omitted profile-stage
 * `needs_more_review` entirely, so an application the individual command would
 * accept was invisible in bulk.
 *
 * And this is still only about what an operator is SHOWN.
 * `vam084_apply_application_decisions` re-derives eligibility per application
 * under a row lock, with the expected-status check, on every write.
 */

import {
  evaluateDirectInterviewInvite,
  type DirectInviteEvaluation
} from "@/lib/direct-interview-eligibility";

export const BULK_INVITE_TARGET_STATUS = "invited_to_interview";

/**
 * Rows per batch.
 *
 * `bulkApplicationDecisionAction` accepts up to 500 and the RPC locks every
 * requested application in one transaction, so the ceiling here is about the
 * operator, not the database: 100 is a reviewable screenful for a person who
 * has to stand behind each name, and it keeps one wave inside the default
 * serverless budget with room to spare.
 */
export const BULK_INVITE_MAX = 100;

export type BulkInviteCandidate = {
  status: unknown;
  submittedProfileReviewers: number;
  requiredProfileReviews: number | null;
  submittedInterviewReviewers: number;
  latestNeedsMoreReviewAt: string | null;
  latestProfileSubmissionAt: string | null;
};

/**
 * Whether a row is worth offering, by the same rules the server applies.
 *
 * Profile-stage `needs_more_review` IS offered when its provenance is
 * satisfied — a newer submitted profile review and no submitted interview
 * review. That is exactly what the database permits, and withholding it here
 * would leave Core Team unable to clear remediated applications in bulk.
 */
export function evaluateBulkInviteCandidate(input: BulkInviteCandidate): DirectInviteEvaluation {
  return evaluateDirectInterviewInvite({
    applicationStatus: input.status,
    submittedProfileReviewers: input.submittedProfileReviewers,
    requiredProfileReviews: input.requiredProfileReviews,
    submittedInterviewReviewers: input.submittedInterviewReviewers,
    latestNeedsMoreReviewAt: input.latestNeedsMoreReviewAt,
    latestProfileSubmissionAt: input.latestProfileSubmissionAt
  });
}

export function isBulkInviteCandidate(input: BulkInviteCandidate): boolean {
  return evaluateBulkInviteCandidate(input).eligible;
}
