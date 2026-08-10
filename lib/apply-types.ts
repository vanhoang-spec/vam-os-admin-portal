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
