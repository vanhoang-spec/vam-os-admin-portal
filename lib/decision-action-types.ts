/**
 * Shared types and initial state for application-decision server actions.
 *
 * Plain (non-"use server") module so client components can import the type
 * and initial-state constant without violating the Next.js rule that "use
 * server" files may only export async functions.
 */

export type DecisionActionState = {
  ok: boolean;
  message: string | null;
};

export const initialDecisionActionState: DecisionActionState = {
  ok: false,
  message: null
};

/**
 * Application decision statuses that are terminal or hard to reverse for the applicant.
 * The decision form shows a confirmation dialog before submitting these.
 */
export const DESTRUCTIVE_DECISION_STATUSES = new Set([
  "rejected_or_not_fit",
  "withdrawn"
]);

export const ALLOWED_DECISION_STATUSES = Object.freeze([
  "under_data_check",
  "screening_passed",
  "invited_to_interview",
  "interview_scheduled",
  "interview_passed",
  "waitlisted",
  "rejected_or_not_fit",
  "needs_more_review",
  "withdrawn"
] as const);

export type AllowedDecisionStatus = (typeof ALLOWED_DECISION_STATUSES)[number];

/**
 * Statuses that are still LEGAL in the database and still present in history,
 * but are no longer a decision any operator makes going forward.
 *
 * `screening_passed` was the first half of a two-click profile decision. S12
 * closes that round in one action — Mời phỏng vấn / Cần xem thêm / Không phù
 * hợp — so nothing needs to CREATE this status any more. It stayed reachable
 * through the generic bulk-decision route by URL even after every button was
 * removed, which is a mutation backdoor rather than a feature.
 *
 * DELIBERATELY NOT REMOVED FROM `ALLOWED_DECISION_STATUSES`: applications
 * already holding this status must keep moving forward, exports must keep
 * filtering on it, and the audit trail must keep rendering it. This set governs
 * one thing only — what a NEW decision may target.
 *
 * Enforced at every generic decision boundary, not only where a control exists,
 * so a crafted request fails closed. The interview invite is taken at
 * /applications/bulk-invite-interview.
 */
export const RETIRED_FORWARD_DECISION_STATUSES: ReadonlySet<string> = new Set([
  "screening_passed"
]);

export const RETIRED_FORWARD_DECISION_MESSAGE =
  'Quyết định "Qua vòng hồ sơ" đã ngừng sử dụng. Dùng "Mời phỏng vấn" (đơn lẻ hoặc hàng loạt) để chuyển hồ sơ sang vòng phỏng vấn.';
