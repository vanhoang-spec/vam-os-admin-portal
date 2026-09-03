/** Review states that may still be changed by their assigned reviewer or an operator. */
export const EDITABLE_REVIEW_STATUSES = Object.freeze([
  "assigned",
  "in_progress",
  "returned_for_clarification"
] as const);

const EDITABLE_REVIEW_STATUS_SET = new Set<string>(EDITABLE_REVIEW_STATUSES);

export function isEditableReviewStatus(status: unknown): boolean {
  return EDITABLE_REVIEW_STATUS_SET.has(String(status ?? ""));
}
