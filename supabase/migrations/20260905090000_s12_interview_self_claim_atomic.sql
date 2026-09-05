-- 20260905090000_s12_interview_self_claim_atomic.sql
--
-- S12 interview day - atomic self-claim of an interview review.
--
-- WHY AN RPC AND NOT A READ-THEN-INSERT IN THE APP LAYER
-- -----------------------------------------------------------------------
-- Interview day is walk-up: a candidate gives their name and whichever
-- interviewer is free searches and claims them on the spot. Two interviewers
-- can very plausibly press "Bat dau phong van" for the same walk-up candidate
-- within the same second.
--
-- The existing uniqueness contract does NOT settle that race:
--
--   application_reviews_active_reviewer_round_uidx
--     on (application_id, reviewer_admin_user_id, review_round)
--     where status is distinct from 'cancelled'
--
-- That index is keyed by REVIEWER. It makes a single actor's retry idempotent,
-- which is why the same-actor path is already safe, but it permits two
-- DIFFERENT reviewers to both hold an active interview review for the same
-- application. A select-then-insert in TypeScript therefore has a real
-- interleaving where both callers observe "no review" and both insert.
--
-- A stricter unique index on (application_id, review_round) is deliberately
-- NOT used. vam084_recompute_application_review_status counts DISTINCT
-- reviewers against recruitment_stage_requirements.minimum_submitted_reviews,
-- which is configurable up to 20; UEHM-S12 sets interview = 1 today but a
-- season requiring two independent interview reviews is a supported lifecycle.
-- Forbidding a second review row at the schema level would break that, and
-- would also break vam090's explicit multi-reviewer assignment path.
--
-- The rule enforced here is narrower and belongs to the CLAIM action, not to
-- the table: an unassigned candidate may be claimed by one interviewer, and a
-- candidate who already has an active interview review is reserved for whoever
-- holds it. That is exactly how Core Team reserves a special candidate for a
-- named interviewer. So the boundary is a transaction-scoped advisory lock on
-- (application, round) - the same technique and key shape vam094 and vam063
-- already use for their create-or-noop decisions.
--
-- Outcomes returned to the caller:
--   'claimed'         - a new interview review was created for p_actor
--   'existing'        - p_actor already held one; returned idempotently
--   'already_claimed' - another interviewer holds it; nothing was written

create or replace function public.vam095_claim_interview_review(
  p_application_id uuid,
  p_actor uuid
) returns table (
  outcome_status text,
  review_id uuid,
  holder_admin_user_id uuid,
  holder_full_name text,
  holder_email text,
  application_status text
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_season_id uuid;
  v_app_status text;
  v_review_id uuid;
  v_holder uuid;
  v_new_review_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;
  if p_application_id is null or p_actor is null then
    raise exception 'Application and actor are required';
  end if;

  select a.season_id, a.status
    into v_season_id, v_app_status
  from public.applications a
  where a.id = p_application_id;

  if v_season_id is null then
    raise exception 'Application or season not found';
  end if;

  -- Exact-season interview participation. Same gate the bulk assignment path
  -- applies to the person being assigned; a global role alone never qualifies.
  if not public.vam084_participant_for_stage(p_actor, v_season_id, 'interview') then
    raise exception 'Actor is not an active interview participant for this season';
  end if;

  -- Canonical interview-eligible lifecycle states. Kept in step with
  -- INTERVIEW_ELIGIBLE_STATUSES and with vam094's interview-round branch.
  if v_app_status is null or v_app_status not in (
    'invited_to_interview',
    'interview_scheduled',
    'interview_in_progress',
    'needs_more_review'
  ) then
    raise exception 'Application is not interview eligible';
  end if;

  -- needs_more_review is shared with profile screening. It only counts as
  -- interview-eligible once an interview review already exists, which is the
  -- same disambiguation vam094 applies.
  if v_app_status = 'needs_more_review' and not exists (
    select 1 from public.application_reviews ar
    where ar.application_id = p_application_id
      and ar.review_round = 'interview'
  ) then
    raise exception 'Application is not interview eligible';
  end if;

  -- Serialize the create-or-noop decision itself on (application, round).
  -- Transaction scoped: released on commit or rollback, never leaked.
  perform pg_advisory_xact_lock(
    hashtextextended(p_application_id::text || ':interview', 0)
  );

  -- Authoritative existence check, now inside the lock. A review already held
  -- by the actor sorts first so a repeat call resolves to the idempotent path
  -- even where the lifecycle legitimately allows several interview reviews.
  select ar.id, ar.reviewer_admin_user_id
    into v_review_id, v_holder
  from public.application_reviews ar
  where ar.application_id = p_application_id
    and ar.review_round = 'interview'
    and ar.status is distinct from 'cancelled'
  order by (ar.reviewer_admin_user_id = p_actor) desc, ar.created_at asc
  limit 1;

  if v_review_id is not null then
    if v_holder = p_actor then
      return query
        select 'existing'::text, v_review_id, p_actor, au.full_name, au.email, v_app_status
        from public.admin_users au where au.id = p_actor;
      return;
    end if;

    return query
      select 'already_claimed'::text, v_review_id, v_holder,
             au.full_name, au.email, v_app_status
      from public.admin_users au where au.id = v_holder;
    return;
  end if;

  insert into public.application_reviews (
    application_id,
    reviewer_admin_user_id,
    review_round,
    status,
    assigned_by,
    claimed_at,
    claim_source
  ) values (
    p_application_id,
    p_actor,
    'interview',
    'in_progress',
    p_actor,
    now(),
    'self_claim'
  )
  returning id into v_new_review_id;

  -- The canonical status advance. Do not open-code it: this is the single
  -- function that knows the interview stage's requirement count and the set of
  -- statuses it is allowed to overwrite, so an invited_to_interview /
  -- interview_scheduled application lands on interview_in_progress while a
  -- needs_more_review application is left where the lifecycle wants it.
  perform public.vam084_recompute_application_review_status(p_application_id, 'interview');

  select a.status into v_app_status from public.applications a where a.id = p_application_id;

  return query
    select 'claimed'::text, v_new_review_id, p_actor, au.full_name, au.email, v_app_status
    from public.admin_users au where au.id = p_actor;
end;
$fn$;

revoke all on function public.vam095_claim_interview_review(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.vam095_claim_interview_review(uuid, uuid)
  to service_role;

comment on function public.vam095_claim_interview_review(uuid, uuid) is
  'S12 interview day self-claim. Advisory-locked create-or-noop on (application, interview): first claim wins, a candidate already held by another interviewer stays reserved for that interviewer, and a repeat call by the holder is idempotent.';
