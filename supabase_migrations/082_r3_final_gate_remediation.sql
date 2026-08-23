-- 082: R3 Final Gate Remediation
-- Fixes B3, B4, C3, C4 from Claude final gate review.

begin;

-- 1. Fix C4 and B3: conflict evaluation
create or replace function public.vam081_evaluate_conflict(
  p_application_id uuid,
  p_review_round text default 'profile_screening'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $script$
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
$script$;

-- 2. Fix B3: dynamic reviewer count (note: currently bound to max 2 by 080)
create or replace function public.vam081_recompute_application_status(
  p_application_id uuid,
  p_review_round text
)
returns text
language plpgsql
security definer
set search_path = ''
as $script$
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
         'invited_to_interview','interview_scheduled',
         'interview_in_progress','interview_completed'
       );
  else
    raise exception 'Unsupported review round: %', p_review_round
      using errcode = '22023';
  end if;

  return v_next_status;
end;
$script$;

-- 3. Fix B3 in submit review
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
as $script$
declare
  v_application_id uuid;
  v_review public.application_reviews%rowtype;
  v_total_score integer;
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

  perform public.vam081_recompute_application_status(v_application_id, v_review.review_round);
  return p_review_id;
end;
$script$;

-- 4. Fix C3: remove unassign_rpc flag
create or replace function public.vam081_prevent_submitted_review_update()
returns trigger
language plpgsql
set search_path = ''
as $script$
begin
  if old.status = 'submitted' then
    raise exception 'Submitted application reviews are immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$script$;

create or replace function public.vam081_unassign_application_review(
  p_review_id uuid,
  p_actor uuid,
  p_cancel_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $script$
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

  perform public.vam081_recompute_application_status(v_application_id, v_cancelled.review_round);
  return p_review_id;
end;
$script$;

-- 5. Fix B4: restore email_primary in application search blob
create or replace view public.application_list_v1 as
with profile_review_states as (
  select
    ar.application_id,
    count(distinct ar.reviewer_admin_user_id) filter (
      where ar.status <> 'cancelled'
    )::integer as assigned_reviewers_count,
    count(distinct ar.reviewer_admin_user_id) filter (
      where ar.status = 'submitted'
    )::integer as submitted_reviews_count,
    count(*) filter (
      where ar.status = 'submitted' and ar.recommendation is not null
    ) = 2 as has_two_final_recommendations,
    count(distinct ar.recommendation) filter (
      where ar.status = 'submitted' and ar.recommendation is not null
    ) = 2
      and count(*) filter (
        where ar.status = 'submitted' and ar.recommendation is not null
      ) = 2 as has_conflict
  from public.application_reviews ar
  where ar.review_round = 'profile_screening'
  group by ar.application_id
)
select
  a.id,
  a.person_id,
  a.season_id,
  a.intake_batch_id,
  a.role_applied,
  coalesce(a.sbd, a.applicant_student_id_norm) as sbd,
  a.source,
  a.acquisition_channel,
  a.submitted_at,
  coalesce(a.status, a.final_status) as status_unified,
  coalesce(a.consent_data_storage, a.consent_pdpa) as consent_unified,
  coalesce(a.full_name, p.full_name) as full_name,
  coalesce(a.email_primary, p.email_primary) as email_primary,
  coalesce(s.code, s.name) as season_code,
  coalesce(b.code, b.name) as intake_batch_code,
  lower(
    coalesce(a.full_name, p.full_name, '') || ' ' ||
    coalesce(a.email_primary, p.email_primary, '') || ' ' ||
    coalesce(a.sbd, a.applicant_student_id_norm, '') || ' ' ||
    a.id || ' ' ||
    coalesce(a.person_id, '')
  ) as search_blob,
  coalesce(a.intake_batch_id, a.season_id) as batch_season_id,
  coalesce(rs.assigned_reviewers_count, 0) as assigned_reviewers_count,
  coalesce(rs.submitted_reviews_count, 0) as submitted_reviews_count,
  case
    when coalesce(rs.has_conflict, false) then 'needs_admin_review'
    when coalesce(rs.has_two_final_recommendations, false) then 'aligned'
    else 'pending'
  end as review_conflict_status,
  coalesce(rs.has_conflict, false) as has_conflict
from public.applications a
left join public.people p on a.person_id = p.id
left join public.seasons s on a.season_id = s.id
left join public.intake_batches b on a.intake_batch_id = b.id
left join profile_review_states rs on rs.application_id = a.id;

alter view public.application_list_v1 set (security_invoker = true);

commit;
