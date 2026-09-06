-- S12 application lifecycle prerequisite.
--
-- This migration deliberately changes only public.applications_status_check.
-- It closes the schema prerequisite needed by the withdrawn-quarantine and
-- direct-interview migrations that immediately follow it in filename order.
-- No application row is updated or rewritten.

begin;

-- Refuse to wait indefinitely for the table lock required to replace a CHECK.
set local lock_timeout = '5s';

do $s12_application_status_prerequisite$
declare
  v_predecessor_19 constant text[] := array[
    'approved_as_mentee',
    'approved_as_mentor',
    'interview_completed',
    'interview_passed',
    'interview_scheduled',
    'invited_to_interview',
    'invited_to_meeting',
    'invited_to_orientation',
    'needs_more_review',
    'ready_for_screening',
    'rejected_or_not_fit',
    'screening_assigned',
    'screening_completed',
    'screening_in_progress',
    'screening_passed',
    'submitted',
    'under_data_check',
    'waitlisted',
    'withdrawn'
  ];
  v_predecessor_20 constant text[] := array[
    'approved_as_mentee',
    'approved_as_mentor',
    'interview_completed',
    'interview_in_progress',
    'interview_passed',
    'interview_scheduled',
    'invited_to_interview',
    'invited_to_meeting',
    'invited_to_orientation',
    'needs_more_review',
    'ready_for_screening',
    'rejected_or_not_fit',
    'screening_assigned',
    'screening_completed',
    'screening_in_progress',
    'screening_passed',
    'submitted',
    'under_data_check',
    'waitlisted',
    'withdrawn'
  ];
  v_canonical_22 constant text[] := array[
    'approved_as_mentee',
    'approved_as_mentor',
    'interview_completed',
    'interview_in_progress',
    'interview_passed',
    'interview_scheduled',
    'invited_to_interview',
    'invited_to_meeting',
    'invited_to_orientation',
    'needs_admin_review',
    'needs_more_review',
    'ready_for_final_decision',
    'ready_for_screening',
    'rejected_or_not_fit',
    'screening_assigned',
    'screening_completed',
    'screening_in_progress',
    'screening_passed',
    'submitted',
    'under_data_check',
    'waitlisted',
    'withdrawn'
  ];
  v_status_attnum smallint;
  v_status_type text;
  v_constraint_count integer;
  v_constraint_name text;
  v_constraint_validated boolean;
  v_definition text;
  v_compact_definition text;
  v_actual_statuses text[];
  v_unexpected_data text[];
begin
  if to_regclass('public.applications') is null then
    raise exception 'S12_STATUS_PREREQUISITE_REFUSED: public.applications is missing';
  end if;

  select a.attnum, format_type(a.atttypid, a.atttypmod)
  into v_status_attnum, v_status_type
  from pg_attribute a
  where a.attrelid = 'public.applications'::regclass
    and a.attname = 'status'
    and not a.attisdropped;

  if v_status_attnum is null or v_status_type <> 'text' then
    raise exception
      'S12_STATUS_PREREQUISITE_REFUSED: applications.status must exist as text (found %)',
      coalesce(v_status_type, '<missing>');
  end if;

  select count(*)
  into v_constraint_count
  from pg_constraint c
  where c.conrelid = 'public.applications'::regclass
    and c.contype = 'c'
    and v_status_attnum = any(c.conkey);

  if v_constraint_count <> 1 then
    raise exception
      'S12_STATUS_PREREQUISITE_REFUSED: expected exactly one CHECK on applications.status, found %',
      v_constraint_count;
  end if;

  select c.conname, c.convalidated, pg_get_constraintdef(c.oid, true)
  into v_constraint_name, v_constraint_validated, v_definition
  from pg_constraint c
  where c.conrelid = 'public.applications'::regclass
    and c.contype = 'c'
    and v_status_attnum = any(c.conkey);

  if v_constraint_name <> 'applications_status_check' then
    raise exception
      'S12_STATUS_PREREQUISITE_REFUSED: unexpected applications.status CHECK name %',
      v_constraint_name;
  end if;

  -- PostgreSQL deparses IN lists as a positive = ANY(ARRAY[...]) expression.
  -- Requiring that known shape plus the exact literal set prevents an unknown
  -- boolean expression from being silently broadened merely because it happens
  -- to mention the same status strings.
  v_compact_definition := regexp_replace(lower(v_definition), '[[:space:]]+', '', 'g');
  -- A NOT VALID canonical constraint is used only by the disposable bad-data
  -- case: remove the catalog suffix for expression-shape validation, then let
  -- the explicit data scan below report the real unsafe condition. A clean but
  -- unvalidated constraint is still refused by v_constraint_validated.
  v_compact_definition := regexp_replace(v_compact_definition, 'notvalid$', '');
  if v_compact_definition not like 'check(statusisnullor(status=any(array[%'
     or right(v_compact_definition, 4) <> '])))' then
    raise exception
      'S12_STATUS_PREREQUISITE_REFUSED: unexpected applications.status CHECK expression: %',
      v_definition;
  end if;

  select coalesce(array_agg(s.status order by s.status), array[]::text[])
  into v_actual_statuses
  from (
    select distinct captures[1] as status
    from regexp_matches(v_definition, '''([^'']+)''', 'g') as matches(captures)
  ) s;

  -- Check data before accepting an idempotent canonical constraint. This makes
  -- a canonical-but-NOT-VALID constraint over bad rows fail for the data reason
  -- instead of being mistaken for a safe no-op.
  select coalesce(array_agg(s.status order by s.status), array[]::text[])
  into v_unexpected_data
  from (
    select distinct a.status
    from public.applications a
    where a.status is not null
      and not (a.status = any(v_canonical_22))
  ) s;

  if cardinality(v_unexpected_data) > 0 then
    raise exception
      'S12_STATUS_PREREQUISITE_REFUSED: applications contains non-canonical status values: %',
      v_unexpected_data;
  end if;

  if not v_constraint_validated then
    raise exception
      'S12_STATUS_PREREQUISITE_REFUSED: applications.status CHECK is not validated';
  end if;

  if v_actual_statuses = v_canonical_22 then
    -- Exact canonical state: intentionally schema-effective no-op.
    null;
  elsif v_actual_statuses = v_predecessor_19
     or v_actual_statuses = v_predecessor_20 then
    alter table public.applications
      drop constraint applications_status_check;

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
          'ready_for_final_decision',
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
  else
    raise exception
      'S12_STATUS_PREREQUISITE_REFUSED: unexpected applications.status set: %',
      v_actual_statuses;
  end if;

  -- Fail the transaction if the effective post-state is anything except one
  -- validated, canonically named CHECK containing the exact 22-value set.
  select count(*)
  into v_constraint_count
  from pg_constraint c
  where c.conrelid = 'public.applications'::regclass
    and c.contype = 'c'
    and v_status_attnum = any(c.conkey)
    and c.conname = 'applications_status_check'
    and c.convalidated;

  select coalesce(array_agg(s.status order by s.status), array[]::text[])
  into v_actual_statuses
  from (
    select distinct captures[1] as status
    from pg_constraint c
    cross join lateral regexp_matches(
      pg_get_constraintdef(c.oid, true),
      '''([^'']+)''',
      'g'
    ) as matches(captures)
    where c.conrelid = 'public.applications'::regclass
      and c.contype = 'c'
      and v_status_attnum = any(c.conkey)
  ) s;

  if v_constraint_count <> 1 or v_actual_statuses <> v_canonical_22 then
    raise exception
      'S12_STATUS_PREREQUISITE_POSTCONDITION_FAILED: count %, statuses %',
      v_constraint_count,
      v_actual_statuses;
  end if;
end
$s12_application_status_prerequisite$;

commit;
