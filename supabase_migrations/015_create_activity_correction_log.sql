-- Phase 2D admin correction workflow audit trail.
-- This table records manual corrections made by admin/core team.
-- It is audit trail only and does not enforce business logic.
-- Until Supabase Auth/RLS is implemented, corrected_by is a text field supplied by the admin UI.

create table if not exists activity_correction_log (
  id uuid primary key default gen_random_uuid(),
  target_table text not null,
  target_id uuid not null,
  correction_type text not null,
  field_name text null,
  old_value text null,
  new_value text null,
  reason text null,
  corrected_by text null,
  created_at timestamptz not null default now(),

  constraint activity_correction_log_target_table_check
    check (target_table in ('mentoring_recaps', 'event_participations')),

  constraint activity_correction_log_correction_type_check
    check (
      correction_type in (
        'update_field',
        'status_change',
        'issue_flag_change',
        'admin_note',
        'manual_review',
        'other'
      )
    )
);

comment on table activity_correction_log is
  'Records manual corrections made by admin/core team for Phase 2 activity data. Audit trail only; does not enforce business logic.';

comment on column activity_correction_log.target_table is
  'Target activity table for the correction. Allowed values: mentoring_recaps, event_participations.';

comment on column activity_correction_log.target_id is
  'ID of the target row in the target activity table.';

comment on column activity_correction_log.correction_type is
  'Type of correction or review action recorded for audit purposes.';

comment on column activity_correction_log.field_name is
  'Optional field name affected by the correction.';

comment on column activity_correction_log.old_value is
  'Optional previous value captured as text for audit trail.';

comment on column activity_correction_log.new_value is
  'Optional new value captured as text for audit trail.';

comment on column activity_correction_log.reason is
  'Optional reason or context for the correction.';

comment on column activity_correction_log.corrected_by is
  'Text identifier supplied by the admin UI until Supabase Auth/RLS is implemented.';

create index if not exists activity_correction_log_target_idx
  on activity_correction_log(target_table, target_id);

create index if not exists activity_correction_log_created_at_idx
  on activity_correction_log(created_at);

create index if not exists activity_correction_log_correction_type_idx
  on activity_correction_log(correction_type);

create index if not exists activity_correction_log_corrected_by_idx
  on activity_correction_log(corrected_by);
