-- Migration 079: application review state projection (R3)
-- Adds read-only profile-screening assignment/completion/conflict state to
-- application_list_v1 without changing the review workflow tables.

begin;

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
  coalesce(a.status, a.final_status::text) as status_unified,
  coalesce(a.consent_data_storage, a.consent_pdpa) as consent_unified,
  coalesce(a.full_name, p.full_name) as full_name,
  coalesce(a.email_primary, p.email_primary) as email_primary,
  coalesce(s.code, s.name) as season_code,
  coalesce(b.code, b.name) as intake_batch_code,
  lower(
    coalesce(a.full_name, p.full_name, '') || ' ' ||
    coalesce(a.sbd, a.applicant_student_id_norm, '') || ' ' ||
    a.id::text || ' ' ||
    coalesce(a.person_id::text, '')
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
grant select on public.application_list_v1 to authenticated, service_role;

comment on column public.application_list_v1.review_conflict_status is
  'pending until two profile-screening reviews are submitted, aligned when recommendations agree, needs_admin_review when they differ.';

commit;
