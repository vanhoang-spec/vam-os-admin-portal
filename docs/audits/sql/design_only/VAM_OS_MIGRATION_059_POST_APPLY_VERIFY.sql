-- VAM OS — MIGRATION 059 POST-APPLY VERIFIER (READ-ONLY, STAGING-ONLY)
-- package: VAM059_VERIFY_V1
--
-- Purpose: prove the exact schema AND security contract of the secured
-- migration 059 after it has been applied to staging. It writes nothing and
-- is always terminated by ROLLBACK. It authorizes nothing by itself and is
-- not an apply packet.
--
-- Environment
--   expected staging project ref : ljfneyuvpxrmejpxsmpz
--   forbidden production ref     : qkkroesfiazsejkzflcd
--
-- This verifier validates contracts, not existence. Every table is checked
-- for exact ordered columns, types, nullability and defaults; every FK for
-- its exact ON DELETE / ON UPDATE action and deferrability; every index for
-- its exact definition; both enums for exact ordered values; and both PII
-- tables for RLS enabled, RLS forced, zero policies, zero PUBLIC/anon/
-- authenticated privilege and exactly SELECT/INSERT/UPDATE/DELETE for
-- service_role with no TRUNCATE.
--
-- Rendering-robustness note. Deparsed CHECK and USING expressions are
-- compared through their exact quoted-literal sets and structural catalog
-- columns rather than through raw pg_get_constraintdef / pg_policies.qual
-- string equality. That is a deliberate carry-over of the correction made in
-- __tests__/migration-062-verifier-catalog-rendering-fix.test.ts: raw
-- deparse strings vary with parenthesisation and cast rendering and produced
-- false-negative FAILs against a schema that already matched exactly. The
-- comparison strength is unchanged — a literal set is exact and immune to
-- formatting — and both tables' raw expressions are additionally emitted
-- verbatim under "evidence" for independent inspection. Constraint and index
-- inventories are exact set equalities, so nothing unexpected can hide.
--
-- This artifact runs only AFTER migration 059 has been applied. It reads the
-- five new tables to prove they are empty, so against a database where they
-- do not exist it raises undefined_table rather than returning verified=false.
-- Either way it never reports success: run the pre-apply preflight
-- (VAM_OS_MIGRATION_059_PREFLIGHT.sql) first to establish which side of the
-- apply the database is on.
--
-- Pass criteria: overall_status = PASS, verified = true, failureCount = 0,
--                failed_assertions = [].

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '3s';

with
expected_ref(staging, production) as (values ('ljfneyuvpxrmejpxsmpz', 'qkkroesfiazsejkzflcd')),
exposed_ref as (select nullif(btrim(coalesce(current_setting('app.settings.project_ref', true), '')), '') v),

-- ============================================================
-- expected contracts (source-controlled)
-- ============================================================
expected_table(t, cols, types, nulls, defs, rls, forced) as (values
 ('applications',
  array['id','legacy_application_temp_id','person_id','season_id','role_applied','submitted_at','sbd','consent_pdpa','consent_pdpa_at','acquisition_channel','final_status','profile_url','source_sheet','source_row_id','created_at','updated_at','full_name','email_primary','phone_primary','gender','intake_batch_id','status','raw_payload','consent_data_storage','source','score_total','score_breakdown','internal_notes'],
  array['uuid','text','uuid','uuid','role_type','date','text','bool','timestamptz','text','application_status','text','text','int4','timestamptz','timestamptz','text','text','text','text','uuid','text','jsonb','bool','text','int4','jsonb','jsonb'],
  array['NO','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES','NO','NO','YES','YES','YES','YES','YES','YES','NO','NO','YES','YES','YES','NO'],
  array['gen_random_uuid()','<none>','<none>','<none>','<none>','<none>','<none>','<none>','<none>','<none>','<none>','<none>','<none>','<none>','now()','now()','<none>','<none>','<none>','<none>','<none>','''submitted''::text','''{}''::jsonb','false','''manual''::text','<none>','''{}''::jsonb','''{}''::jsonb'],
  true, true),
 ('application_answers',
  array['id','application_id','question_key','question_label','value_text','created_at'],
  array['uuid','uuid','text','text','text','timestamptz'],
  array['NO','YES','YES','YES','YES','NO'],
  array['gen_random_uuid()','<none>','<none>','<none>','<none>','now()'],
  true, true),
 ('application_reviews',
  array['id','application_id','review_round','reviewer_admin_user_id','reviewer_person_id','assigned_by','assigned_at','due_at','status','score_motivation','score_goal_clarity','score_commitment','score_fit','score_communication','total_score','recommendation','reviewer_note','submitted_at','created_at','updated_at','assignment_batch_id','claimed_at','claim_source'],
  array['uuid','uuid','text','uuid','uuid','uuid','timestamptz','timestamptz','text','int4','int4','int4','int4','int4','int4','text','text','timestamptz','timestamptz','timestamptz','uuid','timestamptz','text'],
  array['NO','NO','NO','YES','YES','YES','YES','YES','NO','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES','YES'],
  array['gen_random_uuid()','<none>','<none>','<none>','<none>','<none>','now()','<none>','''assigned''::text','<none>','<none>','<none>','<none>','<none>','<none>','<none>','<none>','<none>','now()','now()','<none>','<none>','<none>'],
  true, false),
 ('application_decisions',
  array['id','application_id','decided_by','decided_by_name','decision','previous_status','new_status','decision_note','created_at'],
  array['uuid','uuid','uuid','text','text','text','text','text','timestamptz'],
  array['NO','NO','YES','YES','NO','YES','NO','YES','YES'],
  array['gen_random_uuid()','<none>','<none>','<none>','<none>','<none>','<none>','<none>','now()'],
  true, false),
 ('review_assignment_batches',
  array['id','intake_batch_id','review_round','created_by','created_at','due_at','assignment_note','application_count','reviewer_count'],
  array['uuid','uuid','text','uuid','timestamptz','timestamptz','text','int4','int4'],
  array['NO','YES','NO','YES','NO','YES','YES','YES','YES'],
  array['gen_random_uuid()','<none>','''profile_screening''::text','<none>','now()','<none>','<none>','<none>','<none>'],
  true, false)),

-- Primary keys: one per table, on (id).
expected_pk(t, cols) as (values
 ('applications', array['id']),('application_answers', array['id']),
 ('application_reviews', array['id']),('application_decisions', array['id']),
 ('review_assignment_batches', array['id'])),

-- Unique constraints (PKs excluded).
expected_unique(t, n, cols) as (values
 ('applications','applications_legacy_application_temp_id_key', array['legacy_application_temp_id'])),

-- Foreign keys. del/upd use pg_constraint.confdeltype / confupdtype:
--   'a' = NO ACTION, 'c' = CASCADE, 'n' = SET NULL.
expected_fk(t, n, col, ref, refcol, del, upd, deferrable, deferred) as (values
 ('applications','applications_person_id_fkey','person_id','people','id','n','a',true,true),
 ('applications','applications_season_id_fkey','season_id','seasons','id','n','a',true,true),
 ('applications','applications_intake_batch_id_fkey','intake_batch_id','intake_batches','id','a','a',false,false),
 ('application_answers','application_answers_application_id_fkey','application_id','applications','id','c','a',true,true),
 ('application_reviews','application_reviews_application_id_fkey','application_id','applications','id','c','a',false,false),
 ('application_reviews','application_reviews_reviewer_admin_user_id_fkey','reviewer_admin_user_id','admin_users','id','a','a',false,false),
 ('application_reviews','application_reviews_assigned_by_fkey','assigned_by','admin_users','id','a','a',false,false),
 ('application_reviews','application_reviews_assignment_batch_id_fkey','assignment_batch_id','review_assignment_batches','id','a','a',false,false),
 ('application_decisions','application_decisions_application_id_fkey','application_id','applications','id','c','a',false,false),
 ('application_decisions','application_decisions_decided_by_fkey','decided_by','admin_users','id','a','a',false,false),
 ('review_assignment_batches','review_assignment_batches_intake_batch_id_fkey','intake_batch_id','intake_batches','id','a','a',false,false),
 ('review_assignment_batches','review_assignment_batches_created_by_fkey','created_by','admin_users','id','a','a',false,false)),

-- Vocabulary CHECK constraints, compared as exact sorted literal sets.
expected_check_vocab(t, n, vals) as (values
 ('applications','applications_status_check', array['submitted','under_data_check','ready_for_screening','screening_assigned','screening_in_progress','screening_completed','screening_passed','invited_to_meeting','invited_to_orientation','invited_to_interview','interview_scheduled','interview_in_progress','interview_completed','interview_passed','approved_as_mentor','approved_as_mentee','waitlisted','rejected_or_not_fit','needs_more_review','withdrawn']),
 ('application_reviews','application_reviews_review_round_check', array['profile_screening','interview']),
 ('application_reviews','application_reviews_status_check', array['assigned','in_progress','submitted','returned_for_clarification','cancelled']),
 ('application_reviews','application_reviews_recommendation_check', array['pass_to_interview','waitlist','reject','needs_admin_review','pass_orientation','approve_recommended']),
 ('review_assignment_batches','review_assignment_batches_round_check', array['profile_screening','interview'])),

-- Numeric range CHECK constraints (nullable 1..5 score bounds).
expected_check_range(t, n, col) as (values
 ('application_reviews','application_reviews_score_motivation_check','score_motivation'),
 ('application_reviews','application_reviews_score_goal_clarity_check','score_goal_clarity'),
 ('application_reviews','application_reviews_score_commitment_check','score_commitment'),
 ('application_reviews','application_reviews_score_fit_check','score_fit'),
 ('application_reviews','application_reviews_score_communication_check','score_communication')),

-- Exact CHECK-constraint inventory per table (no NOT NULL entries: those are
-- attnotnull, not pg_constraint rows).
expected_check_inventory(t, names) as (values
 ('applications', array['applications_status_check']),
 ('application_answers', array[]::text[]),
 ('application_reviews', array['application_reviews_recommendation_check','application_reviews_review_round_check','application_reviews_score_commitment_check','application_reviews_score_communication_check','application_reviews_score_fit_check','application_reviews_score_goal_clarity_check','application_reviews_score_motivation_check','application_reviews_status_check']),
 ('application_decisions', array[]::text[]),
 ('review_assignment_batches', array['review_assignment_batches_round_check'])),

-- Exact index inventory and definition per table. unique/primary/partial are
-- asserted from the catalog; the normalised definition pins column order,
-- expression indexes, sort direction and the partial predicate.
expected_index(t, n, uniq, prim, def) as (values
 ('applications','applications_pkey',true,true,'CREATE UNIQUE INDEX applications_pkey ON public.applications USING btree (id)'),
 ('applications','applications_legacy_application_temp_id_key',true,false,'CREATE UNIQUE INDEX applications_legacy_application_temp_id_key ON public.applications USING btree (legacy_application_temp_id)'),
 ('applications','applications_dedup_idx',false,false,'CREATE INDEX applications_dedup_idx ON public.applications USING btree (intake_batch_id, role_applied, lower(email_primary)) WHERE (email_primary IS NOT NULL)'),
 ('applications','applications_status_idx',false,false,'CREATE INDEX applications_status_idx ON public.applications USING btree (status) WHERE (status IS NOT NULL)'),
 ('applications','idx_applications_final_status',false,false,'CREATE INDEX idx_applications_final_status ON public.applications USING btree (final_status)'),
 ('applications','idx_applications_legacy_application_temp_id',false,false,'CREATE INDEX idx_applications_legacy_application_temp_id ON public.applications USING btree (legacy_application_temp_id)'),
 ('applications','idx_applications_season_id',false,false,'CREATE INDEX idx_applications_season_id ON public.applications USING btree (season_id)'),
 ('application_answers','application_answers_pkey',true,true,'CREATE UNIQUE INDEX application_answers_pkey ON public.application_answers USING btree (id)'),
 ('application_reviews','application_reviews_pkey',true,true,'CREATE UNIQUE INDEX application_reviews_pkey ON public.application_reviews USING btree (id)'),
 ('application_reviews','application_reviews_application_idx',false,false,'CREATE INDEX application_reviews_application_idx ON public.application_reviews USING btree (application_id)'),
 ('application_reviews','application_reviews_reviewer_idx',false,false,'CREATE INDEX application_reviews_reviewer_idx ON public.application_reviews USING btree (reviewer_admin_user_id) WHERE (reviewer_admin_user_id IS NOT NULL)'),
 ('application_reviews','application_reviews_status_idx',false,false,'CREATE INDEX application_reviews_status_idx ON public.application_reviews USING btree (status)'),
 ('application_reviews','application_reviews_round_idx',false,false,'CREATE INDEX application_reviews_round_idx ON public.application_reviews USING btree (review_round)'),
 ('application_reviews','application_reviews_assignment_batch_idx',false,false,'CREATE INDEX application_reviews_assignment_batch_idx ON public.application_reviews USING btree (assignment_batch_id) WHERE (assignment_batch_id IS NOT NULL)'),
 ('application_reviews','idx_application_reviews_claim_source',false,false,'CREATE INDEX idx_application_reviews_claim_source ON public.application_reviews USING btree (claim_source) WHERE (claim_source IS NOT NULL)'),
 ('application_decisions','application_decisions_pkey',true,true,'CREATE UNIQUE INDEX application_decisions_pkey ON public.application_decisions USING btree (id)'),
 ('application_decisions','application_decisions_application_idx',false,false,'CREATE INDEX application_decisions_application_idx ON public.application_decisions USING btree (application_id)'),
 ('application_decisions','application_decisions_decided_by_idx',false,false,'CREATE INDEX application_decisions_decided_by_idx ON public.application_decisions USING btree (decided_by) WHERE (decided_by IS NOT NULL)'),
 ('application_decisions','application_decisions_created_at_idx',false,false,'CREATE INDEX application_decisions_created_at_idx ON public.application_decisions USING btree (created_at DESC)'),
 ('review_assignment_batches','review_assignment_batches_pkey',true,true,'CREATE UNIQUE INDEX review_assignment_batches_pkey ON public.review_assignment_batches USING btree (id)'),
 ('review_assignment_batches','review_assignment_batches_intake_batch_idx',false,false,'CREATE INDEX review_assignment_batches_intake_batch_idx ON public.review_assignment_batches USING btree (intake_batch_id) WHERE (intake_batch_id IS NOT NULL)'),
 ('review_assignment_batches','review_assignment_batches_created_at_idx',false,false,'CREATE INDEX review_assignment_batches_created_at_idx ON public.review_assignment_batches USING btree (created_at DESC)'),
 ('review_assignment_batches','review_assignment_batches_created_by_idx',false,false,'CREATE INDEX review_assignment_batches_created_by_idx ON public.review_assignment_batches USING btree (created_by) WHERE (created_by IS NOT NULL)')),

expected_enum(n, vals) as (values
 ('role_type', array['mentor','mentee','supporter','speaker','partner_contact','donor','admin']),
 ('application_status', array['accepted','rejected_or_pending','rejected','pending','withdrawn'])),

-- Exact non-owner ACL per table, as a role -> sorted privilege map.
expected_acl(t, acl) as (values
 ('applications', '{"service_role":["DELETE","INSERT","SELECT","UPDATE"]}'::jsonb),
 ('application_answers', '{"service_role":["DELETE","INSERT","SELECT","UPDATE"]}'::jsonb),
 ('application_reviews', '{"authenticated":["SELECT"],"service_role":["DELETE","INSERT","SELECT","UPDATE"]}'::jsonb),
 ('application_decisions', '{"authenticated":["SELECT"],"service_role":["DELETE","INSERT","SELECT","UPDATE"]}'::jsonb),
 ('review_assignment_batches', '{"authenticated":["SELECT"],"service_role":["DELETE","INSERT","SELECT","UPDATE"]}'::jsonb)),

-- Policy contract for the three review workflow tables. roles is the exact
-- pg_policies.roles array; these policies were created without a TO clause,
-- so they apply to PUBLIC. vals is the exact sorted set of quoted literals
-- the USING expression must reference.
expected_policy(t, n, cmd, roles, vals) as (values
 ('application_reviews','application_reviews_read','SELECT', array['public'],
  array['active','admin','core_team','reviewer','super_admin']),
 ('application_decisions','application_decisions_read','SELECT', array['public'],
  array['admin','core_team','reviewer','super_admin']),
 ('review_assignment_batches','review_assignment_batches_read','SELECT', array['public'],
  array['admin','core_team','super_admin'])),

pii_table(t) as (values ('applications'),('application_answers')),
workflow_table(t) as (values ('application_reviews'),('application_decisions'),('review_assignment_batches')),

-- ============================================================
-- observed state
-- ============================================================
tbl as (
  select e.*, c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         pg_get_userbyid(c.relowner) owner,
         (select array_agg(x.column_name::text order by x.ordinal_position)
            from information_schema.columns x
           where x.table_schema = 'public' and x.table_name = e.t) a_cols,
         (select array_agg(x.udt_name::text order by x.ordinal_position)
            from information_schema.columns x
           where x.table_schema = 'public' and x.table_name = e.t) a_types,
         (select array_agg(x.is_nullable::text order by x.ordinal_position)
            from information_schema.columns x
           where x.table_schema = 'public' and x.table_name = e.t) a_nulls,
         (select array_agg(coalesce(x.column_default::text, '<none>') order by x.ordinal_position)
            from information_schema.columns x
           where x.table_schema = 'public' and x.table_name = e.t) a_defs
  from expected_table e
  left join pg_class c on c.oid = to_regclass('public.' || e.t)
),
-- Quoted literals of a constraint definition, order-insensitive, sorted.
con_literals as (
  select c.conrelid, c.conname, c.contype, c.convalidated,
         (select array_agg(m order by m)
            from (select distinct (regexp_matches(pg_get_constraintdef(c.oid), '''([a-zA-Z0-9_]+)''::text', 'g'))[1] m) s) vals,
         pg_get_constraintdef(c.oid) def
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
),
pol as (
  select p.tablename, p.policyname, p.permissive, p.roles::text[] roles, p.cmd,
         p.qual, p.with_check,
         (select array_agg(m order by m)
            from (select distinct (regexp_matches(coalesce(p.qual, ''), '''([a-zA-Z0-9_]+)''::text', 'g'))[1] m) s) vals
  from pg_policies p
  where p.schemaname = 'public'
),
ueh as (
  select p.id program_id, p.is_active program_active,
         s.id season_id, s.program_id season_program_id,
         b.id batch_id, b.season_id batch_season_id, b.is_active batch_active
  from public.programs p
  left join public.seasons s on s.code = 'UEHM-S12'
  left join public.intake_batches b on b.code = 'UEHM-S12-B1'
  where p.code = 'UEHM'
),
row_counts as (
  select 'applications' t, (select count(*) from public.applications) c
  union all select 'application_answers', (select count(*) from public.application_answers)
  union all select 'application_reviews', (select count(*) from public.application_reviews)
  union all select 'application_decisions', (select count(*) from public.application_decisions)
  union all select 'review_assignment_batches', (select count(*) from public.review_assignment_batches)
),

-- ============================================================
-- assertions
-- ============================================================
assertions as (
 -- ===== environment and safety =====
 select 'env:transaction_read_only' assertion,
        case when current_setting('transaction_read_only') = 'on' then 'PASS' else 'FAIL' end status
 union all select 'env:project_ref_is_expected_staging',
   case when (select v from exposed_ref) is null
          or (select v from exposed_ref) = (select staging from expected_ref)
        then 'PASS' else 'FAIL' end
 union all select 'env:project_ref_is_not_forbidden_production',
   case when (select v from exposed_ref) is distinct from (select production from expected_ref)
        then 'PASS' else 'FAIL' end

 -- ===== object inventory =====
 union all select 'inventory:table:' || t,
   case when oid is not null and relkind = 'r' and owner = current_user then 'PASS' else 'FAIL' end
   from tbl
 -- Exactly the five intended relations in the application-workflow family;
 -- no extra table, view, materialised view, sequence or partitioned table.
 union all select 'inventory:no_unexpected_relation',
   case when (select coalesce(array_agg(c.relname::text order by c.relname), array[]::text[])
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r','v','m','f','p','S')
                 and (c.relname like 'application%' or c.relname like 'review_assignment%'))
             = (select array_agg(t order by t) from expected_table)
        then 'PASS' else 'FAIL' end
 -- Migration 059 creates no function and no trigger.
 union all select 'inventory:no_unexpected_function',
   case when not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'application%' or p.proname like 'review_assignment%'
            or p.proname in ('validate_application_campaign_scope','validate_recruitment_campaign_scope'))
   ) then 'PASS' else 'FAIL' end
 union all select 'inventory:no_trigger_on_target_tables',
   case when not exists (
     select 1 from pg_trigger tg
     join pg_class c on c.oid = tg.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not tg.tgisinternal
       and c.relname in (select t from expected_table)
   ) then 'PASS' else 'FAIL' end

 -- ===== columns: exact names, types, nullability, defaults, ordering =====
 union all select 'columns:' || t,
   case when a_cols = cols and a_types = types and a_nulls = nulls and a_defs = defs
        then 'PASS' else 'FAIL' end
   from tbl

 -- ===== constraints =====
 union all select 'pk:' || e.t,
   case when (select count(*) from pg_constraint c
               where c.conrelid = to_regclass('public.' || e.t) and c.contype = 'p') = 1
         and exists (
           select 1 from pg_constraint c
           where c.conrelid = to_regclass('public.' || e.t) and c.contype = 'p'
             and (select array_agg(a.attname::text order by k.ord)
                    from unnest(c.conkey) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = e.cols)
        then 'PASS' else 'FAIL' end
   from expected_pk e
 union all select 'unique:' || e.n,
   case when exists (
     select 1 from pg_constraint c
     where c.conrelid = to_regclass('public.' || e.t) and c.contype = 'u' and c.conname = e.n
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = e.cols)
        then 'PASS' else 'FAIL' end
   from expected_unique e
 union all select 'unique_inventory',
   case when (select count(*) from pg_constraint c
               where c.conrelid in (select to_regclass('public.' || t) from expected_table)
                 and c.contype = 'u') = (select count(*) from expected_unique)
        then 'PASS' else 'FAIL' end
 -- Exact FK contract: columns, referenced relation/column, ON DELETE,
 -- ON UPDATE, deferrability and initial deferred state.
 union all select 'fk:' || e.n,
   case when exists (
     select 1 from pg_constraint c
     where c.conrelid = to_regclass('public.' || e.t) and c.contype = 'f' and c.conname = e.n
       and c.confrelid = to_regclass('public.' || e.ref)
       and c.confdeltype = e.del and c.confupdtype = e.upd
       and c.condeferrable = e.deferrable and c.condeferred = e.deferred
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = array[e.col]
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(c.confkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = array[e.refcol])
        then 'PASS' else 'FAIL' end
   from expected_fk e
 union all select 'fk_inventory',
   case when (select count(*) from pg_constraint c
               where c.conrelid in (select to_regclass('public.' || t) from expected_table)
                 and c.contype = 'f') = (select count(*) from expected_fk)
        then 'PASS' else 'FAIL' end
 -- Vocabulary CHECKs: exact sorted literal set, validated.
 union all select 'check_vocab:' || e.n,
   case when exists (
     select 1 from con_literals l
     where l.conrelid = to_regclass('public.' || e.t) and l.conname = e.n
       and l.contype = 'c' and l.convalidated
       and l.vals = (select array_agg(v order by v) from unnest(e.vals) v))
        then 'PASS' else 'FAIL' end
   from expected_check_vocab e
 -- Range CHECKs: nullable, lower bound 1, upper bound 5, on the right column.
 union all select 'check_range:' || e.n,
   case when exists (
     select 1 from con_literals l
     where l.conrelid = to_regclass('public.' || e.t) and l.conname = e.n
       and l.contype = 'c' and l.convalidated
       and l.def like '%' || e.col || ' IS NULL%'
       and l.def like '%' || e.col || ' >= 1%'
       and l.def like '%' || e.col || ' <= 5%')
        then 'PASS' else 'FAIL' end
   from expected_check_range e
 union all select 'check_inventory:' || e.t,
   case when (select coalesce(array_agg(l.conname::text order by l.conname), array[]::text[])
                from con_literals l
               where l.conrelid = to_regclass('public.' || e.t) and l.contype = 'c')
             = (select coalesce(array_agg(n order by n), array[]::text[]) from unnest(e.names) n)
        then 'PASS' else 'FAIL' end
   from expected_check_inventory e

 -- ===== indexes =====
 union all select 'index:' || e.n,
   case when exists (
     select 1 from pg_index i
     join pg_class ic on ic.oid = i.indexrelid
     where i.indrelid = to_regclass('public.' || e.t) and ic.relname = e.n
       and i.indisunique = e.uniq and i.indisprimary = e.prim
       and i.indisvalid and i.indisready and i.indislive
       and btrim(regexp_replace(pg_get_indexdef(i.indexrelid), '[[:space:]]+', ' ', 'g'))
           = btrim(regexp_replace(e.def, '[[:space:]]+', ' ', 'g')))
        then 'PASS' else 'FAIL' end
   from expected_index e
 union all select 'index_inventory:' || e.t,
   case when (select coalesce(array_agg(ic.relname::text order by ic.relname), array[]::text[])
                from pg_index i join pg_class ic on ic.oid = i.indexrelid
               where i.indrelid = to_regclass('public.' || e.t))
             = (select array_agg(x.n order by x.n) from expected_index x where x.t = e.t)
        then 'PASS' else 'FAIL' end
   from expected_table e

 -- ===== enums: exact ordered values =====
 union all select 'enum:' || e.n,
   case when exists (
     select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = e.n and t.typtype = 'e'
       and array(select en.enumlabel::text from pg_enum en
                  where en.enumtypid = t.oid order by en.enumsortorder) = e.vals)
        then 'PASS' else 'FAIL' end
   from expected_enum e

 -- ===== security: exact RLS state on all five tables =====
 -- applications / application_answers: enabled AND forced.
 -- the three review workflow tables: enabled, NOT forced.
 union all select 'security:rls_state:' || t,
   case when relrowsecurity = rls and relforcerowsecurity = forced then 'PASS' else 'FAIL' end
   from tbl

 -- ===== security: applications / application_answers (PII) =====
 union all select 'security:zero_policies_on_pii_tables',
   case when not exists (select 1 from pol where tablename in (select t from pii_table))
        then 'PASS' else 'FAIL' end
 -- Belt and braces over the ACL check below: has_table_privilege also
 -- resolves privileges inherited through PUBLIC and role membership.
 union all select 'security:no_effective_privilege:' || r.role_name || ':' || p.t,
   case when not exists (
     select 1 from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                           ('TRUNCATE'),('REFERENCES'),('TRIGGER')) x(priv)
     where has_table_privilege(r.role_name, 'public.' || p.t, x.priv))
        then 'PASS' else 'FAIL' end
   from pii_table p cross join (values ('anon'),('authenticated')) r(role_name)
 union all select 'security:service_role_exact_dml:' || t,
   case when has_table_privilege('service_role', 'public.' || t, 'SELECT')
         and has_table_privilege('service_role', 'public.' || t, 'INSERT')
         and has_table_privilege('service_role', 'public.' || t, 'UPDATE')
         and has_table_privilege('service_role', 'public.' || t, 'DELETE')
         and not has_table_privilege('service_role', 'public.' || t, 'TRUNCATE')
         and not has_table_privilege('service_role', 'public.' || t, 'REFERENCES')
         and not has_table_privilege('service_role', 'public.' || t, 'TRIGGER')
        then 'PASS' else 'FAIL' end
   from pii_table

 -- ===== security: the three review workflow tables =====
 union all select 'security:policy:' || e.n,
   case when (select count(*) from pol p where p.tablename = e.t and p.policyname = e.n) = 1
         and exists (
           select 1 from pol p
           where p.tablename = e.t and p.policyname = e.n
             and p.permissive = 'PERMISSIVE' and p.cmd = e.cmd
             and p.roles = e.roles
             and p.with_check is null
             and p.qual is not null
             and p.qual like '%is_admin_role%'
             and p.vals = (select array_agg(v order by v) from unnest(e.vals) v))
        then 'PASS' else 'FAIL' end
   from expected_policy e
 union all select 'security:policy_inventory',
   case when (select coalesce(array_agg(p.policyname::text order by p.policyname), array[]::text[])
                from pol p where p.tablename in (select t from expected_table))
             = (select array_agg(n order by n) from expected_policy)
        then 'PASS' else 'FAIL' end
 union all select 'security:no_anon_privilege:' || t,
   case when not exists (
     select 1 from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                           ('TRUNCATE'),('REFERENCES'),('TRIGGER')) x(priv)
     where has_table_privilege('anon', 'public.' || t, x.priv))
        then 'PASS' else 'FAIL' end
   from workflow_table
 union all select 'security:authenticated_read_only:' || t,
   case when has_table_privilege('authenticated', 'public.' || t, 'SELECT')
         and not exists (
           select 1 from (values ('INSERT'),('UPDATE'),('DELETE'),
                                 ('TRUNCATE'),('REFERENCES'),('TRIGGER')) x(priv)
           where has_table_privilege('authenticated', 'public.' || t, x.priv))
        then 'PASS' else 'FAIL' end
   from workflow_table

 -- ===== security: exact non-owner ACL on all five tables =====
 union all select 'security:acl:' || e.t,
   case when coalesce((
     select jsonb_object_agg(s.grantee_name, s.privs) from (
       select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') grantee_name,
              jsonb_agg(distinct a.privilege_type order by a.privilege_type) privs
       from pg_class c cross join lateral aclexplode(c.relacl) a
       where c.oid = to_regclass('public.' || e.t)
         and coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') <> current_user
       group by 1
     ) s), '{}'::jsonb) = e.acl
        then 'PASS' else 'FAIL' end
   from expected_acl e

 -- ===== initial data state =====
 union all select 'initial:empty:' || t,
   case when c = 0 then 'PASS' else 'FAIL' end from row_counts
 union all select 'initial:uehm_s12_b1_linkage_intact',
   case when exists (
     select 1 from ueh
     where program_active and season_id is not null and season_program_id = program_id
       and batch_id is not null and batch_season_id = season_id and batch_active)
        then 'PASS' else 'FAIL' end
 -- No pre-existing table gained a dependency on the new objects beyond the
 -- FKs this migration declares: the five new tables are referenced only by
 -- each other.
 union all select 'initial:no_unrelated_table_references_new_objects',
   case when not exists (
     select 1 from pg_constraint c
     join pg_class rel on rel.oid = c.conrelid
     join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and c.contype = 'f'
       and c.confrelid in (select to_regclass('public.' || t) from expected_table)
       and rel.relname not in (select t from expected_table))
        then 'PASS' else 'FAIL' end

 -- ===== compatibility: migrations 062 and 063 still hold =====
 union all select 'compat:m062_functions_present',
   case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') = 11
        then 'PASS' else 'FAIL' end
 union all select 'compat:m062_policies_present',
   case when (select count(*) from pg_policies
              where schemaname = 'public' and policyname like 'vam062\_%') = 7
        then 'PASS' else 'FAIL' end
 union all select 'compat:m062_membership_rls_enabled',
   case when exists (
     select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'person_season_memberships' and c.relrowsecurity
   ) then 'PASS' else 'FAIL' end
 union all select 'compat:m062_scope_arbiter_intact',
   case when exists (
     select 1 from pg_index i join pg_class c on c.oid = i.indrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'admin_scope_access'
       and i.indisunique and i.indisvalid and i.indisready
       and not i.indnullsnotdistinct and i.indnkeyatts = 4
       and i.indpred is not null
       and pg_get_expr(i.indpred, i.indrelid) = '(status = ''active''::text)'
       and i.indexprs is not null
       and pg_get_expr(i.indexprs, i.indrelid) = 'COALESCE(program_id, ''''::text), COALESCE(season_id, ''''::text)'
   ) then 'PASS' else 'FAIL' end
 union all select 'compat:m062_affected_tables_hardened',
   case when not exists (
     select 1 from (values ('admin_users'),('admin_scope_access'),('admin_audit_log'),('people'),
                           ('person_season_memberships'),('intake_batches'),
                           ('person_season_membership_log')) x(t)
     join pg_class c on c.oid = to_regclass('public.' || x.t)
     where not c.relrowsecurity
        or has_table_privilege('anon', 'public.' || x.t, 'SELECT')
        or has_table_privilege('authenticated', 'public.' || x.t, 'INSERT')
        or not has_table_privilege('authenticated', 'public.' || x.t, 'SELECT'))
        then 'PASS' else 'FAIL' end
 union all select 'compat:m063_functions_present',
   case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam063\_%') = 9
        then 'PASS' else 'FAIL' end
 union all select 'compat:m063_entrypoint_grants_intact',
   case when not exists (
     select 1 from (values
       ('public.vam063_pause_membership(uuid,uuid,text)'),
       ('public.vam063_withdraw_membership(uuid,uuid,text)'),
       ('public.vam063_opt_out_membership(uuid,uuid,text)'),
       ('public.vam063_cancel_membership(uuid,uuid,text)'),
       ('public.vam063_reactivate_membership(uuid,uuid,text)'),
       ('public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)'),
       ('public.vam063_remove_membership_role(uuid,uuid,text)')
     ) x(sig)
     where to_regprocedure(x.sig) is null
        or not has_function_privilege('service_role', to_regprocedure(x.sig), 'execute')
        or has_function_privilege('anon', to_regprocedure(x.sig), 'execute')
        or has_function_privilege('authenticated', to_regprocedure(x.sig), 'execute'))
        then 'PASS' else 'FAIL' end
),
normalized as (select assertion, status::text status from assertions)

select jsonb_build_object(
  'package', 'VAM059_VERIFY_V1',
  'read_only', true,
  'transaction_read_only', current_setting('transaction_read_only'),
  'expected_staging_ref', (select staging from expected_ref),
  'forbidden_production_ref', (select production from expected_ref),
  'owner_must_verify_project_ref', true,
  'overall_status', case when bool_and(status = 'PASS') then 'PASS' else 'FAIL' end,
  'verified', bool_and(status = 'PASS'),
  'failureCount', count(*) filter (where status <> 'PASS'),
  'schema_verified', coalesce(bool_and(status = 'PASS') filter (
    where assertion like 'columns:%' or assertion like 'pk:%' or assertion like 'unique%'
       or assertion like 'fk%' or assertion like 'check_%' or assertion like 'index%'
       or assertion like 'enum:%'), false),
  'security_verified', coalesce(bool_and(status = 'PASS') filter (where assertion like 'security:%'), false),
  'migration_062_verified', coalesce(bool_and(status = 'PASS') filter (where assertion like 'compat:m062%'), false),
  'migration_063_verified', coalesce(bool_and(status = 'PASS') filter (where assertion like 'compat:m063%'), false),
  'assertions', jsonb_agg(jsonb_build_object('assertion', assertion, 'status', status) order by assertion),
  'failed_assertions', coalesce(jsonb_agg(assertion order by assertion) filter (where status <> 'PASS'), '[]'::jsonb),
  'evidence', jsonb_build_object(
    'note', 'Verbatim deparsed expressions, emitted for independent inspection. Never scored.',
    'policy_quals', coalesce((
      select jsonb_object_agg(p.policyname, jsonb_build_object('table', p.tablename, 'cmd', p.cmd,
                                                              'roles', to_jsonb(p.roles),
                                                              'using', p.qual, 'with_check', p.with_check))
        from pol p where p.tablename in (select t from expected_table)), '{}'::jsonb),
    'check_definitions', coalesce((
      select jsonb_object_agg(l.conname, l.def) from con_literals l
       where l.contype = 'c'
         and l.conrelid in (select to_regclass('public.' || t) from expected_table)), '{}'::jsonb),
    'non_owner_acls', coalesce((
      select jsonb_object_agg(x.t, x.acl) from (
        select e.t, coalesce((
          select jsonb_object_agg(s.grantee_name, s.privs) from (
            select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') grantee_name,
                   jsonb_agg(distinct a.privilege_type order by a.privilege_type) privs
            from pg_class c cross join lateral aclexplode(c.relacl) a
            where c.oid = to_regclass('public.' || e.t)
              and coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') <> current_user
            group by 1
          ) s), '{}'::jsonb) acl
        from expected_table e
      ) x), '{}'::jsonb)
  )
) migration_059_post_apply_verify_v1
from normalized;

ROLLBACK;
