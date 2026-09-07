/**
 * Canonical application lifecycle rule for creating review assignments.
 *
 * `needs_more_review` is routed by durable interview-review provenance:
 * before any interview row exists it belongs to profile screening; after an
 * interview row exists it belongs to interview. Cancelled interview rows still
 * count because cancellation must not erase which stage the application had
 * reached.
 */

export type ApplicationReviewRound = "profile_screening" | "interview";

const PROFILE_BASE_STATUS_VALUES = [
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned"
] as const;
const PROFILE_BASE_STATUSES = new Set<string>(PROFILE_BASE_STATUS_VALUES);

const INTERVIEW_BASE_STATUS_VALUES = [
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress"
] as const;
const INTERVIEW_BASE_STATUSES = new Set<string>(INTERVIEW_BASE_STATUS_VALUES);

/** Coarse positive allowlists used only for request/UI filtering. */
export const PROFILE_ASSIGNMENT_STATUSES: ReadonlySet<string> = new Set([
  ...PROFILE_BASE_STATUS_VALUES,
  "needs_more_review"
]);

export const INTERVIEW_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  ...INTERVIEW_BASE_STATUS_VALUES,
  "needs_more_review"
]);

export const WITHDRAWN_APPLICATION_REVIEW_MESSAGE =
  "Hồ sơ đã rút khỏi quy trình tuyển và không thể được phân công đánh giá.";

export const RECRUITMENT_OPERATIONAL_STATUSES = new Set<string>([
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned",
  "screening_in_progress",
  "screening_completed",
  "screening_passed",
  "invited_to_meeting",
  "invited_to_orientation",
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress",
  "interview_completed",
  "ready_for_final_decision",
  "interview_passed",
  "waitlisted",
  "needs_more_review",
  "needs_admin_review"
]);

/** Positive lifecycle rule for existing recruitment work remaining actionable. */
export function isApplicationRecruitmentOperational(status: unknown): boolean {
  return RECRUITMENT_OPERATIONAL_STATUSES.has(String(status ?? "").trim());
}

export function isApplicationReviewAssignable(input: {
  status: unknown;
  reviewRound: ApplicationReviewRound;
  hasAnyInterviewReview: boolean;
}): boolean {
  const status = String(input.status ?? "").trim();
  if (input.reviewRound === "profile_screening") {
    return PROFILE_BASE_STATUSES.has(status) ||
      (status === "needs_more_review" && !input.hasAnyInterviewReview);
  }
  return INTERVIEW_BASE_STATUSES.has(status) ||
    (status === "needs_more_review" && input.hasAnyInterviewReview);
}
