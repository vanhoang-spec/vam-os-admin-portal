-- 20260904120000_manual_bulk_assignment.sql

create or replace function public.vam094_assign_selected_application_reviews(
  p_application_ids uuid[],
  p_reviewer_id uuid,
  p_review_round text,
  p_due_at timestamptz,
  p_assignment_note text,
  p_actor uuid
) returns table (
  batch_id uuid,
  applications_assigned integer,
  reviewer_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_season_id uuid;
  v_intake_batch_id uuid;
  v_batch_id uuid;
  v_app_id uuid;
  v_found_count integer;
  v_batch_count integer;
  v_season_count integer;
  v_role_count integer;
begin
  if current_user <> 'service_role' then raise exception 'Trusted server context required'; end if;
  if p_review_round not in ('profile_screening','interview') then raise exception 'Invalid review round'; end if;
  if coalesce(cardinality(p_application_ids), 0) < 1 then raise exception 'Application IDs must not be empty'; end if;
  if cardinality(p_application_ids) > 500 then raise exception 'Cannot assign more than 500 applications at once'; end if;
  if (select count(distinct value) from unnest(p_application_ids) requested(value)) <> cardinality(p_application_ids) then
    raise exception 'Application IDs must be unique';
  end if;

  -- Validate uniform batch, season, and role
  select count(a.id), count(distinct a.intake_batch_id), count(distinct b.season_id), count(distinct lower(coalesce(a.role_applied::text, '')))
  into v_found_count, v_batch_count, v_season_count, v_role_count
  from public.applications a
  join public.intake_batches b on b.id = a.intake_batch_id
  where a.id = any(p_application_ids);

  if v_found_count <> cardinality(p_application_ids) then
    raise exception 'One or more application IDs do not exist';
  end if;
  if v_batch_count <> 1 or v_season_count <> 1 or v_role_count <> 1 then
    raise exception 'All selected applications must belong to exactly one intake batch and have the same role_applied';
  end if;

  select a.intake_batch_id, b.season_id
  into v_intake_batch_id, v_season_id
  from public.applications a
  join public.intake_batches b on b.id = a.intake_batch_id
  where a.id = p_application_ids[1];

  -- Check operator authority
  if not public.vam084_operator_for_season(p_actor, v_season_id) then
    raise exception 'Assignment batch scope denied';
  end if;

  -- Check reviewer eligibility
  if not public.vam084_participant_for_stage(p_reviewer_id, v_season_id, p_review_round) then
    raise exception 'Target assignee is not an active participant for this season and stage';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_intake_batch_id::text || ':' || p_review_round, 0));

  -- Validate applications status semantics
  if exists (
    select 1
    from public.applications a
    where a.id = any(p_application_ids)
      and not (
        (p_review_round = 'profile_screening' and (
          a.status in ('submitted','under_data_check','ready_for_screening','screening_assigned')
          or (a.status = 'needs_more_review' and not exists (
            select 1 from public.application_reviews ar 
            where ar.application_id = a.id and ar.review_round = 'interview' and ar.status <> 'cancelled'
          ))
        ))
        or (p_review_round = 'interview' and (
          a.status in ('invited_to_interview','interview_scheduled','interview_in_progress')
          or (a.status = 'needs_more_review' and exists (
            select 1 from public.application_reviews ar 
            where ar.application_id = a.id and ar.review_round = 'interview' and ar.status <> 'cancelled'
          ))
        ))
      )
  ) then
    raise exception 'One or more selected applications have an invalid status for this review round';
  end if;

  -- Check for existing assignments
  if exists (
    select 1 from public.application_reviews ar
    where ar.application_id = any(p_application_ids)
      and ar.review_round = p_review_round
      and ar.status <> 'cancelled'
  ) then
    raise exception 'One or more applications are already assigned for this round';
  end if;

  -- Lock rows FOR UPDATE in stable order
  perform a.id
  from public.applications a
  where a.id = any(p_application_ids)
  order by a.id
  for update;

  insert into public.review_assignment_batches (
    intake_batch_id,
    review_round,
    created_by,
    due_at,
    assignment_note,
    application_count,
    reviewer_count
  ) values (
    v_intake_batch_id,
    p_review_round,
    p_actor,
    p_due_at,
    nullif(btrim(p_assignment_note), ''),
    cardinality(p_application_ids),
    1
  ) returning id into v_batch_id;

  foreach v_app_id in array p_application_ids loop
    insert into public.application_reviews (
      application_id,
      reviewer_admin_user_id,
      review_round,
      status,
      assigned_by,
      assignment_batch_id,
      due_at
    ) values (
      v_app_id,
      p_reviewer_id,
      p_review_round,
      'assigned',
      p_actor,
      v_batch_id,
      p_due_at
    );
    perform public.vam084_recompute_application_review_status(v_app_id, p_review_round);
  end loop;

  return query select
    v_batch_id,
    cardinality(p_application_ids),
    p_reviewer_id;
end;
$fn$;

revoke all on function public.vam094_assign_selected_application_reviews(uuid[], uuid, text, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.vam094_assign_selected_application_reviews(uuid[], uuid, text, timestamptz, text, uuid) to service_role;
