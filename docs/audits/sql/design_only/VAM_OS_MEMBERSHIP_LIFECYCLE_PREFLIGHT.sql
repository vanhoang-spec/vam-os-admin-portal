-- VAM063_V1 catalog-only preflight. Source-controlled expected state; no business rows are read.
-- Verifies migration 062 V3 is already applied (this package's write paths
-- depend on its corrected admin_scope_access arbiter, RLS-hardened
-- person_season_memberships, and expanded admin_audit_log vocabulary) and
-- that no vam063_* name collision exists.
-- Correction applied 2026-08-02 during staging-preflight-failure
-- reconciliation: prerequisite:membership_status_vocabulary (a loose
-- substring-presence check, not full-set-exact, and never checked role
-- vocabulary at all) is replaced by prerequisite:
-- membership_role_vocabulary_full_exact and prerequisite:
-- membership_status_vocabulary_full_exact — both true set comparisons
-- against the exact required role/status vocabularies, keyed to the
-- specific person_season_memberships_role_check/_status_check constraints
-- by name, immune to whitespace/casts/parentheses/ARRAY formatting/value
-- order. 063 itself is unchanged; this file only gains the read-only
-- structural prerequisite checks the generated TEMP preflight packet had
-- attempted ad hoc (and had gotten wrong via raw-string comparison,
-- producing false-negative FAILs against a staging schema whose actual
-- vocabularies already matched exactly).
with
membership_role_expected(v) as (values ('mentee'),('mentor'),('supporter'),('reviewer'),('interviewer'),('coreteam'),('advisor'),('alumni_mentee'),('guest')),
membership_status_expected(v) as (values ('invited'),('active'),('paused'),('withdrawn'),('completed'),('graduated'),('opted_out'),('cancelled')),
membership_role_actual as (
  select array(select (regexp_matches(pg_get_constraintdef(c.oid),'''([a-zA-Z0-9_]+)''::text','g'))[1]) v
  from pg_constraint c
  where c.conrelid='public.person_season_memberships'::regclass and c.conname='person_season_memberships_role_check' and c.contype='c'
),
membership_status_actual as (
  select array(select (regexp_matches(pg_get_constraintdef(c.oid),'''([a-zA-Z0-9_]+)''::text','g'))[1]) v
  from pg_constraint c
  where c.conrelid='public.person_season_memberships'::regclass and c.conname='person_season_memberships_status_check' and c.contype='c'
),
assertions as(
 select 'prerequisite:person_season_memberships' assertion,case when to_regclass('public.person_season_memberships') is not null then 'PASS' else 'FAIL' end status
 union all select 'prerequisite:person_season_membership_log',case when to_regclass('public.person_season_membership_log') is not null then 'PASS' else 'FAIL' end
 union all select 'prerequisite:admin_scope_access',case when to_regclass('public.admin_scope_access') is not null then 'PASS' else 'FAIL' end
 union all select 'prerequisite:admin_audit_log',case when to_regclass('public.admin_audit_log') is not null then 'PASS' else 'FAIL' end
 union all select 'prerequisite:migration_062_v3_applied',case when to_regprocedure('public.vam062_current_admin_id()') is not null then 'PASS' else 'FAIL' end
 union all select 'prerequisite:admin_scope_access_corrected_arbiter',case when exists(
   select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='admin_scope_access'
     and i.indisunique and i.indisvalid and i.indisready and not i.indisnullsnotdistinct and i.indnkeyatts=4
     and i.indpred is not null and pg_get_expr(i.indpred,i.indrelid)='(status = ''active''::text)'
     and i.indexprs is not null and pg_get_expr(i.indexprs,i.indrelid)='COALESCE(program_id, ''''::text), COALESCE(season_id, ''''::text)'
 ) then 'PASS' else 'FAIL' end
 union all select 'prerequisite:membership_rls_enabled',case when exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='person_season_memberships' and c.relrowsecurity) then 'PASS' else 'FAIL' end
 union all select 'prerequisite:membership_role_vocabulary_full_exact',case when exists(select 1 from membership_role_actual a where (select array_agg(x order by x) from unnest(a.v) x)=(select array_agg(e.v order by e.v) from membership_role_expected e)) then 'PASS' else 'FAIL' end
 union all select 'prerequisite:membership_status_vocabulary_full_exact',case when exists(select 1 from membership_status_actual a where (select array_agg(x order by x) from unnest(a.v) x)=(select array_agg(e.v order by e.v) from membership_status_expected e)) then 'PASS' else 'FAIL' end
 union all select 'prerequisite:action_type_vocabulary',case when not exists(
   select x from unnest(array['create_membership','add_membership_role','remove_membership_role','pause_membership','withdraw_membership','opt_out_membership','cancel_membership','reactivate_membership']) x
   where not exists(select 1 from pg_constraint c where c.conrelid='public.admin_audit_log'::regclass and c.conname='admin_audit_log_action_type_check' and pg_get_constraintdef(c.oid) like '%'||x||'%')
 ) then 'PASS' else 'FAIL' end
 union all select 'package_name_collision',case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam063_%') then 'PASS' else 'FAIL' end
 union all select 'ownership',case when to_regclass('public.person_season_memberships') is null or (select pg_get_userbyid(relowner) from pg_class where oid=to_regclass('public.person_season_memberships'))=current_user then 'PASS' else 'FAIL' end
),
normalized as(select assertion,status::text from assertions)
select jsonb_build_object('package','VAM063_V1','read_only',true,'overall_status',case when bool_and(status='PASS') then 'PASS' else 'FAIL' end,'eligible',bool_and(status='PASS'),'assertions',jsonb_agg(jsonb_build_object('assertion',assertion,'status',status) order by assertion),'failed_assertions',coalesce(jsonb_agg(assertion order by assertion)filter(where status<>'PASS'),'[]'::jsonb)) membership_lifecycle_preflight_v1 from normalized;
