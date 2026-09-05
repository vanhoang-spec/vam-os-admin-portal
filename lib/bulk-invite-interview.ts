/**
 * Bulk "Mời phỏng vấn" — shared constants and row eligibility.
 *
 * Plain module (no "use server", no "server-only") so the page and its client
 * form read one definition rather than two that happen to agree.
 *
 * NOTHING HERE IS A GATE. `vam084_apply_application_decisions` re-derives
 * eligibility per application under a row lock, including the profile-review
 * minimum and the expected-status check. This module only decides which rows
 * are worth SHOWING an operator, so the list is not full of applications the
 * server would refuse.
 */

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

/**
 * Statuses a profile round actually ends in, and from which the database now
 * accepts a direct interview invite.
 *
 * Mirrors the `invited_to_interview` branch of
 * vam084_application_decision_eligibility. `screening_passed` is included so
 * records left there by the old two-step flow are not stranded.
 *
 * `needs_more_review` is deliberately ABSENT from the bulk list. The database
 * will accept it when its provenance rule is satisfied, but "cần xem thêm" is a
 * judgement someone made about one applicant, and sweeping such rows into a
 * bulk invite would quietly overturn it. Those go one at a time on the
 * application detail page.
 */
export const BULK_INVITE_SOURCE_STATUSES: ReadonlySet<string> = new Set([
  "screening_completed",
  "needs_admin_review",
  "screening_passed"
]);

export type BulkInviteCandidate = {
  status: unknown;
  submittedProfileReviews: number;
};

/** Whether a row is worth offering. Never a substitute for the server gate. */
export function isBulkInviteCandidate(
  input: BulkInviteCandidate,
  requiredProfileReviews: number
): boolean {
  const status = String(input.status ?? "").trim();
  if (!BULK_INVITE_SOURCE_STATUSES.has(status)) return false;
  return input.submittedProfileReviews >= requiredProfileReviews;
}
