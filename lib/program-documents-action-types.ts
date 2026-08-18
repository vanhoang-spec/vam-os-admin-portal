/**
 * Shared types for the program-document server actions.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

export type ProgramDocumentActionState = {
  ok: boolean;
  message: string | null;
  documentId?: string | null;
};

export const initialProgramDocumentActionState: ProgramDocumentActionState = {
  ok: false,
  message: null
};
