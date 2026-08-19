-- ============================================================
-- Migration 070 — Collecting recaps from the Facebook group
-- ============================================================
--
-- Purpose: the mentees already write their recaps. They post them in the
-- programme's Facebook group, in a house format whose first lines carry the
-- student id, the mentor and the topic. What the application has never had is
-- a way to get those posts in: the March import of Season 11 shows the cost —
-- 258 of its 286 recaps carry `system.local/missing-url` because the real link
-- was lost in a tracking spreadsheet on the way.
--
-- Meta closed the Groups API, so there is no official integration and no
-- server-side scraping either (that would mean keeping an admin's Facebook
-- session on a server, and risking the account that owns the group). Instead a
-- browser extension reads what an admin is already looking at, and posts it
-- here. This migration is the landing area for that.
--
-- The design rule is that COLLECTED IS NOT IMPORTED. Everything the extension
-- sends lands in a staging table, is matched against the mentees by student id,
-- and becomes a real row in mentoring_recaps only when an organiser approves
-- it. A parser reading somebody else's HTML is going to be wrong sometimes;
-- that must cost a click, not a corrupted record.
--
-- The second rule is DEDUPE BY PERMALINK. Because a post can only be collected
-- once, ever, the collection windows stop mattering: scanning 1-15 and then
-- 1-20 changes nothing, a forgotten run can be caught up late, and an organiser
-- can press the button twice without thinking. The unique index below is what
-- buys that freedom.
--
-- Objects:
--   1. public.recap_import_batches — one collection run
--   2. public.recap_import_items   — one post, staged and matched
--   plus: 'recap_import' on apply_submission_log.route, and
--         'recap_period_reminder' on outbound_emails.kind
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- Server-only, exactly like migrations 064-069: RLS enabled, zero policies,
-- every privilege revoked from PUBLIC/anon/authenticated, and only what
-- service_role needs granted. The extension does not talk to the database — it
-- posts to a route handler that authenticates a bearer token and writes through
-- the service-role client.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It does not touch mentoring_recaps. Staged rows point at it once they are
--     approved; nothing here writes or alters it.
--   * It adds NO unique index on mentoring_recaps.recap_url, however tempting:
--     the legacy table holds 258 rows sharing a placeholder URL and the index
--     would fail on creation. Duplicate protection lives on the staging table,
--     where the data is clean by construction.
--   * The two tables it alters were both created by migration 064 in this same
--     work package, and only their value lists grow.
--
-- Idempotent: create-if-not-exists / add-if-missing throughout.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — prerequisites
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: public.seasons is required by migration 070';
  end if;
  if to_regclass('public.people') is null then
    raise exception 'PREREQ_MISSING: public.people is required by migration 070';
  end if;
  if to_regclass('public.matches') is null then
    raise exception 'PREREQ_MISSING: public.matches is required by migration 070';
  end if;
  if to_regclass('public.mentoring_recaps') is null then
    raise exception 'PREREQ_MISSING: public.mentoring_recaps (migration 012) is required by migration 070';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: public.admin_users is required by migration 070';
  end if;
  if to_regclass('public.apply_submission_log') is null then
    raise exception 'PREREQ_MISSING: public.apply_submission_log (migration 064) is required by migration 070';
  end if;
  if to_regclass('public.outbound_emails') is null then
    raise exception 'PREREQ_MISSING: public.outbound_emails (migration 064) is required by migration 070';
  end if;
  if to_regproc('public.set_updated_at') is null then
    raise exception 'PREREQ_MISSING: public.set_updated_at() is required by migration 070';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. recap_import_batches
-- ------------------------------------------------------------
create table if not exists public.recap_import_batches (
  id uuid primary key default gen_random_uuid(),

  -- Which group was read, as Facebook numbers it. Text, not a foreign key: the
  -- programme may collect from more than one group and they are not our rows.
  group_id text not null,
  group_label text null,

  -- The window the operator meant to cover. Advisory only — what actually got
  -- collected is the items, and duplicates are impossible, so a wrong window
  -- costs nothing.
  period_start date null,
  period_end date null,

  source text not null default 'extension',
  status text not null default 'received',

  item_count integer not null default 0,
  matched_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,

  note text null,
  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recap_import_batches_source_check check (source in ('extension', 'csv')),
  constraint recap_import_batches_status_check
    check (status in ('received', 'reviewing', 'completed')),
  constraint recap_import_batches_counts_check
    check (
      item_count >= 0 and matched_count >= 0 and imported_count >= 0 and duplicate_count >= 0
    ),
  constraint recap_import_batches_period_check
    check (period_start is null or period_end is null or period_start <= period_end)
);

comment on table public.recap_import_batches is
  'One collection run of the recap collector extension. created_by is null when the run authenticated with the import token rather than an admin session.';
comment on column public.recap_import_batches.period_start is
  'The window the operator aimed at. Advisory: duplicates are impossible by permalink, so overlapping or late runs are harmless.';

create index if not exists recap_import_batches_created_idx
  on public.recap_import_batches (created_at desc);

create index if not exists recap_import_batches_status_idx
  on public.recap_import_batches (status, created_at desc);

drop trigger if exists recap_import_batches_set_updated_at on public.recap_import_batches;
create trigger recap_import_batches_set_updated_at
before update on public.recap_import_batches
for each row
execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. recap_import_items
-- ------------------------------------------------------------
create table if not exists public.recap_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.recap_import_batches(id) on delete cascade,

  -- The post itself. Normalised before it gets here (no query string, one host
  -- spelling) so that the unique index below actually means "one post".
  permalink text not null,
  posted_at timestamptz null,

  -- What the post says about the meeting. meeting_date prefers a date written
  -- in the header ("[RECAP BUỔI 3 - 14/03/2026]") over the date it was posted:
  -- students often write up a meeting days later.
  meeting_date date null,
  author_name text null,
  mssv_raw text null,
  meeting_type text null,
  topic text null,
  mentor_names text null,
  mentee_names text null,
  location text null,
  meeting_time_raw text null,

  content_full text null,
  -- True when the collector believes Facebook cut the text off. The reviewer is
  -- told to open the original rather than importing half a recap silently.
  content_truncated boolean not null default false,

  -- Filled by the matcher, confirmed or corrected by a person.
  season_id uuid null references public.seasons(id) on delete set null,
  mentee_person_id uuid null references public.people(id) on delete set null,
  mentor_person_id uuid null references public.people(id) on delete set null,
  match_id uuid null references public.matches(id) on delete set null,
  match_confidence text not null default 'none',

  status text not null default 'pending',
  imported_recap_id uuid null references public.mentoring_recaps(id) on delete set null,
  decided_by uuid null references public.admin_users(id) on delete set null,
  decided_at timestamptz null,
  review_note text null,

  created_at timestamptz not null default now(),

  -- The rule that makes collection windows irrelevant: a post enters once.
  constraint recap_import_items_permalink_key unique (permalink),

  constraint recap_import_items_status_check
    check (status in ('pending', 'matched', 'needs_review', 'imported', 'skipped', 'duplicate')),

  constraint recap_import_items_confidence_check
    check (match_confidence in ('none', 'mssv', 'name', 'manual')),

  constraint recap_import_items_meeting_type_check
    check (
      meeting_type is null
      or meeting_type in ('1on1_primary', '1on1_cross', 'group', 'online', 'offline', 'unknown')
    ),

  -- A recap id may only sit on an item somebody imported.
  constraint recap_import_items_imported_shape_check
    check (imported_recap_id is null or status = 'imported'),

  -- A decided item records when it was decided.
  constraint recap_import_items_decided_shape_check
    check (
      (status in ('imported', 'skipped') and decided_at is not null)
      or status not in ('imported', 'skipped')
    )
);

comment on table public.recap_import_items is
  'One Facebook post, staged. Collected is not imported: a row becomes a mentoring_recaps entry only when an organiser approves it, because a parser reading somebody else''s HTML is sometimes wrong.';
comment on column public.recap_import_items.permalink is
  'Normalised post URL, unique across every batch. This is what makes a second scan of the same window harmless.';
comment on column public.recap_import_items.match_confidence is
  'How the mentee was identified: mssv (the student id in the post header), name (a suggestion only), manual (a person chose), none.';

create index if not exists recap_import_items_batch_status_idx
  on public.recap_import_items (batch_id, status);

create index if not exists recap_import_items_status_idx
  on public.recap_import_items (status, created_at desc);

create index if not exists recap_import_items_mssv_idx
  on public.recap_import_items (mssv_raw)
  where mssv_raw is not null;

create index if not exists recap_import_items_mentee_idx
  on public.recap_import_items (mentee_person_id)
  where mentee_person_id is not null;

-- ------------------------------------------------------------
-- 3. Extending the two migration-064 vocabularies
-- ------------------------------------------------------------
-- The import endpoint is rate-limited with the same hashed-IP counter the
-- public forms use, so its route needs a name there.
alter table public.apply_submission_log
  drop constraint if exists apply_submission_log_route_check;

alter table public.apply_submission_log
  add constraint apply_submission_log_route_check
  check (route in ('apply_mentee', 'apply_mentor', 'confirm', 'recap_import'));

-- The twice-monthly reminder that it is time to collect.
alter table public.outbound_emails
  drop constraint if exists outbound_emails_kind_check;

alter table public.outbound_emails
  add constraint outbound_emails_kind_check
  check (kind in (
    'mentor_confirmation_link',
    'mentee_application_confirmation',
    'mentor_application_confirmation',
    'review_batch_assigned',
    'interview_scheduled',
    'reviewer_invite',
    'mentee_selected',
    'mentee_mentor_intro',
    'mentor_mentee_package',
    'kickoff_invite',
    'recap_period_reminder'
  ));

-- ------------------------------------------------------------
-- 4. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.recap_import_batches enable row level security;
alter table public.recap_import_items   enable row level security;

revoke all on public.recap_import_batches from public, anon, authenticated;
revoke all on public.recap_import_items   from public, anon, authenticated;

grant select, insert, update, delete on public.recap_import_batches to service_role;
grant select, insert, update, delete on public.recap_import_items   to service_role;

-- ------------------------------------------------------------
-- 5. Self-check — fail the transaction if the contract is not met
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array['recap_import_batches', 'recap_import_items'];
  offending text;
begin
  -- 5a. The widened vocabularies must accept the new values.
  if not exists (
    select 1 from pg_constraint
    where conname = 'apply_submission_log_route_check'
      and conrelid = 'public.apply_submission_log'::regclass
      and pg_get_constraintdef(oid) like '%recap_import%'
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: apply_submission_log.route does not accept recap_import';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'outbound_emails_kind_check'
      and conrelid = 'public.outbound_emails'::regclass
      and pg_get_constraintdef(oid) like '%recap_period_reminder%'
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: outbound_emails.kind does not accept recap_period_reminder';
  end if;

  -- 5b. One post, one row — the rule the collection windows depend on.
  if not exists (
    select 1 from pg_constraint
    where conname = 'recap_import_items_permalink_key'
      and conrelid = 'public.recap_import_items'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: permalink is not unique';
  end if;

  -- 5c. RLS on, no policies, no client-role privileges.
  select string_agg(c.relname, ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any (target_tables)
    and c.relrowsecurity is false;

  if offending is not null then
    raise exception 'RLS_CONTRACT_VIOLATION: row level security is not enabled on: %', offending;
  end if;

  select string_agg(format('%s.%s', tablename, policyname), ', ')
    into offending
  from pg_policies
  where schemaname = 'public'
    and tablename = any (target_tables);

  if offending is not null then
    raise exception 'RLS_CONTRACT_VIOLATION: unexpected policy present: %', offending;
  end if;

  select string_agg(format('%s -> %s:%s', c.relname, grantee_name, a.privilege_type), ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral (
    select coalesce(pg_get_userbyid(nullif(x.grantee, 0)), 'PUBLIC') as grantee_name,
           x.privilege_type
    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as x
  ) a(grantee_name, privilege_type)
  where n.nspname = 'public'
    and c.relname = any (target_tables)
    and a.grantee_name in ('PUBLIC', 'anon', 'authenticated');

  if offending is not null then
    raise exception 'GRANT_CONTRACT_VIOLATION: client-role privileges remain: %', offending;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
