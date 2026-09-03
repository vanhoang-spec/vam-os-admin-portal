/**
 * Shared types and initial state for the M092 bulk official approval
 * server action. Plain (non-"use server") module so client components can
 * import these without violating the Next.js "use server" file export rule.
 */

export type BulkApprovalOutcome = "approved" | "skipped" | "manual_required" | "failed";

export type BulkApprovalRowResult = {
  applicationId: string;
  targetRole: "mentor" | "mentee" | null;
  outcome: BulkApprovalOutcome;
  reasonCode: string;
  reasonMessage: string;
  personId: string | null;
  personCreated: boolean | null;
  profileId: string | null;
  profileCreated: boolean | null;
};

export type BulkApprovalActionState = {
  ok: boolean;
  message: string | null;
  rows?: BulkApprovalRowResult[];
};

export const initialBulkApprovalActionState: BulkApprovalActionState = {
  ok: false,
  message: null
};

/** Maximum applications that may be submitted in a single bulk-approval batch. */
export const MAX_BULK_APPROVAL_IDS = 100;
