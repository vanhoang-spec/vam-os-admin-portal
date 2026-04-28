-- VAM OS Phase 2 Activity & Event Tracking
-- This migration creates read/write-ready tables for internal activity tracking,
-- but does not enable RLS yet. RLS policies must be added before broader access.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists mentoring_recaps (
  id uuid primary key default gen_random_uuid(),
  season_id uuid null references seasons(id),
  match_id uuid null references matches(id),
  mentor_person_id uuid null references people(id),
  mentee_person_id uuid null references people(id),
  meeting_date date not null,
  meeting_month text not null,
  recap_url text not null,
  recap_source text not null default 'facebook_group',
  recap_note text,
  issue_flag boolean not null default false,
  status text not null default 'submitted',
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mentoring_recaps_recap_source_check
    check (recap_source in ('facebook_group', 'google_sheet', 'admin_input')),
  constraint mentoring_recaps_status_check
    check (status in ('submitted', 'needs_review', 'invalid', 'duplicate')),
  constraint mentoring_recaps_meeting_month_check
    check (meeting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

comment on table mentoring_recaps is
  'One row represents exactly one mentor-mentee meeting recap. The at-least-one-recap-per-month rule and two-consecutive-missing-month follow-up rule are computed in the app/reporting layer.';

comment on column mentoring_recaps.meeting_month is
  'Operational month in YYYY-MM format. Multiple recaps per mentee/month are allowed.';

create index if not exists mentoring_recaps_season_id_idx
  on mentoring_recaps(season_id);

create index if not exists mentoring_recaps_match_id_idx
  on mentoring_recaps(match_id);

create index if not exists mentoring_recaps_mentor_person_id_idx
  on mentoring_recaps(mentor_person_id);

create index if not exists mentoring_recaps_mentee_person_id_idx
  on mentoring_recaps(mentee_person_id);

create index if not exists mentoring_recaps_meeting_month_idx
  on mentoring_recaps(meeting_month);

create index if not exists mentoring_recaps_issue_flag_idx
  on mentoring_recaps(issue_flag);

drop trigger if exists mentoring_recaps_set_updated_at on mentoring_recaps;

create trigger mentoring_recaps_set_updated_at
before update on mentoring_recaps
for each row
execute function set_updated_at();

create table if not exists event_participations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid null references events(id),
  season_id uuid null references seasons(id),
  person_id uuid null references people(id),
  role_at_event text,
  registration_status text not null default 'registered',
  attendance_status text not null default 'registered_absent',
  attendance_date date,
  recap_url text,
  excuse_reason text,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_participations_registration_status_check
    check (registration_status in ('registered', 'unknown')),
  constraint event_participations_attendance_status_check
    check (attendance_status in ('attended', 'registered_absent')),
  constraint event_participations_role_at_event_check
    check (
      role_at_event is null
      or role_at_event in ('mentor', 'mentee', 'core_team', 'speaker', 'trainer', 'guest', 'unknown')
    )
);

comment on table event_participations is
  'Tracks Phase 2 event/training participation. Phase 2 event scope is Mentee Orientation, Kickoff, and Tổng kết.';

create index if not exists event_participations_event_id_idx
  on event_participations(event_id);

create index if not exists event_participations_season_id_idx
  on event_participations(season_id);

create index if not exists event_participations_person_id_idx
  on event_participations(person_id);

create index if not exists event_participations_attendance_status_idx
  on event_participations(attendance_status);

create index if not exists event_participations_role_at_event_idx
  on event_participations(role_at_event);

drop trigger if exists event_participations_set_updated_at on event_participations;

create trigger event_participations_set_updated_at
before update on event_participations
for each row
execute function set_updated_at();

create or replace view v_monthly_activity_summary as
select
  season_id,
  meeting_month,
  count(*)::bigint as recap_count,
  count(distinct mentee_person_id)::bigint as active_mentee_count,
  count(distinct mentor_person_id)::bigint as active_mentor_count
from mentoring_recaps
where status in ('submitted', 'needs_review')
group by season_id, meeting_month;

comment on view v_monthly_activity_summary is
  'Read-only monthly recap summary for Phase 2 operations: recap count, active mentee count, and active mentor count.';

