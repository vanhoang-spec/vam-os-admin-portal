-- VAM OS Phase 2B Activity Tracking Operational Fields
-- Adds steward capture metadata and meeting/event classification fields.

alter table mentoring_recaps
  add column if not exists meeting_type text not null default '1on1_primary',
  add column if not exists captured_by text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mentoring_recaps_meeting_type_check'
      and conrelid = 'mentoring_recaps'::regclass
  ) then
    alter table mentoring_recaps
      add constraint mentoring_recaps_meeting_type_check
        check (meeting_type in ('1on1_primary', '1on1_cross', 'group', 'online', 'offline', 'unknown'));
  end if;
end;
$$;

comment on column mentoring_recaps.meeting_type is
  'meeting_type distinguishes primary/cross/group/online/offline mentoring sessions.';

comment on column mentoring_recaps.captured_by is
  'captured_by records which Recap Steward captured the row.';

alter table event_participations
  add column if not exists captured_by text null,
  add column if not exists walk_in boolean not null default false;

comment on column event_participations.captured_by is
  'captured_by records which Event Steward captured the row.';

comment on column event_participations.walk_in is
  'walk_in marks event attendance without prior registration.';
