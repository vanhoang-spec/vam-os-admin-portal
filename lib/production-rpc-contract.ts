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
 *
 * The vam084_ and vam090_ recruitment family was ABSENT until migration
 * 20260903180000 was applied to Production on 2026-09-03; the post-apply
 * verification pack confirmed 13/13 present with service_role-only execute.
 * Migration 20260903193000 later replaced vam084_list_recruitment_participants
 * in place — same name, arguments and return contract, so the declared set is
 * unchanged by it.
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
  "vam083_create_legacy_mentor_preview",
  "vam084_application_decision_eligibility",
  "vam084_apply_application_decisions",
  "vam084_change_review_assignment",
  // VERSION-SENSITIVE. The shipped Production body unconditionally inserted a
  // role='review' admin_scope_access row guarded by an ON CONFLICT whose target
  // included `role`, while Production also enforces a role-AGNOSTIC unique
  // index on (user_id, program_id, season_id) among active rows. Any account
  // already holding an active 'operations' or 'full_access' scope for the
  // season therefore failed the grant with
  //   23505 duplicate key value violates unique constraint
  //         "admin_scope_access_active_scope_key"
  // Observed on Production 2026-09-04: Super Admin (no scope row) succeeded and
  // six Core Team / Admin accounts failed.
  // Migration 20260904140000_grant_participation_scope_reuse.sql makes the
  // function reuse a qualifying scope instead of stacking a second one.
  // APPLIED AND VERIFIED on Production (qkkroesfiazsejkzflcd) on 2026-09-04,
  // after Staging. Presence was never the question for this function — the
  // deployed BODY is, so a future change here must be verified the same way.
  "vam084_grant_recruitment_participation",
  // Rewritten by 20260904143000 as a derivation of the canonical eligibility
  // function (applied and verified on Production 2026-09-04). Its published
  // RETURNS TABLE shape is unchanged, so no application change was required.
  // The canonical helper vam084_recruitment_eligible_admins is deliberately
  // absent from every bucket: no application code calls it, it is a SQL-level
  // dependency of the two functions above, exactly like vam093.
  "vam084_list_recruitment_participants",
  "vam084_operator_for_season",
  // VERSION-SENSITIVE. Migration 20260903193000 moved the profile-screening
  // half of vam084_list_recruitment_participants onto the Owner's
  // admin-account policy without touching this predicate, leaving the read
  // side and the write side of one policy disagreeing: the dropdown offers a
  // reviewer the database then refuses with
  //   P0001 Target assignee is not an active participant for this season and stage
  // Migration 20260904100000_profile_screening_reviewer_eligibility_helper.sql
  // re-syncs it (profile screening only; interview semantics unchanged) and is
  // present in main.
  //
  // Staging ran the PRE-parity version on 2026-09-04 and failed every
  // profile-screening assignment — the migration was in git but had never been
  // applied to that database. Presence in this bucket is therefore NOT enough
  // for this function: verify the deployed BODY, not just the name.
  //
  // SUPERSEDED. Migration 20260904143000_privileged_recruitment_automatic_
  // eligibility.sql rewrites this predicate as a thin derivation of the
  // canonical vam084_recruitment_eligible_admins, so the list and the predicate
  // can no longer hold different policies. Applied and verified on Production
  // on 2026-09-04, which also closes the 20260904100000 parity question there.
  "vam084_participant_for_stage",
  "vam084_recompute_application_review_status",
  "vam084_revoke_recruitment_participation",
  "vam084_submit_application_review",
  "vam084_upsert_stage_requirement",
  "vam090_bulk_assign_application_reviews",
  "vam090_finalize_recruitment_approval",
  // M092 Bulk Official Approval. Applied to Production 2026-09-04 by migration
  // 20260904070000_m092_bulk_official_approval_production. Post-apply catalog
  // verification confirmed the identity signature (uuid[], uuid), SECURITY
  // INVOKER with search_path='', and a service_role-only execute ACL
  // (postgres=X | service_role=X, no PUBLIC/anon/authenticated) — with
  // pg_get_functiondef md5 1707a71e... matching the Staging catalog exactly.
  "vam092_bulk_official_approve_applications",
  // VAM094 manual selected bulk assignment. Applied to Production
  // (qkkroesfiazsejkzflcd) by migration 20260904120000_manual_bulk_assignment
  // and verified by the release owner on 2026-09-04: identity signature
  // (uuid[], uuid, text, timestamptz, text, uuid), SECURITY INVOKER
  // (security_definer=false) with search_path='', and a service_role-only
  // execute ACL (postgres + service_role, no PUBLIC/anon/authenticated).
  "vam094_assign_selected_application_reviews",
  // Gỡ liên kết Auth đã chết trước khi cấp quyền tuyển sinh (migration
  // 20260918100000). Dán lên Production 18/09/2026; kiểm đọc catalog ngay sau đó:
  // SECURITY DEFINER, ACL đúng postgres + service_role, không anon/authenticated.
  "vam084_clear_stale_recruitment_auth_link",
  // Quyền đổi kết quả theo vai trò ứng tuyển của hồ sơ (migration 20260918150000).
  // Dán lên Production 18/09/2026; kiểm đọc catalog: hàm có thật, ACL chỉ
  // service_role, và cả ba hàm ghi kết quả đã gọi nó, không hàm nào còn gọi
  // vam084_operator_for_season.
  "vam096_decision_operator_for_application",
  // Xoá hẳn một người và xoá hẳn một tài khoản ban tổ chức (migration
  // 20260920060000). Dán lên Production 20/09/2026; kiểm đọc catalog ngay sau
  // đó cho cả bốn hàm: SECURITY DEFINER, ACL đúng postgres + service_role
  // (không anon/authenticated), thân hàm đọc vai trò API qua
  // vam063_trusted_api_role() và KHÔNG gọi vam084_operator_for_season( hay
  // vam084_staffing_operator_for_season( — phép kiểm phụ thuộc current_user vốn
  // luôn sai trong ngữ cảnh definer (bài học 18/09/2026).
  "vam097_person_delete_report",
  "vam097_delete_person",
  "vam097_admin_account_delete_report",
  "vam097_delete_admin_account",
  // Lịch phỏng vấn mentor 1:1 (migration 20260922100000). Dán lên Production
  // 22/09/2026; kiểm đọc catalog ngay sau đó cho cả ba hàm: SECURITY DEFINER,
  // ACL đúng postgres + service_role (không anon/authenticated), thân hàm đọc
  // vai trò API qua vam063_trusted_api_role() và KHÔNG gọi hàm phụ đọc
  // current_user; hàm giữ chỗ có `for update skip locked` + FIFO theo
  // available_since; hàm mentor tự huỷ có mốc chặn 24 giờ. Migration đó cũng
  // THAY THÂN vam084_recompute_application_review_status theo lối cộng thêm —
  // đã đọc lại pg_get_functiondef xác nhận tấm chắn vòng-hồ-sơ có mặt, hai
  // whitelist cũ và câu raise gốc còn nguyên, vẫn security invoker.
  "vam098_book_interview_slot",
  "vam098_cancel_interview_booking_mentor",
  "vam098_cancel_interview_booking_btc",
  // Chiều ngược — migration 20260923040000_interview_mentor_availability.sql,
  // chủ dự án dán 23/09/2026. Đã đọc catalog Production xác nhận: hàm có mặt,
  // prosecdef = true, ACL đúng `postgres=X/postgres service_role=X/postgres`
  // (không cấp cho anon/authenticated), thân hàm chứa vam063_trusted_api_role,
  // `for update of av skip locked`, `av.available_since asc` và chặn thiếu SĐT,
  // KHÔNG chứa lời gọi vam084_operator_for_season. Bảng đi kèm cũng đã xác
  // minh: RLS bật, service_role đúng INSERT,SELECT,UPDATE (không DELETE),
  // không rò quyền cho anon/authenticated, và có chỉ số bộ phận
  // interview_mentor_availability_active_uidx canh luật một-mentor-một-lời-ngỏ.
  "vam099_match_mentor_at_hour"
];

/**
 * Absent from Production, but defined by a corrective migration that is present
 * in supabase/migrations and awaiting owner approval to apply.
 *
 * The contract test asserts each of these is genuinely defined by a migration
 * file, so this list cannot quietly become a wish list.
 *
 * This is the ONLY honest bucket for an RPC that ships in application code
 * ahead of its Production apply. Moving a name out of here and into
 * PRODUCTION_PROVIDED_RPCS is a claim about the Production catalog and needs
 * read-only catalog evidence recorded against it — never a green build.
 *
 * Migrations: 20260903180000_p0_restore_recruitment_review_rpcs.sql (applied)
 *             20260831120000_s12_m092_bulk_official_approval.sql (NOT applied to Production)
 *             20260901090000_s12_m093_pre_uat_hardening.sql (NOT applied to Production)
 *             20260905140900_s12_withdrawn_application_quarantine_restore.sql (NOT applied)
 */
export const PENDING_PRODUCTION_MIGRATION_RPCS: readonly string[] = [
  // Giữ chỗ một ca phỏng vấn mentee — migration
  // 20260924190000_mentee_interview_sessions.sql. Nằm ở đây cho tới khi chủ dự án
  // dán migration lên Production và có bằng chứng đọc catalog.
  "vam101_book_mentee_session",
  // Ban tổ chức sửa nội dung bài chấm — migration
  // 20260918170000_review_content_override.sql. Nằm ở đây cho tới khi chủ dự án dán
  // migration lên Production và có bằng chứng đọc catalog.
  "vam096_override_application_review",
  // VAM095 P1 withdrawn-application quarantine. These remain explicitly
  // Production-pending until the owner applies 20260905140900 and records
  // read-only catalog verification; this candidate does not apply it.
  "vam095_application_review_assignability",
  "vam095_assign_application_review",
  "vam095_restore_withdrawn_application",
  "vam095_save_application_review_draft"
];

/**
 * Verified present in the STAGING catalog (project ljfneyuvpxrmejpxsmpz) by
 * read-only inspection. Staging runs ahead of Production by design during UAT.
 *
 * This list is a catalog record, NOT a declaration: membership here never
 * satisfies the guard and is never evidence that Production provides a
 * function. A name that application code calls must still earn its place in
 * one of the three real buckets above. That separation is what lets the
 * contract express "STAGING_PRESENT + PRODUCTION_PENDING" during a release
 * instead of silently collapsing the two — which is how the M084/M090 gap went
 * unnoticed until it broke Production.
 *
 * Both entries below are now present on Production too (migration
 * 20260904070000), so the M092 release gap is closed.
 */
export const STAGING_VERIFIED_RPCS: readonly string[] = [
  // M092 base contract, redefined in place (same uuid[],uuid signature) by the
  // M093 pre-UAT hardening migration; Staging therefore runs M092+M093.
  "vam092_bulk_official_approve_applications",
  // M093 returning-mentor collision guard. NOT a direct application RPC — it
  // is called only from inside vam092_bulk_official_approve_applications, so
  // it is a SQL/transitive dependency and correctly absent from DECLARED_RPCS.
  "vam093_returning_mentor_collision"
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
