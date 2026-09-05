-- P1: quarantine withdrawn applications from recruitment operations and add
-- a narrowly-scoped, audited restore boundary. This file is intentionally not
-- applied by the candidate-building workflow.

-- One canonical database predicate for every assignment mutation. The
-- positive allowlists and needs_more_review provenance exactly preserve the
-- existing M094/M090 behavior; terminal states fail by absence.
create or replace function public.vam095_application_review_assignability(
  p_application_id uuid,
  p_review_round text
) returns table(assignable boolean, reason text)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_status text;
  v_has_interview_review boolean;
begin
  select a.status into v_status
  from public.applications a
  where a.id = p_application_id;

  if not found then
    return query select false, 'application_not_found'::text;
    return;
  end if;
  if p_review_round not in ('profile_screening', 'interview') then
    return query select false, 'invalid_review_round'::text;
    return;
  end if;

  select exists (
    select 1
    from public.application_reviews ar
    where ar.application_id = p_application_id
      and ar.review_round = 'interview'
  ) into v_has_interview_review;

  if p_review_round = 'profile_screening' then
    return query select
      v_status in ('submitted', 'under_data_check', 'ready_for_screening', 'screening_assigned')
        or (v_status = 'needs_more_review' and not v_has_interview_review),
      case
        when v_status = 'withdrawn' then 'application_withdrawn'
        when v_status in ('submitted', 'under_data_check', 'ready_for_screening', 'screening_assigned')
          or (v_status = 'needs_more_review' and not v_has_interview_review) then 'assignable'
        else 'invalid_application_status'
      end;
  else
    return query select
      v_status in ('invited_to_interview', 'interview_scheduled', 'interview_in_progress')
        or (v_status = 'needs_more_review' and v_has_interview_review),
      case
        when v_status = 'withdrawn' then 'application_withdrawn'
        when v_status in ('invited_to_interview', 'interview_scheduled', 'interview_in_progress')
          or (v_status = 'needs_more_review' and v_has_interview_review) then 'assignable'
        else 'invalid_application_status'
      end;
  end if;
end;
$fn$;

-- Atomic individual assignment. The application row is locked before the
-- canonical predicate and duplicate checks, closing the check/insert race with
-- withdrawal.
create or replace function public.vam095_assign_application_review(
  p_application_id uuid,
  p_reviewer_id uuid,
  p_review_round text,
  p_due_at timestamptz,
  p_actor uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_app public.applications%rowtype;
  v_gate record;
  v_review_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;
  if p_review_round not in ('profile_screening', 'interview') then
    raise exception 'Invalid review round';
  end if;

  select a.* into v_app
  from public.applications a
  where a.id = p_application_id
  for update;
  if v_app.id is null then
    raise exception 'Application not found';
  end if;
  if not public.vam084_operator_for_season(p_actor, v_app.season_id) then
    raise exception 'Assignment scope denied';
  end if;

  select * into v_gate
  from public.vam095_application_review_assignability(p_application_id, p_review_round);
  if not coalesce(v_gate.assignable, false) then
    if v_gate.reason = 'application_withdrawn' then
      raise exception 'APPLICATION_WITHDRAWN';
    end if;
    raise exception 'Application is not assignable for this review round';
  end if;

  if not public.vam084_participant_for_stage(p_reviewer_id, v_app.season_id, p_review_round) then
    raise exception 'Target assignee is not an active participant for this season and stage';
  end if;
  if exists (
    select 1
    from public.application_reviews ar
    where ar.application_id = p_application_id
      and ar.review_round = p_review_round
      and ar.reviewer_admin_user_id = p_reviewer_id
      and ar.status <> 'cancelled'
  ) then
    raise exception 'Reviewer is already assigned to this application and round';
  end if;

  insert into public.application_reviews (
    application_id, reviewer_admin_user_id, assigned_by, review_round,
    assigned_at, due_at, status
  ) values (
    p_application_id, p_reviewer_id, p_actor, p_review_round,
    now(), p_due_at, 'assigned'
  ) returning id into v_review_id;

  perform public.vam084_recompute_application_review_status(p_application_id, p_review_round);
  return v_review_id;
end;
$fn$;

-- Cancellation remains available for correcting a legacy inconsistent row on
-- a withdrawn application. Reassignment, however, creates a new operational
-- review and therefore passes the same locked application predicate as every
-- other assignment path. Skipping recompute while withdrawn also prevents a
-- corrective cancellation from accidentally reopening the application.
create or replace function public.vam084_change_review_assignment(
  p_review_id uuid,
  p_actor uuid,
  p_reason text,
  p_new_reviewer uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_application_id uuid;
  v_app public.applications%rowtype;
  v_review public.application_reviews%rowtype;
  v_gate record;
  v_replacement uuid;
begin
  if current_user <> 'service_role'
     or length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Assignment change rejected';
  end if;

  select ar.application_id into v_application_id
  from public.application_reviews ar
  where ar.id = p_review_id;
  if v_application_id is null then
    raise exception 'Review not found';
  end if;

  select a.* into v_app
  from public.applications a
  where a.id = v_application_id
  for update;
  if v_app.id is null then
    raise exception 'Application not found';
  end if;

  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if v_review.id is null
     or v_review.application_id <> v_app.id
     or v_review.status not in ('assigned', 'in_progress', 'returned_for_clarification') then
    raise exception 'Review is not cancellable';
  end if;
  if not public.vam084_operator_for_season(p_actor, v_app.season_id) then
    raise exception 'Assignment scope denied';
  end if;

  if p_new_reviewer is not null then
    select * into v_gate
    from public.vam095_application_review_assignability(v_app.id, v_review.review_round);
    if not coalesce(v_gate.assignable, false) then
      if v_gate.reason = 'application_withdrawn' then
        raise exception 'APPLICATION_WITHDRAWN';
      end if;
      raise exception 'Application is not assignable for this review round';
    end if;
    if p_new_reviewer = v_review.reviewer_admin_user_id
       or not public.vam084_participant_for_stage(
         p_new_reviewer, v_app.season_id, v_review.review_round
       )
       or exists (
         select 1
         from public.application_reviews ar
         where ar.application_id = v_review.application_id
           and ar.review_round = v_review.review_round
           and ar.reviewer_admin_user_id = p_new_reviewer
           and ar.status <> 'cancelled'
       ) then
      raise exception 'Replacement reviewer rejected';
    end if;
  end if;

  update public.application_reviews
  set status = 'cancelled', updated_at = now()
  where id = v_review.id;

  if p_new_reviewer is not null then
    insert into public.application_reviews (
      application_id, reviewer_admin_user_id, assigned_by, review_round, due_at, status
    ) values (
      v_review.application_id, p_new_reviewer, p_actor,
      v_review.review_round, v_review.due_at, 'assigned'
    ) returning id into v_replacement;
  end if;

  insert into public.recruitment_assignment_events (
    application_id, review_round, event_type, previous_review_id,
    replacement_review_id, previous_reviewer_admin_user_id,
    new_reviewer_admin_user_id, actor_admin_user_id, reason
  ) values (
    v_review.application_id, v_review.review_round,
    case when p_new_reviewer is null then 'cancelled' else 'reassigned' end,
    v_review.id, v_replacement, v_review.reviewer_admin_user_id,
    p_new_reviewer, p_actor, btrim(p_reason)
  );

  if v_app.status <> 'withdrawn' then
    perform public.vam084_recompute_application_review_status(
      v_review.application_id, v_review.review_round
    );
  end if;
  return coalesce(v_replacement, v_review.id);
end;
$fn$;

-- Draft saving changes assigned -> in_progress, so it is also a recruitment
-- mutation. Lock application first, then review, and refuse a stale withdrawn
-- page before creating that operational state.
create or replace function public.vam095_save_application_review_draft(
  p_review_id uuid,
  p_actor uuid,
  p_score_motivation integer default null,
  p_score_goal_clarity integer default null,
  p_score_commitment integer default null,
  p_score_fit integer default null,
  p_score_communication integer default null,
  p_recommendation text default null,
  p_reviewer_note text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_application_id uuid;
  v_app public.applications%rowtype;
  v_review public.application_reviews%rowtype;
  v_actor_role text;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select ar.application_id into v_application_id
  from public.application_reviews ar
  where ar.id = p_review_id;
  if v_application_id is null then
    raise exception 'Review not found';
  end if;

  select a.* into v_app
  from public.applications a
  where a.id = v_application_id
  for update;
  if v_app.id is null then
    raise exception 'Application not found';
  end if;
  if v_app.status = 'withdrawn' then
    raise exception 'APPLICATION_WITHDRAWN';
  end if;

  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if v_review.id is null
     or v_review.status not in ('assigned', 'in_progress', 'returned_for_clarification') then
    raise exception 'Review is not editable';
  end if;

  select au.role into v_actor_role
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor_role not in ('reviewer', 'super_admin', 'admin', 'core_team')
     or v_review.reviewer_admin_user_id <> p_actor
     or not public.vam084_participant_for_stage(p_actor, v_app.season_id, v_review.review_round) then
    raise exception 'Review draft actor is not the authorized assignee';
  end if;
  if exists (
    select 1 from unnest(array[
      p_score_motivation, p_score_goal_clarity, p_score_commitment,
      p_score_fit, p_score_communication
    ]) as score(value)
    where value is not null and value not between 1 and 5
  ) then
    raise exception 'Review scores must be between 1 and 5';
  end if;

  update public.application_reviews
  set status = 'in_progress',
      score_motivation = p_score_motivation,
      score_goal_clarity = p_score_goal_clarity,
      score_commitment = p_score_commitment,
      score_fit = p_score_fit,
      score_communication = p_score_communication,
      recommendation = p_recommendation,
      reviewer_note = p_reviewer_note,
      updated_at = now()
  where id = p_review_id;

  return p_review_id;
end;
$fn$;

-- Restore the existing submit function with lock order application -> review
-- and an authoritative withdrawn guard inside the transaction.
create or replace function public.vam084_submit_application_review(
  p_review_id uuid,
  p_actor uuid,
  p_score_motivation integer default null,
  p_score_goal_clarity integer default null,
  p_score_commitment integer default null,
  p_score_fit integer default null,
  p_score_communication integer default null,
  p_recommendation text default null,
  p_reviewer_note text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_application_id uuid;
  v_app public.applications%rowtype;
  v_review public.application_reviews%rowtype;
  v_actor_role text;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  select ar.application_id into v_application_id
  from public.application_reviews ar
  where ar.id = p_review_id;
  if v_application_id is null then
    raise exception 'Review not found';
  end if;

  select a.* into v_app
  from public.applications a
  where a.id = v_application_id
  for update;
  if v_app.id is null then
    raise exception 'Application not found';
  end if;
  if v_app.status = 'withdrawn' then
    raise exception 'APPLICATION_WITHDRAWN';
  end if;

  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if v_review.id is null
     or v_review.status not in ('assigned', 'in_progress', 'returned_for_clarification') then
    raise exception 'Review is not editable';
  end if;

  select au.role into v_actor_role
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor_role not in ('reviewer', 'super_admin', 'admin', 'core_team')
     or v_review.reviewer_admin_user_id <> p_actor
     or not public.vam084_participant_for_stage(p_actor, v_app.season_id, v_review.review_round) then
    raise exception 'Review submission actor is not the authorized assignee';
  end if;
  if p_recommendation is null or p_recommendation not in (
    'pass_to_interview', 'approve_recommended', 'waitlist', 'reject', 'needs_admin_review'
  ) then
    raise exception 'Invalid recommendation';
  end if;
  if exists (
    select 1 from unnest(array[
      p_score_motivation, p_score_goal_clarity, p_score_commitment,
      p_score_fit, p_score_communication
    ]) as score(value)
    where value is not null and value not between 1 and 5
  ) then
    raise exception 'Review scores must be between 1 and 5';
  end if;

  update public.application_reviews
  set score_motivation = p_score_motivation,
      score_goal_clarity = p_score_goal_clarity,
      score_commitment = p_score_commitment,
      score_fit = p_score_fit,
      score_communication = p_score_communication,
      total_score = coalesce(p_score_motivation, 0) + coalesce(p_score_goal_clarity, 0)
        + coalesce(p_score_commitment, 0) + coalesce(p_score_fit, 0)
        + coalesce(p_score_communication, 0),
      recommendation = p_recommendation,
      reviewer_note = nullif(btrim(p_reviewer_note), ''),
      status = 'submitted',
      submitted_at = now(),
      updated_at = now()
  where id = p_review_id;

  perform public.vam084_recompute_application_review_status(v_review.application_id, v_review.review_round);
  return p_review_id;
end;
$fn$;

-- Extend the existing decision boundary: withdrawing and cancelling every
-- non-submitted assignment plus both audit writes are one transaction. A
-- failure in any event insert rolls the entire decision back.
create or replace function public.vam084_apply_application_decisions(
  p_application_ids uuid[],
  p_new_status text,
  p_actor uuid,
  p_decision_note text default null,
  p_expected_statuses jsonb default '{}'::jsonb
) returns table(
  application_id uuid,
  previous_status text,
  new_status text,
  applied boolean,
  reason text
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_requested integer;
  v_distinct integer;
  v_loaded integer;
  v_row record;
  v_gate record;
  v_review record;
  v_actor_name text;
  v_cancel_reason text;
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
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor_name is null then
    raise exception 'Decision actor not found';
  end if;

  perform a.id
  from public.applications a
  where a.id = any(p_application_ids)
  order by a.id
  for update;
  get diagnostics v_loaded = row_count;
  if v_loaded <> v_requested then
    raise exception 'One or more applications were not found';
  end if;

  for v_row in
    select a.id, a.season_id, a.status
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

    if p_new_status = 'withdrawn' then
      v_cancel_reason := 'Application withdrawn through decision boundary';
      if nullif(btrim(coalesce(p_decision_note, '')), '') is not null then
        v_cancel_reason := v_cancel_reason || ': ' || btrim(p_decision_note);
      end if;

      for v_review in
        select ar.id, ar.review_round, ar.reviewer_admin_user_id
        from public.application_reviews ar
        where ar.application_id = v_row.id
          and ar.status in ('assigned', 'in_progress', 'returned_for_clarification')
        order by ar.id
        for update
      loop
        update public.application_reviews
        set status = 'cancelled', updated_at = now()
        where id = v_review.id;

        insert into public.recruitment_assignment_events (
          application_id, review_round, event_type, previous_review_id,
          replacement_review_id, previous_reviewer_admin_user_id,
          new_reviewer_admin_user_id, actor_admin_user_id, reason
        ) values (
          v_row.id, v_review.review_round, 'cancelled', v_review.id,
          null, v_review.reviewer_admin_user_id, null, p_actor, v_cancel_reason
        );
      end loop;
    end if;

    update public.applications
    set status = p_new_status
    where id = v_row.id;

    insert into public.application_decisions (
      application_id, decided_by, decided_by_name, decision,
      previous_status, new_status, decision_note
    ) values (
      v_row.id, p_actor, v_actor_name, p_new_status,
      v_row.status, p_new_status, nullif(btrim(p_decision_note), '')
    );

    return query select v_row.id::uuid, v_row.status::text, p_new_status, true, 'applied'::text;
  end loop;
end;
$fn$;

-- Current manual selected-bulk mutation now calls the same canonical predicate
-- after locking every requested application in stable order.
create or replace function public.vam094_assign_selected_application_reviews(
  p_application_ids uuid[],
  p_reviewer_id uuid,
  p_review_round text,
  p_due_at timestamptz,
  p_assignment_note text,
  p_actor uuid
) returns table(
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
  v_gate record;
begin
  if current_user <> 'service_role' then raise exception 'Trusted server context required'; end if;
  if p_review_round not in ('profile_screening', 'interview') then raise exception 'Invalid review round'; end if;
  if coalesce(cardinality(p_application_ids), 0) < 1 then raise exception 'Application IDs must not be empty'; end if;
  if cardinality(p_application_ids) > 500 then raise exception 'Cannot assign more than 500 applications at once'; end if;
  if (select count(distinct value) from unnest(p_application_ids) requested(value)) <> cardinality(p_application_ids) then
    raise exception 'Application IDs must be unique';
  end if;

  select a.intake_batch_id into v_intake_batch_id
  from public.applications a
  where a.id = p_application_ids[1];
  if v_intake_batch_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_intake_batch_id::text || ':' || p_review_round, 0));
  end if;

  perform a.id
  from public.applications a
  where a.id = any(p_application_ids)
  order by a.id
  for update;
  get diagnostics v_found_count = row_count;
  if v_found_count <> cardinality(p_application_ids) then
    raise exception 'One or more application IDs do not exist';
  end if;

  select count(distinct a.intake_batch_id),
         count(distinct b.season_id),
         count(distinct lower(coalesce(a.role_applied::text, '')))
  into v_batch_count, v_season_count, v_role_count
  from public.applications a
  join public.intake_batches b on b.id = a.intake_batch_id
  where a.id = any(p_application_ids);
  if v_batch_count <> 1 or v_season_count <> 1 or v_role_count <> 1 then
    raise exception 'All selected applications must belong to exactly one intake batch and have the same role_applied';
  end if;

  select a.intake_batch_id, b.season_id
  into v_intake_batch_id, v_season_id
  from public.applications a
  join public.intake_batches b on b.id = a.intake_batch_id
  where a.id = p_application_ids[1];
  if not public.vam084_operator_for_season(p_actor, v_season_id) then
    raise exception 'Assignment batch scope denied';
  end if;
  if not public.vam084_participant_for_stage(p_reviewer_id, v_season_id, p_review_round) then
    raise exception 'Target assignee is not an active participant for this season and stage';
  end if;

  foreach v_app_id in array p_application_ids loop
    select * into v_gate
    from public.vam095_application_review_assignability(v_app_id, p_review_round);
    if not coalesce(v_gate.assignable, false) then
      if v_gate.reason = 'application_withdrawn' then
        raise exception 'APPLICATION_WITHDRAWN';
      end if;
      raise exception 'One or more selected applications have an invalid status for this review round';
    end if;
  end loop;

  if exists (
    select 1
    from public.application_reviews ar
    where ar.application_id = any(p_application_ids)
      and ar.review_round = p_review_round
      and ar.status <> 'cancelled'
  ) then
    raise exception 'One or more applications are already assigned for this round';
  end if;

  insert into public.review_assignment_batches (
    intake_batch_id, review_round, created_by, due_at, assignment_note,
    application_count, reviewer_count
  ) values (
    v_intake_batch_id, p_review_round, p_actor, p_due_at,
    nullif(btrim(p_assignment_note), ''), cardinality(p_application_ids), 1
  ) returning id into v_batch_id;

  foreach v_app_id in array p_application_ids loop
    insert into public.application_reviews (
      application_id, reviewer_admin_user_id, review_round, status,
      assigned_by, assignment_batch_id, due_at
    ) values (
      v_app_id, p_reviewer_id, p_review_round, 'assigned',
      p_actor, v_batch_id, p_due_at
    );
    perform public.vam084_recompute_application_review_status(v_app_id, p_review_round);
  end loop;

  return query select v_batch_id, cardinality(p_application_ids), p_reviewer_id;
end;
$fn$;

-- Narrow correction boundary. The target is never supplied by the caller: it
-- is recovered from the unique latest decision that entered withdrawn.
create or replace function public.vam095_restore_withdrawn_application(
  p_application_id uuid,
  p_actor uuid,
  p_reason text
) returns table(
  application_id uuid,
  previous_status text,
  new_status text,
  decision_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_app public.applications%rowtype;
  v_actor_name text;
  v_withdrawn_at timestamptz;
  v_provenance_count integer;
  v_restore_target text;
  v_decision_id uuid;
begin
  if current_user <> 'service_role'
     or length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Restore request rejected';
  end if;

  select a.* into v_app
  from public.applications a
  where a.id = p_application_id
  for update;
  if v_app.id is null then
    raise exception 'Application not found';
  end if;
  if not public.vam084_operator_for_season(p_actor, v_app.season_id) then
    raise exception 'Restore scope denied';
  end if;
  if v_app.status <> 'withdrawn' then
    raise exception 'Only a withdrawn application can be restored';
  end if;

  select coalesce(nullif(btrim(au.full_name), ''), au.email) into v_actor_name
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor_name is null then
    raise exception 'Restore actor not found';
  end if;

  select max(ad.created_at) into v_withdrawn_at
  from public.application_decisions ad
  where ad.application_id = p_application_id
    and ad.new_status = 'withdrawn';
  if v_withdrawn_at is null then
    raise exception 'Withdrawal provenance missing';
  end if;

  select count(*), min(ad.previous_status)
  into v_provenance_count, v_restore_target
  from public.application_decisions ad
  where ad.application_id = p_application_id
    and ad.new_status = 'withdrawn'
    and ad.created_at = v_withdrawn_at;
  if v_provenance_count <> 1 or v_restore_target is null then
    raise exception 'Withdrawal provenance ambiguous';
  end if;
  if v_restore_target not in (
    'submitted', 'under_data_check', 'ready_for_screening',
    'screening_assigned', 'screening_in_progress', 'screening_completed',
    'screening_passed', 'invited_to_meeting', 'invited_to_orientation',
    'invited_to_interview', 'interview_scheduled', 'interview_in_progress',
    'interview_completed', 'ready_for_final_decision', 'interview_passed',
    'waitlisted', 'needs_more_review', 'needs_admin_review'
  ) then
    raise exception 'Withdrawal restore target is not permitted';
  end if;

  update public.applications
  set status = v_restore_target
  where id = p_application_id;

  insert into public.application_decisions (
    application_id, decided_by, decided_by_name, decision,
    previous_status, new_status, decision_note
  ) values (
    p_application_id, p_actor, v_actor_name, 'restore_withdrawn',
    'withdrawn', v_restore_target, btrim(p_reason)
  ) returning id into v_decision_id;

  return query select p_application_id, 'withdrawn'::text, v_restore_target, v_decision_id;
end;
$fn$;

revoke all on function public.vam095_application_review_assignability(uuid, text) from public, anon, authenticated;
revoke all on function public.vam095_assign_application_review(uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.vam084_change_review_assignment(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.vam095_save_application_review_draft(uuid, uuid, integer, integer, integer, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.vam084_submit_application_review(uuid, uuid, integer, integer, integer, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.vam084_apply_application_decisions(uuid[], text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.vam094_assign_selected_application_reviews(uuid[], uuid, text, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.vam095_restore_withdrawn_application(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.vam095_application_review_assignability(uuid, text) to service_role;
grant execute on function public.vam095_assign_application_review(uuid, uuid, text, timestamptz, uuid) to service_role;
grant execute on function public.vam084_change_review_assignment(uuid, uuid, text, uuid) to service_role;
grant execute on function public.vam095_save_application_review_draft(uuid, uuid, integer, integer, integer, integer, integer, text, text) to service_role;
grant execute on function public.vam084_submit_application_review(uuid, uuid, integer, integer, integer, integer, integer, text, text) to service_role;
grant execute on function public.vam084_apply_application_decisions(uuid[], text, uuid, text, jsonb) to service_role;
grant execute on function public.vam094_assign_selected_application_reviews(uuid[], uuid, text, timestamptz, text, uuid) to service_role;
grant execute on function public.vam095_restore_withdrawn_application(uuid, uuid, text) to service_role;
