/**
 * Shared types and initial state for application-decision server actions.
 *
 * Plain (non-"use server") module so client components can import the type
 * and initial-state constant without violating the Next.js rule that "use
 * server" files may only export async functions.
 */

export type DecisionActionState = {
  ok: boolean;
  message: string | null;
};

export const initialDecisionActionState: DecisionActionState = {
  ok: false,
  message: null
};
