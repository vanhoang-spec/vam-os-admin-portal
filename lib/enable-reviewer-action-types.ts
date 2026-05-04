/**
 * Shared types for the enable-reviewer server action.
 *
 * Plain (non-"use server") module so client components can import
 * without violating the Next.js "use server" export rule.
 */

export type EnableReviewerActionState = {
  ok: boolean;
  message: string | null;
  /** admin_users.id of the created or updated row, when ok = true. */
  adminUserId?: string;
};

export const initialEnableReviewerActionState: EnableReviewerActionState = {
  ok: false,
  message: null
};
