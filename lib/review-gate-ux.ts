/**
 * S12 review-gate UX model.
 *
 * The authoritative minimum-review gate lives in the database
 * (`vam084_application_decision_eligibility`). Nothing here relaxes it — this
 * module only mirrors it so the operator UI can explain *why* a lifecycle
 * decision is not available yet, and what the next operational step is.
 *
 * Mirrored DB semantics:
 *   * only `status = 'submitted'` rows count;
 *   * the DB counts DISTINCT reviewer_admin_user_id, so two submitted reviews
 *     by the same reviewer count once;
 *   * `cancelled`, `assigned`, `in_progress` and `returned_for_clarification`
 *     rows never count, no matter how much autosaved content they hold.
 */

export type ReviewGateStage = "profile" | "interview";

export const REVIEW_ROUND_FOR_STAGE: Record<ReviewGateStage, string> = {
  profile: "profile_screening",
  interview: "interview"
};

/** Minimal review shape the gate model needs. Structurally satisfied by ApplicationReview. */
export type ReviewGateReviewInput = {
  id: string;
  review_round: string;
  status: string;
  reviewer_admin_user_id: string | null;
};

/**
 * Assignment state for a stage, as shown to the operator. Deliberately more
 * granular than "có review / không có review": a cancelled row and a never
 * assigned stage are different operational situations.
 */
export type ReviewAssignmentState =
  | "unassigned" // chưa giao
  | "assigned" // đã giao
  | "in_progress" // đang thực hiện
  | "cancelled" // đã hủy
  | "submitted"; // đã nộp

export const ASSIGNMENT_STATE_LABEL: Record<ReviewAssignmentState, string> = {
  unassigned: "Chưa giao",
  assigned: "Đã giao",
  in_progress: "Đang thực hiện",
  cancelled: "Đã hủy",
  submitted: "Đã nộp"
};

/** What the operator can do next about this stage's review coverage. */
export type ReviewGateCta =
  | "none" // minimum already met
  | "assign" // no active review — "Giao review hồ sơ"
  | "open_mine" // current actor owns the active review — "Mở đánh giá của tôi"
  | "await_other"; // someone else owns it — show their name, never edit-as-other

export type ReviewGateActiveReview = {
  id: string;
  status: string;
  reviewerAdminUserId: string | null;
  reviewerName: string | null;
  ownedByActor: boolean;
};

export type ReviewGateState = {
  stage: ReviewGateStage;
  submittedCount: number;
  requiredCount: number;
  /** True when the database minimum for this stage is already satisfied. */
  met: boolean;
  assignmentState: ReviewAssignmentState;
  /** The non-cancelled, non-submitted review for this stage, if any. */
  activeReview: ReviewGateActiveReview | null;
  /** Set only when the active review belongs to the logged-in admin. */
  myOpenReviewId: string | null;
  /** Set only when the active review belongs to somebody else. */
  otherReviewerName: string | null;
  cta: ReviewGateCta;
};

/** A review row that is neither cancelled nor submitted, i.e. still open work. */
function isActive(status: string): boolean {
  return status !== "cancelled" && status !== "submitted";
}

export function buildReviewGateState(input: {
  stage: ReviewGateStage;
  reviews: readonly ReviewGateReviewInput[];
  requiredCount: number;
  actorAdminUserId: string | null;
  reviewerNameById?: ReadonlyMap<string, string>;
}): ReviewGateState {
  const { stage, requiredCount, actorAdminUserId } = input;
  const round = REVIEW_ROUND_FOR_STAGE[stage];
  const stageReviews = input.reviews.filter((r) => r.review_round === round);

  // DISTINCT reviewer, exactly like the RPC's
  // `count(distinct ar.reviewer_admin_user_id) filter (where ... status = 'submitted')`.
  const submittedReviewerIds = new Set<string>();
  for (const r of stageReviews) {
    if (r.status === "submitted" && r.reviewer_admin_user_id) {
      submittedReviewerIds.add(r.reviewer_admin_user_id);
    }
  }
  const submittedCount = submittedReviewerIds.size;
  const met = submittedCount >= requiredCount;

  const activeRow = stageReviews.find((r) => isActive(r.status)) ?? null;
  const activeReview: ReviewGateActiveReview | null = activeRow
    ? {
        id: activeRow.id,
        status: activeRow.status,
        reviewerAdminUserId: activeRow.reviewer_admin_user_id,
        reviewerName:
          (activeRow.reviewer_admin_user_id
            ? input.reviewerNameById?.get(activeRow.reviewer_admin_user_id)
            : null) ?? null,
        ownedByActor:
          !!actorAdminUserId && activeRow.reviewer_admin_user_id === actorAdminUserId
      }
    : null;

  let assignmentState: ReviewAssignmentState;
  if (submittedCount > 0) {
    assignmentState = "submitted";
  } else if (activeRow) {
    assignmentState = activeRow.status === "assigned" ? "assigned" : "in_progress";
  } else if (stageReviews.some((r) => r.status === "cancelled")) {
    // A cancelled row is not "chưa giao" — the operator needs to know a review
    // existed and was withdrawn, otherwise the page reads as if nothing happened.
    assignmentState = "cancelled";
  } else {
    assignmentState = "unassigned";
  }

  let cta: ReviewGateCta;
  if (met) cta = "none";
  else if (!activeReview) cta = "assign";
  else if (activeReview.ownedByActor) cta = "open_mine";
  else cta = "await_other";

  return {
    stage,
    submittedCount,
    requiredCount,
    met,
    assignmentState,
    activeReview,
    myOpenReviewId: cta === "open_mine" ? activeReview!.id : null,
    otherReviewerName: cta === "await_other" ? activeReview!.reviewerName : null,
    cta
  };
}
