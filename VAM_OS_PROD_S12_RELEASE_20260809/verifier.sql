-- =============================================================================
-- VAM OS — PRODUCTION SEASON 12 RELEASE — VERIFIER
--
-- Target    : PRODUCTION. OWNER-RUN in the Supabase SQL Editor.
-- Read-only : YES. REPEATABLE READ READ ONLY, always ROLLBACK.
-- Output    : one row per check — id, what it proves, expected, actual, status.
-- PII       : none.
--
-- WHEN TO RUN
--   after T1        -> V01..V04 must PASS
--   after T2        -> V01..V08 must PASS
--   after T3        -> V01..V11 must PASS (V12 is expected FAIL until T4)
--   after T4        -> ALL must PASS. This is the release verifier contract.
--
-- Any FAIL after T4 means the release is not complete. Do not open the public
-- forms. Go to RECOVERY.md and match the failing check id.
-- =============================================================================

begin isolation level repeatable read read only;
set local statement_timeout = '180s';
set local timezone          = 'UTC';

with
day1(t) as (
  select unnest(array[
    'applications','people','mentor_profiles','mentee_profiles','admin_users',
    'intake_batches','person_season_memberships','person_season_membership_log',
    'admin_audit_log','application_decisions'])
),
rls8(t) as (
  select unnest(array[
    'admin_users','applications','people','mentor_profiles','mentee_profiles',
    'intake_batches','person_season_memberships','person_season_membership_log'])
),
entry(f) as (
  select unnest(array[
    'public.vam063_pause_membership(uuid,uuid,text)',
    'public.vam063_withdraw_membership(uuid,uuid,text)',
    'public.vam063_opt_out_membership(uuid,uuid,text)',
    'public.vam063_cancel_membership(uuid,uuid,text)',
    'public.vam063_reactivate_membership(uuid,uuid,text)',
    'public.vam063_remove_membership_role(uuid,uuid,text)',
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)'])
),
internal(f) as (
  select unnest(array[
    'public.vam063_authorized_for_scope(uuid,uuid,uuid)',
    'public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)',
    'public.vam063_trusted_api_role()'])
),
canon(v) as (
  select array[
    'accept_registration_proof','add_event_participation','add_manual_recap','add_membership_role',
    'approve_application_as_mentee','approve_application_as_mentor','bulk_add_event_participants',
    'cancel_event','cancel_event_registration','cancel_match','cancel_membership',
    'close_event_registration','confirm_event_registration','confirm_registration_payment',
    'create_action_item','create_admin_user','create_event','create_event_checkin_link',
    'create_event_registration_link','create_manual_match','create_membership','create_mentee_profile',
    'create_mentor_profile','deactivate_admin_user','edit_recap','import_participant_membership',
    'link_person_auth','open_event_registration','opt_out_membership','pause_membership',
    'reactivate_admin_user','reactivate_membership','reconcile_person_auth','reject_event_registration',
    'reject_registration_payment','reject_registration_proof','remove_admin_access',
    'remove_event_participation','remove_membership_role','soft_delete_recap','sync_auth','unknown',
    'update_action_item','update_admin_user','update_admin_user_access','update_event','update_event_participation',
    'update_mentee_profile','update_mentor_profile','update_registration_review_note',
    'waitlist_event_registration','withdraw_membership']::text[]
),
checks(id, proves, expected, actual) as (

  -- ── T1: audit ─────────────────────────────────────────────────────────────
  select 'V01', 'admin_audit_log still has all 13 Production columns; nothing dropped or renamed',
         '13',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and table_name='admin_audit_log')

  union all
  select 'V02', 'the four legacy Production-only columns are preserved',
         'action,actor_email,metadata,target_email',
         coalesce((select string_agg(column_name, ',' order by column_name)
                    from information_schema.columns
                   where table_schema='public' and table_name='admin_audit_log'
                     and column_name in ('action','actor_email','target_email','metadata')), '<none>')

  union all
  select 'V03', 'no legacy column can block an INSERT that omits it (NOT NULL without default)',
         '0',
         (select count(*)::text from pg_attribute a
           where a.attrelid='public.admin_audit_log'::regclass
             and a.attname in ('action','actor_email','target_email','metadata')
             and a.attnum > 0 and not a.attisdropped
             and a.attnotnull and a.atthasdef is false)

  union all
  select 'V04', 'action_type CHECK is the canonical 52-value vocabulary, VALIDATED',
         '52|true',
         coalesce((select count(distinct m[1])::text || '|' || bool_and(c.convalidated)::text
                    from pg_constraint c
                    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text','g') m
                   where c.conrelid='public.admin_audit_log'::regclass
                     and c.conname='admin_audit_log_action_type_check'), '<absent>')

  union all
  select 'V05', 'every action_type value stored is inside the canonical vocabulary',
         '0',
         (select count(*)::text from public.admin_audit_log a, canon c
           where a.action_type is not null and not (a.action_type = any (c.v)))

  -- ── T2: security ──────────────────────────────────────────────────────────
  union all
  select 'V06', 'RLS enabled on all ten Day-1 tables',
         '10',
         (select count(*)::text from day1 d
            join pg_class c on c.oid = to_regclass('public.' || d.t)
           where c.relrowsecurity)

  union all
  select 'V07', 'no anon / authenticated / PUBLIC grant of any kind remains on the Day-1 tables',
         '0',
         (select count(*)::text from information_schema.role_table_grants g
           where g.table_schema='public' and g.table_name in (select t from day1)
             and g.grantee in ('anon','authenticated','PUBLIC'))

  union all
  select 'V08', 'service_role retains full table access (Day-1 runs entirely through it)',
         '40',
         (select count(*)::text from day1 d
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
          where has_table_privilege('service_role', 'public.' || d.t, p))

  union all
  select 'V09', 'the eight newly protected tables carry no policy (RLS fail-closed, by design)',
         '0',
         (select count(*)::text from pg_policies p
           where p.schemaname='public' and p.tablename in (select t from rls8))

  union all
  select 'V10', 'FORCE RLS is not set anywhere (owner and service_role must keep working)',
         '0',
         (select count(*)::text from day1 d
            join pg_class c on c.oid = to_regclass('public.' || d.t)
           where c.relforcerowsecurity)

  -- Catalog-only on purpose: a static reference to a table T2 has not yet
  -- created would make this whole verifier a parse error before T2, which
  -- would defeat running it after T1. Row-count correctness of the capture is
  -- asserted by T2 itself, inside T2's own transaction.
  union all
  select 'V11', 'the T2 pre-state capture table exists and is not API-readable',
         'present|0',
         case when to_regclass('public.vam_prod_s12_release_state') is null
              then '<absent>' else 'present' end
         || '|' ||
         (select count(*)::text from information_schema.role_table_grants
           where table_schema='public' and table_name='vam_prod_s12_release_state'
             and grantee in ('anon','authenticated','PUBLIC'))

  -- ── T3: lifecycle objects ─────────────────────────────────────────────────
  union all
  select 'V12', 'transition_type vocabulary is the 13-value superset (7 baseline + 6 lifecycle)',
         '13',
         coalesce((select count(distinct m[1])::text from pg_constraint c
                    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text','g') m
                   where c.conrelid='public.person_season_membership_log'::regclass
                     and c.conname='person_season_membership_log_transition_type_check'), '<absent>')

  union all
  select 'V13', 'all six lifecycle transition values the wrappers write are admitted',
         'pause,withdraw,opt_out,cancel,reactivate,role_removed',
         coalesce((select string_agg(x, ',' order by array_position(
                     array['pause','withdraw','opt_out','cancel','reactivate','role_removed'], x))
                   from unnest(array['pause','withdraw','opt_out','cancel','reactivate','role_removed']) x
                   where exists (select 1 from pg_constraint c
                                  where c.conrelid='public.person_season_membership_log'::regclass
                                    and c.conname='person_season_membership_log_transition_type_check'
                                    and pg_get_constraintdef(c.oid) like '%''' || x || '''%')), '<none>')

  union all
  select 'V14', 'exactly the 11 release functions exist, and no vam062_* package was installed',
         '11|0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and (p.proname like 'vam063\_%' or p.proname like 'vam069\_%'))
         || '|' ||
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname like 'vam062\_%')

  union all
  select 'V15', 'all ten SECURITY DEFINER functions pin search_path=public',
         '10',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and (p.proname like 'vam063\_%' or p.proname like 'vam069\_%')
             and p.prosecdef and p.proconfig::text like '%search_path=public%')

  union all
  select 'V16', 'the seven RC-called entry points exist with the exact signatures the app uses',
         '7',
         (select count(*)::text from entry e where to_regprocedure(e.f) is not null)

  -- has_function_privilege is given the OID form throughout: to_regprocedure
  -- yields NULL for a function that does not exist, the privilege test then
  -- yields NULL rather than raising, and NULL is not TRUE so it is not counted.
  -- The text form would raise 42883 and abort the verifier.
  union all
  select 'V17', 'no API role can execute any lifecycle function or internal helper',
         '0',
         (select count(*)::text
            from (select f from entry union all select f from internal) x
           cross join unnest(array['anon','authenticated']) r
           where has_function_privilege(r, to_regprocedure(x.f), 'execute'))

  union all
  select 'V18', 'the internal helpers are not granted even to service_role',
         '0',
         (select count(*)::text from internal i
           where has_function_privilege('service_role', to_regprocedure(i.f), 'execute'))

  -- ── T4: execution gate ────────────────────────────────────────────────────
  union all
  select 'V19', 'Probe C passed and was recorded before execution was granted',
         'present',
         case when to_regclass('public.vam_prod_s12_release_gate') is null
              then '<not recorded — expected FAIL until T4>' else 'present' end

  union all
  select 'V20', 'service_role can execute all seven entry points (lifecycle is live)',
         '7',
         (select count(*)::text from entry e
           where has_function_privilege('service_role', to_regprocedure(e.f), 'execute'))

  -- ── Standing assertions: what this release proved it did NOT need ─────────
  union all
  select 'V21', 'M066 remains NOT REQUIRED: both profile linkage columns still present',
         '4',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and table_name in ('mentor_profiles','mentee_profiles')
             and column_name in ('source_application_id','intake_batch_id'))

  union all
  select 'V22', 'M067 remains NOT REQUIRED: both person_id FKs still CASCADE / NO ACTION / DEFERRABLE INITIALLY DEFERRED / VALID',
         '2',
         (select count(*)::text from pg_constraint k
           where k.conrelid in ('public.mentor_profiles'::regclass,'public.mentee_profiles'::regclass)
             and k.contype='f' and k.confrelid='public.people'::regclass
             and k.confdeltype='c' and k.confupdtype='a'
             and k.condeferrable and k.condeferred and k.convalidated)

  union all
  select 'V23', 'Season 12 shape intact and Season 11 undisturbed (UEHM/S11/S12 isolation)',
         'UEHM-S11,UEHM-S12|UEHM-S12-B1',
         coalesce((select string_agg(code, ',' order by code) from public.seasons
                    where code in ('UEHM-S11','UEHM-S12')), '<none>')
         || '|' ||
         coalesce((select string_agg(b.code, ',' order by b.code) from public.intake_batches b
                     join public.seasons s on s.id=b.season_id
                    where s.code='UEHM-S12' and b.is_active), '<none>')

  union all
  select 'V24', 'membership integrity: no duplicate person+season+role, no orphan profile person_id',
         '0|0|0',
         (select count(*)::text from (select person_id, season_id, role from public.person_season_memberships
                                       group by 1,2,3 having count(*) > 1) d)
         || '|' ||
         (select count(*)::text from public.mentor_profiles m where m.person_id is not null
            and not exists (select 1 from public.people p where p.id=m.person_id))
         || '|' ||
         (select count(*)::text from public.mentee_profiles m where m.person_id is not null
            and not exists (select 1 from public.people p where p.id=m.person_id))
)
select
  id,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end as status,
  expected,
  actual,
  proves
from checks
order by id;

rollback;
