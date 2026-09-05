-- VAM OS S12 — Official Approval -> Membership Migration
--
-- Atomic membership migration: when official approval mutation runs, insert
-- person_season_memberships (active) alongside application update.
-- Revert membership to `invited` if approval is revoked.

begin;

-- ---- vam090_finalize_recruitment_approval ------------------------
CREATE OR REPLACE FUNCTION public.vam090_finalize_recruitment_approval(
  p_application_id uuid,
  p_new_status text,
  p_actor uuid,
  p_person_id uuid,
  p_expected_status text,
  p_decision_note text DEFAULT NULL::text
)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_app public.applications%rowtype;
  v_gate record;
  v_actor_name text;
  v_program_id uuid;
  v_membership_id uuid;
  v_old_membership_status text;
begin
  if current_user <> 'service_role'
     or p_new_status not in ('approved_as_mentor','approved_as_mentee') then
    raise exception 'Trusted recruitment approval context required';
  end if;

  select a.* into v_app
  from public.applications a
  where a.id = p_application_id
  for update;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.status is distinct from p_expected_status then
    raise exception 'Application status changed';
  end if;
  if not public.vam084_operator_for_season(p_actor, v_app.season_id) then
    raise exception 'Approval scope denied';
  end if;
  if not exists (select 1 from public.people p where p.id = p_person_id) then
    raise exception 'Approval person not found';
  end if;

  select * into v_gate
  from public.vam084_application_decision_eligibility(p_application_id, p_new_status);
  if not coalesce(v_gate.eligible, false) then
    raise exception 'Recruitment approval lifecycle gate rejected: %', coalesce(v_gate.reason, 'ineligible');
  end if;

  select coalesce(nullif(btrim(au.full_name), ''), au.email) into v_actor_name
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor_name is null then raise exception 'Approval actor not found'; end if;

  update public.applications
  set status = p_new_status, person_id = p_person_id
  where id = p_application_id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    p_application_id, p_actor, v_actor_name, p_new_status,
    v_app.status, p_new_status, nullif(btrim(p_decision_note), '')
  );

  -- [NEW] Insert or update person_season_memberships atomically
  select s.program_id into v_program_id from public.seasons s where s.id = v_app.season_id;

  select psm.id, psm.status into v_membership_id, v_old_membership_status
  from public.person_season_memberships psm
  where psm.person_id = p_person_id
    and psm.season_id = v_app.season_id
    and psm.role = v_app.role_applied
  order by psm.created_at desc
  limit 1
  for update;

  if v_membership_id is null then
    insert into public.person_season_memberships (
      person_id, program_id, season_id, role, status, source, created_by
    ) values (
      p_person_id, v_program_id, v_app.season_id, v_app.role_applied,
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
      v_membership_id, p_person_id, v_program_id, v_app.season_id,
      v_app.role_applied, v_old_membership_status, 'active',
      case when v_old_membership_status is null then 'created' else 'status_change' end,
      'S12 recruitment official approval', p_actor
    );
  end if;

  return true;
end;
$function$;

-- ---- vam084_apply_application_decisions --------------------------
CREATE OR REPLACE FUNCTION public.vam084_apply_application_decisions(
  p_application_ids uuid[],
  p_new_status text,
  p_actor uuid,
  p_decision_note text DEFAULT NULL::text,
  p_expected_statuses jsonb DEFAULT '{}'::jsonb
)
 RETURNS TABLE(application_id uuid, previous_status text, new_status text, applied boolean, reason text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_requested integer;
  v_distinct integer;
  v_loaded integer;
  v_row record;
  v_gate record;
  v_actor_name text;
  v_program_id uuid;
  v_membership_id uuid;
  v_old_membership_status text;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;
  v_requested := coalesce(cardinality(p_application_ids), 0);
  select count(distinct value) into v_distinct
  from unnest(coalesce(p_application_ids, array[]::uuid[])) as requested(value);
  if v_requested < 1 or v_requested > 500 or v_distinct <> v_requested then
    raise exception 'Application decision request must contain 1-500 unique IDs';
  end if;
  select coalesce(nullif(btrim(au.full_name), ''), au.email) into v_actor_name
  from public.admin_users au where au.id = p_actor and au.status = 'active';
  if v_actor_name is null then raise exception 'Decision actor not found'; end if;

  perform a.id from public.applications a
  where a.id = any(p_application_ids)
  order by a.id for update;
  get diagnostics v_loaded = row_count;
  if v_loaded <> v_requested then raise exception 'One or more applications were not found'; end if;

  for v_row in
    select a.id, a.season_id, a.status, a.person_id, a.role_applied
    from public.applications a
    where a.id = any(p_application_ids)
    order by a.id
  loop
    if not public.vam084_operator_for_season(p_actor, v_row.season_id) then
      return query select v_row.id::uuid, v_row.status::text, p_new_status, false, 'scope_denied'::text;
      continue;
    end if;
    if not (p_expected_statuses ? v_row.id::text) then
      return query select v_row.id::uuid, v_row.status::text, p_new_status, false, 'expected_status_missing'::text;
      continue;
    end if;
    if (p_expected_statuses ->> v_row.id::text) is distinct from coalesce(v_row.status, '') then
      return query select v_row.id::uuid, v_row.status::text, p_new_status, false, 'stale_status'::text;
      continue;
    end if;
    select * into v_gate
    from public.vam084_application_decision_eligibility(v_row.id, p_new_status);
    if not coalesce(v_gate.eligible, false) then
      return query select v_row.id::uuid, v_row.status::text, p_new_status, false,
        coalesce(v_gate.reason, 'ineligible')::text;
      continue;
    end if;
    update public.applications set status = p_new_status where id = v_row.id;
    insert into public.application_decisions (
      application_id, decided_by, decided_by_name, decision,
      previous_status, new_status, decision_note
    ) values (
      v_row.id, p_actor, v_actor_name, p_new_status,
      v_row.status, p_new_status, nullif(btrim(p_decision_note), '')
    );

    -- [NEW] Revert membership to invited if approval is revoked
    if v_row.status in ('approved_as_mentor', 'approved_as_mentee')
       and p_new_status not in ('approved_as_mentor', 'approved_as_mentee') 
       and v_row.person_id is not null then
      
      select s.program_id into v_program_id from public.seasons s where s.id = v_row.season_id;

      select psm.id, psm.status into v_membership_id, v_old_membership_status
      from public.person_season_memberships psm
      where psm.person_id = v_row.person_id
        and psm.season_id = v_row.season_id
        and psm.role = v_row.role_applied
      order by psm.created_at desc
      limit 1
      for update;

      if v_membership_id is not null and v_old_membership_status = 'active' then
        update public.person_season_memberships
           set status = 'invited', updated_at = now()
         where id = v_membership_id;

        insert into public.person_season_membership_log (
          membership_id, person_id, program_id, season_id, role,
          old_status, new_status, transition_type, reason, changed_by
        ) values (
          v_membership_id, v_row.person_id, v_program_id, v_row.season_id,
          v_row.role_applied, 'active', 'invited', 'status_change',
          'S12 recruitment official approval revoked', p_actor
        );
      end if;
    end if;

    return query select v_row.id::uuid, v_row.status::text, p_new_status, true, 'applied'::text;
  end loop;
end;
$function$;


-- Execute ACL
revoke all on function public.vam084_apply_application_decisions(uuid[], text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.vam084_apply_application_decisions(uuid[], text, uuid, text, jsonb) to service_role;

revoke all on function public.vam090_finalize_recruitment_approval(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.vam090_finalize_recruitment_approval(uuid, text, uuid, uuid, text, text) to service_role;

commit;
