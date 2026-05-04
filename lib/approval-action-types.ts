/**
 * Shared types and initial state for application-approval server actions.
 *
 * Plain (non-"use server") module so client components can import the type
 * and initial-state constant without violating the Next.js rule that
 * "use server" files may only export async functions.
 */

export type ApprovalActionState = {
  ok: boolean;
  message: string | null;
  personId?: string;
  profileId?: string;
  personCreated?: boolean;
  profileCreated?: boolean;
};

export const initialApprovalActionState: ApprovalActionState = {
  ok: false,
  message: null
};
