/**
 * Declared Production database RPC contract.
 *
 * WHY THIS FILE EXISTS
 *   Release e197e8c shipped code that called the public.vam084_ and public.vam090_
 *   family. Staging had those functions; Production never did. Nothing in CI
 *   compared "RPCs the code calls" against "RPCs Production actually provides",
 *   so the gap only surfaced as a runtime failure for a logged-in operator:
 *     Could not find the function public.vam084_list_recruitment_participants
 *     (p_review_stage, p_season_id) in the schema cache.
 *
 *   __tests__/rpc-release-contract.test.ts enforces that every RPC the
 *   application calls is declared in exactly one bucket below. Adding a new
 *   `.rpc("...")` call without declaring it fails the build — which is the
 *   exact failure class that broke Production.
 *
 * DELIBERATELY CREDENTIAL-FREE
 *   This is a static declaration, checked by a static test. Ordinary CI needs
 *   no Production credentials and makes no network call. That also means the
 *   file records what we have *verified and declared*, not live truth: it is
 *   only as good as the evidence cited against each bucket, and it must be
 *   updated whenever a corrective migration is actually applied.
 */

/**
 * Verified present in the Production catalog (project qkkroesfiazsejkzflcd) by
 * read-only pg_proc inspection on 2026-09-03.
 */
export const PRODUCTION_PROVIDED_RPCS: readonly string[] = [
  "get_founder_intelligence_dashboard",
  "get_operations_dashboard_data",
  "vam063_add_membership_role",
  "vam063_cancel_membership",
  "vam063_opt_out_membership",
  "vam063_pause_membership",
  "vam063_reactivate_membership",
  "vam063_remove_membership_role",
  "vam063_withdraw_membership",
  "vam069_set_application_form_state",
  "vam071_confirm_renewal_profile",
  "vam071_create_renewal_invite",
  "vam071_revoke_renewal_invite",
  "vam071_submit_renewal_accepted",
  "vam071_submit_renewal_declined",
  "vam083_consume_legacy_mentor_preview",
  "vam083_create_legacy_mentor_preview"
];

/**
 * Absent from Production, but defined by a corrective migration that is present
 * in supabase/migrations and awaiting owner approval to apply.
 *
 * The contract test asserts each of these is genuinely defined by a migration
 * file, so this list cannot quietly become a wish list.
 *
 * Migration: 20260903180000_p0_restore_recruitment_review_rpcs.sql
 */
export const PENDING_PRODUCTION_MIGRATION_RPCS: readonly string[] = [
  "vam084_application_decision_eligibility",
  "vam084_apply_application_decisions",
  "vam084_change_review_assignment",
  "vam084_grant_recruitment_participation",
  "vam084_list_recruitment_participants",
  "vam084_operator_for_season",
  "vam084_participant_for_stage",
  "vam084_recompute_application_review_status",
  "vam084_revoke_recruitment_participation",
  "vam084_submit_application_review",
  "vam084_upsert_stage_requirement",
  "vam090_bulk_assign_application_reviews",
  "vam090_finalize_recruitment_approval"
];

/**
 * Absent from Production, called by the application, and NOT introduced by the
 * current release: the rolled-back Production build calls these too, so they
 * are pre-existing breakage on their own remediation track rather than a
 * release blocker. Acknowledged here so the guard stays green for unrelated
 * work while still refusing anything genuinely new.
 *
 * Do not add to this list to silence a new failure. A newly introduced RPC
 * belongs in a migration, not here.
 */
export const KNOWN_MISSING_PREEXISTING_RPCS: readonly string[] = [
  "add_action_item_comment",
  "create_action_item",
  "generate_monthly_followup_actions",
  "get_operations_workflow_data",
  "update_action_item",
  "vam062_admin_mutation_atomic",
  "vam062_begin_auth_operation",
  "vam062_consume_account_preview",
  "vam062_create_account_preview",
  "vam062_import_participant_membership_atomic",
  "vam062_record_auth_operation_stage",
  "vam062_record_auth_reconciliation",
  "vam062_record_reconciliation",
  "vam062_upsert_staff_account_atomic"
];

/**
 * Call sites that pass a variable to `.rpc()` instead of a literal, so the
 * static scanner cannot read the name off the call. Each must enumerate the
 * names it can dispatch; the contract test verifies every declared name really
 * does appear as a string literal in that file, and fails on any NEW indirect
 * call site that is not declared here.
 */
export const INDIRECT_RPC_CALL_SITES: ReadonlyArray<{ file: string; rpcs: readonly string[] }> = [
  {
    file: "app/actions/membership-lifecycle.ts",
    rpcs: [
      "vam063_pause_membership",
      "vam063_reactivate_membership",
      "vam063_withdraw_membership",
      "vam063_opt_out_membership",
      "vam063_cancel_membership",
      "vam063_remove_membership_role"
    ]
  }
];

/** Every RPC name the declared contract accounts for, in any bucket. */
export const DECLARED_RPCS: readonly string[] = PRODUCTION_PROVIDED_RPCS.concat(
  PENDING_PRODUCTION_MIGRATION_RPCS,
  KNOWN_MISSING_PREEXISTING_RPCS
);
