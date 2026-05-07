-- Migration 048: Add kickoff as an official event_type
--
-- Kickoff is a core season-opening event and should not be classified as networking.
--
-- Purpose:
--   * Allow event_type = 'kickoff' wherever the database currently enforces
--     event_type through a Postgres enum or the known events_event_type_check.
--   * Preserve all existing event_type values.
--   * Avoid changing unrelated event columns or event participation schema.
--
-- Current staging inspection (2026-05-07):
--   events.event_type is plain text and has no check constraint, so kickoff is
--   already accepted by the database there. This migration still records the
--   official decision and remains safe for environments that use an enum or
--   the known check-constraint name.
--
-- Rollback note:
--   * For plain text or check-constraint environments, remove or adjust rows
--     with event_type = 'kickoff', then recreate the prior check if needed.
--   * Postgres enum values cannot be removed directly. If public.event_type is
--     an enum and 'kickoff' is added, rollback requires a new enum type without
--     'kickoff' and a controlled column type swap.

do $$
begin
  if to_regtype('public.event_type') is not null then
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'event_type'
        and e.enumlabel = 'kickoff'
    ) then
      execute 'alter type public.event_type add value ''kickoff''';
    end if;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_event_type_check'
  ) then
    alter table public.events
      drop constraint events_event_type_check;

    alter table public.events
      add constraint events_event_type_check
      check (
        event_type is null
        or event_type::text in (
          'orientation',
          'training',
          'workshop',
          'community',
          'matching',
          'company_tour',
          'networking',
          'closing',
          'business_case',
          'job_shadowing',
          'kickoff',
          'other'
        )
      );
  end if;
end;
$$;

comment on column public.events.event_type is
  'Official event type. Kickoff is a core season-opening event and should not be classified as networking.';

notify pgrst, 'reload schema';
