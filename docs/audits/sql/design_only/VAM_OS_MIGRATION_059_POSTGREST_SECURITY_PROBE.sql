-- VAM OS — MIGRATION 059 POSTGREST SECURITY PROBE MANIFEST
-- package: VAM059_POSTGREST_SECURITY_PROBE_V1
--
-- NOT EXECUTED. This artifact is a manifest only. The executable probe is
-- scripts/application-bootstrap-postgrest-probe.mjs, which is not run by this
-- package and refuses to run without --authorize-staging-probe against an
-- endpoint whose host contains the expected staging ref (ljfneyuvpxrmejpxsmpz)
-- and does not contain the forbidden production ref (qkkroesfiazsejkzflcd).
--
-- The probe exercises the migration 059 privilege contract over the real
-- PostgREST surface, which is the only place ambient default privileges and
-- role inheritance can be observed end to end:
--
--   1. service_role SELECT on applications and application_answers succeeds
--   2. anon SELECT is denied (401/403/404, zero rows)
--   3. anon INSERT is denied
--   4. unauthorized authenticated SELECT is denied
--   5. unauthorized authenticated INSERT is denied
--   6. service_role INSERT -> SELECT -> DELETE round trip succeeds and the
--      probe row is provably removed
--   7. no token, key, email, raw UUID, cookie or authorization header is
--      printed — every emitted string passes through the probe's redact()
--      and only names, booleans, HTTP statuses and row counts are emitted
--
-- This SQL file performs no impersonation, contains no credential and reads
-- no row. Selecting it returns the manifest below.

select jsonb_build_object(
  'package', 'VAM059_POSTGREST_SECURITY_PROBE_V1',
  'harness', 'scripts/application-bootstrap-postgrest-probe.mjs',
  'executed_by_this_package', false,
  'remote_execution_authorized', false,
  'credentials_embedded', false,
  'target_environment', 'staging',
  'expected_staging_ref', 'ljfneyuvpxrmejpxsmpz',
  'forbidden_production_ref', 'qkkroesfiazsejkzflcd',
  'requires_flag', '--authorize-staging-probe',
  'tables_under_test', jsonb_build_array('public.applications', 'public.application_answers'),
  'writes_performed', 'step 6 only: one applications row inserted and deleted by service_role',
  'output_contains', jsonb_build_array('assertion name', 'pass boolean', 'expected status', 'http status', 'row count'),
  'output_never_contains', jsonb_build_array('token', 'api key', 'email', 'raw uuid', 'cookie', 'authorization header', 'response body'),
  'checks', jsonb_build_array(
    jsonb_build_object('id', 1, 'name', 'service_role_select', 'expect', 'allowed'),
    jsonb_build_object('id', 2, 'name', 'anon_select_denied', 'expect', 'denied'),
    jsonb_build_object('id', 3, 'name', 'anon_insert_denied', 'expect', 'denied'),
    jsonb_build_object('id', 4, 'name', 'unauthorized_authenticated_select_denied', 'expect', 'denied'),
    jsonb_build_object('id', 5, 'name', 'unauthorized_authenticated_insert_denied', 'expect', 'denied'),
    jsonb_build_object('id', 6, 'name', 'service_role_insert_select_delete', 'expect', 'allowed_and_cleaned_up'),
    jsonb_build_object('id', 7, 'name', 'no_secret_in_output', 'expect', 'redacted')
  )
) migration_059_postgrest_security_probe_manifest;
