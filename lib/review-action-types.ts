/**
 * Shared types and initial state for application-review server actions.
 *
 * Kept in a plain (non-"use server") module so client components can import
 * the type and initial state constant without violating the Next.js rule that
 * "use server" files may only export async functions.
 */

export type ReviewActionState = {
  ok: boolean;
  message: string | null;
  reviewId?: string;
};

export const initialReviewActionState: ReviewActionState = {
  ok: false,
  message: null
};
