-- VAM_OS_V5_METADATA_EVIDENCE_CAPTURE.sql
-- Purpose: metadata-only staging catalog evidence capture for V5 Artifact 1 schema-authority
--          decision pack. Reads pg_catalog ONLY. Never selects, counts, or samples any
--          application/business relation. Never touches auth.users. Never invokes an
--          application function or RPC. No DDL/DML. Ends with ROLLBACK.
--
-- Scope: the prerequisite dependency inventory derived from migration 062
--        (supabase_migrations/062_review_only_account_admin_rls_foundation.sql) and its
--        predecessor policies/helpers, plus a name/oid probe for the eight V5 package
--        tables (which this migration has NOT yet created in staging; queried defensively
--        with left joins so their absence is itself evidence, not an error).
--
-- Every statement below is read-only against catalog relations:
--   pg_class, pg_namespace, pg_attribute, pg_attrdef, pg_collation, pg_constraint, pg_index,
--   pg_am, pg_proc, pg_language, pg_policies, and catalog-rendering functions
--   (pg_get_expr, pg_get_constraintdef, pg_get_indexdef, pg_get_functiondef,
--    pg_get_function_identity_arguments, pg_get_function_arguments, pg_get_userbyid,
--    aclexplode, acldefault, format_type, to_regnamespace, to_regprocedure).
--
-- Output shape: each section is emitted as exactly one line of JSON (jsonb_agg collapses
-- all rows of that section into a single array), preceded by a plain-text
-- "---SECTION:<name>---" marker line. This lets the sanitizer stream stdout directly
-- without ever materializing unsanitized output on disk.
--
-- This file is evidence tooling only. It is not migration 062, not preflight, not
-- rollback, not post-apply verification, and it is not executed as part of any of those.

\pset format unaligned
\pset tuples_only on
\pset fieldsep ''
\pset recordsep ''
\pset null 'null'
\pset pager off

begin transaction read only;

set local statement_timeout = '15s';
set local lock_timeout = '3s';

\echo ---SECTION:relations---
with target_rel(schema_name, rel_name, category, evidence_id) as (
  values
    ('public','people','prerequisite','PREREQ-01'),
    ('public','programs','prerequisite','PREREQ-02'),
    ('public','seasons','prerequisite','PREREQ-03'),
    ('public','intake_batches','prerequisite','PREREQ-04'),
    ('public','person_season_memberships','prerequisite','PREREQ-05'),
    ('public','person_season_membership_log','prerequisite','PREREQ-06'),
    ('public','admin_users','prerequisite','PREREQ-07'),
    ('public','admin_scope_access','prerequisite','PREREQ-08'),
    ('public','admin_audit_log','prerequisite','PREREQ-09'),
    ('public','account_rls_package_state','package','PKG-01'),
    ('public','account_rls_package_manifest','package','PKG-02'),
    ('public','account_import_batches','package','PKG-03'),
    ('public','account_import_outcomes','package','PKG-04'),
    ('public','account_auth_reconciliation','package','PKG-05'),
    ('public','account_auth_operations','package','PKG-06'),
    ('public','account_person_auth_links','package','PKG-07'),
    ('public','account_import_previews','package','PKG-08')
)
select jsonb_agg(row_to_json(sub)) from (
  select
    t.evidence_id,
    t.category,
    t.schema_name,
    t.rel_name,
    c.oid::text as relation_oid_diagnostic_only,
    c.relkind,
    c.relpersistence,
    pg_get_userbyid(c.relowner) as owner_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced,
    c.relhasindex,
    c.relhasrules,
    c.relhastriggers
  from target_rel t
  left join pg_namespace n on n.nspname = t.schema_name
  left join pg_class c on c.relnamespace = n.oid and c.relname = t.rel_name
) sub;

\echo ---SECTION:columns---
select jsonb_agg(row_to_json(sub)) from (
  select
    n.nspname as schema_name,
    c.relname as rel_name,
    a.attnum as ordinal_position,
    a.attname as column_name,
    format_type(a.atttypid, a.atttypmod) as formatted_type,
    a.atttypid::regtype::text as underlying_type,
    not a.attnotnull as is_nullable,
    pg_get_expr(ad.adbin, ad.adrelid) as canonical_default,
    a.attidentity as identity_mode,
    a.attgenerated as generated_mode,
    co.collname as collation_name,
    a.attisdropped as is_dropped
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
  left join pg_collation co on co.oid = a.attcollation
  where n.nspname = 'public'
    and c.relname in (
      'people','programs','seasons','intake_batches','person_season_memberships',
      'person_season_membership_log','admin_users','admin_scope_access','admin_audit_log',
      'account_rls_package_state','account_rls_package_manifest','account_import_batches',
      'account_import_outcomes','account_auth_reconciliation','account_auth_operations',
      'account_person_auth_links','account_import_previews'
    )
  order by c.relname, a.attnum
) sub;

\echo ---SECTION:constraints---
select jsonb_agg(row_to_json(sub)) from (
  select
    n.nspname as schema_name,
    cl.relname as rel_name,
    con.conname as constraint_name,
    con.contype as constraint_type,
    (
      select array_agg(att.attname order by k.ord)
      from unnest(con.conkey) with ordinality k(attnum, ord)
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
    ) as local_columns,
    fn.nspname as referenced_schema,
    fcl.relname as referenced_table,
    (
      select array_agg(fatt.attname order by k.ord)
      from unnest(con.confkey) with ordinality k(attnum, ord)
      join pg_attribute fatt on fatt.attrelid = con.confrelid and fatt.attnum = k.attnum
    ) as referenced_columns,
    con.confmatchtype as match_type,
    con.confupdtype as on_update_action,
    con.confdeltype as on_delete_action,
    con.condeferrable as is_deferrable,
    con.condeferred as initially_deferred,
    con.convalidated as is_validated,
    pg_get_constraintdef(con.oid, true) as canonical_definition
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  left join pg_class fcl on fcl.oid = con.confrelid
  left join pg_namespace fn on fn.oid = fcl.relnamespace
  where n.nspname = 'public'
    and cl.relname in (
      'people','programs','seasons','intake_batches','person_season_memberships',
      'person_season_membership_log','admin_users','admin_scope_access','admin_audit_log',
      'account_rls_package_state','account_rls_package_manifest','account_import_batches',
      'account_import_outcomes','account_auth_reconciliation','account_auth_operations',
      'account_person_auth_links','account_import_previews'
    )
  order by cl.relname, con.conname
) sub;

\echo ---SECTION:indexes---
select jsonb_agg(row_to_json(sub)) from (
  select
    n.nspname as schema_name,
    cl.relname as table_name,
    ic.relname as index_name,
    cl.oid::text as table_oid_diagnostic_only,
    ic.oid::text as index_oid_diagnostic_only,
    i.indisunique as is_unique,
    i.indisprimary as is_primary,
    i.indisvalid as is_valid,
    i.indisready as is_ready,
    i.indislive as is_live,
    am.amname as access_method,
    (
      select array_agg(att.attname order by k.ord)
      from unnest(i.indkey::smallint[]) with ordinality k(attnum, ord)
      join pg_attribute att on att.attrelid = i.indrelid and att.attnum = k.attnum
      where k.ord <= i.indnkeyatts
    ) as key_columns,
    (
      select array_agg(att.attname order by k.ord)
      from unnest(i.indkey::smallint[]) with ordinality k(attnum, ord)
      join pg_attribute att on att.attrelid = i.indrelid and att.attnum = k.attnum
      where k.ord > i.indnkeyatts
    ) as included_columns,
    i.indexprs is not null as has_expressions,
    pg_get_expr(i.indexprs, i.indrelid) as expression_definitions,
    pg_get_expr(i.indpred, i.indrelid) as predicate,
    i.indnullsnotdistinct as nulls_not_distinct,
    pg_get_indexdef(ic.oid) as canonical_indexdef
  from pg_index i
  join pg_class cl on cl.oid = i.indrelid
  join pg_class ic on ic.oid = i.indexrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join pg_am am on am.oid = ic.relam
  where n.nspname = 'public'
    and cl.relname in (
      'people','programs','seasons','intake_batches','person_season_memberships',
      'person_season_membership_log','admin_users','admin_scope_access','admin_audit_log',
      'account_rls_package_state','account_rls_package_manifest','account_import_batches',
      'account_import_outcomes','account_auth_reconciliation','account_auth_operations',
      'account_person_auth_links','account_import_previews'
    )
  order by cl.relname, ic.relname
) sub;

\echo ---SECTION:relation_acl---
select jsonb_agg(row_to_json(sub)) from (
  select
    n.nspname as schema_name,
    c.relname as object_name,
    'relation' as object_type,
    pg_get_userbyid(c.relowner) as owner_name,
    pg_get_userbyid(a.grantor) as grantor_name,
    pg_get_userbyid(a.grantee) as grantee_name,
    a.privilege_type,
    a.is_grantable
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public'
    and c.relname in (
      'people','programs','seasons','intake_batches','person_season_memberships',
      'person_season_membership_log','admin_users','admin_scope_access','admin_audit_log',
      'account_rls_package_state','account_rls_package_manifest','account_import_batches',
      'account_import_outcomes','account_auth_reconciliation','account_auth_operations',
      'account_person_auth_links','account_import_previews'
    )
  order by c.relname, a.grantee
) sub;

\echo ---SECTION:function_acl---
select jsonb_agg(row_to_json(sub)) from (
  select
    n.nspname as schema_name,
    p.proname as object_name,
    'function' as object_type,
    pg_get_userbyid(p.proowner) as owner_name,
    pg_get_userbyid(a.grantor) as grantor_name,
    pg_get_userbyid(a.grantee) as grantee_name,
    a.privilege_type,
    a.is_grantable
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public'
    and p.proname in ('current_admin_role','is_active_admin')
  order by p.proname, a.grantee
) sub;

\echo ---SECTION:policies---
select jsonb_agg(row_to_json(sub)) from (
  select
    schemaname as schema_name,
    tablename as table_name,
    policyname as policy_name,
    cmd as command,
    permissive,
    roles,
    qual as using_expression,
    with_check as with_check_expression
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'people','admin_users','admin_scope_access','admin_audit_log','person_season_memberships'
    )
  order by tablename, policyname
) sub;

\echo ---SECTION:rls_state---
select jsonb_agg(row_to_json(sub)) from (
  select
    n.nspname as schema_name,
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'people','admin_users','admin_scope_access','admin_audit_log','person_season_memberships'
    )
  order by c.relname
) sub;

\echo ---SECTION:helper_functions---
select jsonb_agg(row_to_json(sub)) from (
  select
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_arguments(p.oid) as arguments_with_modes,
    format_type(p.prorettype, null) as return_type,
    l.lanname as language,
    p.provolatile as volatility,
    p.proparallel as parallel_mode,
    p.prosecdef as security_definer,
    p.proleakproof as is_leakproof,
    p.proisstrict as is_strict,
    pg_get_userbyid(p.proowner) as owner_name,
    p.proconfig as proconfig,
    pg_get_functiondef(p.oid) as canonical_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname in ('current_admin_role','is_active_admin')
  order by p.proname
) sub;

\echo ---SECTION:prerequisite_probe---
select jsonb_agg(row_to_json(sub)) from (
  select 'auth_schema' as evidence_id, to_regnamespace('auth') is not null as exists_bool
  union all
  select 'gen_random_uuid_function' as evidence_id, to_regprocedure('gen_random_uuid()') is not null as exists_bool
) sub;

\echo ---SECTION:session_context---
select jsonb_agg(row_to_json(sub)) from (
  select
    current_setting('server_version') as server_version,
    current_setting('transaction_read_only') as transaction_read_only,
    current_setting('statement_timeout') as statement_timeout_setting,
    current_setting('lock_timeout') as lock_timeout_setting,
    current_database() as database_name
) sub;

rollback;
