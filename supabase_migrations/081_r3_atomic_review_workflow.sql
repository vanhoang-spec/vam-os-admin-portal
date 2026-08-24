-- Migration 081: atomic application-review workflow and assignment lifecycle

begin;

alter table public.application_reviews
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.admin_users(id),
  add column if not exists cancel_reason text;

-- Preserve the existing audit vocabulary while making review assignment
-- lifecycle events first-class audit actions.
alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_type_check;
alter table public.admin_audit_log
  add constraint admin_audit_log_action_type_check check (
    action_type = any (array[
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
      'update_action_item','update_admin_user','update_admin_user_access','update_event',
      'update_event_participation','update_mentee_profile','update_mentor_profile',
      'update_registration_review_note','waitlist_event_registration','withdraw_membership',
      'set_application_form_state','confirm_renewal','create_renewal_invite',
      'revoke_renewal_invite','application_review_unassigned','application_review_reassigned'
    ])
  ) not valid;

-- The only conflict signal exposed by this function is the aggregate boolean.
-- A conflict exists only for exactly two non-null submitted recommendations
-- that differ; scores and partial/non-final reviews are irrelevant.
create or replace function public.vam081_evaluate_conflict(
  p_application_id uuid,
  p_review_round text default 'profile_screening'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (
      where ar.status = 'submitted' and ar.recommendation is not null
    ) = 2
    and count(distinct ar.recommendation) filter (
      where ar.status = 'submitted' and ar.recommendation is not null
    ) = 2
  from public.application_reviews ar
  where ar.application_id = p_application_id
    and ar.review_round = p_review_round;
$$;

-- Recompute the application state while the caller holds the per-application
-- advisory lock. This helper is intentionally not executable by API roles.
create or replace function public.vam081_recompute_application_status(
  p_application_id uuid,
  p_review_round text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
  v_started_count integer;
  v_final_count integer;
  v_next_status text;
begin
  select
    count(*) filter (where ar.status <> 'cancelled')::integer,
    count(*) filter (where ar.status in ('in_progress', 'submitted'))::integer,
    count(*) filter (
      where ar.status = 'submitted' and ar.recommendation is not null
    )::integer
  into v_active_count, v_started_count, v_final_count
  from public.application_reviews ar
  where ar.application_id = p_application_id
    and ar.review_round = p_review_round;

  if p_review_round = 'profile_screening' then
    v_next_status := case
      when v_final_count = 2 and public.vam081_evaluate_conflict(p_application_id, p_review_round)
        then 'needs_admin_review'
      when v_final_count = 2 then 'screening_completed'
      when v_active_count = 0 then 'ready_for_screening'
      when v_started_count > 0 then 'screening_in_progress'
      else 'screening_assigned'
    end;

    update public.applications
       set status = v_next_status
     where id = p_application_id
       and status in (
         'submitted','under_data_check','ready_for_screening','screening_assigned',
         'screening_in_progress','screening_completed','needs_admin_review'
       );
  elsif p_review_round = 'interview' then
    v_next_status := case
      when v_final_count > 0 then 'interview_completed'
      when v_active_count = 0 then 'invited_to_interview'
      else 'interview_in_progress'
    end;

    update public.applications
       set status = v_next_status
     where id = p_application_id
       and status in (
         'invited_to_interview','interview_scheduled','interview_in_progress',
         'interview_completed'
       );
  else
    raise exception 'Unsupported review round: %', p_review_round
      using errcode = '22023';
  end if;

  return v_next_status;
end;
$$;

-- Submitted reviews are final. The narrowly-scoped flag is set only inside
-- vam081_unassign_application_review; that RPC still rejects submitted rows.
create or replace function public.vam081_prevent_submitted_review_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'submitted'
     and not (
       new.status = 'cancelled'
       and current_setting('vam081.unassign_rpc', true) = 'on'
     ) then
    raise exception 'Submitted application reviews are immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vam081_submitted_review_immutable
  on public.application_reviews;
create trigger trg_vam081_submitted_review_immutable
before update on public.application_reviews
for each row
execute function public.vam081_prevent_submitted_review_update();

create or replace function public.vam081_save_application_review_draft(
  p_review_id uuid,
  p_actor uuid,
  p_score_motivation integer default null,
  p_score_goal_clarity integer default null,
  p_score_commitment integer default null,
  p_score_fit integer default null,
  p_score_communication integer default null,
  p_recommendation text default null,
  p_reviewer_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_review public.application_reviews%rowtype;
begin
  if p_actor is null then
    raise exception 'Actor is required' using errcode = '22023';
  end if;
  if p_score_motivation not between 1 and 5
     or p_score_goal_clarity not between 1 and 5
     or p_score_commitment not between 1 and 5
     or p_score_fit not between 1 and 5
     or p_score_communication not between 1 and 5 then
    raise exception 'Review scores must be between 1 and 5'
      using errcode = '22023';
  end if;

  select ar.application_id into v_application_id
  from public.application_reviews ar
  where ar.id = p_review_id;
  if not found then
    raise exception 'Application review not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_application_id::text, 0));

  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if not found then
    raise exception 'Application review not found' using errcode = 'P0002';
  end if;
  if v_review.reviewer_admin_user_id is distinct from p_actor then
    raise exception 'Review ownership mismatch' using errcode = '42501';
  end if;
  if v_review.status = 'submitted' then
    raise exception 'Submitted application reviews are immutable' using errcode = '55000';
  end if;
  if v_review.status = 'cancelled' then
    raise exception 'Cancelled application reviews cannot be edited' using errcode = '55000';
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
         updated_at = transaction_timestamp()
   where id = p_review_id;

  perform public.vam081_recompute_application_status(v_application_id, v_review.review_round);
  return p_review_id;
end;
$$;

create or replace function public.vam081_submit_application_review(
  p_review_id uuid,
  p_actor uuid,
  p_score_motivation integer default null,
  p_score_goal_clarity integer default null,
  p_score_commitment integer default null,
  p_score_fit integer default null,
  p_score_communication integer default null,
  p_recommendation text default null,
  p_reviewer_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_review public.application_reviews%rowtype;
  v_total_score integer;
  v_final_count integer;
  v_has_conflict boolean;
begin
  if p_actor is null then
    raise exception 'Actor is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_recommendation), '') is null then
    raise exception 'A final recommendation is required' using errcode = '22023';
  end if;
  if p_score_motivation not between 1 and 5
     or p_score_goal_clarity not between 1 and 5
     or p_score_commitment not between 1 and 5
     or p_score_fit not between 1 and 5
     or p_score_communication not between 1 and 5 then
    raise exception 'Review scores must be between 1 and 5'
      using errcode = '22023';
  end if;

  select ar.application_id into v_application_id
  from public.application_reviews ar
  where ar.id = p_review_id;
  if not found then
    raise exception 'Application review not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_application_id::text, 0));

  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if not found then
    raise exception 'Application review not found' using errcode = 'P0002';
  end if;
  if v_review.reviewer_admin_user_id is distinct from p_actor then
    raise exception 'Review ownership mismatch' using errcode = '42501';
  end if;
  if v_review.status = 'submitted' then
    raise exception 'Submitted application reviews are immutable' using errcode = '55000';
  end if;
  if v_review.status = 'cancelled' then
    raise exception 'Cancelled application reviews cannot be submitted' using errcode = '55000';
  end if;

  v_total_score := case
    when num_nonnulls(
      p_score_motivation, p_score_goal_clarity, p_score_commitment,
      p_score_fit, p_score_communication
    ) = 0 then null
    else coalesce(p_score_motivation, 0)
       + coalesce(p_score_goal_clarity, 0)
       + coalesce(p_score_commitment, 0)
       + coalesce(p_score_fit, 0)
       + coalesce(p_score_communication, 0)
  end;

  update public.application_reviews
     set status = 'submitted',
         score_motivation = p_score_motivation,
         score_goal_clarity = p_score_goal_clarity,
         score_commitment = p_score_commitment,
         score_fit = p_score_fit,
         score_communication = p_score_communication,
         total_score = v_total_score,
         recommendation = p_recommendation,
         reviewer_note = p_reviewer_note,
         submitted_at = transaction_timestamp(),
         updated_at = transaction_timestamp()
   where id = p_review_id;

  if v_review.review_round = 'profile_screening' then
    select count(*)::integer
      into v_final_count
      from public.application_reviews ar
     where ar.application_id = v_application_id
       and ar.review_round = 'profile_screening'
       and ar.status = 'submitted'
       and ar.recommendation is not null;

    v_has_conflict := public.vam081_evaluate_conflict(
      v_application_id,
      'profile_screening'
    );

    if v_final_count = 2 then
      update public.applications
         set status = case
           when v_has_conflict then 'needs_admin_review'
           else 'screening_completed'
         end
       where id = v_application_id
         and status in (
           'screening_assigned','screening_in_progress',
           'screening_completed','needs_admin_review'
         );
    else
      perform public.vam081_recompute_application_status(v_application_id, v_review.review_round);
    end if;
  else
    perform public.vam081_recompute_application_status(v_application_id, v_review.review_round);
  end if;
  return p_review_id;
end;
$$;

create or replace function public.vam081_unassign_application_review(
  p_review_id uuid,
  p_actor uuid,
  p_cancel_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_review public.application_reviews%rowtype;
  v_cancelled public.application_reviews%rowtype;
begin
  if p_actor is null then
    raise exception 'Actor is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_cancel_reason), '') is null then
    raise exception 'Cancel reason is required' using errcode = '22023';
  end if;

  select ar.application_id into v_application_id
  from public.application_reviews ar
  where ar.id = p_review_id;
  if not found then
    raise exception 'Application review not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_application_id::text, 0));

  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if not found then
    raise exception 'Application review not found' using errcode = 'P0002';
  end if;
  if v_review.status = 'submitted' then
    raise exception 'Submitted application reviews cannot be unassigned' using errcode = '55000';
  end if;
  if v_review.status = 'cancelled' then
    raise exception 'Application review is already cancelled' using errcode = '55000';
  end if;

  perform set_config('vam081.unassign_rpc', 'on', true);
  update public.application_reviews
     set status = 'cancelled',
         cancelled_at = transaction_timestamp(),
         cancelled_by = p_actor,
         cancel_reason = btrim(p_cancel_reason),
         updated_at = transaction_timestamp()
   where id = p_review_id
  returning * into v_cancelled;

  insert into public.admin_audit_log(
    actor_admin_user_id, action_type, target_admin_user_id, before_data, after_data
  ) values (
    p_actor,
    'application_review_unassigned',
    v_review.reviewer_admin_user_id,
    to_jsonb(v_review),
    to_jsonb(v_cancelled)
  );

  perform public.vam081_recompute_application_status(v_application_id, v_review.review_round);
  return p_review_id;
end;
$$;

create or replace function public.vam081_reassign_application_review(
  p_review_id uuid,
  p_new_reviewer_admin_user_id uuid,
  p_actor uuid,
  p_cancel_reason text,
  p_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_review public.application_reviews%rowtype;
  v_cancelled public.application_reviews%rowtype;
  v_new_review public.application_reviews%rowtype;
begin
  if p_actor is null or p_new_reviewer_admin_user_id is null then
    raise exception 'Actor and new reviewer are required' using errcode = '22023';
  end if;
  if nullif(btrim(p_cancel_reason), '') is null then
    raise exception 'Cancel reason is required' using errcode = '22023';
  end if;

  select ar.application_id into v_application_id
  from public.application_reviews ar
  where ar.id = p_review_id;
  if not found then
    raise exception 'Application review not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_application_id::text, 0));

  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if not found then
    raise exception 'Application review not found' using errcode = 'P0002';
  end if;
  if v_review.status = 'submitted' then
    raise exception 'Submitted application reviews cannot be reassigned' using errcode = '55000';
  end if;
  if v_review.status = 'cancelled' then
    raise exception 'Application review is already cancelled' using errcode = '55000';
  end if;

  update public.application_reviews
     set status = 'cancelled',
         cancelled_at = transaction_timestamp(),
         cancelled_by = p_actor,
         cancel_reason = btrim(p_cancel_reason),
         updated_at = transaction_timestamp()
   where id = p_review_id
  returning * into v_cancelled;

  insert into public.application_reviews(
    application_id, review_round, reviewer_admin_user_id, assigned_by,
    assigned_at, due_at, status
  ) values (
    v_review.application_id, v_review.review_round, p_new_reviewer_admin_user_id,
    p_actor, transaction_timestamp(), coalesce(p_due_at, v_review.due_at), 'assigned'
  )
  returning * into v_new_review;

  insert into public.admin_audit_log(
    actor_admin_user_id, action_type, target_admin_user_id, before_data, after_data
  ) values (
    p_actor,
    'application_review_reassigned',
    p_new_reviewer_admin_user_id,
    jsonb_build_object('cancelled_review', to_jsonb(v_review)),
    jsonb_build_object(
      'cancelled_review', to_jsonb(v_cancelled),
      'replacement_review', to_jsonb(v_new_review)
    )
  );

  perform public.vam081_recompute_application_status(v_application_id, v_review.review_round);
  return v_new_review.id;
end;
$$;

create or replace function public.vam081_bulk_assign_reviews_atomic(
  p_batch jsonb,
  p_pairs jsonb,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_batch_id uuid;
  v_application_count integer;
  v_reviewer_count integer;
begin
  if p_actor is null then
    raise exception 'Actor is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_batch) <> 'object' then
    raise exception 'Batch payload must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) = 0 then
    raise exception 'Assignment pairs must be a non-empty array' using errcode = '22023';
  end if;

  -- Every participant takes locks in the same deterministic order.
  for v_application_id in
    select distinct (pair.value->>'application_id')::uuid
    from jsonb_array_elements(p_pairs) as pair(value)
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_application_id::text, 0));
  end loop;

  select
    count(distinct (pair.value->>'application_id')::uuid)::integer,
    count(distinct (pair.value->>'reviewer_admin_user_id')::uuid)::integer
  into v_application_count, v_reviewer_count
  from jsonb_array_elements(p_pairs) as pair(value);

  insert into public.review_assignment_batches(
    intake_batch_id, review_round, created_by, due_at, assignment_note,
    application_count, reviewer_count
  ) values (
    nullif(p_batch->>'intake_batch_id', '')::uuid,
    'profile_screening',
    p_actor,
    nullif(p_batch->>'due_at', '')::timestamptz,
    nullif(p_batch->>'assignment_note', ''),
    v_application_count,
    v_reviewer_count
  )
  returning id into v_batch_id;

  insert into public.application_reviews(
    application_id, review_round, reviewer_admin_user_id, assigned_by,
    assigned_at, due_at, status, assignment_batch_id, claim_source
  )
  select
    (pair.value->>'application_id')::uuid,
    'profile_screening',
    (pair.value->>'reviewer_admin_user_id')::uuid,
    p_actor,
    transaction_timestamp(),
    nullif(p_batch->>'due_at', '')::timestamptz,
    'assigned',
    v_batch_id,
    'bulk_assign'
  from jsonb_array_elements(p_pairs) as pair(value);

  update public.applications a
     set status = 'screening_assigned'
   where a.id in (
     select distinct (pair.value->>'application_id')::uuid
     from jsonb_array_elements(p_pairs) as pair(value)
   )
     and a.status in ('submitted', 'under_data_check', 'ready_for_screening');

  return v_batch_id;
end;
$$;

revoke all on function public.vam081_evaluate_conflict(uuid, text)
  from public, anon, authenticated;
revoke all on function public.vam081_recompute_application_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.vam081_prevent_submitted_review_update()
  from public, anon, authenticated;
revoke all on function public.vam081_save_application_review_draft(
  uuid, uuid, integer, integer, integer, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.vam081_submit_application_review(
  uuid, uuid, integer, integer, integer, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.vam081_unassign_application_review(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.vam081_reassign_application_review(
  uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.vam081_bulk_assign_reviews_atomic(jsonb, jsonb, uuid)
  from public, anon, authenticated;

grant execute on function public.vam081_evaluate_conflict(uuid, text)
  to service_role;
grant execute on function public.vam081_save_application_review_draft(
  uuid, uuid, integer, integer, integer, integer, integer, text, text
) to service_role;
grant execute on function public.vam081_submit_application_review(
  uuid, uuid, integer, integer, integer, integer, integer, text, text
) to service_role;
grant execute on function public.vam081_unassign_application_review(uuid, uuid, text)
  to service_role;
grant execute on function public.vam081_reassign_application_review(
  uuid, uuid, uuid, text, timestamptz
) to service_role;
grant execute on function public.vam081_bulk_assign_reviews_atomic(jsonb, jsonb, uuid)
  to service_role;

commit;
