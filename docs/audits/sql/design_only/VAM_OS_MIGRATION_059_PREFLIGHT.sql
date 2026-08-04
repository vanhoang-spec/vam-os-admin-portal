-- VAM OS — MIGRATION 059 PRE-APPLY PREFLIGHT (READ-ONLY, STAGING-ONLY)
-- package: VAM059_PREFLIGHT_V1
--
-- Purpose: one read-only, fail-closed gate that decides whether the secured
-- migration 059 (supabase_migrations/059_staging_application_workflow_bootstrap.sql)
-- may be applied to staging. It writes nothing and is always terminated by
-- ROLLBACK. It authorizes nothing by itself.
--
-- Environment
--   expected staging project ref : ljfneyuvpxrmejpxsmpz
--   forbidden production ref     : qkkroesfiazsejkzflcd
--
-- ============================================================
-- PROJECT IDENTITY — FAIL CLOSED
-- ============================================================
-- Target identity must be PROVEN, never assumed. Identity is read from two
-- independent, owner-controlled sources, each classified into exactly one of
-- absent / expected_staging / forbidden_production / other:
--
--   platform  : current_setting('app.settings.project_ref', true)
--   attested  : current_setting('vam059.attested_project_ref', true)
--
-- The verdict is looked up from the exhaustive 16-row identity_class truth
-- table below. Only three combinations return PASS, and all three require at
-- least one source to read exactly ljfneyuvpxrmejpxsmpz while the other is
-- either absent or the same exact value. Everything else — no source at all,
-- an empty string, the forbidden production ref, an unrelated ref, or two
-- sources that disagree — returns FAIL, and eligible is bool_and over every
-- assertion, so eligible becomes false.
--
-- The expected ref hard-coded in this file is the comparison target, not
-- evidence of what is connected. It proves nothing on its own.
--
-- conflict:* and env:not_production_topology remain SECONDARY guards only.
-- They are additional ANDed assertions; because eligibility is a conjunction,
-- no structural observation can ever substitute for, or compensate for, a
-- failed identity assertion. Object absence, database name and current_user
-- are never treated as proof of staging identity.
--
-- ------------------------------------------------------------
-- EXECUTION INSTRUCTIONS (owner-run, staging only)
-- ------------------------------------------------------------
--   1. Open the Supabase dashboard and VISUALLY CONFIRM the project ref in
--      the browser URL reads exactly ljfneyuvpxrmejpxsmpz. If it reads
--      qkkroesfiazsejkzflcd, or anything else, stop — do not run this file.
--   2. Paste this file into the SQL editor of that confirmed project.
--   3. Supabase's SQL editor does not expose app.settings.project_ref. Where
--      it is absent, the owner must supply the transaction-local attestation
--      deliberately, by typing exactly one additional statement immediately
--      after the "SET LOCAL lock_timeout" line below:
--
--        SET LOCAL vam059.attested_project_ref = 'ljfneyuvpxrmejpxsmpz';
--
--      This file NEVER sets, defaults or fabricates that attestation. As
--      committed it contains no attestation statement, so running it
--      unmodified against a project that does not expose
--      app.settings.project_ref reports eligible=false by design.
--   4. Read project_identity in the output. It reports the class of each
--      source and which route proved identity.
--
-- owner_must_verify_project_ref is always emitted as true: step 1 is a human
-- control that no in-database assertion can replace.
--
-- Eligibility is deliberately NOT derived from the default-privilege
-- evidence. Ambient Supabase default ACLs will normally grant new public
-- tables to anon and authenticated, and that is expected. The protection
-- comes from the amended migration's own explicit REVOKE/GRANT contract
-- (PHASE 8) executed inside the migration transaction, which additionally
-- re-verifies itself before COMMIT. The safety:* assertions below prove the
-- preconditions that contract requires and cannot pass vacuously.
--
-- The committed migration this preflight is bound to is identified by
-- migration_059_sha256 in the output; __tests__/migration-059-secure-
-- application-bootstrap.test.ts enforces that binding offline.
--
-- Pass criteria: overall_status = PASS, eligible = true, failureCount = 0,
--                failed_assertions = [].

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '3s';

with
-- ---------- expected contracts (source-controlled) ----------
expected_ref(staging, production) as (values ('ljfneyuvpxrmejpxsmpz', 'qkkroesfiazsejkzflcd')),
-- Exhaustive identity verdict table: 4 platform classes x 4 attested classes.
-- Source-controlled data rather than nested conditionals, so every one of the
-- sixteen combinations is stated explicitly and auditable. Exactly three
-- return PASS; there is no default branch that could pass by omission.
identity_class(platform, attested, verdict) as (values
 ('absent','absent','FAIL'),
 ('absent','expected_staging','PASS'),
 ('absent','forbidden_production','FAIL'),
 ('absent','other','FAIL'),
 ('expected_staging','absent','PASS'),
 ('expected_staging','expected_staging','PASS'),
 ('expected_staging','forbidden_production','FAIL'),
 ('expected_staging','other','FAIL'),
 ('forbidden_production','absent','FAIL'),
 ('forbidden_production','expected_staging','FAIL'),
 ('forbidden_production','forbidden_production','FAIL'),
 ('forbidden_production','other','FAIL'),
 ('other','absent','FAIL'),
 ('other','expected_staging','FAIL'),
 ('other','forbidden_production','FAIL'),
 ('other','other','FAIL')),
target_table(t) as (values
 ('applications'),('application_answers'),('application_reviews'),
 ('application_decisions'),('review_assignment_batches')),
target_index(n) as (values
 ('applications_pkey'),('applications_legacy_application_temp_id_key'),
 ('applications_dedup_idx'),('applications_status_idx'),
 ('idx_applications_final_status'),('idx_applications_legacy_application_temp_id'),
 ('idx_applications_season_id'),
 ('application_answers_pkey'),
 ('application_reviews_pkey'),('application_reviews_application_idx'),
 ('application_reviews_reviewer_idx'),('application_reviews_status_idx'),
 ('application_reviews_round_idx'),('application_reviews_assignment_batch_idx'),
 ('idx_application_reviews_claim_source'),
 ('application_decisions_pkey'),('application_decisions_application_idx'),
 ('application_decisions_decided_by_idx'),('application_decisions_created_at_idx'),
 ('review_assignment_batches_pkey'),('review_assignment_batches_intake_batch_idx'),
 ('review_assignment_batches_created_at_idx'),('review_assignment_batches_created_by_idx')),
target_constraint(n) as (values
 ('applications_pkey'),('applications_legacy_application_temp_id_key'),
 ('applications_person_id_fkey'),('applications_season_id_fkey'),
 ('applications_intake_batch_id_fkey'),('applications_status_check'),
 ('application_answers_pkey'),('application_answers_application_id_fkey'),
 ('application_reviews_review_round_check'),('application_reviews_status_check'),
 ('application_reviews_recommendation_check'),
 ('application_reviews_score_motivation_check'),
 ('application_reviews_score_goal_clarity_check'),
 ('application_reviews_score_commitment_check'),
 ('application_reviews_score_fit_check'),
 ('application_reviews_score_communication_check'),
 ('application_reviews_assignment_batch_id_fkey'),
 ('review_assignment_batches_round_check')),
target_policy(n) as (values
 ('read_applications_review_roles'),('application_reviews_read'),
 ('application_decisions_read'),('review_assignment_batches_read')),
-- Triggers migration 059 must not collide with. 059 creates none itself; the
-- design-only, blocked migration 061 would install applications_campaign_scope_guard.
target_trigger(n) as (values ('applications_campaign_scope_guard')),
-- Functions migration 059 must not collide with. 059 creates none; these are
-- the blocked migration 061 guards that would otherwise fire on applications.
target_function(n) as (values
 ('validate_application_campaign_scope'),('validate_recruitment_campaign_scope')),
target_enum(n) as (values ('role_type'),('application_status')),
role_type_expected(v) as (values
 (array['mentor','mentee','supporter','speaker','partner_contact','donor','admin'])),
application_status_expected(v) as (values
 (array['accepted','rejected_or_pending','rejected','pending','withdrawn'])),
prerequisite_table(t) as (values
 ('people'),('programs'),('seasons'),('intake_batches'),('admin_users')),

-- ---------- observed state ----------
-- Both sources are read with the missing_ok form, so an unset GUC yields NULL
-- rather than raising. An empty or whitespace-only value collapses to NULL and
-- is therefore classified 'absent', which never passes.
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
identity_verdict as (
  select i.platform_class, i.attested_class, c.verdict
  from identity i
  join identity_class c on c.platform = i.platform_class and c.attested = i.attested_class
),
enum_actual as (
  select t.typname n,
         array(select e.enumlabel::text from pg_enum e where e.enumtypid = t.oid order by e.enumsortorder) v
  from pg_type t
  join pg_namespace ns on ns.oid = t.typnamespace
  where ns.nspname = 'public' and t.typtype = 'e' and t.typname in (select n from target_enum)
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

-- ---------- assertions ----------
assertions as (
 -- ===== environment and safety =====
 select 'env:transaction_read_only' assertion,
        case when current_setting('transaction_read_only') = 'on' then 'PASS' else 'FAIL' end status
 -- Identity verdict comes from the exhaustive identity_class truth table.
 -- coalesce(..., 'FAIL') is the fail-closed default: if the lookup yields no
 -- row for any reason, the assertion fails rather than disappearing.
 union all select 'env:project_ref_is_expected_staging',
   coalesce((select verdict from identity_verdict), 'FAIL')
 -- At least one identity source must have been supplied at all. An absent or
 -- empty app.settings.project_ref with no owner attestation fails here.
 union all select 'env:project_identity_present',
   case when (select platform_class from identity) <> 'absent'
          or (select attested_class from identity) <> 'absent'
        then 'PASS' else 'FAIL' end
 -- The forbidden production ref is rejected explicitly, from either source.
 union all select 'env:project_ref_is_not_forbidden_production',
   case when (select platform_class from identity) <> 'forbidden_production'
         and (select attested_class from identity) <> 'forbidden_production'
        then 'PASS' else 'FAIL' end
 -- Two supplied sources may not disagree.
 union all select 'env:project_identity_sources_agree',
   case when (select platform_class from identity) = 'absent'
          or (select attested_class from identity) = 'absent'
          or (select platform_class from identity) = (select attested_class from identity)
        then 'PASS' else 'FAIL' end
 -- SECONDARY guard only. Production carries public.applications; staging does
 -- not. This is one more ANDed assertion and can never substitute for, or
 -- compensate for, a failed identity assertion above.
 union all select 'env:not_production_topology',
   case when to_regclass('public.applications') is null then 'PASS' else 'FAIL' end

 -- ===== target objects absent =====
 union all select 'conflict:table_absent:' || t,
   case when to_regclass('public.' || t) is null then 'PASS' else 'FAIL' end
   from target_table
 -- Any relkind, not just ordinary tables: a view, matview, sequence or
 -- foreign table under a target name would break CREATE TABLE just the same.
 union all select 'conflict:relation_name_free',
   case when not exists (
     select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in (select t from target_table)
   ) then 'PASS' else 'FAIL' end
 union all select 'conflict:index_name_free',
   case when not exists (
     select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'i' and c.relname in (select n from target_index)
   ) then 'PASS' else 'FAIL' end
 union all select 'conflict:constraint_name_free',
   case when not exists (
     select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where n.nspname = 'public' and c.conname in (select n from target_constraint)
   ) then 'PASS' else 'FAIL' end
 union all select 'conflict:policy_name_free',
   case when not exists (
     select 1 from pg_policies p
     where p.schemaname = 'public' and p.policyname in (select n from target_policy)
   ) then 'PASS' else 'FAIL' end
 union all select 'conflict:trigger_name_free',
   case when not exists (
     select 1 from pg_trigger tg
     join pg_class c on c.oid = tg.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not tg.tgisinternal
       and (tg.tgname in (select n from target_trigger)
            or c.relname in (select t from target_table))
   ) then 'PASS' else 'FAIL' end
 union all select 'conflict:function_name_free',
   case when not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (select n from target_function)
   ) then 'PASS' else 'FAIL' end

 -- ===== prerequisites =====
 union all select 'prerequisite:table:' || t,
   case when to_regclass('public.' || t) is not null then 'PASS' else 'FAIL' end
   from prerequisite_table
 -- Structural compatibility of the columns migration 059 actually references.
 union all select 'prerequisite:people_id_uuid',
   case when exists (
     select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'people'
       and column_name = 'id' and udt_name = 'uuid'
   ) then 'PASS' else 'FAIL' end
 union all select 'prerequisite:seasons_id_uuid',
   case when exists (
     select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'seasons'
       and column_name = 'id' and udt_name = 'uuid'
   ) then 'PASS' else 'FAIL' end
 union all select 'prerequisite:intake_batches_id_uuid',
   case when exists (
     select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'intake_batches'
       and column_name = 'id' and udt_name = 'uuid'
   ) then 'PASS' else 'FAIL' end
 union all select 'prerequisite:admin_users_id_uuid',
   case when exists (
     select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'admin_users'
       and column_name = 'id' and udt_name = 'uuid'
   ) then 'PASS' else 'FAIL' end
 -- Every FK target above must be backed by a unique/primary key.
 -- PostgreSQL's own foreign-key target rule (transformFkeyCheckAttrs scans
 -- pg_index, not pg_constraint): a unique, valid, ready, immediate index whose
 -- single key column is id, with no partial predicate and no expression key.
 -- Primary-key and UNIQUE-constraint indexes qualify through this same rule,
 -- and a bare CREATE UNIQUE INDEX — which produces no pg_constraint row at
 -- all — is correctly accepted. indnkeyatts = 1 with a first-key-column
 -- comparison means a composite index cannot qualify merely by containing id,
 -- and INCLUDE columns, which live beyond indnkeyatts, are correctly ignored.
 union all select 'prerequisite:fk_targets_unique',
   case when not exists (
     select 1 from (values ('people'),('seasons'),('intake_batches'),('admin_users')) x(t)
     where not exists (
       select 1
       from pg_index i
       join pg_attribute a
         on a.attrelid = i.indrelid
        and a.attname = 'id'
        and a.attnum > 0
        and not a.attisdropped
       where i.indrelid = to_regclass('public.' || x.t)
         and i.indisunique
         and i.indisvalid
         and i.indisready
         and i.indimmediate
         and i.indpred is null
         and i.indexprs is null
         and i.indnkeyatts = 1
         and (string_to_array(i.indkey::text, ' ')::smallint[])[1] = a.attnum
     )
   ) then 'PASS' else 'FAIL' end
 union all select 'prerequisite:gen_random_uuid',
   case when to_regprocedure('gen_random_uuid()') is not null then 'PASS' else 'FAIL' end

 -- ===== required catalog data =====
 union all select 'catalog:uehm_program_exists',
   case when exists (select 1 from ueh) then 'PASS' else 'FAIL' end
 union all select 'catalog:uehm_program_active',
   case when exists (select 1 from ueh where program_active) then 'PASS' else 'FAIL' end
 union all select 'catalog:uehm_s12_belongs_to_uehm',
   case when exists (select 1 from ueh where season_id is not null and season_program_id = program_id)
        then 'PASS' else 'FAIL' end
 union all select 'catalog:uehm_s12_b1_belongs_to_uehm_s12',
   case when exists (select 1 from ueh where batch_id is not null and batch_season_id = season_id)
        then 'PASS' else 'FAIL' end
 union all select 'catalog:uehm_s12_b1_active',
   case when exists (select 1 from ueh where batch_active) then 'PASS' else 'FAIL' end

 -- ===== enums: absent, or exactly compatible (ordered) =====
 union all select 'enum:role_type_absent_or_exact',
   case when not exists (select 1 from enum_actual where n = 'role_type')
          or exists (select 1 from enum_actual a, role_type_expected e
                     where a.n = 'role_type' and a.v = e.v)
        then 'PASS' else 'FAIL' end
 union all select 'enum:application_status_absent_or_exact',
   case when not exists (select 1 from enum_actual where n = 'application_status')
          or exists (select 1 from enum_actual a, application_status_expected e
                     where a.n = 'application_status' and a.v = e.v)
        then 'PASS' else 'FAIL' end

 -- ===== preconditions the amended migration's PHASE 8 contract requires =====
 -- Each mirrors an abort condition inside migration 059 itself, so a PASS
 -- here is a genuine, non-vacuous statement about the target database.
 union all select 'safety:grant_roles_present',
   case when not exists (
     select 1 from (values ('anon'),('authenticated'),('service_role')) x(r)
     where not exists (select 1 from pg_roles where rolname = x.r)
   ) then 'PASS' else 'FAIL' end
 union all select 'safety:owner_bypassrls',
   case when coalesce((select rolbypassrls from pg_roles where rolname = current_user), false)
        then 'PASS' else 'FAIL' end
 union all select 'safety:service_role_bypassrls',
   case when coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false)
        then 'PASS' else 'FAIL' end
 union all select 'safety:owner_can_create_in_public',
   case when has_schema_privilege(current_user, 'public', 'CREATE') then 'PASS' else 'FAIL' end

 -- ===== previously verified release guarantees, reasserted (not rerun) =====
 union all select 'release:m062_functions_present',
   case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') = 11
        then 'PASS' else 'FAIL' end
 union all select 'release:m062_policies_present',
   case when (select count(*) from pg_policies
              where schemaname = 'public' and policyname like 'vam062\_%') = 7
        then 'PASS' else 'FAIL' end
 union all select 'release:m062_membership_rls_enabled',
   case when exists (
     select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'person_season_memberships' and c.relrowsecurity
   ) then 'PASS' else 'FAIL' end
 union all select 'release:m062_scope_arbiter_intact',
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
 union all select 'release:m063_functions_present',
   case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam063\_%') = 9
        then 'PASS' else 'FAIL' end
 union all select 'release:m063_lifecycle_entrypoints_intact',
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
        or has_function_privilege('authenticated', to_regprocedure(x.sig), 'execute')
   ) then 'PASS' else 'FAIL' end
),
normalized as (select assertion, status::text status from assertions),

-- ---------- evidence (reported, never scored) ----------
evidence_schema_acl as (
  select coalesce(jsonb_object_agg(grantee_name, privs), '{}'::jsonb) v from (
    select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') grantee_name,
           jsonb_agg(distinct a.privilege_type order by a.privilege_type) privs
    from pg_namespace n cross join lateral aclexplode(n.nspacl) a
    where n.nspname = 'public'
    group by 1
  ) s
),
evidence_default_acl as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'defacl_owner', pg_get_userbyid(d.defaclrole),
           'schema', coalesce(n.nspname, '<all schemas>'),
           'object_type', d.defaclobjtype,
           'grantee', coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC'),
           'privilege', a.privilege_type
         ) order by pg_get_userbyid(d.defaclrole), coalesce(n.nspname, ''), d.defaclobjtype,
                    coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC'), a.privilege_type),
         '[]'::jsonb) v
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclobjtype = 'r' and (d.defaclnamespace = 0 or n.nspname = 'public')
),
-- What a newly created public table would inherit, per role, with no
-- explicit grant statement. This is exactly what migration 059 PHASE 8
-- overrides on applications and application_answers.
evidence_inherited as (
  select coalesce(jsonb_object_agg(grantee_name, privs), '{}'::jsonb) v from (
    select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') grantee_name,
           jsonb_agg(distinct a.privilege_type order by a.privilege_type) privs
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclobjtype = 'r' and (d.defaclnamespace = 0 or n.nspname = 'public')
    group by 1
  ) s
)
select jsonb_build_object(
  'package', 'VAM059_PREFLIGHT_V1',
  'read_only', true,
  'transaction_read_only', current_setting('transaction_read_only'),
  'expected_staging_ref', (select staging from expected_ref),
  'forbidden_production_ref', (select production from expected_ref),
  -- Project identity is reported explicitly. Only the CLASS of each source is
  -- emitted, never the raw supplied value, so an unexpected input is never
  -- echoed back into the output.
  'project_identity', jsonb_build_object(
    'platform_setting', 'app.settings.project_ref',
    'platform_class', (select platform_class from identity),
    'attestation_setting', 'vam059.attested_project_ref',
    'attested_class', (select attested_class from identity),
    'route', case
      when (select platform_class from identity) <> 'absent'
       and (select attested_class from identity) <> 'absent' then 'both'
      when (select platform_class from identity) <> 'absent' then 'platform_setting'
      when (select attested_class from identity) <> 'absent' then 'owner_attestation'
      else 'none' end,
    'verified', coalesce((select verdict from identity_verdict), 'FAIL') = 'PASS',
    'attestation_set_by_this_file', false
  ),
  'owner_must_verify_project_ref', true,
  'migration_059_sha256', 'sha256 of supabase_migrations/059_staging_application_workflow_bootstrap.sql is bound offline by __tests__/migration-059-secure-application-bootstrap.test.ts',
  'overall_status', case when bool_and(status = 'PASS') then 'PASS' else 'FAIL' end,
  'eligible', bool_and(status = 'PASS'),
  'failureCount', count(*) filter (where status <> 'PASS'),
  'assertions', jsonb_agg(jsonb_build_object('assertion', assertion, 'status', status) order by assertion),
  'failed_assertions', coalesce(jsonb_agg(assertion order by assertion) filter (where status <> 'PASS'), '[]'::jsonb),
  'evidence', jsonb_build_object(
    'note', 'Evidence only. Never scored. Ambient default privileges are expected to include anon and authenticated; migration 059 PHASE 8 revokes them explicitly.',
    'public_schema_privileges', (select v from evidence_schema_acl),
    'default_acls_for_new_public_tables', (select v from evidence_default_acl),
    'inherited_privileges_for_new_public_tables', (select v from evidence_inherited)
  )
) migration_059_preflight_v1
from normalized;

ROLLBACK;
