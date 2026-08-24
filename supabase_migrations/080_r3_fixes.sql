-- Migration 080: bounded R3 remediation

begin;

-- One reviewer may only hold one assignment for an application and round.
drop index if exists public.idx_app_reviews_single_reviewer;
create unique index idx_app_reviews_single_reviewer
  on public.application_reviews (application_id, reviewer_admin_user_id, review_round)
  where status <> 'cancelled';

-- Serialize active profile-screening assignment counts per application so two
-- concurrent bulk operations cannot both pass the two-reviewer ceiling.
create or replace function public.vam080_enforce_profile_screening_reviewer_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_active_count integer;
begin
  if new.review_round = 'profile_screening' and new.status <> 'cancelled' then
    perform pg_advisory_xact_lock(hashtextextended(new.application_id::text, 0));

    select count(*)::integer
      into v_active_count
      from public.application_reviews ar
     where ar.application_id = new.application_id
       and ar.review_round = 'profile_screening'
       and ar.status <> 'cancelled'
       and (tg_op = 'INSERT' or ar.id <> new.id);

    if v_active_count >= 2 then
      raise exception 'An application may have at most two active profile_screening reviewers'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_reviews_profile_screening_limit
  on public.application_reviews;
create trigger trg_app_reviews_profile_screening_limit
before insert or update of application_id, review_round, reviewer_admin_user_id, status
on public.application_reviews
for each row
execute function public.vam080_enforce_profile_screening_reviewer_limit();

-- Conflict routing is a first-class application workflow status.
alter table public.applications
  drop constraint if exists applications_status_check;
alter table public.applications
  add constraint applications_status_check check (
    status is null or status in (
      'submitted',
      'under_data_check',
      'ready_for_screening',
      'screening_assigned',
      'screening_in_progress',
      'screening_completed',
      'screening_passed',
      'invited_to_meeting',
      'invited_to_orientation',
      'invited_to_interview',
      'interview_scheduled',
      'interview_in_progress',
      'interview_completed',
      'interview_passed',
      'approved_as_mentor',
      'approved_as_mentee',
      'waitlisted',
      'rejected_or_not_fit',
      'needs_more_review',
      'needs_admin_review',
      'withdrawn'
    )
  );

-- Application workflow tables are server-only. The service-role key is the
-- authorization boundary; browser roles receive neither policies nor grants.
alter table public.applications enable row level security;
drop policy if exists "read_applications_review_roles" on public.applications;
drop policy if exists "applications_read" on public.applications;

revoke select, insert, update, delete
  on table public.applications, public.application_reviews, public.application_answers
  from authenticated, anon, public;

do $$
begin
  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('applications', 'application_reviews', 'application_answers')
      and g.grantee in ('authenticated', 'anon', 'PUBLIC')
      and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'R3 application workflow DML grants remain on a client role';
  end if;
end;
$$;

-- Forward-fix migration 077: canonical duplicate protection applies to every
-- season and exempts withdrawn or explicitly exempted applications.
drop index if exists public.canonical_identity_email_idx;
drop index if exists public.canonical_identity_mssv_idx;

do $$ 
declare
  email_collision_count integer;
  mssv_collision_count integer;
begin
  select count(*) into email_collision_count
  from (
    select season_id, applicant_email_norm
    from public.applications
    where role_applied = 'mentee' and applicant_email_norm is not null and status is distinct from 'withdrawn' and dedup_exempt_reason is null
    group by season_id, applicant_email_norm
    having count(*) > 1
  ) as duplicates;

  if email_collision_count > 0 then
    raise exception 'Migration preflight failed: found % email collisions', email_collision_count;
  end if;

  select count(*) into mssv_collision_count
  from (
    select season_id, applicant_student_id_norm
    from public.applications
    where role_applied = 'mentee' and applicant_student_id_norm is not null and applicant_student_id_norm != '' and status is distinct from 'withdrawn' and dedup_exempt_reason is null
    group by season_id, applicant_student_id_norm
    having count(*) > 1
  ) as duplicates;

  if mssv_collision_count > 0 then
    raise exception 'Migration preflight failed: found % MSSV collisions', mssv_collision_count;
  end if;
end $$;
create unique index canonical_identity_email_idx
on public.applications (season_id, applicant_email_norm)
where role_applied = 'mentee'
  and applicant_email_norm is not null
  and status is distinct from 'withdrawn'
  and dedup_exempt_reason is null;

create unique index canonical_identity_mssv_idx
on public.applications (season_id, applicant_student_id_norm)
where role_applied = 'mentee'
  and applicant_student_id_norm is not null
  and applicant_student_id_norm <> ''
  and status is distinct from 'withdrawn'
  and dedup_exempt_reason is null;

commit;
