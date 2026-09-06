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
 *     Cần xem thêm    → needs_more_review
 *     Không phù hợp   → rejected_or_not_fit
 *
 *   `screening_passed` is no longer offered as a human choice. It remains a
 *   legal application status and a legal source for the invite, so records
 *   already sitting there are unaffected.
 *
 * WHAT ENFORCES WHAT
 *   Nothing in this module is a gate. Every eligibility answer it carries was
 *   produced by `vam084_application_decision_eligibility` — the same function
 *   the write path consults — and is passed in. This module arranges those
 *   answers for the operator; it never derives one.
 *
 *   That is deliberate. All three decisions are review-gated by the database:
 *   `rejected_or_not_fit` and `needs_more_review` sit behind the same
 *   `v_profile_submitted >= v_profile_required` check as the invite. Telling an
 *   operator that "Không phù hợp" needs no reviews would be a lie the server
 *   then refuses.
 */

import type { DirectInviteEvaluation, DirectInviteReason } from "@/lib/direct-interview-eligibility";

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
  { value: "invited_to_interview", label: "Mời phỏng vấn", destructive: false },
  { value: "needs_more_review", label: "Cần xem thêm", destructive: false },
  { value: "rejected_or_not_fit", label: "Không phù hợp", destructive: true }
] as const);

export type ScreeningDecisionValue = (typeof SCREENING_DECISION_CHOICES)[number]["value"];

/** Suffix on a choice the database would refuse right now. */
export const BLOCKED_CHOICE_SUFFIX = " — chưa đủ điều kiện";

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

/** An open review belonging to somebody who is not the current actor. */
export type OtherActiveReview = {
  id: string;
  status: string;
  statusLabel: string;
  reviewerName: string;
};

export type ScreeningDecisionState = {
  /** True while this application is still a profile-round decision. */
  inProfileStage: boolean;
  submittedCount: number;
  /** `null` when the season requirement could not be read. */
  requiredCount: number | null;
  assignmentState: ScreeningAssignmentState;
  /**
   * The CURRENT ACTOR's own open review, if they hold one.
   *
   * Found by searching every profile review for one this actor owns, not by
   * inspecting whichever open review happens to sort first. With two reviewers
   * on an application, taking the first row would hide the actor's own work
   * behind somebody else's.
   */
  myOpenReviewId: string | null;
  /** Every OTHER open review, read-only. Never linked for editing. */
  otherActiveReviews: OtherActiveReview[];
  /** One entry per submitted review, newest first. Never aggregated. */
  evidence: ScreeningEvidence[];
  /**
   * The database's answer for each decision, keyed by status. Produced by
   * `vam084_application_decision_eligibility`, never derived here.
   */
  eligibility: Record<string, DirectInviteEvaluation>;
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

const REVIEW_STATUS_LABEL: Record<string, string> = {
  assigned: "Chưa bắt đầu",
  in_progress: "Đang làm",
  returned_for_clarification: "Cần làm rõ",
  submitted: "Đã nộp",
  cancelled: "Đã huỷ"
};

export function reviewStatusLabel(status: unknown): string {
  const key = String(status ?? "").trim();
  return REVIEW_STATUS_LABEL[key] ?? key;
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

const UNKNOWN: DirectInviteEvaluation = { eligible: false, reason: "eligibility_unknown" };

export function buildScreeningDecisionState(input: {
  applicationStatus: string | null;
  reviews: readonly ScreeningReviewInput[];
  /** `null` when the season requirement could not be read. */
  requiredCount: number | null;
  actorAdminUserId: string | null;
  reviewerNameById?: ReadonlyMap<string, string>;
  /** Server answers per candidate status. A missing entry is treated as unknown. */
  eligibility?: Record<string, DirectInviteEvaluation>;
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

  const activeRows = rows.filter((r) => isActive(r.status));

  // The actor's OWN open review, wherever it sits in the array.
  const mine = input.actorAdminUserId
    ? activeRows.find((r) => r.reviewer_admin_user_id === input.actorAdminUserId) ?? null
    : null;

  const otherActiveReviews: OtherActiveReview[] = activeRows
    .filter((r) => r.id !== mine?.id)
    .map((r) => ({
      id: r.id,
      status: r.status,
      statusLabel: reviewStatusLabel(r.status),
      reviewerName:
        (r.reviewer_admin_user_id ? input.reviewerNameById?.get(r.reviewer_admin_user_id) : null) ??
        "Không xác định"
    }));

  let assignmentState: ScreeningAssignmentState;
  if (submittedCount > 0) {
    assignmentState = "submitted";
  } else if (activeRows.length) {
    assignmentState = activeRows.every((r) => r.status === "assigned") ? "assigned" : "in_progress";
  } else if (rows.some((r) => r.status === "cancelled")) {
    // A cancelled row is not "chưa giao". The operator needs to know a review
    // existed and was withdrawn, or the page reads as if nothing ever happened.
    assignmentState = "cancelled";
  } else {
    assignmentState = "unassigned";
  }

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

  const eligibility: Record<string, DirectInviteEvaluation> = {};
  for (const choice of SCREENING_DECISION_CHOICES) {
    eligibility[choice.value] = input.eligibility?.[choice.value] ?? UNKNOWN;
  }

  return {
    inProfileStage: PROFILE_DECISION_STATUSES.has(status),
    submittedCount,
    requiredCount: input.requiredCount,
    assignmentState,
    myOpenReviewId: mine?.id ?? null,
    otherActiveReviews,
    evidence,
    eligibility
  };
}

/** The database's answer for one choice. Unknown answers are refusals. */
export function screeningChoiceEvaluation(
  value: string,
  state: Pick<ScreeningDecisionState, "eligibility">
): DirectInviteEvaluation {
  return state.eligibility[value] ?? UNKNOWN;
}

export function isScreeningChoiceBlocked(
  value: string,
  state: Pick<ScreeningDecisionState, "eligibility">
): boolean {
  return !screeningChoiceEvaluation(value, state).eligible;
}

/** True when no decision at all is currently available. */
export function allScreeningChoicesBlocked(
  state: Pick<ScreeningDecisionState, "eligibility">
): boolean {
  return SCREENING_DECISION_CHOICES.every((choice) => isScreeningChoiceBlocked(choice.value, state));
}

/**
 * The single reason to lead with when nothing is available.
 * Prefers the invite's reason: it is the decision Core Team came here to make.
 */
export function primaryBlockedReason(
  state: Pick<ScreeningDecisionState, "eligibility">
): DirectInviteReason {
  return screeningChoiceEvaluation("invited_to_interview", state).reason;
}
