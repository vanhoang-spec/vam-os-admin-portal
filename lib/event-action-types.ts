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
  // ── existing ──────────────────────────────────────────────────────────────
  | "idle"
  | "success"
  | "already_registered"
  | "validation_error"
  | "link_error"
  | "server_error"
  // ── Phase 2: approval / capacity outcomes ─────────────────────────────────
  /** Registration accepted but requires admin review (approval_required = true). */
  | "pending_review"
  /** Capacity full; registration placed on waitlist (waitlist_enabled = true). */
  | "waitlisted"
  /** Capacity full and waitlist disabled; registration rejected. */
  | "capacity_full";

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
    mentee_code?: string;
    proof_url?: string;
    proof_note?: string;
    speaker_question?: string;
    payment_proof_url?: string;
    payment_proof_note?: string;
    meal_selected?: string;
  };
};

export const initialPublicRegistrationActionState: PublicRegistrationActionState = {
  ok: false,
  status: "idle",
  message: null,
  values: {}
};

export type CheckinActionStatus =
  // ── existing ──────────────────────────────────────────────────────────────
  | "idle"
  | "success"
  | "already_checked_in"
  | "validation_error"
  | "link_error"
  | "server_error"
  // ── Phase 2: registration-state errors ────────────────────────────────────
  /** Email not found in registrations for this event. */
  | "not_registered"
  /** Registration exists but is pending admin approval. */
  | "pending_approval"
  /** Registration was rejected by admin. */
  | "registration_rejected"
  /** Registration is on the waitlist. */
  | "registration_waitlisted"
  /** Registration was cancelled. */
  | "registration_cancelled_status"
  /** Generic: registration not in a confirmed state (confirmed_only mode). */
  | "not_confirmed"
  // ── Phase 2: time-window & mode errors ────────────────────────────────────
  /** Check-in window has not opened yet (checkin_opens_at in the future). */
  | "checkin_not_open"
  /** Check-in window has closed (now > checkin_closes_at). */
  | "checkin_closed"
  /** Capacity reached; walk-in blocked. */
  | "event_full"
  /** allow_walk_in = false; walk-in blocked. */
  | "walk_in_blocked"
  /** checkin_mode = 'manual_admin_only'; public self check-in disabled. */
  | "self_checkin_disabled";

export type PublicCheckinActionState = {
  ok: boolean;
  status: CheckinActionStatus;
  message: string | null;
  eventName?: string | null;
  values?: {
    email?: string;
    full_name?: string;
    phone?: string;
    student_id?: string;
    notes?: string;
  };
};

export const initialPublicCheckinActionState: PublicCheckinActionState = {
  ok: false,
  status: "idle",
  message: null,
  values: {}
};
