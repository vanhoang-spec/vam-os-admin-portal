/**
 * Shared types for the selection-run server actions.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

export type SelectionActionState = {
  ok: boolean;
  message: string | null;
  runId?: string;
};

export const initialSelectionActionState: SelectionActionState = {
  ok: false,
  message: null
};
