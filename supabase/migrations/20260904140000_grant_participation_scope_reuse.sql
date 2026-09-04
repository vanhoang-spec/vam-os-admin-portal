-- 20260904140000_grant_participation_scope_reuse.sql
--
-- ===========================================================================
-- Cấp Interviewer failed for every Core Team / Admin account on Production.
-- ===========================================================================
--
-- WHAT HAPPENED
--   Production, 2026-09-04. Super Admin could grant Interviewer; six separate
--   active Core Team / Admin accounts could not, all with the same error:
--
--     23505 duplicate key value violates unique constraint
--           "admin_scope_access_active_scope_key"
--     Key (user_id, program_id, season_id)=(…, …, …) already exists.
--
--   `vam084_grant_recruitment_participation` unconditionally inserts a
--   `role='review'` scope row, guarded by
--
--     on conflict (user_id, coalesce(program_id,''), coalesce(season_id,''), role)
--       where (status = 'active') do nothing
--
--   That ON CONFLICT target INCLUDES `role`. Production additionally enforces
--   `admin_scope_access_active_scope_key` on (user_id, program_id, season_id)
--   among active rows — WITHOUT `role`. So for an account that already holds an
--   active `operations` scope for the same season, the new `review` row is not
--   a conflict on the role-inclusive index (DO NOTHING never fires) but IS a
--   violation of the role-agnostic one. The insert therefore raised instead of
--   being skipped, and the whole grant transaction rolled back.
--
--   Super Admin succeeded only because that account held no active scope row
--   for the season — nothing to collide with. It was never a permissions
--   difference, which is why the failure looked arbitrary.
--
-- THE POLICY THIS ENCODES
--   A season scope is a PRE-CONDITION for recruitment work, not a side effect
--   of it. `vam084_participant_for_stage` and `vam084_operator_for_season` both
--   accept `role in ('review','operations','full_access')` for the target
--   season, or `super_admin` outright. An account that already satisfies that
--   predicate needs nothing added; inserting a second active row for it was
--   never what made it eligible, only what made the grant fail.
--
--   So: reuse an existing qualifying scope, create one only when none exists,
--   and never stack a second active row for the same user/program/season.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * It does not drop, alter or weaken `admin_scope_access_active_scope_key`
--     or the role-inclusive index. Both stay exactly as they are.
--   * It does not widen who may be granted. Every authorization check —
--     operator-for-season, identity/email match, Auth-link collision,
--     duplicate-account, privileged-inactive — is preserved verbatim.
--   * It does not touch an existing `operations` or `full_access` row. They are
--     read, never modified, so Core Team operational scopes are untouched.
--   * It creates no people, no admin_users and no Auth identity it did not
--     already create, and the reviewer/interviewer membership stays scoped to
--     the target season exactly as before.
--
--   Additive CREATE OR REPLACE. Same name, same six-argument signature, same
--   uuid return, same execute ACL.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.vam084_grant_recruitment_participation(
  p_actor uuid,
  p_person_id uuid,
  p_season_id uuid,
  p_participation_role text,
  p_auth_user_id uuid,
  p_email text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_program_id uuid;
  v_person_email text;
  v_admin_id uuid;
  v_existing_auth uuid;
  v_existing_role text;
  v_existing_status text;
  v_old_membership_status text;
  v_membership_id uuid;
  v_target_role text;
  v_has_qualifying_scope boolean;
  v_has_active_scope boolean;
begin
  if p_participation_role not in ('reviewer', 'interviewer') then
    raise exception 'Unsupported recruitment participation role';
  end if;
  if not public.vam084_operator_for_season(p_actor, p_season_id) then
    raise exception 'Recruitment participation grant rejected';
  end if;

  select s.program_id into v_program_id
  from public.seasons s
  where s.id = p_season_id;
  select lower(btrim(p.email_primary)) into v_person_email
  from public.people p
  where p.id = p_person_id;

  if v_program_id is null or v_person_email is null or v_person_email <> lower(btrim(p_email)) then
    raise exception 'Recruitment participant identity or season is invalid';
  end if;
  if exists (
    select 1 from public.admin_users au
    where au.auth_user_id = p_auth_user_id and lower(btrim(au.email)) <> v_person_email
  ) then
    raise exception 'Auth identity is already linked to another account';
  end if;
  if (select count(*) from public.admin_users au where lower(btrim(au.email)) = v_person_email) > 1 then
    raise exception 'Duplicate admin account emails must be reconciled first';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_person_id::text || ':' || p_season_id::text || ':' || p_participation_role, 0)
  );

  select au.id, au.auth_user_id, au.role, au.status
    into v_admin_id, v_existing_auth, v_existing_role, v_existing_status
  from public.admin_users au
  where lower(btrim(au.email)) = v_person_email
  for update;

  if v_admin_id is null then
    insert into public.admin_users (auth_user_id, email, full_name, role, status)
    select p_auth_user_id, v_person_email, p.full_name, 'reviewer', 'active'
    from public.people p where p.id = p_person_id
    returning id into v_admin_id;
  else
    if v_existing_auth is not null and v_existing_auth <> p_auth_user_id then
      raise exception 'Account email is linked to a different Auth identity';
    end if;
    if v_existing_role not in ('viewer','support_team','reviewer','core_team','admin','super_admin') then
      raise exception 'Existing account role cannot join recruitment';
    end if;
    if v_existing_role in ('core_team','admin','super_admin') and v_existing_status <> 'active' then
      raise exception 'Inactive privileged accounts require super-admin reactivation';
    end if;
    update public.admin_users
       set auth_user_id = coalesce(auth_user_id, p_auth_user_id),
           role = case when role in ('viewer','support_team') then 'reviewer' else role end,
           status = case when role in ('core_team','admin','super_admin') then status else 'active' end,
           updated_at = now()
     where id = v_admin_id;
  end if;

  -- ── Season scope: reuse, never stack ────────────────────────────────────
  --
  -- Read the account role back AFTER the upsert above, because a viewer /
  -- support_team account was just promoted to 'reviewer' and the pre-update
  -- value would be stale.
  select au.role into v_target_role
  from public.admin_users au
  where au.id = v_admin_id;

  -- A super_admin satisfies both eligibility predicates on role alone, so a
  -- season scope row would be inert. Skipping it also avoids manufacturing a
  -- season-scoped row for an account whose authority is deliberately global.
  if v_target_role is distinct from 'super_admin' then
    -- Exact-season match only. That is what the eligibility predicates test,
    -- and it is what the partial unique indexes key on, so a program-wide
    -- (season_id is null) row neither qualifies here nor collides below.
    select
      count(*) filter (where asa.role in ('review','operations','full_access')) > 0,
      count(*) > 0
      into v_has_qualifying_scope, v_has_active_scope
    from public.admin_scope_access asa
    where asa.user_id = p_auth_user_id
      and asa.status = 'active'
      and asa.program_id = v_program_id::text
      and asa.season_id = p_season_id::text;

    if v_has_qualifying_scope then
      -- Already eligible for this season. Leave the existing row exactly as it
      -- is: an 'operations' or 'full_access' grant is an operational decision
      -- that this function has no business narrowing to 'review'.
      null;
    elsif v_has_active_scope then
      -- An active scope exists but none of its roles qualify. Inserting would
      -- violate the (user, program, season) active-scope index, and silently
      -- succeeding would hand back an account the stage predicates still
      -- reject. Refuse with a reason an operator can act on.
      raise exception 'Account holds a non-qualifying active scope for this season; reconcile it before granting recruitment participation';
    else
      begin
        insert into public.admin_scope_access (
          user_id, program_id, season_id, role, status
        ) values (
          p_auth_user_id, v_program_id::text, p_season_id::text, 'review', 'active'
        );
      exception when unique_violation then
        -- A concurrent grant for the OTHER participation role created the scope
        -- between the check and the insert. The advisory lock above is keyed on
        -- (person, season, participation_role), so reviewer and interviewer
        -- grants for one person do not exclude each other. Reusing what that
        -- transaction created is the correct outcome, and catching the
        -- violation keeps this correct whichever of the two active-scope
        -- indexes fires.
        null;
      end;
    end if;
  end if;

  select psm.id, psm.status into v_membership_id, v_old_membership_status
  from public.person_season_memberships psm
  where psm.person_id = p_person_id
    and psm.season_id = p_season_id
    and psm.role = p_participation_role
  order by psm.created_at desc
  limit 1
  for update;

  if v_membership_id is null then
    insert into public.person_season_memberships (
      person_id, program_id, season_id, role, status, source, created_by
    ) values (
      p_person_id, v_program_id, p_season_id, p_participation_role,
      'active', 'manual', p_actor
    ) returning id into v_membership_id;
  else
    update public.person_season_memberships
       set status = 'active', end_date = null, updated_at = now()
     where id = v_membership_id;
  end if;

  if v_old_membership_status is distinct from 'active' then
    insert into public.person_season_membership_log (
      membership_id, person_id, program_id, season_id, role,
      old_status, new_status, transition_type, reason, changed_by
    ) values (
      v_membership_id, p_person_id, v_program_id, p_season_id,
      p_participation_role, v_old_membership_status, 'active',
      case when v_old_membership_status is null then 'created' else 'status_change' end,
      'S12 recruitment participation grant', p_actor
    );
  end if;

  insert into public.admin_audit_log (
    actor_admin_user_id, target_admin_user_id, action_type, details
  ) values (
    p_actor, v_admin_id, 'update_admin_user_access',
    jsonb_build_object(
      'operation', 'grant_recruitment_participation',
      'person_id', p_person_id,
      'season_id', p_season_id,
      'participation_role', p_participation_role
    )
  );

  return v_admin_id;
end;
$function$;

-- Re-assert the execute ACL. CREATE OR REPLACE preserves existing privileges,
-- so this is belt-and-braces: these are trusted RPCs and anon/authenticated
-- must never execute them.
revoke all on function public.vam084_grant_recruitment_participation(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.vam084_grant_recruitment_participation(uuid, uuid, uuid, text, uuid, text) to service_role;
