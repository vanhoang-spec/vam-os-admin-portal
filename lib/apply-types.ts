/**
 * Shared types and initial state for the /apply/* pilot intake forms.
 *
 * Lives in lib/ (not app/actions/) so it can be imported by both
 * "use client" components and "use server" action files without
 * violating Next.js's rule that a "use server" file may only export
 * async functions.
 */

export type ApplyActionState = {
  ok: boolean;
  message: string | null;
  applicationId?: string;
  fieldErrors?: Array<{ name: string; label: string }>;
};

export const initialApplyActionState: ApplyActionState = {
  ok: false,
  message: null
};

/**
 * The hidden form field that relays a pilot token from the page render into
 * the submission Server Action, so both resolve the identical gate.
 *
 * Lives here rather than in lib/apply-gate.ts because the form components are
 * "use client" and apply-gate.ts is `server-only`. The name is prefixed so it
 * cannot collide with a Form Spec field, and the server reads it explicitly —
 * it is never swept into raw_payload or an answer row.
 */
export const APPLY_TOKEN_FIELD = "__apply_token";
