/**
 * Shared types for the assisted-matching server actions.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

export type AiMatchingActionState = {
  ok: boolean;
  message: string | null;
  runId?: string | null;
};

export const initialAiMatchingActionState: AiMatchingActionState = {
  ok: false,
  message: null
};
