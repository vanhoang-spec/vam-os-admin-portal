/**
 * Shared types for the mentor season-confirmation server actions.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

/** Public form at /confirm/<token>. */
export type PublicConfirmationActionState = {
  ok: boolean;
  message: string | null;
  /** Set when the link itself is no longer usable, so the page can swap views. */
  state?: "not_found" | "expired" | "locked";
};

export const initialPublicConfirmationActionState: PublicConfirmationActionState = {
  ok: false,
  message: null
};

/** Per-row actions on the admin roster (record by phone, extra slots, re-issue link). */
export type MentorConfirmationActionState = {
  ok: boolean;
  message: string | null;
};

export const initialMentorConfirmationActionState: MentorConfirmationActionState = {
  ok: false,
  message: null
};

/** Page-level actions: generate missing links, send the next batch of emails. */
export type MentorConfirmationBatchActionState = {
  ok: boolean;
  message: string | null;
  created?: number;
  sent?: number;
  skipped?: number;
  failed?: number;
};

export const initialMentorConfirmationBatchActionState: MentorConfirmationBatchActionState = {
  ok: false,
  message: null
};
