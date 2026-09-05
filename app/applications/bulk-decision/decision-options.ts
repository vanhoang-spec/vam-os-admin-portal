/**
 * Scope of the post-interview bulk final decision screen.
 *
 * This screen is NOT a general "set any status on any application" tool. It
 * exists for one operator moment: applications whose required interview
 * reviews are in, waiting for the Core Team's final ruling. Everything here
 * is a UI narrowing only — `lib/decision-action-types.ts`,
 * `lib/application-decisions.ts` and the RPC keep their full global domain so
 * the individual decision form and other surfaces are unaffected.
 *
 * Plain module (no "use client", no "server-only") so both the server page and
 * the client form can import it.
 */

/**
 * The single lifecycle state this screen sources candidates from. An
 * application only reaches it once the interview-review minimum is met, which
 * is exactly the population a bulk final ruling applies to.
 */
export const BULK_FINAL_DECISION_SOURCE_STATUS = "ready_for_final_decision";

/**
 * Every status the screen's filter may select. Bounded on purpose: a
 * hand-typed or bookmarked `?status=` outside this set falls back to the
 * canonical source status rather than widening the list to all applications.
 */
export const BULK_FINAL_DECISION_SOURCE_STATUSES = Object.freeze([
  BULK_FINAL_DECISION_SOURCE_STATUS
] as const);

/**
 * The four rulings a Core Team member can make at this point in the pipeline.
 *
 * `screening_passed`, `invited_to_interview` and `interview_scheduled` are
 * deliberately absent — they are earlier-stage transitions, and interview
 * scheduling remains deferred. They stay in the global allowlists because
 * other surfaces (the individual decision form, S12 screening) still use them.
 */
export const BULK_FINAL_DECISION_STATUSES = Object.freeze([
  "interview_passed",
  "waitlisted",
  "rejected_or_not_fit",
  "needs_more_review"
] as const);

export type BulkFinalDecisionStatus = (typeof BULK_FINAL_DECISION_STATUSES)[number];

/** Resolves a `?status=` search param to a status this screen actually allows. */
export function resolveSourceStatus(raw: string | undefined | null): string {
  const value = (raw ?? "").trim();
  return (BULK_FINAL_DECISION_SOURCE_STATUSES as readonly string[]).includes(value)
    ? value
    : BULK_FINAL_DECISION_SOURCE_STATUS;
}
