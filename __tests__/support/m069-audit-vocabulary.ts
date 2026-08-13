/**
 * M069 — the ONE canonical representation of the audit action_type vocabulary.
 *
 * `PRE_M069_AUDIT_ACTION_TYPES` is the exact 52-value list installed by the S12
 * release T1 (`VAM_OS_PROD_S12_RELEASE_20260809/apply/T1_audit_action_type_compat.sql`,
 * Section 2). That constraint is CLOSED and VALIDATED, so these 52 values are
 * the complete set of action types Production admits today.
 *
 * Every SQL copy of the list — preflight.sql, apply.sql Section 0, apply.sql
 * Section 4, supabase_migrations/069 Section 4, verifier.sql, rollback.sql —
 * is proven set-equal to this array by
 * `__tests__/migration-069-application-intake-control.test.ts`. That is the
 * anti-drift mechanism: there is no way to edit one copy without the test
 * failing, so preflight, apply and the verifier cannot come to disagree about
 * what "the pre-M069 vocabulary" means.
 *
 * Not exported to runtime code. Nothing in `app/` or `lib/` reads this; it
 * exists so the migration package and its tests share one definition.
 */

export const PRE_M069_AUDIT_ACTION_TYPES: readonly string[] = [
  "accept_registration_proof",
  "add_event_participation",
  "add_manual_recap",
  "add_membership_role",
  "approve_application_as_mentee",
  "approve_application_as_mentor",
  "bulk_add_event_participants",
  "cancel_event",
  "cancel_event_registration",
  "cancel_match",
  "cancel_membership",
  "close_event_registration",
  "confirm_event_registration",
  "confirm_registration_payment",
  "create_action_item",
  "create_admin_user",
  "create_event",
  "create_event_checkin_link",
  "create_event_registration_link",
  "create_manual_match",
  "create_membership",
  "create_mentee_profile",
  "create_mentor_profile",
  "deactivate_admin_user",
  "edit_recap",
  "import_participant_membership",
  "link_person_auth",
  "open_event_registration",
  "opt_out_membership",
  "pause_membership",
  "reactivate_admin_user",
  "reactivate_membership",
  "reconcile_person_auth",
  "reject_event_registration",
  "reject_registration_payment",
  "reject_registration_proof",
  "remove_admin_access",
  "remove_event_participation",
  "remove_membership_role",
  "soft_delete_recap",
  "sync_auth",
  "unknown",
  "update_action_item",
  "update_admin_user",
  "update_admin_user_access",
  "update_event",
  "update_event_participation",
  "update_mentee_profile",
  "update_mentor_profile",
  "update_registration_review_note",
  "waitlist_event_registration",
  "withdraw_membership"
];

/** The single value M069 adds. Nothing else may change. */
export const M069_AUDIT_ACTION_TYPE = "set_application_form_state";

/** The exact vocabulary that must exist after apply.sql commits. */
export const POST_M069_AUDIT_ACTION_TYPES: readonly string[] = [
  ...PRE_M069_AUDIT_ACTION_TYPES,
  M069_AUDIT_ACTION_TYPE
].sort();

/**
 * The set comparison preflight, apply Section 0/4 and verifier V17 all perform
 * in SQL: `expected EXCEPT actual` and `actual EXCEPT expected`, both of which
 * must be empty. Modelled here so the adversarial cases can be driven through
 * the same specification the SQL implements.
 */
export function vocabularyDrift(
  expected: readonly string[],
  actual: readonly string[]
): { missing: string[]; unexpected: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: expected.filter((v) => !actualSet.has(v)).sort(),
    unexpected: actual.filter((v) => !expectedSet.has(v)).sort()
  };
}

/** True when the guard must refuse. */
export function refusesVocabulary(
  expected: readonly string[],
  actual: readonly string[]
): boolean {
  const { missing, unexpected } = vocabularyDrift(expected, actual);
  return missing.length > 0 || unexpected.length > 0;
}

/**
 * Pulls every `'value'` literal out of a SQL `array[...]` / `values (...)`
 * vocabulary declaration, so a SQL copy can be compared against the canonical
 * array above. Deliberately captures ANY single-quoted run rather than
 * `[a-z_]+`, so a smuggled `'Weird-Value'` shows up as an unexpected member
 * instead of being silently skipped.
 */
export function sqlVocabulary(block: string): string[] {
  return Array.from(
    new Set((block.match(/'[^']*'/g) ?? []).map((v) => v.slice(1, -1)))
  ).sort();
}
