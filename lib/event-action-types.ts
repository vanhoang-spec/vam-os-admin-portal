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
