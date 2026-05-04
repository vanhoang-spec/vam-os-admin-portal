/**
 * Shared state type for the interview self-claim server action.
 *
 * Plain (non-"use server") module so client components can import the type
 * and initial-state constant without violating Next.js "use server" rules.
 */

export type ClaimInterviewActionState = {
  ok: boolean;
  message: string | null;
  /** ID of the created (or pre-existing) interview review row, when ok = true. */
  reviewId?: string;
  /** true when another reviewer already holds an active claim on this candidate. */
  alreadyClaimed?: boolean;
};

export const initialClaimInterviewActionState: ClaimInterviewActionState = {
  ok: false,
  message: null
};
