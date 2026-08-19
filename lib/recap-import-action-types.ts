/**
 * Shared types for the recap-import server actions.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

export type RecapImportActionState = {
  ok: boolean;
  message: string | null;
};

export const initialRecapImportActionState: RecapImportActionState = {
  ok: false,
  message: null
};
