-- ============================================================
-- Migration 073 — the cross_mentoring event type
-- ============================================================
--
-- Purpose: migration 072 models a cross-mentoring session as an event so that
-- several mentors, and every mentee who registers, can be recorded against it.
-- For that session to be findable it needs a type of its own.
--
-- ============================================================
-- WHY THIS IS ITS OWN FILE, AND WHY IT HAS NO TRANSACTION
-- ============================================================
-- `alter type ... add value` cannot run inside a transaction block, which is
-- exactly why migration 048 (which added 'kickoff') is also an unwrapped file
-- of its own. Keeping this separate lets 072 stay fully transactional with its
-- self-check intact.
--
-- ============================================================
-- WHY NOT REUSE AN EXISTING TYPE
-- ============================================================
-- `networking` ("Giao lưu") is the closest fit, and migration 048 set the
-- precedent against that kind of overloading in its own comment: a kickoff
-- "should not be classified as networking". `other` would work mechanically but
-- would leave the events list filter unable to isolate cross-mentoring
-- sessions, which is most of the reason for recording them.
--
-- ============================================================
-- THE TWO SHAPES THIS HAS TO SURVIVE
-- ============================================================
-- Staging and production disagree about what `events.event_type` is. The
-- design-only production catalog declares a Postgres enum `public.event_type`;
-- migration 048 records that in staging the column is plain text with a CHECK.
-- Both branches below are guarded, so whichever shape is in front of it, this
-- file does the right thing and skips the other.
--
-- Rollback note: enum values cannot be removed. Undoing the enum branch means a
-- new type without the value and a controlled column swap — which is why this
-- adds a value the application will use rather than a speculative one.
-- ============================================================

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
        and e.enumlabel = 'cross_mentoring'
    ) then
      execute 'alter type public.event_type add value ''cross_mentoring''';
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

    -- Every value migration 048 allowed, plus the new one. The three that are
    -- not in the application's own option list — workshop, community, matching —
    -- are kept because production rows may already carry them.
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
          'cross_mentoring',
          'other'
        )
      );
  end if;
end;
$$;

comment on column public.events.event_type is
  'Official event type. cross_mentoring is a session arranged through a mentee request (migration 072) and is counted separately from training.';

notify pgrst, 'reload schema';
