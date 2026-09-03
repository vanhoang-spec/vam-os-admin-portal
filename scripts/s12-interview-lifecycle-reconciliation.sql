-- ===========================================================================
-- S12 interview-lifecycle reconciliation — DETECTION ONLY. READ ONLY.
--
-- WHY THIS EXISTS
--   The current runtime is correct: vam084_submit_application_review always
--   ends by calling vam084_recompute_application_review_status, which moves an
--   interview-stage application to ready_for_final_decision as soon as the
--   distinct submitted-reviewer count reaches the season minimum. Nothing in
--   the deployed code or catalog can produce 'interview_completed' any more —
--   vam084_apply_application_decisions does not accept it, and
--   vam084_application_decision_eligibility answers 'unsupported_decision'.
--
--   Rows can nevertheless sit at a stale interview-stage status if they were
--   written by an EARLIER runtime. On Production the vam084_* family was
--   absent until migration 20260903180000 (the P0 restore), so reviews
--   recorded before that date never ran recompute at all.
--
--   This script finds those rows from objective database facts only. It never
--   writes, and it deliberately does NOT tell you an applicant passed the
--   interview — reaching ready_for_final_decision is where the human
--   Admin/Core Team decision begins, not a substitute for it.
--
-- HOW TO READ THE RESULT
--   expected_status is this script's replay of the interview branch of
--   vam084_recompute_application_review_status against current data. A row is
--   listed only when expected_status differs from the row's current status AND
--   the current status is one the recompute UPDATE is allowed to change.
--
-- REMEDIATION
--   Do not UPDATE applications.status by hand. Call the canonical function for
--   the specific proven id, as service_role:
--     select public.vam084_recompute_application_review_status(
--       '<application_id>'::uuid, 'interview');
--   It re-reads the same facts under a row lock and applies the same rule.
-- ===========================================================================

with stage as (
  select r.season_id, r.minimum_submitted_reviews as required
  from public.recruitment_stage_requirements r
  where r.review_stage = 'interview'
),
facts as (
  select
    a.id,
    a.season_id,
    a.status                                as current_status,
    a.role_applied::text                    as role_applied,
    st.required,
    count(distinct ar.reviewer_admin_user_id)
      filter (where ar.status <> 'cancelled')                       as active_reviewers,
    count(distinct ar.reviewer_admin_user_id)
      filter (where ar.status in ('in_progress','submitted'))       as started_reviewers,
    count(distinct ar.reviewer_admin_user_id)
      filter (where ar.status = 'submitted')                        as submitted_reviewers,
    count(*) filter (where ar.status = 'submitted')                 as submitted_review_rows,
    max(ar.submitted_at) filter (where ar.status = 'submitted')     as last_review_submitted_at
  from public.applications a
  join stage st on st.season_id = a.season_id
  left join public.application_reviews ar
    on ar.application_id = a.id and ar.review_round = 'interview'
  where a.status in (
    'invited_to_interview','interview_scheduled','interview_in_progress',
    'interview_completed','ready_for_final_decision','needs_more_review'
  )
  group by a.id, a.season_id, a.status, a.role_applied, st.required
),
replayed as (
  select f.*,
    case
      when f.current_status = 'needs_more_review'
           and f.active_reviewers > f.submitted_reviewers then 'needs_more_review'
      when f.submitted_reviewers >= f.required            then 'ready_for_final_decision'
      when f.active_reviewers = 0                         then 'invited_to_interview'
      else 'interview_in_progress'
    end as expected_status
  from facts f
)
select
  -- Severity, so an operator can act on what matters and ignore label lag.
  --   blocks_official_approval : the row has met the interview minimum but is
  --     parked before ready_for_final_decision, so the Admin/Core Team decision
  --     (and therefore M092) can never be reached. These are the rows to fix.
  --   cosmetic_label_lag       : recompute would only relabel an in-flight
  --     interview row (e.g. invited_to_interview -> interview_in_progress)
  --     because assignment does not itself call recompute. Nothing is blocked;
  --     reconciling these changes display only and is NOT recommended.
  case
    when r.expected_status = 'ready_for_final_decision'
     and r.current_status <> 'ready_for_final_decision' then 'blocks_official_approval'
    else 'cosmetic_label_lag'
  end                                   as severity,
  s.code                                as season_code,
  r.id::text                            as application_id,
  r.role_applied,
  r.current_status,
  r.expected_status,
  r.required                            as required_submitted_reviewers,
  r.submitted_reviewers,
  r.submitted_review_rows,
  r.active_reviewers,
  r.last_review_submitted_at,
  -- A decision recorded AFTER the last interview review is a deliberate human
  -- action; such a row is NOT safe to auto-reconcile without review.
  (select count(*) from public.application_decisions d
     where d.application_id = r.id
       and r.last_review_submitted_at is not null
       and d.created_at > r.last_review_submitted_at)              as decisions_after_last_review,
  (select max(d.new_status) from public.application_decisions d
     where d.application_id = r.id
       and r.last_review_submitted_at is not null
       and d.created_at > r.last_review_submitted_at)              as latest_decision_after_review
from replayed r
join public.seasons s on s.id = r.season_id
where r.expected_status is distinct from r.current_status
order by severity, s.code, r.current_status, r.id;
