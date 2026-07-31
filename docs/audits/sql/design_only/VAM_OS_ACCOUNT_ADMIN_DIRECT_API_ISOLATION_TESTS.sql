-- Executable isolation tests are implemented by scripts/account-rls-isolation-harness.mjs.
-- This SQL artifact intentionally performs no impersonation and contains no credentials.
-- Required externally supplied synthetic identities: anon, super_admin, UEH operator, HAM operator,
-- reviewer, interviewer, mentor, and mentee. Service-role is excluded because it bypasses RLS.
select jsonb_build_object('package','VAM062_V3','harness','scripts/account-rls-isolation-harness.mjs','validity_check_required',true,'fixture_existence_required',true,'cross_season_required',true,'remote_execution_authorized',false,'credentials_embedded',false) isolation_harness_manifest;
