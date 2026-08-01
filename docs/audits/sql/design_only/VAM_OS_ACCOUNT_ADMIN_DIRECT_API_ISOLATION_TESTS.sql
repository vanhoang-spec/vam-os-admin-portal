-- Executable isolation tests are implemented by scripts/account-rls-isolation-harness.mjs.
-- This SQL artifact intentionally performs no impersonation and contains no credentials.
-- Required externally supplied synthetic identities: anon, super_admin, UEH operator, HAM operator,
-- reviewer, interviewer, mentor, and mentee. Service-role is excluded because it bypasses RLS.
select jsonb_build_object('package','VAM062_V4','harness','scripts/account-rls-isolation-harness.mjs','authoritative_role_scope_required',true,'person_auth_link_required',true,'fixture_topology_required',true,'denial_matrix','privilege_denial_only_for_package_tables','remote_execution_authorized',false,'credentials_embedded',false) isolation_harness_manifest;
