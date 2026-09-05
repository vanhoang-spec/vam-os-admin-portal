/**
 * The S12 profile-screening decision, as one Core Team action.
 *
 * WHAT CHANGED AND WHY
 *   The pipeline used to ask Core Team for two decisions after a profile review
 *   landed: "Qua vòng hồ sơ", then "Mời phỏng vấn". With roughly two operators
 *   working a full intake, that second click is pure cost — it carries no
 *   judgement the first one did not already make. Core Team now makes ONE
 *   decision at this stage:
 *
 *     Mời phỏng vấn   → invited_to_interview
 *     Không phù hợp   → rejected_or_not_fit
 *     Cần xem thêm    → needs_more_review
 *
 *   `screening_passed` is no longer offered as a human choice. It remains a
 *   legal application status and a legal source for the invite, so records
 *   already sitting there are unaffected.
 *
 * WHAT DID NOT CHANGE
 *   The gate. `vam084_application_decision_eligibility` still refuses
 *   `invited_to_interview` below the season's minimum submitted profile
 *   reviews. Everything in this module mirrors that gate so the operator can
 *   see it; nothing here enforces it. The database is the arbiter.
 *
 *   Mirrored precisely: only `status = 'submitted'` rows count, and the count is
 *   of DISTINCT reviewers, exactly as the RPC's
 *   `count(distinct ar.reviewer_admin_user_id) filter (where ... 'submitted')`.
 */

export const PROFILE_REVIEW_ROUND = "profile_screening";

/**
 * Statuses where an application is still in the profile round and Core Team's
 * next action is the screening decision.
 *
 * `screening_passed` is included so an application left there by the old
 * two-step flow still offers the invite, and `needs_more_review` is included
 * because a profile-stage remediation returns here. Interview-round statuses
 * are deliberately absent: once an application is invited or later, this
 * surface has nothing more to say about it.
 */
export const PROFILE_DECISION_STATUSES: ReadonlySet<string> = new Set([
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned",
  "screening_in_progress",
  "screening_completed",
  "needs_admin_review",
  "needs_more_review",
  "screening_passed"
]);

/** The three choices Core Team is offered at this stage, in operator order. */
export const SCREENING_DECISION_CHOICES = Object.freeze([
  {
    value: "invited_to_interview",
    label: "Mời phỏng vấn",
    /** Requires the profile-review minimum. The others do not. */
    requiresProfileReview: true,
    destructive: false
  },
  {
    value: "needs_more_review",
    label: "Cần xem thêm",
    requiresProfileReview: false,
    destructive: false
  },
  {
    value: "rejected_or_not_fit",
    label: "Không phù hợp",
    requiresProfileReview: false,
    destructive: true
  }
] as const);

export type ScreeningDecisionValue = (typeof SCREENING_DECISION_CHOICES)[number]["value"];

/** Suffix on a choice the database would refuse right now. */
export const BLOCKED_CHOICE_SUFFIX = " — chưa đủ đánh giá";

export type ScreeningReviewInput = {
  id: string;
  review_round: string;
  status: string;
  reviewer_admin_user_id: string | null;
  total_score: number | null;
  score_motivation?: number | null;
  score_goal_clarity?: number | null;
  score_commitment?: number | null;
  score_fit?: number | null;
  score_communication?: number | null;
  recommendation: string | null;
  reviewer_note: string | null;
  submitted_at: string | null;
};

/** How the profile round is staffed right now, in words an operator uses. */
export type ScreeningAssignmentState =
  | "unassigned"
  | "assigned"
  | "in_progress"
  | "cancelled"
  | "submitted";

export const ASSIGNMENT_STATE_LABEL: Record<ScreeningAssignmentState, string> = {
  unassigned: "Chưa giao",
  assigned: "Đã giao",
  in_progress: "Đang thực hiện",
  cancelled: "Đã hủy",
  submitted: "Đã nộp"
};

/** What the operator can usefully do next about review coverage. */
export type ScreeningCta = "none" | "assign" | "open_mine" | "await_other";

/** One submitted review, shown as evidence. Never averaged across reviewers. */
export type ScreeningEvidence = {
  reviewId: string;
  reviewerName: string;
  totalScore: number | null;
  components: Array<{ label: string; value: number | null }>;
  recommendation: string | null;
  recommendationLabel: string;
  reviewerNote: string | null;
  submittedAt: string | null;
};

export type ScreeningDecisionState = {
  /** True while this application is still a profile-round decision. */
  inProfileStage: boolean;
  submittedCount: number;
  requiredCount: number;
  /** True when the database would accept "Mời phỏng vấn" on review grounds. */
  met: boolean;
  assignmentState: ScreeningAssignmentState;
  activeReview: {
    id: string;
    status: string;
    reviewerName: string | null;
    ownedByActor: boolean;
  } | null;
  myOpenReviewId: string | null;
  otherReviewerName: string | null;
  cta: ScreeningCta;
  /** One entry per submitted review, newest first. Never aggregated. */
  evidence: ScreeningEvidence[];
};

const RECOMMENDATION_LABEL: Record<string, string> = {
  pass_to_interview: "Nên mời phỏng vấn",
  approve_recommended: "Nên nhận",
  waitlist: "Danh sách chờ",
  reject: "Không phù hợp",
  needs_admin_review: "Cần Core Team xem thêm"
};

export function recommendationLabel(value: unknown): string {
  const key = String(value ?? "").trim();
  if (!key) return "Chưa nêu";
  return RECOMMENDATION_LABEL[key] ?? key;
}

const COMPONENT_FIELDS: Array<{ key: keyof ScreeningReviewInput; label: string }> = [
  { key: "score_motivation", label: "Động lực" },
  { key: "score_goal_clarity", label: "Mục tiêu" },
  { key: "score_commitment", label: "Cam kết" },
  { key: "score_fit", label: "Phù hợp" },
  { key: "score_communication", label: "Giao tiếp" }
];

function isActive(status: string): boolean {
  return status !== "cancelled" && status !== "submitted";
}

export function buildScreeningDecisionState(input: {
  applicationStatus: string | null;
  reviews: readonly ScreeningReviewInput[];
  requiredCount: number;
  actorAdminUserId: string | null;
  reviewerNameById?: ReadonlyMap<string, string>;
}): ScreeningDecisionState {
  const status = String(input.applicationStatus ?? "").trim();
  const rows = input.reviews.filter((r) => r.review_round === PROFILE_REVIEW_ROUND);

  const submittedReviewerIds = new Set<string>();
  for (const r of rows) {
    if (r.status === "submitted" && r.reviewer_admin_user_id) {
      submittedReviewerIds.add(r.reviewer_admin_user_id);
    }
  }
  const submittedCount = submittedReviewerIds.size;
  const met = submittedCount >= input.requiredCount;

  const activeRow = rows.find((r) => isActive(r.status)) ?? null;
  const activeReview = activeRow
    ? {
        id: activeRow.id,
        status: activeRow.status,
        reviewerName:
          (activeRow.reviewer_admin_user_id
            ? input.reviewerNameById?.get(activeRow.reviewer_admin_user_id)
            : null) ?? null,
        ownedByActor:
          !!input.actorAdminUserId &&
          activeRow.reviewer_admin_user_id === input.actorAdminUserId
      }
    : null;

  let assignmentState: ScreeningAssignmentState;
  if (submittedCount > 0) assignmentState = "submitted";
  else if (activeRow) assignmentState = activeRow.status === "assigned" ? "assigned" : "in_progress";
  // A cancelled row is not "chưa giao". The operator needs to know a review
  // existed and was withdrawn, or the page reads as if nothing ever happened.
  else if (rows.some((r) => r.status === "cancelled")) assignmentState = "cancelled";
  else assignmentState = "unassigned";

  let cta: ScreeningCta;
  if (met) cta = "none";
  else if (!activeReview) cta = "assign";
  else if (activeReview.ownedByActor) cta = "open_mine";
  else cta = "await_other";

  const evidence: ScreeningEvidence[] = rows
    .filter((r) => r.status === "submitted")
    .map((r) => ({
      reviewId: r.id,
      reviewerName:
        (r.reviewer_admin_user_id ? input.reviewerNameById?.get(r.reviewer_admin_user_id) : null) ??
        "Không xác định",
      totalScore: r.total_score ?? null,
      components: COMPONENT_FIELDS.map(({ key, label }) => ({
        label,
        value: (r[key] as number | null | undefined) ?? null
      })),
      recommendation: r.recommendation ?? null,
      recommendationLabel: recommendationLabel(r.recommendation),
      reviewerNote: r.reviewer_note ?? null,
      submittedAt: r.submitted_at ?? null
    }))
    .sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? "")));

  return {
    inProfileStage: PROFILE_DECISION_STATUSES.has(status),
    submittedCount,
    requiredCount: input.requiredCount,
    met,
    assignmentState,
    activeReview,
    myOpenReviewId: cta === "open_mine" ? activeReview!.id : null,
    otherReviewerName: cta === "await_other" ? activeReview!.reviewerName : null,
    cta,
    evidence
  };
}

/**
 * Whether a choice would be refused by the database right now.
 *
 * Only the invite is review-gated at this stage: `rejected_or_not_fit` and
 * `needs_more_review` are already reachable from screening_completed /
 * needs_admin_review / screening_passed under their own branch of the
 * eligibility function, and this must not add a restriction the database does
 * not have.
 */
export function isScreeningChoiceBlocked(
  value: string,
  state: Pick<ScreeningDecisionState, "met">
): boolean {
  const choice = SCREENING_DECISION_CHOICES.find((c) => c.value === value);
  if (!choice) return false;
  return choice.requiresProfileReview && !state.met;
}
