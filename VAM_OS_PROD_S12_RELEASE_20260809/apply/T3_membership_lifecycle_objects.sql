-- =============================================================================
-- VAM OS — PRODUCTION SEASON 12 RELEASE — APPLY TRANSACTION 3 of 4
-- T3: membership lifecycle objects, INSTALLED BUT NOT YET EXECUTABLE (Phase 3)
--
-- Target : PRODUCTION only. T1 and T2 must have committed.
--
-- WHAT THIS INSTALLS
--   * the 13-value person_season_membership_log transition vocabulary
--     (the M065 delta — identical DDL, Production-specific packaging)
--   * public.vam063_trusted_api_role()          — trusted-context resolver
--   * public.vam069_trusted_context_probe()     — read-only runtime proof (Probe C)
--   * public.vam063_authorized_for_scope()      — shared authorization rule
--   * public.vam063_transition_membership_atomic() — the single transition core
--   * the seven entry points the RC calls by name from
--     app/actions/membership-lifecycle.ts:
--       vam063_pause_membership, vam063_reactivate_membership,
--       vam063_withdraw_membership, vam063_opt_out_membership,
--       vam063_cancel_membership, vam063_remove_membership_role,
--       vam063_add_membership_role
--
-- WHAT THIS DELIBERATELY DOES NOT INSTALL
--   The VAM062 V3 package. Production has none of it, and no Day-1 path needs
--   it: the seven lifecycle functions below never call a vam062_* function, and
--   the two preconditions migration 063 inherited from 062 — the
--   vam062_current_admin_id() helper and the four-part admin_scope_access
--   arbiter — are only used by 062's own RLS policy and its ON CONFLICT upsert,
--   neither of which exists here. Installing 062 to satisfy a comment would be
--   making Production look like Staging. See README section 3 for the P1
--   consequence this leaves behind (admin-console user management).
--
-- WHY M064 IS NOT A SEPARATE MIGRATION HERE
--   M064 exists because Staging already had nine functions carrying a guard
--   that PostgREST v10+ can never satisfy: current_setting(
--   'request.jwt.claim.role') was removed from PostgREST in v10.0 and today's
--   platform populates only request.jwt.claims. Production has none of those
--   functions yet, so there is nothing to retrofit — the corrected resolution
--   is built into vam063_trusted_api_role() from the first line it ever runs.
--   Replaying M064 as a migration would be a no-op looking for functions that
--   do not exist.
--
-- EXECUTION IS WITHHELD ON PURPOSE
--   None of the seven entry points is granted EXECUTE by this transaction.
--   Production Vercel authenticates with the legacy-named
--   SUPABASE_SERVICE_ROLE_KEY while the Supabase project also carries
--   newer-format secret-key objects, and which of those the deployment
--   actually sends is not knowable from the database. T4 grants EXECUTE only
--   after Probe C proves, from the deployed key itself, that the trusted
--   context resolves. Until then a lifecycle call fails with 42501 at the
--   door rather than half-writing a membership. No secret value is ever read
--   by this package.
-- =============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

-- ── Section 0. Guards ───────────────────────────────────────────────────────
do $t3_guard$
declare
  v_txt   text;
  v_cols  text[];
  v_tt_base constant text[] := array[
    'backfill','created','manual','role_change','rollover','status_change','system'
  ];
  -- Every action_type the functions below write.
  v_actions constant text[] := array[
    'add_membership_role','remove_membership_role','pause_membership',
    'withdraw_membership','opt_out_membership','cancel_membership',
    'reactivate_membership'
  ];
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'T3 ABORTED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and (p.proname like 'vam063%' or p.proname like 'vam069%')) then
    raise exception 'T3 ABORTED [LIFECYCLE_COLLISION]: vam063*/vam069* functions already exist.';
  end if;

  -- T1: every action_type these functions write must already be admissible.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_actions) x
  where not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.admin_audit_log'::regclass
      and c.conname = 'admin_audit_log_action_type_check'
      and pg_get_constraintdef(c.oid) like '%''' || x || '''%'
  );
  if v_txt is not null then
    raise exception 'T3 ABORTED [T1_NOT_APPLIED]: admin_audit_log vocabulary does not admit: %', v_txt;
  end if;

  -- T2: RLS must already be on. T3 installs write-path functions only and
  -- never touches RLS or grants on a pre-existing table.
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'person_season_memberships' and c.relrowsecurity) then
    raise exception 'T3 ABORTED [T2_NOT_APPLIED]: person_season_memberships RLS is not enabled.';
  end if;

  -- The transition vocabulary must still be the untouched 7-value baseline.
  select array_agg(distinct m[1] order by m[1]) into v_cols
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
  where c.conrelid = 'public.person_season_membership_log'::regclass
    and c.conname = 'person_season_membership_log_transition_type_check';
  if v_cols is distinct from v_tt_base then
    raise exception 'T3 ABORTED [TRANSITION_VOCAB_DRIFT]: expected %, found %', v_tt_base, v_cols;
  end if;

  -- vam063_add_membership_role inserts source='manual'. If a source CHECK
  -- exists it must admit that value, or every add-role call fails with 23514
  -- after passing every authorization check.
  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.person_season_memberships'::regclass and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ilike '%source%')
     and not exists (select 1 from pg_constraint c
              where c.conrelid = 'public.person_season_memberships'::regclass and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ilike '%source%'
                and pg_get_constraintdef(c.oid) like '%''manual''%') then
    raise exception 'T3 ABORTED [MEMBERSHIP_SOURCE_VOCAB]: person_season_memberships source CHECK does not admit ''manual''.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='programs' and column_name='is_active') then
    raise exception 'T3 ABORTED [PROGRAMS_IS_ACTIVE]: programs.is_active absent.';
  end if;
end
$t3_guard$;

-- ── Section 1. Transition vocabulary (the M065 delta) ───────────────────────
-- The six wrappers below write pause / withdraw / opt_out / cancel /
-- reactivate / role_removed. Production's migration-052 CHECK admits none of
-- them, so without this every lifecycle transition would fail with 23514
-- AFTER passing authorization — the exact defect that blocked staging until
-- M065. The seven baseline values are preserved; this is a strict superset.
alter table public.person_season_membership_log
  drop constraint person_season_membership_log_transition_type_check;

alter table public.person_season_membership_log
  add constraint person_season_membership_log_transition_type_check
  check (transition_type = any (array[
    'created'::text,
    'status_change'::text,
    'role_change'::text,
    'rollover'::text,
    'backfill'::text,
    'manual'::text,
    'system'::text,
    'pause'::text,
    'withdraw'::text,
    'opt_out'::text,
    'cancel'::text,
    'reactivate'::text,
    'role_removed'::text
  ]));

-- ── Section 2. Trusted-context resolver ─────────────────────────────────────
-- Resolves the API role of the current request from three sources, in the
-- order of decreasing authority, and reports which one answered:
--
--   1. request.jwt.claim.role  — the legacy per-claim GUC. Removed from
--      PostgREST in v10.0; present only on an old platform.
--   2. request.jwt.claims ->> 'role' — the whole verified JWT payload, which
--      is what current PostgREST populates. This is M064's remediation, and
--      Supabase's own auth.role() implements the same fallback.
--   3. current_setting('role') — the role PostgREST installs with SET LOCAL
--      ROLE before running the request. This covers a deployment presenting a
--      newer-format secret key, where the gateway may map the key to the
--      service_role database role without republishing a JWT payload.
--
-- Source 3 is not a weakening: only a request the platform has already
-- authenticated as service_role can cause SET ROLE service_role, exactly as
-- only a validly signed JWT can produce a service_role claim. An owner
-- session in the SQL editor reads 'none' here and is not admitted.
--
-- STABLE, not IMMUTABLE: it reads session state. SECURITY INVOKER: it touches
-- no table, so it needs no elevation; the SECURITY DEFINER callers below run
-- as the owner and can execute it without any grant to an API role.
create function public.vam063_trusted_api_role()
returns table (api_role text, claim_source text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_role   text;
  v_claims text;
begin
  v_role := nullif(current_setting('request.jwt.claim.role', true), '');
  if v_role is not null then
    return query select v_role, 'legacy_guc'::text;
    return;
  end if;

  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  if v_claims is not null then
    begin
      v_role := (v_claims::jsonb) ->> 'role';
    exception when others then
      v_role := null;   -- malformed claims are never trusted
    end;
    if v_role is not null then
      return query select v_role, 'claims_json'::text;
      return;
    end if;
  end if;

  v_role := nullif(current_setting('role', true), '');
  if v_role is not null and v_role <> 'none' then
    return query select v_role, 'set_role'::text;
    return;
  end if;

  return query select null::text, 'none'::text;
end
$$;

-- ── Section 3. Probe C — the runtime proof that gates T4 ────────────────────
-- Read-only, no PII, no mutation, no secret value. Returns what the resolver
-- above sees for the caller, so the owner can prove from the DEPLOYED
-- Production key that the trusted context resolves BEFORE any lifecycle write
-- is enabled. See PROBE_C_TRUSTED_CONTEXT_RUNBOOK.md.
create function public.vam069_trusted_context_probe()
returns table (
  api_role        text,
  claim_source    text,
  is_trusted      boolean,
  db_current_user text,
  probe_version   text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.api_role,
         r.claim_source,
         coalesce(r.api_role, '') = 'service_role',
         current_user::text,
         'VAM_PROD_S12_PROBE_C_v1'
  from public.vam063_trusted_api_role() r
$$;

-- ── Section 4. Shared authorization rule ────────────────────────────────────
-- Identical in shape and semantics to the reviewed migration-063 rule, so the
-- behaviour tested end-to-end on staging is the behaviour Production gets.
--
-- PHASE 5 NOTE, load-bearing: the second branch compares admin_scope_access
-- program_id/season_id against program/season UUIDs. Live Production stores
-- CODES in those columns ('UEHM-S11', 'UEHM', 'UEH Mentoring', 'VAM' —
-- Probe B), so on today's data that branch matches nothing and the ONLY route
-- to a lifecycle operation is an active super_admin. That is Decision A, and
-- it is why this release seeds no UEHM-S12 scope row: a code-form row would
-- not satisfy this function, and a UUID-form row would be the only row in the
-- table shaped differently from every other. The branch is kept, unmodified,
-- so that the eventual scope-representation decision changes data and not
-- this function.
create function public.vam063_authorized_for_scope(
  p_actor_admin_user_id uuid,
  p_program_id uuid,
  p_season_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where a.id = p_actor_admin_user_id and a.status = 'active' and (
      a.role = 'super_admin'
      or exists (
        select 1 from public.admin_scope_access s
        where s.user_id = a.auth_user_id and s.status = 'active'
          and s.role in ('full_access','operations')
          and s.program_id = p_program_id::text and s.season_id = p_season_id::text
      )
    )
  )
$$;

-- ── Section 5. The single transition core ───────────────────────────────────
-- Every wrapper below is a thin, status-specific call into this function: it
-- is the only place that writes person_season_memberships,
-- person_season_membership_log and admin_audit_log, so every transition gets
-- identical authorization, idempotency, history preservation and audit
-- behaviour. It never issues a DELETE.
--
-- The exception message texts are preserved verbatim from migration 063
-- because safeRpcMessage() in app/actions/membership-lifecycle.ts pattern
-- matches on their substrings ("reason required", "invalid status
-- transition", "not authorized", "membership not found", "cross-program").
-- Rewording them would silently degrade every operator-facing error message
-- to the generic fallback.
create function public.vam063_transition_membership_atomic(
  p_actor_admin_user_id uuid,
  p_membership_id uuid,
  p_allowed_from_statuses text[],
  p_to_status text,
  p_transition_type text,
  p_action_type text,
  p_reason text,
  p_reason_required boolean
) returns table (outcome_status text, membership_id uuid, old_status text, new_status text)
language plpgsql security definer set search_path = public
as $$
declare
  v_person_id uuid; v_program_id uuid; v_season_id uuid; v_role text; v_old_status text;
  v_api_role text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM063 trusted server context required';
  end if;
  if not exists (select 1 from public.admin_users where id = p_actor_admin_user_id and status = 'active') then
    raise exception 'VAM063 unauthorized actor';
  end if;
  if p_reason_required and nullif(btrim(p_reason), '') is null then
    raise exception 'VAM063 reason required for this transition';
  end if;

  select person_id, program_id, season_id, role, status
    into v_person_id, v_program_id, v_season_id, v_role, v_old_status
  from public.person_season_memberships where id = p_membership_id for update;
  if v_person_id is null then
    raise exception 'VAM063 membership not found';
  end if;

  if not public.vam063_authorized_for_scope(p_actor_admin_user_id, v_program_id, v_season_id) then
    raise exception 'VAM063 actor not authorized for this program-season scope';
  end if;

  -- Repeated requests are idempotent: already in the target state is a no-op,
  -- not an error, and writes no duplicate log or audit row.
  if v_old_status = p_to_status then
    return query select 'noop'::text, p_membership_id, v_old_status, v_old_status;
    return;
  end if;

  if not (v_old_status = any (p_allowed_from_statuses)) then
    raise exception 'VAM063 invalid status transition: % -> %', v_old_status, p_to_status;
  end if;

  update public.person_season_memberships
     set status = p_to_status, updated_at = now()
   where id = p_membership_id;

  insert into public.person_season_membership_log
    (membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
  values
    (p_membership_id, v_person_id, v_program_id, v_season_id, v_role, v_old_status, p_to_status, p_transition_type, p_reason, p_actor_admin_user_id);

  insert into public.admin_audit_log (actor_admin_user_id, action_type, before_data, after_data)
  values (
    p_actor_admin_user_id,
    p_action_type,
    jsonb_build_object('membership_id', p_membership_id, 'status', v_old_status),
    jsonb_build_object('membership_id', p_membership_id, 'status', p_to_status, 'role', v_role,
                       'program_id', v_program_id, 'season_id', v_season_id, 'reason', p_reason)
  );

  return query select 'transitioned'::text, p_membership_id, v_old_status, p_to_status;
end
$$;

-- ── Section 6. The seven entry points ───────────────────────────────────────
-- Names, argument order and return shape are fixed by the RC: they are read
-- straight out of RPC_BY_OPERATION and the addMembershipRoleAction call in
-- app/actions/membership-lifecycle.ts. Do not rename.

create function public.vam063_pause_membership(p_actor_admin_user_id uuid, p_membership_id uuid, p_reason text)
returns table (outcome_status text, membership_id uuid, old_status text, new_status text)
language sql security definer set search_path = public as $$
  select * from public.vam063_transition_membership_atomic(
    p_actor_admin_user_id, p_membership_id, array['active'], 'paused', 'pause', 'pause_membership', p_reason, false)
$$;

create function public.vam063_withdraw_membership(p_actor_admin_user_id uuid, p_membership_id uuid, p_reason text)
returns table (outcome_status text, membership_id uuid, old_status text, new_status text)
language sql security definer set search_path = public as $$
  select * from public.vam063_transition_membership_atomic(
    p_actor_admin_user_id, p_membership_id, array['active','paused','invited'], 'withdrawn', 'withdraw', 'withdraw_membership', p_reason, false)
$$;

create function public.vam063_opt_out_membership(p_actor_admin_user_id uuid, p_membership_id uuid, p_reason text)
returns table (outcome_status text, membership_id uuid, old_status text, new_status text)
language sql security definer set search_path = public as $$
  select * from public.vam063_transition_membership_atomic(
    p_actor_admin_user_id, p_membership_id, array['active','paused','invited'], 'opted_out', 'opt_out', 'opt_out_membership', p_reason, false)
$$;

-- Administrative cancellation requires a reason (DEC-07).
create function public.vam063_cancel_membership(p_actor_admin_user_id uuid, p_membership_id uuid, p_reason text)
returns table (outcome_status text, membership_id uuid, old_status text, new_status text)
language sql security definer set search_path = public as $$
  select * from public.vam063_transition_membership_atomic(
    p_actor_admin_user_id, p_membership_id, array['active','paused','withdrawn','opted_out','invited'], 'cancelled', 'cancel', 'cancel_membership', p_reason, true)
$$;

create function public.vam063_reactivate_membership(p_actor_admin_user_id uuid, p_membership_id uuid, p_reason text)
returns table (outcome_status text, membership_id uuid, old_status text, new_status text)
language sql security definer set search_path = public as $$
  select * from public.vam063_transition_membership_atomic(
    p_actor_admin_user_id, p_membership_id, array['paused','withdrawn','opted_out','cancelled'], 'active', 'reactivate', 'reactivate_membership', p_reason, false)
$$;

-- Remove role never deletes: it cancels that one role's membership and leaves
-- every other role for the same person+season untouched (DEC-07).
create function public.vam063_remove_membership_role(p_actor_admin_user_id uuid, p_membership_id uuid, p_reason text)
returns table (outcome_status text, membership_id uuid, old_status text, new_status text)
language sql security definer set search_path = public as $$
  select * from public.vam063_transition_membership_atomic(
    p_actor_admin_user_id, p_membership_id, array['active','paused','invited'], 'cancelled', 'role_removed', 'remove_membership_role', p_reason, true)
$$;

-- Add role creates a NEW membership row for the additional role and never
-- touches the person's other active roles. The transaction-scoped advisory
-- lock is keyed on exactly person_id + season_id + role, so two concurrent
-- add-role calls for the same identity serialize: the second observes the
-- first's committed row and returns a controlled no-op instead of surfacing a
-- raw unique_violation. The UNIQUE(person_id, season_id, role) constraint
-- remains the final database-level gate behind it.
create function public.vam063_add_membership_role(
  p_actor_admin_user_id uuid,
  p_person_id uuid,
  p_program_id uuid,
  p_season_id uuid,
  p_role text,
  p_reason text
) returns table (outcome_status text, membership_id uuid)
language plpgsql security definer set search_path = public
as $$
declare v_membership uuid; v_api_role text;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM063 trusted server context required';
  end if;
  if not exists (select 1 from public.admin_users where id = p_actor_admin_user_id and status = 'active') then
    raise exception 'VAM063 unauthorized actor';
  end if;
  if not public.vam063_authorized_for_scope(p_actor_admin_user_id, p_program_id, p_season_id) then
    raise exception 'VAM063 actor not authorized for this program-season scope';
  end if;
  if not exists (select 1 from public.programs p join public.seasons s on s.program_id = p.id
                  where p.id = p_program_id and p.is_active and s.id = p_season_id) then
    raise exception 'VAM063 invalid active program-season relationship';
  end if;
  if p_role not in ('mentor','mentee') then
    raise exception 'VAM063 unsupported participant role';
  end if;
  -- UEHM/HAM and S11/S12 isolation: a person already holding a membership in a
  -- DIFFERENT program for this same season can never be reassigned by this path.
  if exists (select 1 from public.person_season_memberships
              where person_id = p_person_id and program_id <> p_program_id and season_id = p_season_id) then
    raise exception 'VAM063 cross-program reassignment denied';
  end if;

  perform pg_advisory_xact_lock(hashtext('VAM063_ROLE|' || p_person_id::text || '|' || p_season_id::text || '|' || p_role));
  select id into v_membership from public.person_season_memberships
   where person_id = p_person_id and season_id = p_season_id and role = p_role;
  if v_membership is not null then
    return query select 'noop'::text, v_membership;
    return;
  end if;

  insert into public.person_season_memberships (person_id, program_id, season_id, role, status, source, created_by)
  values (p_person_id, p_program_id, p_season_id, p_role, 'active', 'manual', p_actor_admin_user_id)
  returning id into v_membership;

  insert into public.person_season_membership_log
    (membership_id, person_id, program_id, season_id, role, old_status, new_status, transition_type, reason, changed_by)
  values
    (v_membership, p_person_id, p_program_id, p_season_id, p_role, null, 'active', 'created', p_reason, p_actor_admin_user_id);

  insert into public.admin_audit_log (actor_admin_user_id, action_type, before_data, after_data)
  values (p_actor_admin_user_id, 'add_membership_role', null,
          jsonb_build_object('membership_id', v_membership, 'person_id', p_person_id,
                             'program_id', p_program_id, 'season_id', p_season_id, 'role', p_role));

  return query select 'created'::text, v_membership;
end
$$;

-- ── Section 7. Privileges ───────────────────────────────────────────────────
-- Everything is revoked from every API role. The probe is the ONE thing
-- service_role may call after T3, because proving the trusted context is
-- exactly what has to happen before T4.
revoke all on function
  public.vam063_trusted_api_role(),
  public.vam069_trusted_context_probe(),
  public.vam063_authorized_for_scope(uuid,uuid,uuid),
  public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean),
  public.vam063_pause_membership(uuid,uuid,text),
  public.vam063_withdraw_membership(uuid,uuid,text),
  public.vam063_opt_out_membership(uuid,uuid,text),
  public.vam063_cancel_membership(uuid,uuid,text),
  public.vam063_reactivate_membership(uuid,uuid,text),
  public.vam063_remove_membership_role(uuid,uuid,text),
  public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)
from public, anon, authenticated, service_role;

grant execute on function public.vam069_trusted_context_probe() to service_role;

-- ── Section 8. Post-conditions ──────────────────────────────────────────────
do $t3_post$
declare
  v_n integer;
  v_txt text;
  v_entry constant text[] := array[
    'vam063_pause_membership','vam063_withdraw_membership','vam063_opt_out_membership',
    'vam063_cancel_membership','vam063_reactivate_membership','vam063_remove_membership_role',
    'vam063_add_membership_role'
  ];
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'vam063\_%' or p.proname like 'vam069\_%');
  if v_n <> 11 then
    raise exception 'T3 ABORTED [OBJECT_COUNT]: expected 11 functions, found %', v_n;
  end if;

  -- Every entry point must be SECURITY DEFINER with a pinned search_path, or
  -- it is not safe to grant to service_role in T4.
  select string_agg(p.proname, ', ' order by p.proname) into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any (v_entry)
    and (not p.prosecdef or p.proconfig is null or not (p.proconfig::text like '%search_path=public%'));
  if v_txt is not null then
    raise exception 'T3 ABORTED [FUNCTION_HARDENING]: % is not SECURITY DEFINER with SET search_path=public', v_txt;
  end if;

  -- Execution must still be withheld from every entry point.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(v_entry) x
  where has_function_privilege('service_role', (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                                where n.nspname='public' and p.proname = x limit 1), 'execute');
  if v_txt is not null then
    raise exception 'T3 ABORTED [EXECUTE_NOT_WITHHELD]: service_role can already execute %. T4 must be the only thing that grants it.', v_txt;
  end if;

  if not has_function_privilege('service_role', 'public.vam069_trusted_context_probe()', 'execute') then
    raise exception 'T3 ABORTED [PROBE_NOT_EXECUTABLE]: service_role cannot run Probe C, so T4 could never be justified.';
  end if;

  -- No API role may reach the internal helpers, ever.
  foreach v_txt in array array['anon','authenticated'] loop
    if has_function_privilege(v_txt, 'public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)', 'execute')
       or has_function_privilege(v_txt, 'public.vam063_authorized_for_scope(uuid,uuid,uuid)', 'execute')
       or has_function_privilege(v_txt, 'public.vam069_trusted_context_probe()', 'execute') then
      raise exception 'T3 ABORTED [HELPER_EXPOSED]: % can execute an internal function', v_txt;
    end if;
  end loop;

  select count(distinct m[1]) into v_n
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
  where c.conrelid = 'public.person_season_membership_log'::regclass
    and c.conname = 'person_season_membership_log_transition_type_check';
  if v_n <> 13 then
    raise exception 'T3 ABORTED [TRANSITION_VOCAB_SIZE]: expected 13 values, found %', v_n;
  end if;
end
$t3_post$;

notify pgrst, 'reload schema';

commit;
