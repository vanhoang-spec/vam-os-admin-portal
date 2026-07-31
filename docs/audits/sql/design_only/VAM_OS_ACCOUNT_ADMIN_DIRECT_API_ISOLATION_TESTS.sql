-- Executable isolation tests are implemented by scripts/account-rls-isolation-harness.mjs.
-- This SQL artifact intentionally performs no impersonation and contains no credentials.
-- Required externally supplied synthetic identities: anon, super_admin, UEH operator, HAM operator,
-- reviewer, interviewer, mentor, and mentee. Service-role is excluded because it bypasses RLS.
select jsonb_build_object('harness','scripts/account-rls-isolation-harness.mjs','remote_execution_authorized',false,'credentials_embedded',false) isolation_harness_manifest;
