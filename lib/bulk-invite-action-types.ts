/**
 * Shape of the bulk invite result.
 *
 * Plain module so the client form and the "use server" action share one
 * definition — a "use server" file may export only async functions.
 */

export type BulkInviteRowResult = {
  applicationId: string;
  applicantName: string;
  applied: boolean;
  /** Operator-facing outcome, per applicant. Never a bare count. */
  message: string;
};

export type BulkInviteState = {
  ok: boolean;
  message: string;
  appliedCount: number;
  blockedCount: number;
  /** One entry per submitted application. Nothing is silently skipped. */
  rows: BulkInviteRowResult[];
};

export const initialBulkInviteState: BulkInviteState = {
  ok: false,
  message: "",
  appliedCount: 0,
  blockedCount: 0,
  rows: []
};
