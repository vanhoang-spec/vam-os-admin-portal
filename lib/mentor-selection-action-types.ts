/**
 * Shared types for the mentor self-selection server action.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

export type MentorSelectionActionState = {
  ok: boolean;
  message: string | null;
  /** The mentor is at their confirmed capacity — shown in red, with the fix. */
  capExceeded?: boolean;
  matchId?: string | null;
};

export const initialMentorSelectionActionState: MentorSelectionActionState = {
  ok: false,
  message: null
};
