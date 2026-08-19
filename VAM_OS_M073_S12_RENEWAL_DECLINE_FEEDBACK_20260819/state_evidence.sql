-- =============================================================================
-- VAM OS — M073 — POST-APPLY STATE EVIDENCE (READ ONLY, NO ASSERTIONS)
--
-- Target : STAGING (ljfneyuvpxrmejpxsmpz).
--
-- Contains NO assertions and CANNOT raise. Every statement is a SELECT, wrapped
-- in a transaction that ROLLS BACK. Its purpose is to report what the database
-- currently looks like even when an assertion elsewhere would abort first — a
-- verifier that stops at its first failure tells you one thing; this tells you
-- all of them.
--
-- Run any number of times. Run it on Production only if you want the same
-- read-only picture there; it changes nothing either way.
-- =============================================================================

begin;

-- ── 1. M073 schema objects ──────────────────────────────────────────────────
select
  'A. schema'                                                   as section,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'person_season_invites'
     and column_name = 'decline_feedback')                      as decline_feedback_column_count,
  (select data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'person_season_invites'
     and column_name = 'decline_feedback')                      as decline_feedback_type,
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'person_season_invites'
     and column_name = 'decline_feedback')                      as decline_feedback_nullable,
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'person_season_invites'
     and column_name = 'decline_feedback')                      as decline_feedback_default,
  (select count(*) from pg_constraint
   where conname = 'person_season_invites_decline_feedback_binding_check'
     and conrelid = 'public.person_season_invites'::regclass)   as binding_constraint_count,
  (select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'person_season_invites_decline_feedback_binding_check'
     and conrelid = 'public.person_season_invites'::regclass)   as binding_constraint_def;

-- ── 2. Every decline signature that currently exists ────────────────────────
-- One row per overload. Expect exactly ONE row, with 2 args and 1 default.
select
  'B. decline signatures'                                       as section,
  p.oid::regprocedure::text                                     as function_identity,
  p.pronargs                                                    as arg_count,
  coalesce((select string_agg(format_type(t, null), ', ' order by ord)
            from unnest(p.proargtypes::oid[]) with ordinality u(t, ord)), '<none>')
                                                                as arg_types,
  p.pronargdefaults                                             as defaults,
  array_to_string(p.proargnames[1:p.pronargs], ', ')            as param_names,
  p.prosecdef                                                   as security_definer,
  p.provolatile                                                 as volatility,
  p.proisstrict                                                 as is_strict,
  array_to_string(p.proconfig, ', ')                            as proconfig,
  pg_get_userbyid(p.proowner)                                   as owner,
  md5(p.prosrc)                                                 as body_md5,
  (position('decline_feedback = v_feedback' in p.prosrc) > 0)   as writes_feedback_in_claim,
  (position('nullif(btrim(coalesce(p_decline_feedback' in p.prosrc) > 0)
                                                                as normalises_feedback,
  (position('vam063_trusted_api_role' in p.prosrc) > 0)         as uses_m072_resolver
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined'
order by p.pronargs;

-- ── 3. ACLs on every vam071_* function, BY PRINCIPAL ────────────────────────
-- The distinction that matters:
--   * the OWNER's EXECUTE is implicit in ownership. REVOKE ... FROM public,
--     anon, authenticated, service_role does not remove it, and acldefault()
--     re-supplies it when proacl is NULL. It is not a grant anyone made.
--   * PUBLIC appears as grantee 0 and is the one that means "the web can reach
--     this".
--   * anon / authenticated are the web roles.
--   * service_role is the trusted server role: expected on the five ENTRY
--     POINTS, and expected ABSENT on the two helpers.
select
  'C. acl by principal'                                         as section,
  p.proname                                                     as function_name,
  case when p.proname in ('vam071_renewal_identity_lock',
                          'vam071_accepted_renewal_exists')
       then 'helper' else 'entry_point' end                     as role_in_m071,
  coalesce(r.rolname, 'PUBLIC')                                 as grantee,
  case when acl.grantee = 0 then 'PUBLIC'
       when acl.grantee = p.proowner then 'OWNER (implicit in ownership)'
       else 'explicit grant' end                                as grant_kind,
  acl.privilege_type                                            as privilege,
  pg_get_userbyid(acl.grantor)                                  as granted_by
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles r on r.oid = acl.grantee
where n.nspname = 'public' and p.proname like 'vam071\_%'
  and acl.privilege_type = 'EXECUTE'
order by role_in_m071, p.proname, grantee;

-- ── 4. The M071 contract, evaluated exactly as M071 states it ───────────────
-- Forbidden principals only. A 'yes' anywhere in the first three columns is a
-- real exposure; owner/postgres access is not evaluated here because M071 does
-- not forbid it.
select
  'D. m071 contract'                                            as section,
  f                                                             as function_identity,
  has_function_privilege('anon', f, 'execute')                  as anon_can_execute,
  has_function_privilege('authenticated', f, 'execute')         as authenticated_can_execute,
  has_function_privilege('service_role', f, 'execute')          as service_role_can_execute,
  exists (select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where p.oid = f::regprocedure and acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
                                                                as public_can_execute,
  case when f like '%identity_lock%' or f like '%accepted_renewal_exists%'
       then 'helper: anon/authenticated/service_role/PUBLIC must all be false'
       else 'entry point: service_role true; anon/authenticated/PUBLIC false' end
                                                                as expectation
from unnest(array[
  'public.vam071_renewal_identity_lock(uuid,uuid,text)',
  'public.vam071_accepted_renewal_exists(uuid,uuid,text)',
  'public.vam071_create_renewal_invite(uuid,uuid,uuid,uuid,text,text,timestamptz)',
  'public.vam071_revoke_renewal_invite(uuid,uuid,text)',
  'public.vam071_submit_renewal_accepted(text,jsonb,boolean)',
  'public.vam071_confirm_renewal_profile(uuid,uuid,jsonb,jsonb,jsonb)'
]::text[]) f
order by f;

-- The decline entry point is listed separately because its identity changed
-- with M073 and a hard-coded signature would error if it were not yet applied.
select
  'D2. decline entry point'                                     as section,
  p.oid::regprocedure::text                                     as function_identity,
  has_function_privilege('anon', p.oid, 'execute')              as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute')     as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'execute')      as service_role_can_execute,
  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
                                                                as public_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';

-- ── 5. Data invariants ──────────────────────────────────────────────────────
select
  'E. data'                                                     as section,
  (select count(*) from public.person_season_invites)           as invites_total,
  (select count(*) from public.person_season_invites where outcome = 'accepted')  as invites_accepted,
  (select count(*) from public.person_season_invites where outcome = 'declined')  as invites_declined,
  (select count(*) from public.person_season_invites where decline_feedback is not null)
                                                                as invites_with_feedback,
  (select count(*) from public.person_season_invites
   where submitted_at is null and revoked_at is null and expires_at > now())
                                                                as invites_live,
  -- Each of the next three must be 0.
  (select count(*) from public.person_season_invites
   where (outcome is not distinct from 'accepted') <> (application_id is not null))
                                                                as violates_application_binding,
  (select count(*) from public.person_season_invites
   where (submitted_at is null) <> (outcome is null))           as violates_outcome_binding,
  (select count(*) from public.person_season_invites
   where decline_feedback is not null and outcome is distinct from 'declined')
                                                                as violates_feedback_binding,
  (select count(*) from public.applications where status = 'declined_renewal')
                                                                as ghost_declined_renewal_rows;

-- ── 6. Environment ──────────────────────────────────────────────────────────
select
  'F. environment'                                              as section,
  current_database()                                            as db,
  current_user                                                  as run_as,
  now()                                                         as observed_at,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'vam062\_%')  as is_staging,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'vam071\_%')   as vam071_function_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vam063_trusted_api_role')
                                                                as m072_resolver_count;

rollback;
