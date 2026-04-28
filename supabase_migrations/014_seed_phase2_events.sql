-- Seed Phase 2 tracked events for UEHM-S11.
-- Assumption: existing events.event_type accepts the documented Phase 2 values
-- from docs/PHASE_2_ACTIVITY_AND_EVENT_TRACKING_PLAN_DRAFT.md:
-- orientation, training, workshop, community, matching, other.
-- This migration is idempotent and does not update existing rows.

with target_season as (
  select id
  from seasons
  where code = 'UEHM-S11'
  limit 1
),
seed_events as (
  select *
  from (
    values
      (
        'UEHM-S11-ORIENTATION',
        'Mentee Orientation',
        'orientation',
        '2026-04-01 09:00:00+07'::timestamptz,
        'Seeded for Phase 2 event participation pilot.'
      ),
      (
        'UEHM-S11-KICKOFF',
        'Kickoff',
        'training',
        '2026-04-15 09:00:00+07'::timestamptz,
        'Seeded for Phase 2 event participation pilot.'
      ),
      (
        'UEHM-S11-CLOSING',
        'Tổng kết',
        'training',
        '2026-08-31 09:00:00+07'::timestamptz,
        'Seeded for Phase 2 event participation pilot.'
      )
  ) as rows(legacy_event_temp_id, event_name, event_type, starts_at, source_notes)
)
insert into events (
  legacy_event_temp_id,
  season_id,
  event_name,
  event_type,
  starts_at,
  source_notes
)
select
  seed_events.legacy_event_temp_id,
  target_season.id,
  seed_events.event_name,
  seed_events.event_type::event_type,
  seed_events.starts_at,
  seed_events.source_notes
from seed_events
cross join target_season
where not exists (
  select 1
  from events
  where events.legacy_event_temp_id = seed_events.legacy_event_temp_id
    and events.season_id = target_season.id
);
