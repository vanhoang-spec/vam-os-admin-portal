-- ===========================================================================
-- P0 CORRECTIVE — restore the recruitment/review RPC family on Production.
--
-- WHY THIS EXISTS
--   Production (qkkroesfiazsejkzflcd) is missing the entire public.vam084_*
--   and public.vam090_* family that the deployed application code calls. The
--   authenticated failure observed was:
--     Could not find the function public.vam084_list_recruitment_participants
--     (p_review_stage, p_season_id) in the schema cache.
--
-- PROVENANCE
--   Every function body below is pg_get_functiondef() output taken verbatim
--   from Staging (ljfneyuvpxrmejpxsmpz), where this family is deployed and has
--   passed Owner UAT. Nothing here is hand-written or re-derived.
--
-- SCOPE — deliberately minimal
--   Included: exactly the 13 functions the current application code requires
--   (11 called directly, plus vam084_operator_for_season and
--   vam084_recompute_application_review_status which those call internally),
--   and the one table they depend on that Production does not have.
--
--   NOT included, on purpose:
--     * 20260830070430_s12_recruitment_operational_remediation.sql (not approved
--       for Production replay);
--     * M092 / M093 (vam092_*, vam093_*) — separate, unreleased work;
--     * the other 14 functions current code needs that Production is also
--       missing (vam062_* x9, action-item/operations x5). Those are a real and
--       separate defect; they are reported, not bundled, because they touch
--       admin/account surfaces with their own review requirements.
--
-- COMPATIBILITY — verified read-only against the Production catalog
--   * applications.role_applied is public.role_type on BOTH databases.
--   * None of these 13 functions reference people.gender, so the Production
--     gender_type-vs-Staging text divergence does not affect this package.
--   * None reference application_reviews.cancel_* or applications.applicant_*_norm
--     / dedup_exempt_reason (columns Production lacks).
--   * The two functions that write admin_audit_log only use columns Production
--     already has; Production's extra metadata/target_email columns are nullable.
--   * recruitment_stage_requirements does NOT exist on Production and IS
--     required by 3 of these functions, so it is created here.
--   * recruitment_assignment_events also does NOT exist on Production and is
--     written by vam084_change_review_assignment, so it is created here too.
--   * the two UEHM-S12 stage-requirement rows are seeded, because the
--     eligibility gate refuses every approval when they are absent.
--
-- SAFETY
--   Additive and idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE
--   FUNCTION. No DROP, no data migration, no backfill, no column changes to any
--   existing table, no permission widening. Execute privilege is restricted to
--   service_role exactly as on Staging.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Missing dependency table.
--    Shape, constraints, RLS posture and grants replicate Staging exactly.
--    RLS is enabled AND forced with no policies: the table is reachable only
--    by roles that bypass RLS (service_role), which is how the trusted RPCs
--    read it and how nothing else can.
-- --------------------------------------------------------------------------
create table if not exists public.recruitment_stage_requirements (
  season_id uuid not null,
  review_stage text not null,
  minimum_submitted_reviews integer not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruitment_stage_requirements_pkey primary key (season_id, review_stage),
  constraint recruitment_stage_requirements_stage_check
    check (review_stage = any (array['profile_screening'::text, 'interview'::text])),
  constraint recruitment_stage_requirements_minimum_check
    check (minimum_submitted_reviews >= 1 and minimum_submitted_reviews <= 20),
  constraint recruitment_stage_requirements_season_id_fkey
    foreign key (season_id) references public.seasons(id) on delete cascade,
  constraint recruitment_stage_requirements_updated_by_fkey
    foreign key (updated_by) references public.admin_users(id) on delete set null
);

alter table public.recruitment_stage_requirements enable row level security;
alter table public.recruitment_stage_requirements force row level security;

revoke all on table public.recruitment_stage_requirements from public;
revoke all on table public.recruitment_stage_requirements from anon, authenticated;
grant all on table public.recruitment_stage_requirements to service_role;

-- --------------------------------------------------------------------------
-- 1b. Second missing dependency table.
--     vam084_change_review_assignment writes an audit event here on every
--     cancel/reassign. Production does not have it, so that function would
--     compile and then fail at call time without this.
--     Shape, constraints, indexes, RLS posture and grants replicate Staging.
-- --------------------------------------------------------------------------
create table if not exists public.recruitment_assignment_events (
  id uuid not null default gen_random_uuid(),
  application_id uuid not null,
  review_round text not null,
  event_type text not null,
  previous_review_id uuid not null,
  replacement_review_id uuid,
  previous_reviewer_admin_user_id uuid not null,
  new_reviewer_admin_user_id uuid,
  actor_admin_user_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint recruitment_assignment_events_pkey primary key (id),
  constraint recruitment_assignment_events_review_round_check
    check (review_round = any (array['profile_screening'::text, 'interview'::text])),
  constraint recruitment_assignment_events_event_type_check
    check (event_type = any (array['cancelled'::text, 'reassigned'::text])),
  constraint recruitment_assignment_events_reason_check
    check (length(btrim(reason)) >= 3 and length(btrim(reason)) <= 1000),
  constraint recruitment_assignment_events_application_id_fkey
    foreign key (application_id) references public.applications(id) on delete cascade,
  constraint recruitment_assignment_events_previous_review_id_fkey
    foreign key (previous_review_id) references public.application_reviews(id),
  constraint recruitment_assignment_events_replacement_review_id_fkey
    foreign key (replacement_review_id) references public.application_reviews(id),
  constraint recruitment_assignment_events_previous_reviewer_admin_user_fkey
    foreign key (previous_reviewer_admin_user_id) references public.admin_users(id),
  constraint recruitment_assignment_events_new_reviewer_admin_user_id_fkey
    foreign key (new_reviewer_admin_user_id) references public.admin_users(id),
  constraint recruitment_assignment_events_actor_admin_user_id_fkey
    foreign key (actor_admin_user_id) references public.admin_users(id)
);

create index if not exists recruitment_assignment_events_application_created_idx
  on public.recruitment_assignment_events using btree (application_id, created_at desc);

alter table public.recruitment_assignment_events enable row level security;
alter table public.recruitment_assignment_events force row level security;

revoke all on table public.recruitment_assignment_events from public;
revoke all on table public.recruitment_assignment_events from anon, authenticated;
grant all on table public.recruitment_assignment_events to service_role;

-- --------------------------------------------------------------------------
-- 1c. Stage-requirement configuration for the current season.
--
--     vam084_application_decision_eligibility refuses every official approval
--     with reason 'stage_requirement_missing' when the season has no row here,
--     so creating the table empty would leave the restored family installed but
--     unusable. Staging currently holds exactly these two rows, and they are the
--     values the recruitment flow has been UAT'd against:
--         UEHM-S12 / profile_screening / 1
--         UEHM-S12 / interview         / 1
--
--     Season id is resolved by code, never hard-coded. seasons.code carries a
--     unique index on both databases, so the lookup is deterministic; the guard
--     below still fails loudly rather than seeding the wrong season if that ever
--     stops being true.
--
--     ON CONFLICT DO NOTHING, keyed on the table's real uniqueness contract
--     (its primary key, season_id + review_stage): this guarantees the rows
--     EXIST without overwriting a value an operator has since tuned, and it
--     touches no other season or stage. Re-running the migration is a no-op.
-- --------------------------------------------------------------------------
do $$
declare
  v_season_id uuid;
  v_matches integer;
begin
  select count(*) into v_matches from public.seasons where code = 'UEHM-S12';
  if v_matches <> 1 then
    raise exception
      'P0 restore aborted: expected exactly one public.seasons row with code UEHM-S12, found %. '
      'Resolve the season catalog before applying this migration.', v_matches;
  end if;

  select id into v_season_id from public.seasons where code = 'UEHM-S12';

  insert into public.recruitment_stage_requirements
    (season_id, review_stage, minimum_submitted_reviews)
  values
    (v_season_id, 'profile_screening', 1),
    (v_season_id, 'interview', 1)
  on conflict (season_id, review_stage) do nothing;
end
$$;

-- --------------------------------------------------------------------------
-- 2. The 13 required functions, verbatim from Staging.
--    Ordered so that callees are defined before their callers.
-- --------------------------------------------------------------------------

-- ---- vam084_operator_for_season ----------------------------------
CREATE OR REPLACE FUNCTION public.vam084_operator_for_season(p_actor uuid, p_season_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    current_user = 'service_role'
    and exists (
      select 1
      from public.admin_users au
      where au.id = p_actor
        and au.status = 'active'
        and au.role in ('super_admin', 'admin', 'core_team')
        and (
          au.role = 'super_admin'
          or exists (
            select 1
            from public.admin_scope_access asa
            where asa.user_id = au.auth_user_id
              and asa.status = 'active'
              and asa.season_id = p_season_id::text
              and asa.role in ('operations', 'full_access')
          )
        )
    );
$function$;

-- ---- vam084_participant_for_stage --------------------------------
CREATE OR REPLACE FUNCTION public.vam084_participant_for_stage(p_admin_user_id uuid, p_season_id uuid, p_review_stage text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.admin_users au
    join public.people p
      on lower(btrim(p.email_primary)) = lower(btrim(au.email))
    join public.person_season_memberships psm
      on psm.person_id = p.id
     and psm.season_id = p_season_id
     and psm.status = 'active'
     and psm.role = case p_review_stage
       when 'profile_screening' then 'reviewer'
       when 'interview' then 'interviewer'
       else '__invalid__'
     end
    where au.id = p_admin_user_id
      and au.status = 'active'
      and au.role in ('reviewer', 'core_team', 'admin', 'super_admin')
      and (
        au.role = 'super_admin'
        or exists (
          select 1
          from public.admin_scope_access asa
          where asa.user_id = au.auth_user_id
            and asa.status = 'active'
            and asa.season_id = p_season_id::text
            and asa.role in ('review', 'operations', 'full_access')
        )
      )
  );
$function$;

-- ---- vam084_list_recruitment_participants ------------------------
CREATE OR REPLACE FUNCTION public.vam084_list_recruitment_participants(p_season_id uuid, p_review_stage text)
 RETURNS TABLE(id uuid, email text, full_name text, role text, participation_role text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select distinct
    au.id,
    au.email,
    au.full_name,
    au.role,
    psm.role
  from public.admin_users au
  join public.people p
    on lower(btrim(p.email_primary)) = lower(btrim(au.email))
  join public.person_season_memberships psm
    on psm.person_id = p.id
   and psm.season_id = p_season_id
   and psm.status = 'active'
   and psm.role = case p_review_stage
     when 'profile_screening' then 'reviewer'
     when 'interview' then 'interviewer'
     else '__invalid__'
   end
  where current_user = 'service_role'
    and au.status = 'active'
    and au.role in ('reviewer', 'core_team', 'admin', 'super_admin')
    and (
      au.role = 'super_admin'
      or exists (
        select 1
        from public.admin_scope_access asa
        where asa.user_id = au.auth_user_id
          and asa.status = 'active'
          and asa.season_id = p_season_id::text
          and asa.role in ('review', 'operations', 'full_access')
      )
    )
  order by au.email;
$function$;

-- ---- vam084_upsert_stage_requirement -----------------------------
CREATE OR REPLACE FUNCTION public.vam084_upsert_stage_requirement(p_actor uuid, p_season_id uuid, p_review_stage text, p_minimum integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_review_stage not in ('profile_screening','interview')
     or p_minimum not between 1 and 20
     or not public.vam084_operator_for_season(p_actor, p_season_id) then
    raise exception 'Stage requirement update rejected';
  end if;
  insert into public.recruitment_stage_requirements (
    season_id, review_stage, minimum_submitted_reviews, updated_by
  ) values (p_season_id, p_review_stage, p_minimum, p_actor)
  on conflict (season_id, review_stage) do update
    set minimum_submitted_reviews = excluded.minimum_submitted_reviews,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$function$;

-- ---- vam084_application_decision_eligibility ---------------------
CREATE OR REPLACE FUNCTION public.vam084_application_decision_eligibility(p_application_id uuid, p_new_status text)
 RETURNS TABLE(eligible boolean, reason text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_app public.applications%rowtype;
  v_profile_required integer;
  v_interview_required integer;
  v_profile_submitted integer;
  v_interview_submitted integer;
  v_latest_more_review_at timestamptz;
begin
  select a.* into v_app from public.applications a where a.id = p_application_id;
  if v_app.id is null then return query select false, 'application_not_found'; return; end if;

  select r.minimum_submitted_reviews into v_profile_required
  from public.recruitment_stage_requirements r
  where r.season_id = v_app.season_id and r.review_stage = 'profile_screening';
  select r.minimum_submitted_reviews into v_interview_required
  from public.recruitment_stage_requirements r
  where r.season_id = v_app.season_id and r.review_stage = 'interview';
  if v_profile_required is null or v_interview_required is null then
    return query select false, 'stage_requirement_missing'; return;
  end if;

  select
    count(distinct ar.reviewer_admin_user_id) filter (
      where ar.review_round = 'profile_screening' and ar.status = 'submitted'
    ),
    count(distinct ar.reviewer_admin_user_id) filter (
      where ar.review_round = 'interview' and ar.status = 'submitted'
    )
  into v_profile_submitted, v_interview_submitted
  from public.application_reviews ar
  where ar.application_id = p_application_id;

  select max(ad.created_at) into v_latest_more_review_at
  from public.application_decisions ad
  where ad.application_id = p_application_id
    and ad.new_status = 'needs_more_review';

  if p_new_status = 'under_data_check' then
    return query select v_app.status in ('submitted','ready_for_screening'),
      case when v_app.status in ('submitted','ready_for_screening') then 'eligible' else 'invalid_transition' end;
  elsif p_new_status = 'screening_passed' then
    return query select
      v_app.status in ('screening_completed','needs_admin_review','needs_more_review')
        and v_profile_submitted >= v_profile_required
        and (v_app.status <> 'needs_more_review' or v_interview_submitted = 0)
        and (
          v_app.status <> 'needs_more_review'
          or exists (
            select 1 from public.application_reviews ar
            where ar.application_id = p_application_id
              and ar.review_round = 'profile_screening'
              and ar.status = 'submitted'
              and ar.submitted_at > v_latest_more_review_at
          )
        ),
      case when v_profile_submitted < v_profile_required then 'profile_review_minimum_not_met'
           when v_app.status = 'needs_more_review' and not exists (
             select 1 from public.application_reviews ar
             where ar.application_id = p_application_id
               and ar.review_round = 'profile_screening'
               and ar.status = 'submitted'
               and ar.submitted_at > v_latest_more_review_at
           ) then 'additional_review_not_submitted'
           when v_app.status not in ('screening_completed','needs_admin_review','needs_more_review')
             or (v_app.status = 'needs_more_review' and v_interview_submitted > 0) then 'invalid_transition'
           else 'eligible' end;
  elsif p_new_status = 'invited_to_interview' then
    return query select
      v_app.status = 'screening_passed' and v_profile_submitted >= v_profile_required,
      case when v_profile_submitted < v_profile_required then 'profile_review_minimum_not_met'
           when v_app.status <> 'screening_passed' then 'invalid_transition'
           else 'eligible' end;
  elsif p_new_status = 'interview_scheduled' then
    return query select v_app.status = 'invited_to_interview',
      case when v_app.status = 'invited_to_interview' then 'eligible' else 'invalid_transition' end;
  elsif p_new_status = 'interview_passed' then
    return query select
      v_app.status in ('ready_for_final_decision','needs_more_review')
        and v_interview_submitted >= v_interview_required
        and (
          v_app.status <> 'needs_more_review'
          or exists (
            select 1 from public.application_reviews ar
            where ar.application_id = p_application_id
              and ar.review_round = 'interview'
              and ar.status = 'submitted'
              and ar.submitted_at > v_latest_more_review_at
          )
        ),
      case when v_interview_submitted < v_interview_required then 'interview_review_minimum_not_met'
           when v_app.status = 'needs_more_review' and not exists (
             select 1 from public.application_reviews ar
             where ar.application_id = p_application_id
               and ar.review_round = 'interview'
               and ar.status = 'submitted'
               and ar.submitted_at > v_latest_more_review_at
           ) then 'additional_review_not_submitted'
           when v_app.status not in ('ready_for_final_decision','needs_more_review') then 'invalid_transition'
           else 'eligible' end;
  elsif p_new_status in ('approved_as_mentor','approved_as_mentee') then
    -- M092.1: role_applied is an enum (role_type) on Staging — normalize
    -- through ::text before coalesce/lower, exactly like the M092 RPC does.
    return query select
      v_app.status = 'interview_passed'
        and v_interview_submitted >= v_interview_required
        and lower(coalesce(v_app.role_applied::text, '')) =
          case when p_new_status = 'approved_as_mentor' then 'mentor' else 'mentee' end,
      case when v_interview_submitted < v_interview_required then 'interview_review_minimum_not_met'
           when v_app.status <> 'interview_passed' then 'invalid_transition'
           when lower(coalesce(v_app.role_applied::text, '')) <>
             case when p_new_status = 'approved_as_mentor' then 'mentor' else 'mentee' end
             then 'application_role_mismatch'
           else 'eligible' end;
  elsif p_new_status in ('waitlisted','rejected_or_not_fit','needs_more_review') then
    if v_app.status in ('interview_scheduled','interview_in_progress','interview_completed','ready_for_final_decision','interview_passed') then
      return query select v_interview_submitted >= v_interview_required,
        case when v_interview_submitted >= v_interview_required then 'eligible' else 'interview_review_minimum_not_met' end;
    else
      return query select
        v_app.status in ('screening_completed','screening_passed','needs_admin_review')
          and v_profile_submitted >= v_profile_required,
        case when v_profile_submitted < v_profile_required then 'profile_review_minimum_not_met'
             when v_app.status not in ('screening_completed','screening_passed','needs_admin_review') then 'invalid_transition'
             else 'eligible' end;
    end if;
  elsif p_new_status = 'withdrawn' then
    return query select
      v_app.status not in ('approved_as_mentor','approved_as_mentee','rejected_or_not_fit','withdrawn'),
      case when v_app.status not in ('approved_as_mentor','approved_as_mentee','rejected_or_not_fit','withdrawn')
        then 'eligible' else 'terminal_status' end;
  else
    return query select false, 'unsupported_decision';
  end if;
end;
$function$;

-- ---- vam084_recompute_application_review_status ------------------
CREATE OR REPLACE FUNCTION public.vam084_recompute_application_review_status(p_application_id uuid, p_review_stage text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_season_id uuid;
  v_current_status text;
  v_required integer;
  v_active integer;
  v_started integer;
  v_submitted integer;
  v_recommendations integer;
  v_next text;
  v_updated integer;
begin
  select a.season_id, a.status
    into v_season_id, v_current_status
  from public.applications a
  where a.id = p_application_id
  for update;
  if v_season_id is null then raise exception 'Application or season not found'; end if;

  select r.minimum_submitted_reviews into v_required
  from public.recruitment_stage_requirements r
  where r.season_id = v_season_id and r.review_stage = p_review_stage;
  if v_required is null then raise exception 'Review requirement is not configured'; end if;

  select
    count(distinct ar.reviewer_admin_user_id) filter (where ar.status <> 'cancelled'),
    count(distinct ar.reviewer_admin_user_id) filter (where ar.status in ('in_progress','submitted')),
    count(distinct ar.reviewer_admin_user_id) filter (where ar.status = 'submitted'),
    count(distinct ar.recommendation) filter (
      where ar.status = 'submitted' and ar.recommendation is not null
    )
  into v_active, v_started, v_submitted, v_recommendations
  from public.application_reviews ar
  where ar.application_id = p_application_id
    and ar.review_round = p_review_stage;

  if p_review_stage = 'profile_screening' then
    v_next := case
      when v_current_status = 'needs_more_review' and v_active > v_submitted then 'needs_more_review'
      when v_submitted >= v_required and v_recommendations > 1 then 'needs_admin_review'
      when v_submitted >= v_required then 'screening_completed'
      when v_active = 0 then 'ready_for_screening'
      when v_started > 0 then 'screening_in_progress'
      else 'screening_assigned'
    end;
    update public.applications set status = v_next
    where id = p_application_id
      and status in (
        'submitted','under_data_check','ready_for_screening','screening_assigned',
        'screening_in_progress','screening_completed','needs_admin_review','needs_more_review'
      );
  elsif p_review_stage = 'interview' then
    v_next := case
      when v_current_status = 'needs_more_review' and v_active > v_submitted then 'needs_more_review'
      when v_submitted >= v_required then 'ready_for_final_decision'
      when v_active = 0 then 'invited_to_interview'
      else 'interview_in_progress'
    end;
    update public.applications set status = v_next
    where id = p_application_id
      and status in (
        'invited_to_interview','interview_scheduled',
        'interview_in_progress','interview_completed','ready_for_final_decision','needs_more_review'
      );
  else
    raise exception 'Unsupported review stage';
  end if;
  get diagnostics v_updated = row_count;
  if v_updated = 0 and v_current_status is distinct from v_next then
    raise exception 'Application state cannot be recomputed from current status';
  end if;
  return v_next;
end;
$function$;

-- ---- vam084_submit_application_review ----------------------------
CREATE OR REPLACE FUNCTION public.vam084_submit_application_review(p_review_id uuid, p_actor uuid, p_score_motivation integer DEFAULT NULL::integer, p_score_goal_clarity integer DEFAULT NULL::integer, p_score_commitment integer DEFAULT NULL::integer, p_score_fit integer DEFAULT NULL::integer, p_score_communication integer DEFAULT NULL::integer, p_recommendation text DEFAULT NULL::text, p_reviewer_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_review public.application_reviews%rowtype;
  v_season_id uuid;
  v_actor_role text;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;
  select ar.* into v_review
  from public.application_reviews ar
  where ar.id = p_review_id
  for update;
  if v_review.id is null or v_review.status not in ('assigned','in_progress','returned_for_clarification') then
    raise exception 'Review is not editable';
  end if;
  select a.season_id into v_season_id from public.applications a where a.id = v_review.application_id;
  select au.role into v_actor_role from public.admin_users au
  where au.id = p_actor and au.status = 'active';

  if v_actor_role not in ('reviewer','super_admin','admin','core_team')
     or v_review.reviewer_admin_user_id <> p_actor
     or not public.vam084_participant_for_stage(p_actor, v_season_id, v_review.review_round) then
    raise exception 'Review submission actor is not the authorized assignee';
  end if;
  if p_recommendation is null or p_recommendation not in (
    'pass_to_interview','approve_recommended','waitlist','reject','needs_admin_review'
  ) then raise exception 'Invalid recommendation'; end if;
  if exists (
    select 1 from unnest(array[
      p_score_motivation,p_score_goal_clarity,p_score_commitment,p_score_fit,p_score_communication
    ]) as score(value) where value is not null and value not between 1 and 5
  ) then
    raise exception 'Review scores must be between 1 and 5';
  end if;

  update public.application_reviews
     set score_motivation = p_score_motivation,
         score_goal_clarity = p_score_goal_clarity,
         score_commitment = p_score_commitment,
         score_fit = p_score_fit,
         score_communication = p_score_communication,
         total_score = coalesce(p_score_motivation,0) + coalesce(p_score_goal_clarity,0)
                     + coalesce(p_score_commitment,0) + coalesce(p_score_fit,0)
                     + coalesce(p_score_communication,0),
         recommendation = p_recommendation,
         reviewer_note = nullif(btrim(p_reviewer_note), ''),
         status = 'submitted', submitted_at = now(), updated_at = now()
   where id = p_review_id;

  perform public.vam084_recompute_application_review_status(
    v_review.application_id, v_review.review_round
  );
  return p_review_id;
end;
$function$;

-- ---- vam084_change_review_assignment -----------------------------
CREATE OR REPLACE FUNCTION public.vam084_change_review_assignment(p_review_id uuid, p_actor uuid, p_reason text, p_new_reviewer uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_review public.application_reviews%rowtype;
  v_season_id uuid;
  v_replacement uuid;
begin
  if current_user <> 'service_role'
     or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'Assignment change rejected';
  end if;
  select ar.* into v_review from public.application_reviews ar
  where ar.id = p_review_id for update;
  if v_review.id is null or v_review.status not in ('assigned','in_progress','returned_for_clarification') then
    raise exception 'Review is not cancellable';
  end if;
  select a.season_id into v_season_id from public.applications a
  where a.id = v_review.application_id;
  if not public.vam084_operator_for_season(p_actor, v_season_id) then
    raise exception 'Assignment scope denied';
  end if;
  if p_new_reviewer is not null then
    if p_new_reviewer = v_review.reviewer_admin_user_id
       or not public.vam084_participant_for_stage(p_new_reviewer, v_season_id, v_review.review_round)
       or exists (
         select 1 from public.application_reviews ar
         where ar.application_id = v_review.application_id
           and ar.review_round = v_review.review_round
           and ar.reviewer_admin_user_id = p_new_reviewer
           and ar.status <> 'cancelled'
       ) then raise exception 'Replacement reviewer rejected'; end if;
  end if;

  update public.application_reviews set status = 'cancelled', updated_at = now()
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
  perform public.vam084_recompute_application_review_status(
    v_review.application_id, v_review.review_round
  );
  return coalesce(v_replacement, v_review.id);
end;
$function$;

-- ---- vam084_apply_application_decisions --------------------------
CREATE OR REPLACE FUNCTION public.vam084_apply_application_decisions(p_application_ids uuid[], p_new_status text, p_actor uuid, p_decision_note text DEFAULT NULL::text, p_expected_statuses jsonb DEFAULT '{}'::jsonb)
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
    update public.applications set status = p_new_status where id = v_row.id;
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
$function$;

-- ---- vam084_grant_recruitment_participation ----------------------
CREATE OR REPLACE FUNCTION public.vam084_grant_recruitment_participation(p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text, p_auth_user_id uuid, p_email text)
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

  insert into public.admin_scope_access (
    user_id, program_id, season_id, role, status
  ) values (
    p_auth_user_id, v_program_id::text, p_season_id::text, 'review', 'active'
  ) on conflict (user_id, (coalesce(program_id, '')), (coalesce(season_id, '')), role)
      where (status = 'active') do nothing;

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

-- ---- vam084_revoke_recruitment_participation ---------------------
CREATE OR REPLACE FUNCTION public.vam084_revoke_recruitment_participation(p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_program_id uuid;
  v_membership public.person_season_memberships%rowtype;
  v_admin_id uuid;
  v_auth_user_id uuid;
  v_platform_role text;
begin
  if p_participation_role not in ('reviewer', 'interviewer')
     or not public.vam084_operator_for_season(p_actor, p_season_id) then
    raise exception 'Recruitment participation revoke rejected';
  end if;

  select s.program_id into v_program_id from public.seasons s where s.id = p_season_id;
  select psm.* into v_membership
  from public.person_season_memberships psm
  where psm.person_id = p_person_id
    and psm.season_id = p_season_id
    and psm.role = p_participation_role
  order by psm.created_at desc
  limit 1
  for update;
  if v_membership.id is null then raise exception 'Recruitment participation not found'; end if;

  select au.id, au.auth_user_id, au.role
    into v_admin_id, v_auth_user_id, v_platform_role
  from public.admin_users au
  join public.people p on lower(btrim(p.email_primary)) = lower(btrim(au.email))
  where p.id = p_person_id
  for update of au;

  update public.person_season_memberships
     set status = 'cancelled', end_date = current_date, updated_at = now()
   where id = v_membership.id;
  insert into public.person_season_membership_log (
    membership_id, person_id, program_id, season_id, role,
    old_status, new_status, transition_type, reason, changed_by
  ) values (
    v_membership.id, p_person_id, v_program_id, p_season_id,
    p_participation_role, v_membership.status, 'cancelled',
    'status_change', 'S12 recruitment participation revoke', p_actor
  );

  if not exists (
    select 1 from public.person_season_memberships psm
    where psm.person_id = p_person_id
      and psm.season_id = p_season_id
      and psm.role in ('reviewer','interviewer')
      and psm.status = 'active'
  ) then
    update public.admin_scope_access
       set status = 'inactive', updated_at = now()
     where user_id = v_auth_user_id
       and season_id = p_season_id::text
       and role = 'review'
       and status = 'active';
  end if;

  if v_platform_role = 'reviewer' and not exists (
    select 1
    from public.person_season_memberships psm
    join public.people p on p.id = psm.person_id
    join public.admin_users au on lower(btrim(au.email)) = lower(btrim(p.email_primary))
    where au.id = v_admin_id
      and psm.role in ('reviewer','interviewer')
      and psm.status = 'active'
  ) then
    update public.admin_users set status = 'inactive', updated_at = now()
    where id = v_admin_id;
  end if;

  insert into public.admin_audit_log (
    actor_admin_user_id, target_admin_user_id, action_type, details
  ) values (
    p_actor, v_admin_id, 'update_admin_user_access',
    jsonb_build_object(
      'operation', 'revoke_recruitment_participation',
      'person_id', p_person_id,
      'season_id', p_season_id,
      'participation_role', p_participation_role
    )
  );
  return v_admin_id;
end;
$function$;

-- ---- vam090_bulk_assign_application_reviews ----------------------
CREATE OR REPLACE FUNCTION public.vam090_bulk_assign_application_reviews(p_intake_batch_id uuid, p_role_applied text, p_statuses text[], p_reviewer_ids uuid[], p_review_round text, p_due_at timestamp with time zone, p_exclude_already_assigned boolean, p_assignment_note text, p_actor uuid, p_limit integer DEFAULT NULL::integer)
 RETURNS TABLE(batch_id uuid, applications_assigned integer, reviewers_count integer, min_per_reviewer integer, max_per_reviewer integer, skipped_already_assigned integer, skipped_limit_reached integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_season_id uuid;
  v_application_ids uuid[];
  v_reviewer_ids uuid[];
  v_batch_id uuid;
  v_application_id uuid;
  v_reviewer_id uuid;
  v_candidate_count integer;
  v_assigned integer := 0;
  -- Kept distinct: a candidate excluded because it already has an active
  -- assignment is a materially different outcome from one that was simply
  -- never reached because the batch was capped at p_limit. Collapsing them
  -- into one counter would misrepresent a limit-truncated application as
  -- "already assigned" to the caller.
  v_skipped_already_assigned integer := 0;
  v_skipped_limit_reached integer := 0;
  v_app_index integer;
  v_offset integer;
  v_reviewer_count integer;
  v_selected boolean;
  v_min integer;
  v_max integer;
  v_actual_reviewers integer;
  v_profile_statuses constant text[] := array[
    'submitted','under_data_check','ready_for_screening','screening_assigned','needs_more_review'
  ];
  v_interview_statuses constant text[] := array[
    'invited_to_interview','interview_scheduled','interview_in_progress','needs_more_review'
  ];
begin
  if current_user <> 'service_role' then raise exception 'Trusted server context required'; end if;
  if p_intake_batch_id is null then raise exception 'Intake batch is required'; end if;
  -- p_limit must be rejected outright when out of range, not silently treated
  -- as "no limit": a caller passing 0 or a negative number almost certainly
  -- made a mistake and expects an error, not an unbounded assignment. 500 is
  -- a generous ceiling for a single UEHM one-wave batch while still bounding
  -- pathological input at the mutation boundary, not only in the UI.
  if p_limit is not null and (p_limit < 1 or p_limit > 500) then
    raise exception 'Assignment limit must be between 1 and 500';
  end if;
  if p_review_round not in ('profile_screening','interview') then raise exception 'Invalid review round'; end if;
  if lower(btrim(coalesce(p_role_applied, ''))) not in ('mentor','mentee') then raise exception 'Invalid applied role'; end if;
  if coalesce(cardinality(p_statuses), 0) < 1
     or coalesce(cardinality(p_reviewer_ids), 0) < 1
     or cardinality(p_reviewer_ids) > 100
     or (select count(distinct value) from unnest(p_reviewer_ids) requested(value)) <> cardinality(p_reviewer_ids)
     or (select count(distinct value) from unnest(p_statuses) requested(value)) <> cardinality(p_statuses) then
    raise exception 'Assignment filters and reviewers must be non-empty and unique';
  end if;
  if (p_review_round = 'profile_screening' and not p_statuses <@ v_profile_statuses)
     or (p_review_round = 'interview' and not p_statuses <@ v_interview_statuses) then
    raise exception 'Assignment status filter is invalid for the review round';
  end if;

  select ib.season_id into v_season_id
  from public.intake_batches ib
  where ib.id = p_intake_batch_id;
  if v_season_id is null or not public.vam084_operator_for_season(p_actor, v_season_id) then
    raise exception 'Assignment batch scope denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_intake_batch_id::text || ':' || p_review_round, 0));

  select array_agg(au.id order by coalesce(workload.active_count, 0), coalesce(au.email, ''), au.id)
    into v_reviewer_ids
  from unnest(p_reviewer_ids) requested(id)
  join public.admin_users au on au.id = requested.id and au.status = 'active'
  left join lateral (
    select count(*)::integer as active_count
    from public.application_reviews ar
    where ar.reviewer_admin_user_id = au.id
      and ar.review_round = p_review_round
      and ar.status <> 'cancelled'
  ) workload on true;
  if cardinality(v_reviewer_ids) <> cardinality(p_reviewer_ids) then
    raise exception 'One or more reviewers are not active';
  end if;
  foreach v_reviewer_id in array v_reviewer_ids loop
    if not public.vam084_participant_for_stage(v_reviewer_id, v_season_id, p_review_round) then
      raise exception 'Reviewer is not an active participant for this season and stage';
    end if;
  end loop;

  -- M093: role_applied is public.role_type (enum) on Staging, not text — the
  -- same defect M092.1 fixed elsewhere. Normalizing through ::text first
  -- makes this comparison, and the two identical ones below, work
  -- identically whether the column is the enum or plain text.
  select count(*)::integer into v_candidate_count
  from public.applications a
  where a.intake_batch_id = p_intake_batch_id
    and lower(coalesce(a.role_applied::text, '')) = lower(btrim(p_role_applied))
    and a.status = any(p_statuses)
    and (
      a.status <> 'needs_more_review'
      or (p_review_round = 'profile_screening' and not exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
      or (p_review_round = 'interview' and exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
    );

  perform a.id
  from public.applications a
  where a.intake_batch_id = p_intake_batch_id
    and lower(coalesce(a.role_applied::text, '')) = lower(btrim(p_role_applied))
    and a.status = any(p_statuses)
    and (
      a.status <> 'needs_more_review'
      or (p_review_round = 'profile_screening' and not exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
      or (p_review_round = 'interview' and exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
    )
  order by a.submitted_at nulls last, a.id
  for update;

  select array_agg(a.id order by a.submitted_at nulls last, a.id)
    into v_application_ids
  from public.applications a
  where a.intake_batch_id = p_intake_batch_id
    and lower(coalesce(a.role_applied::text, '')) = lower(btrim(p_role_applied))
    and a.status = any(p_statuses)
    and (
      a.status <> 'needs_more_review'
      or (p_review_round = 'profile_screening' and not exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
      or (p_review_round = 'interview' and exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
    )
    and (
      not p_exclude_already_assigned
      or not exists (
        select 1 from public.application_reviews ar
        where ar.application_id = a.id
          and ar.review_round = p_review_round
          and ar.status <> 'cancelled'
      )
    );

  v_skipped_already_assigned := v_candidate_count - coalesce(cardinality(v_application_ids), 0);

  -- Handle limit restriction. p_limit is already validated to be between
  -- 1 and 500 (or null) above. Truncation here is a separate reason from
  -- "already assigned" above — track it in its own counter.
  if p_limit is not null and coalesce(cardinality(v_application_ids), 0) > p_limit then
    v_skipped_limit_reached := cardinality(v_application_ids) - p_limit;
    v_application_ids := v_application_ids[1:p_limit];
  end if;

  if coalesce(cardinality(v_application_ids), 0) = 0 then
    raise exception 'No applications matched the assignment filters';
  end if;

  insert into public.review_assignment_batches (
    intake_batch_id, review_round, created_by, due_at,
    assignment_note, application_count, reviewer_count
  ) values (
    p_intake_batch_id, p_review_round, p_actor, p_due_at,
    nullif(btrim(p_assignment_note), ''), 0, 0
  ) returning id into v_batch_id;

  v_reviewer_count := cardinality(v_reviewer_ids);
  for v_app_index in 1..cardinality(v_application_ids) loop
    v_application_id := v_application_ids[v_app_index];
    v_selected := false;
    for v_offset in 0..(v_reviewer_count - 1) loop
      v_reviewer_id := v_reviewer_ids[1 + mod(v_app_index - 1 + v_offset, v_reviewer_count)];
      if not exists (
        select 1 from public.application_reviews ar
        where ar.application_id = v_application_id
          and ar.reviewer_admin_user_id = v_reviewer_id
          and ar.review_round = p_review_round
          and ar.status <> 'cancelled'
      ) then
        insert into public.application_reviews (
          application_id, review_round, reviewer_admin_user_id, assigned_by,
          assigned_at, due_at, status, assignment_batch_id
        ) values (
          v_application_id, p_review_round, v_reviewer_id, p_actor,
          now(), p_due_at, 'assigned', v_batch_id
        );
        perform public.vam084_recompute_application_review_status(v_application_id, p_review_round);
        v_assigned := v_assigned + 1;
        v_selected := true;
        exit;
      end if;
    end loop;
    if not v_selected then v_skipped_already_assigned := v_skipped_already_assigned + 1; end if;
  end loop;
  if v_assigned = 0 then raise exception 'No non-duplicate assignments could be created'; end if;

  select count(distinct ar.reviewer_admin_user_id)::integer,
         min(per_reviewer.assignment_count)::integer,
         max(per_reviewer.assignment_count)::integer
    into v_actual_reviewers, v_min, v_max
  from public.application_reviews ar
  join lateral (
    select count(*)::integer as assignment_count
    from public.application_reviews counted
    where counted.assignment_batch_id = v_batch_id
      and counted.reviewer_admin_user_id = ar.reviewer_admin_user_id
  ) per_reviewer on true
  where ar.assignment_batch_id = v_batch_id;

  update public.review_assignment_batches
  set application_count = v_assigned, reviewer_count = v_actual_reviewers
  where id = v_batch_id;

  return query select v_batch_id, v_assigned, v_actual_reviewers, v_min, v_max,
    v_skipped_already_assigned, v_skipped_limit_reached;
end;
$function$;

-- ---- vam090_finalize_recruitment_approval ------------------------
CREATE OR REPLACE FUNCTION public.vam090_finalize_recruitment_approval(p_application_id uuid, p_new_status text, p_actor uuid, p_person_id uuid, p_expected_status text, p_decision_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_app public.applications%rowtype;
  v_gate record;
  v_actor_name text;
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
  return true;
end;
$function$;

-- --------------------------------------------------------------------------
-- 3. Execute ACL — service_role only, matching Staging exactly.
--    These are trusted RPCs: anon/authenticated must never execute them.
-- --------------------------------------------------------------------------
revoke all on function public.vam084_operator_for_season(p_actor uuid, p_season_id uuid) from public;
revoke all on function public.vam084_operator_for_season(p_actor uuid, p_season_id uuid) from anon, authenticated;
grant execute on function public.vam084_operator_for_season(p_actor uuid, p_season_id uuid) to service_role;
revoke all on function public.vam084_participant_for_stage(p_admin_user_id uuid, p_season_id uuid, p_review_stage text) from public;
revoke all on function public.vam084_participant_for_stage(p_admin_user_id uuid, p_season_id uuid, p_review_stage text) from anon, authenticated;
grant execute on function public.vam084_participant_for_stage(p_admin_user_id uuid, p_season_id uuid, p_review_stage text) to service_role;
revoke all on function public.vam084_list_recruitment_participants(p_season_id uuid, p_review_stage text) from public;
revoke all on function public.vam084_list_recruitment_participants(p_season_id uuid, p_review_stage text) from anon, authenticated;
grant execute on function public.vam084_list_recruitment_participants(p_season_id uuid, p_review_stage text) to service_role;
revoke all on function public.vam084_upsert_stage_requirement(p_actor uuid, p_season_id uuid, p_review_stage text, p_minimum integer) from public;
revoke all on function public.vam084_upsert_stage_requirement(p_actor uuid, p_season_id uuid, p_review_stage text, p_minimum integer) from anon, authenticated;
grant execute on function public.vam084_upsert_stage_requirement(p_actor uuid, p_season_id uuid, p_review_stage text, p_minimum integer) to service_role;
revoke all on function public.vam084_application_decision_eligibility(p_application_id uuid, p_new_status text) from public;
revoke all on function public.vam084_application_decision_eligibility(p_application_id uuid, p_new_status text) from anon, authenticated;
grant execute on function public.vam084_application_decision_eligibility(p_application_id uuid, p_new_status text) to service_role;
revoke all on function public.vam084_recompute_application_review_status(p_application_id uuid, p_review_stage text) from public;
revoke all on function public.vam084_recompute_application_review_status(p_application_id uuid, p_review_stage text) from anon, authenticated;
grant execute on function public.vam084_recompute_application_review_status(p_application_id uuid, p_review_stage text) to service_role;
revoke all on function public.vam084_submit_application_review(p_review_id uuid, p_actor uuid, p_score_motivation integer DEFAULT NULL::integer, p_score_goal_clarity integer DEFAULT NULL::integer, p_score_commitment integer DEFAULT NULL::integer, p_score_fit integer DEFAULT NULL::integer, p_score_communication integer DEFAULT NULL::integer, p_recommendation text DEFAULT NULL::text, p_reviewer_note text DEFAULT NULL::text) from public;
revoke all on function public.vam084_submit_application_review(p_review_id uuid, p_actor uuid, p_score_motivation integer DEFAULT NULL::integer, p_score_goal_clarity integer DEFAULT NULL::integer, p_score_commitment integer DEFAULT NULL::integer, p_score_fit integer DEFAULT NULL::integer, p_score_communication integer DEFAULT NULL::integer, p_recommendation text DEFAULT NULL::text, p_reviewer_note text DEFAULT NULL::text) from anon, authenticated;
grant execute on function public.vam084_submit_application_review(p_review_id uuid, p_actor uuid, p_score_motivation integer DEFAULT NULL::integer, p_score_goal_clarity integer DEFAULT NULL::integer, p_score_commitment integer DEFAULT NULL::integer, p_score_fit integer DEFAULT NULL::integer, p_score_communication integer DEFAULT NULL::integer, p_recommendation text DEFAULT NULL::text, p_reviewer_note text DEFAULT NULL::text) to service_role;
revoke all on function public.vam084_change_review_assignment(p_review_id uuid, p_actor uuid, p_reason text, p_new_reviewer uuid DEFAULT NULL::uuid) from public;
revoke all on function public.vam084_change_review_assignment(p_review_id uuid, p_actor uuid, p_reason text, p_new_reviewer uuid DEFAULT NULL::uuid) from anon, authenticated;
grant execute on function public.vam084_change_review_assignment(p_review_id uuid, p_actor uuid, p_reason text, p_new_reviewer uuid DEFAULT NULL::uuid) to service_role;
revoke all on function public.vam084_apply_application_decisions(p_application_ids uuid[], p_new_status text, p_actor uuid, p_decision_note text DEFAULT NULL::text, p_expected_statuses jsonb DEFAULT '{}'::jsonb) from public;
revoke all on function public.vam084_apply_application_decisions(p_application_ids uuid[], p_new_status text, p_actor uuid, p_decision_note text DEFAULT NULL::text, p_expected_statuses jsonb DEFAULT '{}'::jsonb) from anon, authenticated;
grant execute on function public.vam084_apply_application_decisions(p_application_ids uuid[], p_new_status text, p_actor uuid, p_decision_note text DEFAULT NULL::text, p_expected_statuses jsonb DEFAULT '{}'::jsonb) to service_role;
revoke all on function public.vam084_grant_recruitment_participation(p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text, p_auth_user_id uuid, p_email text) from public;
revoke all on function public.vam084_grant_recruitment_participation(p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text, p_auth_user_id uuid, p_email text) from anon, authenticated;
grant execute on function public.vam084_grant_recruitment_participation(p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text, p_auth_user_id uuid, p_email text) to service_role;
revoke all on function public.vam084_revoke_recruitment_participation(p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text) from public;
revoke all on function public.vam084_revoke_recruitment_participation(p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text) from anon, authenticated;
grant execute on function public.vam084_revoke_recruitment_participation(p_actor uuid, p_person_id uuid, p_season_id uuid, p_participation_role text) to service_role;
revoke all on function public.vam090_bulk_assign_application_reviews(p_intake_batch_id uuid, p_role_applied text, p_statuses text[], p_reviewer_ids uuid[], p_review_round text, p_due_at timestamp with time zone, p_exclude_already_assigned boolean, p_assignment_note text, p_actor uuid, p_limit integer DEFAULT NULL::integer) from public;
revoke all on function public.vam090_bulk_assign_application_reviews(p_intake_batch_id uuid, p_role_applied text, p_statuses text[], p_reviewer_ids uuid[], p_review_round text, p_due_at timestamp with time zone, p_exclude_already_assigned boolean, p_assignment_note text, p_actor uuid, p_limit integer DEFAULT NULL::integer) from anon, authenticated;
grant execute on function public.vam090_bulk_assign_application_reviews(p_intake_batch_id uuid, p_role_applied text, p_statuses text[], p_reviewer_ids uuid[], p_review_round text, p_due_at timestamp with time zone, p_exclude_already_assigned boolean, p_assignment_note text, p_actor uuid, p_limit integer DEFAULT NULL::integer) to service_role;
revoke all on function public.vam090_finalize_recruitment_approval(p_application_id uuid, p_new_status text, p_actor uuid, p_person_id uuid, p_expected_status text, p_decision_note text DEFAULT NULL::text) from public;
revoke all on function public.vam090_finalize_recruitment_approval(p_application_id uuid, p_new_status text, p_actor uuid, p_person_id uuid, p_expected_status text, p_decision_note text DEFAULT NULL::text) from anon, authenticated;
grant execute on function public.vam090_finalize_recruitment_approval(p_application_id uuid, p_new_status text, p_actor uuid, p_person_id uuid, p_expected_status text, p_decision_note text DEFAULT NULL::text) to service_role;
