-- VAM062_V3 independent catalog verification. Expected constants are source controlled; missing/extra evidence fails.
-- Changes vs. the reviewed VAM062_V5 draft:
--  * expected_policy gains the two new read policies for intake_batches and
--    person_season_membership_log (DEC-09).
--  * account_rls_package_state's expected column list/constraint count is
--    updated for the new prior_grants column (7 columns, still 3
--    constraints — a plain NOT NULL column does not add a pg_constraint row
--    in this Postgres version, confirmed against the original file's own
--    counting convention for other NOT NULL-only columns).
--  * policy_inventory/package_provenance counts updated for 7 policies and
--    25 manifest rows (was 5 / 23).
--  * affected_table_state_and_grants extended to all 7 write-path tables
--    instead of 5 — this is now a meaningful check rather than one that
--    would have silently ignored intake_batches and
--    person_season_membership_log entirely.
--  * a new action_type_vocabulary assertion proves the exact final
--    (expanded, still NOT VALID) constraint definition rather than only
--    checking table/function/policy shape.
-- Corrections applied 2026-08-02 during staging-preflight-failure
-- reconciliation:
--  * expected_baseline gains a roles column and a 4th row for the
--    pre-existing, safe, out-of-band emergency policy "active admins can
--    read themselves" (applied to staging 2026-06-17); this migration never
--    drops or alters it, so post-apply verification must prove it still
--    exists, unchanged. read_admin_users_super_admin_or_self's expected
--    qual is corrected to its current, hardened (status='active') form.
--  * policy_inventory's "no unexpected extra policy" clause now reads its
--    list of known-safe non-package policy names from expected_baseline
--    itself instead of a separate hardcoded literal list, so the two can
--    never drift apart again; it still fails closed on any policy that is
--    neither package-owned (vam062_%) nor a named baseline policy.
--  * action_type_vocabulary is split into action_type_vocabulary:values
--    (set comparison of bare literal values) and action_type_vocabulary:
--    not_valid (via pg_constraint.convalidated), matching the preflight's
--    fix, instead of raw pg_get_constraintdef string equality.
-- Corrections applied 2026-08-03 during staging post-apply-failure
-- reconciliation (all three were verifier-side defects; migration 062 is
-- unchanged and was applied exactly once):
--  * C1 policy/baseline_policy compared p.qual to the expected constant with
--    raw string equality. pg_get_expr renders a sub-SELECT across multiple
--    lines ("\n   FROM", "\n     JOIN", "\n  WHERE") while the expected
--    constants are written flat, so the four EXISTS-bearing policies failed
--    on whitespace alone. Both sides are now put through the *same*
--    normalisation — btrim(regexp_replace(x,'[[:space:]]+',' ','g')) — and
--    then compared with exact equality. A POSIX bracket class is used rather
--    than \s so the pattern cannot depend on standard_conforming_strings.
--    Everything else stays exact: policy name, schema/table, PERMISSIVE,
--    cmd, roles, USING, WITH CHECK, and the count(p.*)=1 uniqueness clause.
--    RESIDUAL RISK (narrow, deliberately accepted): normalisation also
--    collapses whitespace *inside* quoted string literals, so two quals
--    differing only by internal spacing of a literal would compare equal. No
--    currently expected qual contains such a literal, and
--    migration-062-verifier-catalog-rendering-fix.test.ts fails the build if
--    one is ever introduced — at which point this comparator must be
--    redesigned (e.g. literal-aware tokenisation) rather than widened.
--  * C2 column_defaults used an inline CASE that omitted the seven
--    account_auth_operations state defaults and account_person_auth_links.id,
--    and asserted a gen_random_uuid() default on account_import_previews.id
--    that migration 062 never declares. It is replaced by expected_default,
--    an explicit (table,column,rendered_default) allow-list carrying every
--    default migration 062 declares. Unlisted columns must have NO default,
--    so an unexpected default still fails closed; a listed default that is
--    missing or different still fails; and an expected_default row naming a
--    column that does not exist also fails.
--  * C3 the single actual_constraints total could not tell a dropped foreign
--    key from an added check. expected_table now carries a typed breakdown
--    (con_p/con_f/con_u/con_c) compared per contype, plus an independently
--    derived total asserted equal to their sum — so swapping one constraint
--    type for another fails, and any other contype (trigger/exclusion/
--    catalogued NOT NULL) cannot slip in unverified. Counts are derived from
--    the unchanged migration-062 source, not from staging output; the
--    previous 15/11 for account_auth_operations/account_person_auth_links
--    were arithmetic errors (correct totals are 14 and 9).
with
expected_policy(t,n,q) as(values
 ('admin_users','vam062_admin_users_self_or_super','((auth_user_id = auth.uid()) OR (current_admin_role() = ''super_admin''::text))'),
 ('admin_scope_access','vam062_scope_self_or_super','((user_id = auth.uid()) OR (current_admin_role() = ''super_admin''::text))'),
 ('admin_audit_log','vam062_audit_actor_or_super','((actor_admin_user_id = vam062_current_admin_id()) OR (current_admin_role() = ''super_admin''::text))'),
 ('people','vam062_people_program_ops','((current_admin_role() = ''super_admin''::text) OR (EXISTS ( SELECT 1 FROM (person_season_memberships m JOIN admin_scope_access s ON (((s.user_id = auth.uid()) AND (s.status = ''active''::text) AND (s.role = ANY (ARRAY[''full_access''::text, ''operations''::text])) AND (s.program_id = (m.program_id)::text) AND (s.season_id IS NOT NULL) AND (s.season_id = (m.season_id)::text)))) WHERE (m.person_id = people.id))))'),
 ('person_season_memberships','vam062_membership_program_ops','((current_admin_role() = ''super_admin''::text) OR (EXISTS ( SELECT 1 FROM admin_scope_access s WHERE ((s.user_id = auth.uid()) AND (s.status = ''active''::text) AND (s.role = ANY (ARRAY[''full_access''::text, ''operations''::text])) AND (s.program_id = (person_season_memberships.program_id)::text) AND (s.season_id IS NOT NULL) AND (s.season_id = (person_season_memberships.season_id)::text)))))'),
 ('intake_batches','vam062_intake_batches_program_ops','((current_admin_role() = ''super_admin''::text) OR (EXISTS ( SELECT 1 FROM (seasons se JOIN admin_scope_access s ON (((s.user_id = auth.uid()) AND (s.status = ''active''::text) AND (s.role = ANY (ARRAY[''full_access''::text, ''operations''::text])) AND (s.program_id = (se.program_id)::text) AND (s.season_id IS NOT NULL) AND (s.season_id = (se.id)::text)))) WHERE (se.id = intake_batches.season_id))))'),
 ('person_season_membership_log','vam062_membership_log_program_ops','((current_admin_role() = ''super_admin''::text) OR (EXISTS ( SELECT 1 FROM admin_scope_access s WHERE ((s.user_id = auth.uid()) AND (s.status = ''active''::text) AND (s.role = ANY (ARRAY[''full_access''::text, ''operations''::text])) AND (s.program_id = (person_season_membership_log.program_id)::text) AND (s.season_id IS NOT NULL) AND (s.season_id = (person_season_membership_log.season_id)::text)))))')),
-- expected_baseline is the single source of truth for "known-safe,
-- non-package pre-existing policies" — both baseline_policy (proves each
-- one still exists with its exact definition) and policy_inventory (proves
-- no *other* unexpected policy exists) read from it, so the two checks can
-- never drift apart again. read_admin_users_super_admin_or_self's qual is
-- the currently-live, hardened (status='active') form. "active admins can
-- read themselves" is the out-of-band emergency policy applied to staging
-- on 2026-06-17 (docs/VAM_OS_PROD_STAGING_SCHEMA_DIFF_2026-06-17.md) —
-- migration 062 never drops or alters it, so post-apply it must still be
-- present, unchanged, with its original roles=authenticated shape.
expected_baseline(t,n,roles,q)as(values('admin_users','read_admin_users_super_admin_or_self',array['public'],'(((auth.uid() = auth_user_id) AND (status = ''active''::text)) OR (current_admin_role() = ''super_admin''::text))'),('admin_users','active admins can read themselves',array['authenticated'],'((auth_user_id = auth.uid()) AND (status = ''active''::text))'),('admin_scope_access','read_admin_scope_access_self_or_super_admin',array['public'],'((current_admin_role() = ''super_admin''::text) OR (is_active_admin() AND (user_id = auth.uid()) AND (status = ''active''::text)))'),('admin_audit_log','read_admin_audit_log_super_admin_only',array['public'],'(current_admin_role() = ''super_admin''::text)')),
-- expected_table's trailing four integers are the typed pg_constraint
-- breakdown (C3): con_p primary key, con_f foreign key, con_u unique, con_c
-- check. They are counted from the unchanged migration-062 CREATE TABLE
-- source. A plain NOT NULL does not produce a pg_constraint row in this
-- Postgres version; the total==sum assertion below would fail loudly if that
-- ever changes, rather than silently mis-counting.
expected_table(t,cols,types,nulls,rls,forced,con_p,con_f,con_u,con_c)as(values
 ('account_rls_package_state',array['table_name','rls_was_enabled','rls_was_forced','prior_grants','package_version','state_checksum','recorded_at'],array['text','bool','bool','jsonb','text','text','timestamptz'],array['NO','NO','NO','NO','NO','NO','NO'],false,false,1,0,0,2),
 ('account_rls_package_manifest',array['object_kind','object_name','table_name','object_oid','definition_hash','owner_name','package_version'],array['text','text','text','oid','text','text','text'],array['NO','NO','YES','YES','NO','NO','NO'],false,false,1,0,0,3),
 ('account_import_batches',array['id','actor_admin_user_id','source_sha256','row_count','status','created_at','completed_at'],array['uuid','uuid','text','int4','text','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','NO','YES'],true,false,1,1,0,3),
 ('account_import_outcomes',array['id','batch_id','row_number','outcome_status','reason_code','auth_user_id_hash','created_at'],array['uuid','uuid','int4','text','text','text','timestamptz'],array['NO','NO','NO','NO','NO','YES','NO'],true,false,1,1,1,4),
 ('account_auth_reconciliation',array['operation_id','identifier_hash','action_type','failure_class','retry_status','correlation_metadata','created_at','updated_at'],array['uuid','text','text','text','text','jsonb','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','NO','NO','NO'],true,false,1,0,0,2),
 ('account_auth_operations',array['operation_id','actor_admin_user_id','operation_type','identifier_hash','pre_lookup_state','preexisting_auth_user_id_hash','provider_stage','provider_auth_user_id_hash','ownership_state','delete_allowed','application_stage','compensation_stage','reconciliation_state','retry_of','failure_class','created_at','updated_at'],array['uuid','uuid','text','text','text','text','text','text','text','bool','text','text','text','uuid','text','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','YES','NO','YES','NO','NO','NO','NO','NO','YES','YES','NO','NO'],true,false,1,2,0,11),
 ('account_person_auth_links',array['id','auth_user_id','person_id','program_id','season_id','role','status','created_at','updated_at'],array['uuid','uuid','uuid','uuid','uuid','text','text','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','NO','NO','NO','NO'],true,false,1,3,3,2),
 ('account_import_previews',array['id','actor_admin_user_id','secret_hash','ciphertext','iv','auth_tag','expires_at','created_at'],array['uuid','uuid','text','text','text','text','timestamptz','timestamptz'],array['NO','NO','NO','NO','NO','NO','NO','NO'],true,false,1,1,0,1)),
-- expected_default (C2) is the complete, source-controlled set of column
-- defaults declared by migration 062, rendered as information_schema.columns
-- reports them (a bare literal on a text column renders with an explicit
-- ::text cast). Every column of every expected_table that is NOT listed here
-- must have no default at all — that is what makes this fail closed against
-- an arbitrary default appearing on staging. account_import_previews.id is
-- deliberately absent: migration 062 declares it "id uuid primary key" with
-- no default.
expected_default(t,col,d)as(values
 ('account_rls_package_state','prior_grants','''[]''::jsonb'),
 ('account_rls_package_state','recorded_at','transaction_timestamp()'),
 ('account_import_batches','id','gen_random_uuid()'),
 ('account_import_batches','created_at','now()'),
 ('account_import_outcomes','id','gen_random_uuid()'),
 ('account_import_outcomes','created_at','now()'),
 ('account_auth_reconciliation','retry_status','''required''::text'),
 ('account_auth_reconciliation','correlation_metadata','''{}''::jsonb'),
 ('account_auth_reconciliation','created_at','now()'),
 ('account_auth_reconciliation','updated_at','now()'),
 ('account_auth_operations','pre_lookup_state','''pending''::text'),
 ('account_auth_operations','provider_stage','''not_started''::text'),
 ('account_auth_operations','ownership_state','''not_found''::text'),
 ('account_auth_operations','delete_allowed','false'),
 ('account_auth_operations','application_stage','''not_started''::text'),
 ('account_auth_operations','compensation_stage','''not_required''::text'),
 ('account_auth_operations','reconciliation_state','''not_required''::text'),
 ('account_auth_operations','created_at','now()'),
 ('account_auth_operations','updated_at','now()'),
 ('account_person_auth_links','id','gen_random_uuid()'),
 ('account_person_auth_links','created_at','now()'),
 ('account_person_auth_links','updated_at','now()'),
 ('account_import_previews','created_at','now()')),
expected_function(sig)as(values('vam062_current_admin_id()'),('vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text)'),('vam062_admin_mutation_atomic(uuid,text,uuid,jsonb)'),('vam062_upsert_staff_account_atomic(uuid,uuid,integer,uuid,text,text,text,uuid,uuid,text)'),('vam062_import_participant_membership_atomic(uuid,uuid,integer,text,text,text,uuid,uuid,uuid)'),('vam062_record_reconciliation(uuid,uuid,integer,text)'),('vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb)'),('vam062_begin_auth_operation(uuid,uuid,text,text,uuid)'),('vam062_record_auth_operation_stage(uuid,uuid,text,text,text,boolean,text)'),('vam062_create_account_preview(uuid,uuid,text,text,text,text,timestamp with time zone,integer)'),('vam062_consume_account_preview(uuid,uuid,text)')),
-- action_type_vocabulary is checked as a set of bare values plus a separate
-- NOT VALID state check (matching the preflight's approach), instead of raw
-- pg_get_constraintdef string equality.
action_type_expected(v) as (values ('create_admin_user'),('update_admin_user'),('reactivate_admin_user'),('deactivate_admin_user'),('remove_admin_access'),('sync_auth'),('unknown'),('import_participant_membership'),('link_person_auth'),('reconcile_person_auth'),('create_membership'),('add_membership_role'),('remove_membership_role'),('pause_membership'),('withdraw_membership'),('opt_out_membership'),('cancel_membership'),('reactivate_membership')),
action_type_actual as (
  select c.oid,c.convalidated,array(select (regexp_matches(pg_get_constraintdef(c.oid),'''([a-zA-Z0-9_]+)''::text','g'))[1]) v
  from pg_constraint c
  where c.conrelid='public.admin_audit_log'::regclass and c.conname='admin_audit_log_action_type_check' and c.contype='c'
),
table_actual as(select e.*,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner,(select array_agg(x.column_name::text order by x.ordinal_position)from information_schema.columns x where x.table_schema='public' and x.table_name=e.t) actual_cols,(select array_agg(x.udt_name::text order by x.ordinal_position)from information_schema.columns x where x.table_schema='public' and x.table_name=e.t) actual_types,(select array_agg(x.is_nullable::text order by x.ordinal_position)from information_schema.columns x where x.table_schema='public' and x.table_name=e.t) actual_nulls,(select count(*) from pg_constraint x where x.conrelid=c.oid) actual_constraints,(select count(*) from pg_constraint x where x.conrelid=c.oid and x.contype='p') actual_p,(select count(*) from pg_constraint x where x.conrelid=c.oid and x.contype='f') actual_f,(select count(*) from pg_constraint x where x.conrelid=c.oid and x.contype='u') actual_u,(select count(*) from pg_constraint x where x.conrelid=c.oid and x.contype='c') actual_c from expected_table e left join pg_class c on c.oid=to_regclass('public.'||e.t)),
assertions as(
 -- actual_constraints=con_p+con_f+con_u+con_c is not redundant with the four
 -- typed equalities: it is an independently derived total that proves no
 -- constraint of any *other* contype (trigger, exclusion, or a catalogued
 -- NOT NULL on a future Postgres) exists unverified on a package table.
 select 'table:'||t assertion,case when oid is not null and relkind='r' and owner=current_user and actual_cols=cols and actual_types=types and actual_nulls=nulls and relrowsecurity=rls and relforcerowsecurity=forced and actual_p=con_p and actual_f=con_f and actual_u=con_u and actual_c=con_c and actual_constraints=con_p+con_f+con_u+con_c then 'PASS' else 'FAIL' end status,jsonb_build_object('expected_columns',cols,'actual_columns',actual_cols,'expected_constraints',jsonb_build_object('p',con_p,'f',con_f,'u',con_u,'c',con_c),'actual_constraints',jsonb_build_object('p',actual_p,'f',actual_f,'u',actual_u,'c',actual_c,'total',actual_constraints)) evidence from table_actual
 -- C1: qual is compared after identical whitespace normalisation on both
 -- sides (see header). Everything else remains exact equality.
 union all select 'policy:'||e.n,case when count(p.*)=1 and bool_and(p.permissive='PERMISSIVE' and p.roles::text[]=array['authenticated']::text[] and p.cmd='SELECT' and btrim(regexp_replace(p.qual,'[[:space:]]+',' ','g'))=btrim(regexp_replace(e.q,'[[:space:]]+',' ','g')) and p.with_check is null) then 'PASS' else 'FAIL' end,jsonb_build_object('table',e.t) from expected_policy e left join pg_policies p on p.schemaname='public' and p.tablename=e.t and p.policyname=e.n group by e.t,e.n
 -- policy inventory is expected-existing (expected_baseline) + package-owned
 -- (vam062_%), not a stale fixed count: any policy on a package-touched
 -- table that is neither a named package policy nor a named baseline policy
 -- fails this assertion, so an unknown/unsafe/materially-different policy
 -- still fails closed even though the known-safe emergency policy does not.
 union all select 'policy_inventory',case when (select count(*) from pg_policies where schemaname='public' and policyname like 'vam062_%')=7 and not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename in(select t from expected_policy) and p.permissive='PERMISSIVE' and p.policyname not in(select n from expected_policy) and p.policyname not in(select n from expected_baseline)) then 'PASS' else 'FAIL' end,'{}'::jsonb
 -- C1: same normalisation as policy: above, so the two comparison methods
 -- cannot drift apart if a baseline policy ever gains a sub-SELECT.
 union all select 'baseline_policy:'||e.n,case when count(p.*)=1 and bool_and(p.permissive='PERMISSIVE' and p.roles::text[]=e.roles and p.cmd='SELECT' and btrim(regexp_replace(p.qual,'[[:space:]]+',' ','g'))=btrim(regexp_replace(e.q,'[[:space:]]+',' ','g')) and p.with_check is null) then 'PASS' else 'FAIL' end,jsonb_build_object('table',e.t) from expected_baseline e left join pg_policies p on p.schemaname='public' and p.tablename=e.t and p.policyname=e.n group by e.t,e.n,e.roles
 union all select 'affected_table_state_and_grants',case when not exists(select 1 from(values('admin_users'),('admin_scope_access'),('admin_audit_log'),('people'),('person_season_memberships'),('intake_batches'),('person_season_membership_log'))x(t) join pg_class c on c.oid=to_regclass('public.'||x.t) where not c.relrowsecurity or c.relforcerowsecurity or pg_get_userbyid(c.relowner)<>current_user or has_table_privilege('anon','public.'||x.t,'SELECT,INSERT,UPDATE,DELETE') or not has_table_privilege('authenticated','public.'||x.t,'SELECT') or has_table_privilege('authenticated','public.'||x.t,'INSERT,UPDATE,DELETE') or not has_table_privilege('service_role','public.'||x.t,'SELECT,INSERT,UPDATE,DELETE')) then 'PASS' else 'FAIL' end,'{}'::jsonb
 union all select 'function:'||e.sig,case when p.oid is not null and p.prosecdef and p.proconfig@>array['search_path=public'] and pg_get_userbyid(p.proowner)=current_user and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute') then 'PASS' else 'FAIL' end,'{}'::jsonb from expected_function e left join pg_proc p on p.oid=to_regprocedure('public.'||e.sig)
 union all select 'function_inventory',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam062_%')=11 then 'PASS' else 'FAIL' end,'{}'::jsonb
 union all select 'package_grants',case when not exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in(select t from expected_table) and grantee not in(current_user,'service_role')) and not exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in('account_rls_package_state','account_rls_package_manifest') and grantee='service_role') and not exists(select 1 from(values('account_import_batches'),('account_import_outcomes'),('account_auth_reconciliation'),('account_import_previews'))x(t) where (select count(*) from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=x.t and g.grantee='service_role' and g.privilege_type in('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))<>7) then 'PASS' else 'FAIL' end,'{}'::jsonb
 union all select 'package_provenance',case when to_regclass('public.account_rls_package_manifest') is not null and (select count(*) from public.account_rls_package_manifest where package_version='VAM062_V5')=26 and not exists(select 1 from public.account_rls_package_manifest m join pg_class c on m.object_kind='table' and m.object_oid=c.oid where c.relname<>m.object_name or m.definition_hash<>'VAM062_V5_TABLE_PROVENANCE') then 'PASS' else 'FAIL' end,'{"supplementary":true}'::jsonb
 -- C2: every package-table column must match expected_default exactly, and
 -- any column absent from expected_default must have NO default (the scalar
 -- subquery yields NULL, and "is distinct from NULL" catches an unexpected
 -- default). The second clause rejects an expected_default row that names a
 -- column which does not exist, so the allow-list cannot rot silently.
 union all select 'column_defaults',case when not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name in(select t from expected_table) and c.column_default::text is distinct from(select x.d from expected_default x where x.t=c.table_name::text and x.col=c.column_name::text)) and not exists(select 1 from expected_default x where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name::text=x.t and c.column_name::text=x.col)) then 'PASS' else 'FAIL' end,'{}'::jsonb
 union all select 'action_type_vocabulary:values',case when exists(select 1 from action_type_actual a where (select array_agg(x order by x) from unnest(a.v) x)=(select array_agg(e.v order by e.v) from action_type_expected e)) then 'PASS' else 'FAIL' end,'{}'::jsonb
 union all select 'action_type_vocabulary:not_valid',case when exists(select 1 from action_type_actual a where a.convalidated=false) then 'PASS' else 'FAIL' end,'{}'::jsonb
 union all select 'admin_users_status_vocabulary',case when exists(select 1 from pg_constraint where conrelid='public.admin_users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%active%' and pg_get_constraintdef(oid) like '%inactive%') and not exists(select 1 from pg_constraint where conrelid='public.admin_users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%invited%') then 'PASS' else 'FAIL' end,'{}'::jsonb),
summary as(select *,status<>'PASS' failed from assertions)
select jsonb_build_object(
  'package','VAM062_V3',
  'overall_status',case when bool_and(not failed) then 'PASS' else 'FAIL' end,
  'assertions',jsonb_agg(jsonb_build_object('assertion',assertion,'status',status,'evidence',evidence)order by assertion),
  'mismatches',coalesce(jsonb_agg(assertion order by assertion)filter(where failed),'[]'::jsonb),
  'null_season_denial',case when not exists(select 1 from summary where assertion in('policy:vam062_people_program_ops','policy:vam062_membership_program_ops','policy:vam062_intake_batches_program_ops','policy:vam062_membership_log_program_ops') and failed) then 'PASS' else 'FAIL' end
) account_rls_post_apply_v3 from summary;
