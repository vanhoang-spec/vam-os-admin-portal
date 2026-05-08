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

export type RegistrationActionStatus =
  | "idle"
  | "success"
  | "already_registered"
  | "validation_error"
  | "link_error"
  | "server_error";

export type PublicRegistrationActionState = {
  ok: boolean;
  status: RegistrationActionStatus;
  message: string | null;
  eventName?: string | null;
  values?: {
    full_name?: string;
    email?: string;
    phone?: string;
    student_id?: string;
    school?: string;
    program_of_study?: string;
    role_text?: string;
    notes?: string;
  };
};

export const initialPublicRegistrationActionState: PublicRegistrationActionState = {
  ok: false,
  status: "idle",
  message: null,
  values: {}
};
