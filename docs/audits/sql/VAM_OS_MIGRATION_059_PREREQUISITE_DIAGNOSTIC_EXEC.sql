-- VAM OS — MIGRATION 059 PREREQUISITE DIAGNOSTIC — EXECUTION PACKET
-- packet: VAM059_PREREQ_DIAGNOSTIC_EXEC_V1
--
-- COMPLETE AND SELF-CONTAINED. Copy this whole file into the Supabase SQL
-- Editor and run it exactly as committed. It needs no manual step, no
-- additional statement, no psql \i include, no external file and no
-- previously prepared session.
--
-- ------------------------------------------------------------
-- ONE HUMAN CONTROL, IMMEDIATELY BEFORE YOU RUN THIS
-- ------------------------------------------------------------
--   Look at the Supabase dashboard URL in your browser and confirm the
--   project ref reads exactly:
--
--       ljfneyuvpxrmejpxsmpz
--
--   If it reads qkkroesfiazsejkzflcd, or anything else, stop and close this
--   file. The attestation inside the transaction below records that you
--   performed this check.
-- ------------------------------------------------------------
--
-- WHY THIS PACKET EXISTS
--   The reviewed owner preflight
--   docs/audits/sql/VAM_OS_MIGRATION_059_OWNER_PREFLIGHT_EXEC.sql
--   returned overall_status = FAIL with exactly two failed assertions:
--     prerequisite:fk_targets_unique
--     prerequisite:is_admin_role_text_array
--   Every environment, catalog, conflict, security, migration-062 and
--   migration-063 assertion passed. This packet gathers the catalog evidence
--   needed to decide, per failure, whether the database is genuinely missing
--   a prerequisite or whether the assertion itself is too narrow. It changes
--   nothing and authorises nothing.
--
-- WHAT IT READS
--   pg_catalog and nothing else. No business table is read, no row is
--   counted, and no application data, personal data or credential can appear
--   in the output. The only names emitted are catalog object names, type
--   names, attribute numbers and function parameter names.
--
-- WHAT IT EMITS
--   One row, one JSONB column:
--     project_identity           - class of each identity source
--     replicated_assertions      - the two failing predicates, re-evaluated
--                                  here verbatim, so this packet's reading is
--                                  provably the same as the preflight's
--     fk_target_evidence         - per target column: type, attnum, notnull,
--                                  every PK/UNIQUE constraint, every index,
--                                  and the two independent uniqueness verdicts
--     is_admin_role_evidence     - every overload's catalog signature
--     classification             - one of ASSERTION_FALSE_NEGATIVE,
--                                  REAL_PREREQUISITE_MISMATCH, AMBIGUOUS
--                                  for each failure, by deterministic rule
--
-- CLASSIFICATION RULES (applied in order, per failure)
--   fk_targets_unique
--     REAL_PREREQUISITE_MISMATCH  a target table or its id column is absent,
--                                 or a target has no FK-eligible unique index
--     ASSERTION_FALSE_NEGATIVE    every target has an FK-eligible unique
--                                 index, but at least one has no exact
--                                 single-column PRIMARY KEY / UNIQUE
--                                 constraint. PostgreSQL accepts a bare
--                                 unique index as a foreign-key target; the
--                                 preflight assertion only accepts a
--                                 pg_constraint row, so it is the narrower of
--                                 the two.
--     AMBIGUOUS                   both hold everywhere, so the assertion
--                                 should have passed and something else is
--                                 involved
--   is_admin_role_text_array
--     REAL_PREREQUISITE_MISMATCH  public.is_admin_role(text[]) is not
--                                 callable at all
--     ASSERTION_FALSE_NEGATIVE    it is callable, but no overload renders
--                                 pg_get_function_arguments() as exactly
--                                 'roles text[]'. That comparison includes
--                                 the PARAMETER NAME, which does not affect
--                                 call resolution.
--     AMBIGUOUS                   it is callable and some overload does
--                                 render as 'roles text[]'
--
-- Effect: READ ONLY. One transaction, always terminated by ROLLBACK, never
--   committed. Writes nothing. No DDL, no DML.

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '3s';

-- Owner attestation of the connected project. Transaction-local, and rolled
-- back with everything else. Present as committed bytes so this packet runs
-- exactly as reviewed. The forbidden production ref qkkroesfiazsejkzflcd is
-- rejected below: if it is ever observed, the packet withholds all catalog
-- evidence and reports refused = true instead.
SET LOCAL vam059.attested_project_ref = 'ljfneyuvpxrmejpxsmpz';

with
expected_ref(staging, production) as (values ('ljfneyuvpxrmejpxsmpz', 'qkkroesfiazsejkzflcd')),
platform_ref as (select nullif(btrim(coalesce(current_setting('app.settings.project_ref', true), '')), '') v),
attested_ref as (select nullif(btrim(coalesce(current_setting('vam059.attested_project_ref', true), '')), '') v),
identity as (
  select
    case when p.v is null then 'absent'
         when p.v = r.staging then 'expected_staging'
         when p.v = r.production then 'forbidden_production'
         else 'other' end platform_class,
    case when a.v is null then 'absent'
         when a.v = r.staging then 'expected_staging'
         when a.v = r.production then 'forbidden_production'
         else 'other' end attested_class
  from expected_ref r, platform_ref p, attested_ref a
),
-- Fail closed: evidence is emitted only when identity is proven staging and
-- neither source reads as the forbidden production ref.
identity_ok as (
  select (select platform_class from identity) <> 'forbidden_production'
     and (select attested_class from identity) <> 'forbidden_production'
     and ((select platform_class from identity) = 'expected_staging'
       or (select attested_class from identity) = 'expected_staging')
     and ((select platform_class from identity) = 'absent'
       or (select attested_class from identity) = 'absent'
       or (select platform_class from identity) = (select attested_class from identity)) v
),

-- ============================================================
-- the two failing predicates, replicated verbatim
-- ============================================================
-- Copied character for character from the owner preflight packet so this
-- diagnostic provably reproduces what that run computed.
replicated as (
  select
    (not exists (
      select 1 from (values ('people'),('seasons'),('intake_batches'),('admin_users')) x(t)
      where not exists (
        select 1 from pg_constraint c
        where c.conrelid = to_regclass('public.' || x.t)
          and c.contype in ('p','u')
          and c.conkey = array[(
            select a.attnum from pg_attribute a
            where a.attrelid = c.conrelid and a.attname = 'id'
          )]
      )
    )) fk_targets_unique,
    (exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_admin_role'
        and pg_get_function_arguments(p.oid) = 'roles text[]'
    )) is_admin_role_text_array
),

-- ============================================================
-- foreign-key target evidence
-- ============================================================
fk_target(t) as (values ('people'),('seasons'),('intake_batches'),('admin_users')),
target_col as (
  select x.t,
         to_regclass('public.' || x.t) rel,
         a.attnum,
         a.attnotnull,
         format_type(a.atttypid, a.atttypmod) data_type
  from fk_target x
  left join pg_attribute a
    on a.attrelid = to_regclass('public.' || x.t)
   and a.attname = 'id' and a.attnum > 0 and not a.attisdropped
),
-- Every PRIMARY KEY / UNIQUE constraint on the target, with the catalog
-- fields that decide whether it could back a foreign key.
target_con as (
  select tc.t,
         c.conname::text conname,
         c.contype::text contype,
         c.conkey,
         c.convalidated,
         c.condeferrable,
         c.condeferred,
         (c.contype in ('p','u') and c.conkey = array[tc.attnum]) exact_single_column_on_id
  from target_col tc
  join pg_constraint c on c.conrelid = tc.rel and c.contype in ('p','u')
),
-- Every index on the target. Key columns are read from indkey positionally so
-- an expression key (attnum 0) and any INCLUDE column are both visible.
target_idx as (
  select tc.t,
         ic.relname::text indexname,
         i.indisunique, i.indisprimary, i.indisvalid, i.indisready, i.indimmediate,
         i.indnkeyatts, i.indnatts, i.indnullsnotdistinct,
         (select array_agg(k.attnum order by k.ord)
            from unnest(string_to_array(i.indkey::text, ' ')::smallint[]) with ordinality k(attnum, ord)
           where k.ord <= i.indnkeyatts) key_attnums,
         (select array_agg(coalesce(a2.attname::text, '<expression>') order by k.ord)
            from unnest(string_to_array(i.indkey::text, ' ')::smallint[]) with ordinality k(attnum, ord)
            left join pg_attribute a2 on a2.attrelid = i.indrelid and a2.attnum = k.attnum and k.attnum > 0
           where k.ord <= i.indnkeyatts) key_columns,
         case when i.indpred is not null then pg_get_expr(i.indpred, i.indrelid) end partial_predicate,
         case when i.indexprs is not null then pg_get_expr(i.indexprs, i.indrelid) end index_expression,
         -- PostgreSQL's own rule for a usable foreign-key target: a unique,
         -- valid, ready, immediate index over exactly one key column, that
         -- column being id, with no partial predicate and no expression.
         -- Composite, partial and expression indexes are all excluded here.
         (i.indisunique
          and i.indisvalid
          and i.indisready
          and i.indimmediate
          and i.indpred is null
          and i.indexprs is null
          and i.indnkeyatts = 1
          and tc.attnum is not null
          and (string_to_array(i.indkey::text, ' ')::smallint[])[1] = tc.attnum) fk_eligible
  from target_col tc
  join pg_index i on i.indrelid = tc.rel
  join pg_class ic on ic.oid = i.indexrelid
),
fk_summary as (
  select tc.t,
         (tc.rel is not null) table_present,
         (tc.attnum is not null) id_column_present,
         tc.attnum, tc.attnotnull, tc.data_type,
         coalesce((select bool_or(c.exact_single_column_on_id) from target_con c where c.t = tc.t), false)
           has_exact_single_column_unique_constraint,
         coalesce((select bool_or(x.fk_eligible) from target_idx x where x.t = tc.t), false)
           has_fk_eligible_unique_index
  from target_col tc
),

-- ============================================================
-- public.is_admin_role evidence
-- ============================================================
fn as (
  select p.oid,
         n.nspname::text schema_name,
         p.proname::text proname,
         p.prokind::text prokind,
         pg_get_function_identity_arguments(p.oid) identity_arguments,
         pg_get_function_arguments(p.oid) declared_arguments,
         oidvectortypes(p.proargtypes) arg_type_vector,
         (select array_agg(u.t order by u.ord)
            from unnest(string_to_array(nullif(p.proargtypes::text, ''), ' ')::oid[]) with ordinality u(t, ord)) arg_type_oids,
         (select array_agg(format_type(u.t, null) order by u.ord)
            from unnest(string_to_array(nullif(p.proargtypes::text, ''), ' ')::oid[]) with ordinality u(t, ord)) arg_type_names,
         p.proargnames,
         p.proargmodes::text[] proargmodes,
         p.pronargs,
         p.pronargdefaults,
         (p.provariadic <> 0) is_variadic,
         pg_get_function_result(p.oid) result_type,
         format_type(p.prorettype, null) return_type,
         p.prosecdef,
         p.provolatile::text provolatile,
         pg_get_userbyid(p.proowner)::text owner_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_admin_role'
),
fn_facts as (
  select (select count(*) from fn) overload_count,
         (to_regprocedure('public.is_admin_role(text[])') is not null) exact_identity_exists,
         exists (select 1 from fn where identity_arguments = 'text[]') identity_arguments_match,
         exists (select 1 from fn where declared_arguments = 'roles text[]') declared_arguments_match
),

-- ============================================================
-- deterministic classification
-- ============================================================
classification as (
  select
    case
      when exists (select 1 from fk_summary where not table_present or not id_column_present)
        then 'REAL_PREREQUISITE_MISMATCH'
      when exists (select 1 from fk_summary where not has_fk_eligible_unique_index)
        then 'REAL_PREREQUISITE_MISMATCH'
      when exists (select 1 from fk_summary where not has_exact_single_column_unique_constraint)
        then 'ASSERTION_FALSE_NEGATIVE'
      else 'AMBIGUOUS'
    end fk_targets_unique,
    case
      when not (select exact_identity_exists from fn_facts)
        then 'REAL_PREREQUISITE_MISMATCH'
      when not (select declared_arguments_match from fn_facts)
        then 'ASSERTION_FALSE_NEGATIVE'
      else 'AMBIGUOUS'
    end is_admin_role_text_array
)

select case when (select v from identity_ok) then jsonb_build_object(
  'packet', 'VAM059_PREREQ_DIAGNOSTIC_EXEC_V1',
  'read_only', true,
  'refused', false,
  'transaction_read_only', current_setting('transaction_read_only'),
  'expected_staging_ref', (select staging from expected_ref),
  'forbidden_production_ref', (select production from expected_ref),
  'project_identity', jsonb_build_object(
    'platform_class', (select platform_class from identity),
    'attested_class', (select attested_class from identity),
    'attestation_set_by_this_file', true
  ),
  'replicated_assertions', jsonb_build_object(
    'prerequisite:fk_targets_unique', (select fk_targets_unique from replicated),
    'prerequisite:is_admin_role_text_array', (select is_admin_role_text_array from replicated)
  ),
  'fk_target_evidence', coalesce((
    select jsonb_object_agg(s.t, jsonb_build_object(
      'table', 'public.' || s.t,
      'column', 'id',
      'table_present', s.table_present,
      'id_column_present', s.id_column_present,
      'data_type', s.data_type,
      'attnum', s.attnum,
      'not_null', s.attnotnull,
      'unique_constraints', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', c.conname, 'contype', c.contype, 'conkey', to_jsonb(c.conkey),
          'validated', c.convalidated, 'deferrable', c.condeferrable, 'deferred', c.condeferred,
          'exact_single_column_on_id', c.exact_single_column_on_id
        ) order by c.conname) from target_con c where c.t = s.t), '[]'::jsonb),
      'indexes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', x.indexname,
          'is_unique', x.indisunique, 'is_primary', x.indisprimary,
          'is_valid', x.indisvalid, 'is_ready', x.indisready, 'is_immediate', x.indimmediate,
          'nkeyatts', x.indnkeyatts, 'natts', x.indnatts,
          'nulls_not_distinct', x.indnullsnotdistinct,
          'key_attnums', to_jsonb(x.key_attnums), 'key_columns', to_jsonb(x.key_columns),
          'partial_predicate', x.partial_predicate,
          'index_expression', x.index_expression,
          'fk_eligible', x.fk_eligible
        ) order by x.indexname) from target_idx x where x.t = s.t), '[]'::jsonb),
      'has_exact_single_column_unique_constraint', s.has_exact_single_column_unique_constraint,
      'has_fk_eligible_unique_index', s.has_fk_eligible_unique_index
    )) from fk_summary s), '{}'::jsonb),
  'is_admin_role_evidence', jsonb_build_object(
    'overload_count', (select overload_count from fn_facts),
    'exact_identity_exists', (select exact_identity_exists from fn_facts),
    'identity_arguments_match_text_array', (select identity_arguments_match from fn_facts),
    'declared_arguments_match_roles_text_array', (select declared_arguments_match from fn_facts),
    'overloads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'schema', f.schema_name, 'name', f.proname, 'oid', f.oid::bigint, 'prokind', f.prokind,
        'identity_arguments', f.identity_arguments,
        'declared_arguments', f.declared_arguments,
        'arg_type_vector', f.arg_type_vector,
        'arg_type_oids', to_jsonb(f.arg_type_oids),
        'arg_type_names', to_jsonb(f.arg_type_names),
        'arg_names', to_jsonb(f.proargnames),
        'arg_modes', to_jsonb(f.proargmodes),
        'nargs', f.pronargs, 'ndefaults', f.pronargdefaults, 'is_variadic', f.is_variadic,
        'result_type', f.result_type, 'return_type', f.return_type,
        'security_definer', f.prosecdef, 'volatility', f.provolatile, 'owner', f.owner_name
      ) order by f.identity_arguments) from fn f), '[]'::jsonb)
  ),
  'classification', jsonb_build_object(
    'prerequisite:fk_targets_unique', (select fk_targets_unique from classification),
    'prerequisite:is_admin_role_text_array', (select is_admin_role_text_array from classification)
  ),
  'business_rows_read', 0,
  'authorises_nothing', true
) else jsonb_build_object(
  'packet', 'VAM059_PREREQ_DIAGNOSTIC_EXEC_V1',
  'read_only', true,
  'refused', true,
  'reason', 'project identity not proven to be the expected staging project, or the forbidden production ref was observed',
  'project_identity', jsonb_build_object(
    'platform_class', (select platform_class from identity),
    'attested_class', (select attested_class from identity)
  ),
  'evidence_withheld', true,
  'authorises_nothing', true
) end migration_059_prerequisite_diagnostic_v1;

ROLLBACK;
