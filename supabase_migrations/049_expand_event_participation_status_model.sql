-- Migration 049: Expand event participation status model
--
-- Purpose:
--   * Represent registration lifecycle and attendance outcome separately.
--   * Avoid converting registered-only or confirmed-only event rows into false
--     no-show/absence KPI data.
--   * Preserve existing event_participations data and legacy status values.
--
-- Model:
--   registration_status:
--     registered, confirmed, declined, no_response, cancelled
--     plus unknown for backward compatibility with existing MVP data.
--
--   attendance_status:
--     attended, absent_excused, absent_unexcused, registered_no_response,
--     walk_in, unknown
--     plus registered_absent for backward compatibility with existing MVP data.
--
-- Rollback note:
--   Before rolling back, first remap any new values to the legacy set:
--   registration_status -> registered/unknown
--   attendance_status -> attended/registered_absent
--   Then recreate the prior constraints.

alter table public.event_participations
  drop constraint if exists event_participations_registration_status_check;

alter table public.event_participations
  add constraint event_participations_registration_status_check
  check (
    registration_status is null
    or registration_status in (
      'registered',
      'confirmed',
      'declined',
      'no_response',
      'cancelled',
      'unknown'
    )
  );

alter table public.event_participations
  drop constraint if exists event_participations_attendance_status_check;

alter table public.event_participations
  add constraint event_participations_attendance_status_check
  check (
    attendance_status is null
    or attendance_status in (
      'attended',
      'absent_excused',
      'absent_unexcused',
      'registered_no_response',
      'walk_in',
      'unknown',
      'registered_absent'
    )
  );

comment on column public.event_participations.registration_status is
  'Registration lifecycle status. Keep separate from attendance outcome to avoid false absence/no-show reporting.';

comment on column public.event_participations.attendance_status is
  'Attendance outcome. registered_no_response and unknown are not absence statuses; use absent_excused/absent_unexcused for real absences.';

notify pgrst, 'reload schema';
