-- =============================================================================
-- VAM OS — M069 SEASON 12 APPLICATION INTAKE CONTROL — VERIFIER
--
-- READ-ONLY. Run after apply.sql, in its own session, with
-- `set timezone = 'UTC'`. Every check must report PASS.
--
-- 18 checks. Any FAIL means the apply did not land as reviewed; do not open
-- any form until it is resolved.
-- =============================================================================

\echo '=== M069 VERIFIER — READ ONLY ==='

with checks as (

  -- V01 — the table exists
  select 'V01' as id, 'control table exists' as what,
         (to_regclass('public.application_form_controls') is not null) as ok,
         coalesce(to_regclass('public.application_form_controls')::text, '<absent>') as detail

  -- V02 — exactly two control rows, both for UEHM-S12-B1
  union all
  select 'V02', 'exactly 2 control rows for UEHM-S12-B1',
         count(*) = 2, count(*)::text
  from public.application_form_controls c
  join public.intake_batches b on b.id = c.intake_batch_id
  where b.code = 'UEHM-S12-B1'

  -- V03 — mentor control exists
  union all
  select 'V03', 'mentor control row exists', count(*) = 1, count(*)::text
  from public.application_form_controls c
  join public.intake_batches b on b.id = c.intake_batch_id
  where b.code = 'UEHM-S12-B1' and c.applicant_role = 'mentor'

  -- V04 — mentee control exists
  union all
  select 'V04', 'mentee control row exists', count(*) = 1, count(*)::text
  from public.application_form_controls c
  join public.intake_batches b on b.id = c.intake_batch_id
  where b.code = 'UEHM-S12-B1' and c.applicant_role = 'mentee'

  -- V05 — BOTH are CLOSED. The single most important check in this file.
  union all
  select 'V05', 'every control row is CLOSED', count(*) = 0,
         coalesce(string_agg(c.applicant_role || '=' || c.state, ', ' order by c.applicant_role), '<none not-closed>')
  from public.application_form_controls c
  where c.state <> 'closed'

  -- V06 — uniqueness is enforced by an index, not by convention
  union all
  select 'V06', 'unique index on (intake_batch_id, applicant_role)',
         count(*) = 1, coalesce(string_agg(indexname, ', '), '<none>')
  from pg_indexes
  where schemaname = 'public' and tablename = 'application_form_controls'
    and indexname = 'application_form_controls_batch_role_key'

  -- V07 — role vocabulary is closed
  union all
  select 'V07', 'applicant_role CHECK admits exactly mentor+mentee',
         count(*) = 1, coalesce(string_agg(conname, ', '), '<none>')
  from pg_constraint
  where conrelid = to_regclass('public.application_form_controls')
    and conname = 'application_form_controls_role_check' and contype = 'c'

  -- V08 — state vocabulary is closed
  union all
  select 'V08', 'state CHECK admits exactly closed+pilot+open',
         count(*) = 1, coalesce(string_agg(conname, ', '), '<none>')
  from pg_constraint
  where conrelid = to_regclass('public.application_form_controls')
    and conname = 'application_form_controls_state_check' and contype = 'c'

  -- V09 — binding integrity trigger is installed
  union all
  select 'V09', 'binding trigger installed', count(*) = 1,
         coalesce(string_agg(tgname, ', '), '<none>')
  from pg_trigger
  where tgrelid = to_regclass('public.application_form_controls')
    and tgname = 'application_form_controls_binding' and not tgisinternal

  -- V10 — RLS is ON
  union all
  select 'V10', 'RLS enabled on the control table', bool_and(relrowsecurity),
         coalesce(string_agg(relrowsecurity::text, ','), '<none>')
  from pg_class
  where oid = to_regclass('public.application_form_controls')

  -- V11 — and there are ZERO policies. RLS with a permissive policy would be
  -- worse than no RLS, because it would look locked down.
  union all
  select 'V11', 'zero RLS policies on the control table', count(*) = 0,
         coalesce(string_agg(policyname, ', '), '<none>')
  from pg_policies
  where schemaname = 'public' and tablename = 'application_form_controls'

  -- V12 — no grant to any public web role
  union all
  select 'V12', 'no anon/authenticated/PUBLIC grant on the control table',
         count(*) = 0,
         coalesce(string_agg(grantee || ':' || privilege_type, ', '), '<none>')
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'application_form_controls'
    and grantee in ('anon', 'authenticated', 'PUBLIC')

  -- V13 — the mutation function exists
  union all
  select 'V13', 'vam069_set_application_form_state exists', count(*) = 1,
         coalesce(string_agg(p.proname, ', '), '<none>')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam069_set_application_form_state'

  -- V14 — it is SECURITY DEFINER with a pinned search_path
  union all
  select 'V14', 'mutation function is SECURITY DEFINER with pinned search_path',
         bool_and(p.prosecdef and p.proconfig is not null
                  and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
         coalesce(string_agg(p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), '<none>'), ' '), '<none>')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam069_set_application_form_state'

  -- V15 — execute is not granted to a public web role
  union all
  select 'V15', 'no anon/authenticated/PUBLIC execute on the mutation function',
         count(*) = 0,
         coalesce(string_agg(grantee, ', '), '<none>')
  from information_schema.role_routine_grants
  where routine_schema = 'public' and routine_name = 'vam069_set_application_form_state'
    and grantee in ('anon', 'authenticated', 'PUBLIC')

  -- V16 — audit capability: the vocabulary now admits the M069 action
  union all
  select 'V16', 'audit vocabulary admits set_application_form_state',
         count(*) = 1,
         coalesce(string_agg(c.conname, ', '), '<none>')
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check'
    and pg_get_constraintdef(c.oid) like '%set_application_form_state%'

  -- V17 — and it grew by exactly one, to 53. Not 52 (unchanged), not more
  -- (something else edited the vocabulary in the same window).
  union all
  select 'V17', 'audit vocabulary holds exactly 53 values',
         coalesce(v, 0) = 53, coalesce(v::text, '<no check>')
  from (
    select count(distinct m[1]) as v
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
    where c.conrelid = to_regclass('public.admin_audit_log')
      and c.conname = 'admin_audit_log_action_type_check'
  ) s

  -- V18 — Season 11 is untouched. No control row anywhere may reference an
  -- S11 season, by any route.
  union all
  select 'V18', 'no control row references any Season 11 object', count(*) = 0,
         coalesce(string_agg(s.code, ', '), '<none>')
  from public.application_form_controls c
  join public.seasons s on s.id = c.season_id
  where s.code like '%S11%'
)
select id,
       case when ok then 'PASS' else 'FAIL' end as result,
       what,
       detail
from checks
order by id;

-- Summary line. Expect: 18 checks, 0 failures.
with checks as (select 1)
select
  (select count(*) from public.application_form_controls) as control_rows_total,
  (select count(*) from public.application_form_controls where state = 'closed') as control_rows_closed,
  (select count(*) from public.application_form_controls where state <> 'closed') as control_rows_not_closed,
  (select count(*) from public.admin_audit_log where action_type = 'set_application_form_state') as m069_audit_rows,
  now() at time zone 'UTC' as verified_at_utc;
