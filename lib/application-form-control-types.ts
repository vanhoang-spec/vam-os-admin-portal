import type { ApplicantRole, ApplicationFormState } from "@/lib/application-form-controls";

/**
 * Shared state for the M069 form-control Server Action.
 *
 * Lives here rather than in app/actions/application-form-controls.ts because
 * a "use server" file may only export async functions — exporting the initial
 * state object from there makes Next.js reject the module at build time.
 * Same reason lib/apply-types.ts exists.
 */
export type FormControlActionState = {
  ok: boolean;
  message: string | null;
  role?: ApplicantRole;
  newState?: ApplicationFormState;
  outcome?: "changed" | "noop";
};

export const initialFormControlActionState: FormControlActionState = {
  ok: false,
  message: null
};
