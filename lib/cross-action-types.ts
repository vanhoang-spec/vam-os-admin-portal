/**
 * Shared types for the cross-mentoring server actions.
 *
 * A plain module, deliberately: client components import these, and a `"use
 * server"` file may export nothing but async functions.
 */

export type CrossActionState = {
  ok: boolean;
  message: string | null;
};

export const initialCrossActionState: CrossActionState = {
  ok: false,
  message: null
};

/** The sweep says more than yes/no — the screen shows who was left out and why. */
export type CrossSweepActionState = CrossActionState & {
  invited?: number;
  rested?: number;
  alreadyInvited?: number;
  noEmail?: number;
  failed?: number;
};

export const initialCrossSweepActionState: CrossSweepActionState = {
  ok: false,
  message: null
};
