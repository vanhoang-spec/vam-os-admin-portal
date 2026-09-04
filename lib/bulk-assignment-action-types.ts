/**
 * Shared types and initial state for the bulk-assignment server action.
 *
 * Plain (non-"use server") module so client components can import the type
 * and initial-state constant without violating the Next.js rule that
 * "use server" files may only export async functions.
 */

export type BulkAssignmentActionState = {
  ok: boolean;
  message: string | null;
  applicationsAssigned?: number;
  reviewersCount?: number;
  reviewerId?: string;
  minPerReviewer?: number;
  maxPerReviewer?: number;
  skippedAlreadyAssigned?: number;
  batchId?: string;
};

export const initialBulkAssignmentActionState: BulkAssignmentActionState = {
  ok: false,
  message: null
};

export const INTERVIEW_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress",
  "needs_more_review"
]);

export const PROFILE_ASSIGNMENT_STATUSES: ReadonlySet<string> = new Set([
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned",
  "needs_more_review"
]);
