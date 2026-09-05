-- =============================================================================
-- MIGRATION 20260906090000
-- S12 recruitment throughput -- direct profile-review to interview invite
--
-- NOT APPLIED. Authored against Production schema a3af03a and executed against
-- NO database.
--
-- WHY
--   Core Team reported the S12 flow taking roughly three times as long as the
--   old one. With ~2 operators processing a large intake, the cost is dominated
--   by human actions, and the pipeline demanded two of them for one judgement:
--   "Qua vong ho so" and then "Moi phong van". This removes the first as a
--   separate human step.
--
-- WHAT CHANGES
--   Exactly one branch of exactly one function. `invited_to_interview` becomes
--   reachable directly from the statuses the profile round actually ends in,
--   instead of only from `screening_passed`.
--
-- WHAT DOES NOT CHANGE
--   * The review gate. `v_profile_submitted >= v_profile_required` still guards
--     the transition, still counts DISTINCT reviewers, and still counts only
--     rows with status = 'submitted'. Assigned, in_progress, returned and
--     cancelled reviews remain worth nothing.
--   * Every other branch of this function, byte for byte: under_data_check,
--     screening_passed, interview_scheduled, interview_passed, approved_as_*,
--     waitlisted / rejected_or_not_fit / needs_more_review, withdrawn.
--   * `screening_passed` remains a legal source, so records sitting there today
--     and any two-step decision in flight keep working.
--   * needs_more_review provenance routing, carried across verbatim.
--   * Signature, RETURNS TABLE shape, STABLE, SECURITY INVOKER, search_path.
--
-- WHY NO NEW RPC
--   A "collapse two transitions into one transaction" function was considered
--   and rejected. It would have to write two application_decisions rows for one
--   human command, which misrepresents the audit trail as two independent Core
--   Team actions. Nothing in the database requires `screening_passed` to be
--   persisted -- vam084_recompute_application_review_status neither produces it
--   nor reads it, and its UPDATE guard lists exclude both screening_passed and
--   invited_to_interview -- so the honest model is one transition, one decision
--   row, one audit entry.
--
-- ROLLBACK
--   Re-apply the vam084_application_decision_eligibility body from
--   20260903180000_p0_restore_recruitment_review_rpcs.sql. No table, column,
--   index, policy or grant is touched by this file, so nothing else unwinds.
-- =============================================================================

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
    -- S12 THROUGHPUT CHANGE, AND THE ONLY CHANGE IN THIS FUNCTION.
    --
    -- Previously this accepted 'screening_passed' alone, which forced Core Team
    -- to record two separate decisions -- "Qua vong ho so" and then "Moi phong
    -- van" -- for one operational judgement. The profile-review gate below is
    -- unchanged in strength; only the set of source statuses widens, to exactly
    -- the statuses vam084_recompute_application_review_status produces once the
    -- profile round is finished:
    --
    --   screening_completed  reviewers agreed
    --   needs_admin_review   reviewers disagreed
    --   screening_passed     retained so records already at that state, and any
    --                        two-step decision still in flight, keep working
    --
    -- needs_more_review keeps its own clause, carrying the SAME provenance rule
    -- the screening_passed branch above uses: it may only advance while no
    -- interview review exists (so it is a profile-stage remediation, not an
    -- interview-stage one) and only once a profile review has been submitted
    -- AFTER the decision that asked for more review. Without both conditions a
    -- "Can xem them" application could reach the interview round on the strength
    -- of the review that prompted the request.
    return query select
      (
        v_app.status in ('screening_passed', 'screening_completed', 'needs_admin_review')
        or (
          v_app.status = 'needs_more_review'
          and v_interview_submitted = 0
          and exists (
            select 1 from public.application_reviews ar
            where ar.application_id = p_application_id
              and ar.review_round = 'profile_screening'
              and ar.status = 'submitted'
              and ar.submitted_at > v_latest_more_review_at
          )
        )
      )
      and v_profile_submitted >= v_profile_required,
      case when v_profile_submitted < v_profile_required then 'profile_review_minimum_not_met'
           when v_app.status = 'needs_more_review' and (
             v_interview_submitted > 0
             or not exists (
               select 1 from public.application_reviews ar
               where ar.application_id = p_application_id
                 and ar.review_round = 'profile_screening'
                 and ar.status = 'submitted'
                 and ar.submitted_at > v_latest_more_review_at
             )
           ) then 'additional_review_not_submitted'
           when v_app.status not in (
             'screening_passed', 'screening_completed', 'needs_admin_review', 'needs_more_review'
           ) then 'invalid_transition'
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

-- The execute ACL is unchanged from 20260903180000 and restated here so a
-- CREATE OR REPLACE can never silently widen it.
revoke all on function public.vam084_application_decision_eligibility(uuid, text)
  from public, anon, authenticated;
grant execute on function public.vam084_application_decision_eligibility(uuid, text)
  to service_role;

do $vam_direct_invite_post$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'vam084_application_decision_eligibility'
  ) then
    raise exception 'post-condition: vam084_application_decision_eligibility missing';
  end if;
end
$vam_direct_invite_post$;
