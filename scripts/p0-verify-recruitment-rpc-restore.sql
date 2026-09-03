-- ===========================================================================
-- P0 RESTORE — post-apply verification pack.
--
-- Run this AFTER applying
--   supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql
-- against the temporary Supabase development branch created from Production
-- (qkkroesfiazsejkzflcd).
--
-- Entirely READ-ONLY and safe to run repeatedly: it writes nothing and calls no
-- mutating RPC. It is deliberately ONE statement, because `supabase db query`
-- returns only the final result set — a multi-statement script would silently
-- report just its last check.
--
-- Every row must read PASS. Any FAIL blocks the Production apply.
-- The single MANUAL row names what this pack cannot cover.
--
-- Usage:
--   supabase db query --linked --project-ref <BRANCH_REF> \
--     --file scripts/p0-verify-recruitment-rpc-restore.sql
-- ===========================================================================

begin read only;

with
season as (
  select id from public.seasons where code = 'UEHM-S12'
),

-- 1. All 13 functions exist -------------------------------------------------
c1 as (
  select count(*) as n from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in (
      'vam084_operator_for_season','vam084_participant_for_stage',
      'vam084_list_recruitment_participants','vam084_upsert_stage_requirement',
      'vam084_application_decision_eligibility','vam084_recompute_application_review_status',
      'vam084_submit_application_review','vam084_change_review_assignment',
      'vam084_apply_application_decisions','vam084_grant_recruitment_participation',
      'vam084_revoke_recruitment_participation','vam090_bulk_assign_application_reviews',
      'vam090_finalize_recruitment_approval')
),

-- 2. Signatures exactly match what the application calls --------------------
--    Parameter NAMES matter: PostgREST binds named arguments, so a rename
--    breaks the call as surely as a missing function does.
--    Compared against pg_get_function_identity_arguments(), which reports
--    names and types WITHOUT default clauses — the expected strings below are
--    written to match that, not pg_get_functiondef().
expected(name, args) as (values
  ('vam084_operator_for_season','p_actor uuid, p_season_id uuid'),
  ('vam084_participant_for_stage','p_admin_user_id uuid, p_season_id uuid, p_review_stage text'),
  ('vam084_list_recruitment_participants','p_season_id uuid, p_review_stage text'),
  ('vam084_upsert_stage_requirement','p_actor uuid, p_season_id uuid, p_review_stage text, p_minimum integer'),
  ('vam084_application_decision_eligibility','p_application_id uuid, p_new_status text'),
  ('vam084_recompute_application_review_status','p_application_id uuid, p_review_stage text'),
  ('vam084_change_review_assignment','p_review_id uuid, p_actor uuid, p_reason text, p_new_reviewer uuid'),
  ('vam084_revoke_recruitment_participation','p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text'),
  ('vam084_grant_recruitment_participation','p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text, p_auth_user_id uuid, p_email text'),
  ('vam090_finalize_recruitment_approval','p_application_id uuid, p_new_status text, p_actor uuid, p_person_id uuid, p_expected_status text, p_decision_note text'),
  ('vam084_apply_application_decisions','p_application_ids uuid[], p_new_status text, p_actor uuid, p_decision_note text, p_expected_statuses jsonb')
),
c2 as (
  select
    count(*) filter (where pg_get_function_identity_arguments(p.oid) = e.args) as ok,
    count(*) as total,
    coalesce(string_agg(e.name, ', ') filter (
      where p.oid is null or pg_get_function_identity_arguments(p.oid) is distinct from e.args), '') as bad
  from expected e
  left join pg_proc p on p.proname = e.name and p.pronamespace = 'public'::regnamespace
),

-- 3. Execute ACL is service_role only ---------------------------------------
c3 as (
  select coalesce(string_agg(p.proname || ' -> ' ||
           coalesce(array_to_string(p.proacl::text[], ' '), 'DEFAULT(PUBLIC)'), '; '), '') as over_granted
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and (p.proname like 'vam084\_%' or p.proname like 'vam090\_%')
    and (p.proacl is null
         or exists (select 1 from unnest(p.proacl::text[]) a
                    where a like '=%' or a like 'anon=%' or a like 'authenticated=%'))
),

-- 4/5/6. Dependency tables: presence, forced RLS, constraints ---------------
c4 as (
  select count(*) as n, coalesce(string_agg(relname, ', '), '') as names
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
    and relname in ('recruitment_stage_requirements','recruitment_assignment_events')
),
c5 as (
  select count(*) filter (where not (relrowsecurity and relforcerowsecurity)) as unforced,
         coalesce(string_agg(relname || ' rls=' || relrowsecurity::text ||
                             ' forced=' || relforcerowsecurity::text, '; '), '') as detail,
         (select count(*) from pg_policies where schemaname = 'public'
            and tablename in ('recruitment_stage_requirements','recruitment_assignment_events')) as policies
  from pg_class where relnamespace = 'public'::regnamespace
    and relname in ('recruitment_stage_requirements','recruitment_assignment_events')
),
c6 as (
  select count(*) as n from pg_constraint
  where conrelid in (to_regclass('public.recruitment_stage_requirements'),
                     to_regclass('public.recruitment_assignment_events'))
),

-- 7. Stage-requirement seed landed, and touched nothing else ----------------
c7 as (
  select count(*) as n,
         count(*) filter (where r.minimum_submitted_reviews = 1) as ones,
         count(*) filter (where r.review_stage = 'profile_screening') as screening,
         count(*) filter (where r.review_stage = 'interview') as interview,
         coalesce(string_agg(r.review_stage || '=' || r.minimum_submitted_reviews::text, ', '), 'none') as detail
  from public.recruitment_stage_requirements r
  join public.seasons s on s.id = r.season_id
  where s.code = 'UEHM-S12'
),
c7b as (
  select count(*) as n from public.recruitment_stage_requirements r
  join public.seasons s on s.id = r.season_id
  where s.code <> 'UEHM-S12'
),

-- 8. Safe read-only RPC calls (these three write nothing) -------------------
c8a as (
  select count(*) as n
  from public.vam084_list_recruitment_participants((select id from season), 'profile_screening')
),
c8b as (
  select public.vam084_operator_for_season(
           '00000000-0000-0000-0000-000000000000'::uuid, (select id from season)) as v
),
c8c as (
  select public.vam084_participant_for_stage(
           '00000000-0000-0000-0000-000000000000'::uuid, (select id from season), 'interview') as v
),
-- 8d. The eligibility gate is a pure read, and 'stage_requirement_missing' is
--     exactly the answer the seed exists to prevent.
c8d as (
  select count(*) as n
  from (select id from public.applications limit 25) a
  cross join lateral public.vam084_application_decision_eligibility(a.id, 'approved_as_mentor') g
  where g.reason = 'stage_requirement_missing'
)

select * from (
  select 1 as ord, '1. functions_present' as check,
         case when n = 13 then 'PASS' else 'FAIL' end as result,
         n::text || '/13 present' as detail from c1
  union all
  select 2, '2. signatures_exact',
         case when ok = 11 then 'PASS' else 'FAIL' end,
         ok::text || '/11 exact' || case when bad = '' then '' else ' — mismatched: ' || bad end from c2
  union all
  select 3, '3. execute_acl_service_role_only',
         case when over_granted = '' then 'PASS' else 'FAIL' end,
         case when over_granted = '' then 'no anon/authenticated/PUBLIC execute' else over_granted end from c3
  union all
  select 4, '4. dependency_tables_present',
         case when n = 2 then 'PASS' else 'FAIL' end, names from c4
  union all
  select 5, '5. rls_enabled_forced_no_policies',
         case when unforced = 0 and policies = 0 then 'PASS' else 'FAIL' end,
         detail || ' policies=' || policies::text from c5
  union all
  select 6, '6. table_constraints_present',
         case when n >= 10 then 'PASS' else 'FAIL' end,
         n::text || ' constraints across both tables' from c6
  union all
  select 7, '7. stage_requirement_seed',
         case when n = 2 and ones = 2 and screening = 1 and interview = 1 then 'PASS' else 'FAIL' end,
         'UEHM-S12: ' || detail from c7
  union all
  select 8, '7b. seed_left_other_seasons_alone',
         case when n = 0 then 'PASS' else 'FAIL' end,
         n::text || ' rows outside UEHM-S12' from c7b
  union all
  select 9, '8a. list_participants_callable',
         'PASS', n::text || ' participants for UEHM-S12/profile_screening' from c8a
  union all
  select 10, '8b. operator_for_season_callable',
         case when v = false then 'PASS' else 'FAIL' end,
         'unknown actor resolves to not-an-operator' from c8b
  union all
  select 11, '8c. participant_for_stage_callable',
         case when v = false then 'PASS' else 'FAIL' end,
         'unknown admin resolves to not-a-participant' from c8c
  union all
  select 12, '8d. eligibility_gate_requirement_configured',
         case when n = 0 then 'PASS' else 'FAIL' end,
         n::text || ' of 25 sampled applications still answer stage_requirement_missing' from c8d
  union all
  select 13, '9. mutation_semantics', 'MANUAL',
         'submit_application_review, change_review_assignment, apply_application_decisions, '
         'grant/revoke_recruitment_participation, bulk_assign_application_reviews and '
         'finalize_recruitment_approval write participant rows — exercise on the branch with '
         'synthetic .test fixtures only, then delete them.'
) checks order by ord;

rollback;
