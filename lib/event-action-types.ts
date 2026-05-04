/**
 * Shared types and initial state for event server actions.
 * Lives in lib/ (not app/actions/) so client components can import it
 * without crossing the "use server" boundary.
 */

export type EventActionState = {
  ok: boolean;
  message: string | null;
  createdEventId?: string | null;
};

export const initialEventActionState: EventActionState = { ok: false, message: null };

/** Phase 045B: state for bulk-add-participants action. */
export type BulkAddActionState = {
  ok: boolean;
  message: string | null;
  addedCount?: number;
  skippedCount?: number;
};

export const initialBulkAddActionState: BulkAddActionState = { ok: false, message: null };
