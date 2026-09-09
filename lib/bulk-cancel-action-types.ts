/**
 * State for the bulk "hand an application back" action.
 *
 * Its own module because `app/actions/bulk-cancel.ts` carries `"use server"`,
 * and `__tests__/use-server-export-contract.test.ts` allows only async exports
 * from those files.
 */
export type BulkCancelActionState = {
  ok: boolean;
  message: string | null;
  /** How many assignments were actually returned to the unassigned pool. */
  cancelledCount: number;
  /** Applications that could not be handed back, and why, one line each. */
  failures: string[];
};

export const initialBulkCancelActionState: BulkCancelActionState = {
  ok: false,
  message: null,
  cancelledCount: 0,
  failures: []
};

/**
 * Upper bound on one hand-back.
 *
 * Matched to the lot size the Core Team actually works in — ten applications
 * per page, one page per reviewer — so a mis-click costs at most one lot, and
 * the sequential RPC loop stays inside a request's budget.
 */
export const BULK_CANCEL_MAX = 25;
