/**
 * Shared types for match server actions.
 * Lives in lib/ so client components can import without crossing
 * the "use server" boundary.
 * Phase 046A: manual matching foundation.
 */

export type MatchActionState = {
  ok: boolean;
  message: string | null;
  matchId?: string | null;
};

export const initialMatchActionState: MatchActionState = { ok: false, message: null };
