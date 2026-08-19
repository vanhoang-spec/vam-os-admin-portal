/**
 * Shared types for the participant-administration server actions.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

export type ParticipantActionState = {
  ok: boolean;
  message: string | null;
};

export const initialParticipantActionState: ParticipantActionState = {
  ok: false,
  message: null
};

/** One batch of invitations, kept below the provider's daily ceiling. */
export const MAX_INVITES_PER_BATCH = 100;
