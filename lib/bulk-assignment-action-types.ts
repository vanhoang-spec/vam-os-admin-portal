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

// Compatibility re-export. The lifecycle rule itself lives in one domain
// module shared by individual assignment, bulk assignment and queue reads.
export {
  INTERVIEW_ELIGIBLE_STATUSES,
  PROFILE_ASSIGNMENT_STATUSES
} from "@/lib/application-review-assignability";
