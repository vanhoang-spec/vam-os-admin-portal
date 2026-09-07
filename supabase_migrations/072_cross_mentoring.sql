-- ============================================================
-- Migration 072 — Cross-mentoring: from a mentee's wish to a scheduled session
-- ============================================================
--
-- Purpose: cross-mentoring happens in this programme and the application has no
-- idea. `mentoring_recaps.meeting_type` accepts '1on1_cross', there is a
-- dropdown for it on the manual recap form, and that is the whole of it — a
-- label applied after the fact. The March import of Season 11 carried about
-- fifteen of them in one month, so the connecting is real; it is just happening
-- entirely in private messages.
--
-- This migration is the record of that process: a mentee asks for a session in
-- a field, organisers approve it, mentors who master that field are invited,
-- one is chosen, and the session becomes an event.
--
-- ============================================================
-- THREE LAYERS, KEPT APART
-- ============================================================
--   who masters what   → cross_mentoring_fields + mentor_cross_fields
--   how a wish travels → cross_requests + cross_invitations (+ slots, + log)
--   the session itself → events + event_registrations        (migration 051)
--
-- A finalised request points at an `events` row, and from that moment
-- registration, check-in and attendance run on machinery that already exists.
--
-- ============================================================
-- WHY THE SESSION IS AN EVENT AND NOT A RECAP
-- ============================================================
-- `mentoring_recaps` holds exactly one `mentor_person_id`. Real cross sessions
-- have two or three mentors — the March data is full of posts headed "Mentor:"
-- twice — and today the visiting mentor survives only as free text. An event
-- holds as many participants as it likes, each with a role, so modelling the
-- session as an event records every mentor without touching a legacy table
-- carrying 286 rows of real data.
--
-- ============================================================
-- WHY A PURPOSE-BUILT FIELD CATALOG, AND NOT THE ONE FROM MIGRATION 036
-- ============================================================
-- `industries` / `function_areas` + `mentor_industries` / `mentor_function_areas`
-- exist and look like exactly the right home. They are not, for two reasons
-- found in the code rather than guessed at:
--
--   1. `replaceMentorIndustryLinks` (lib/people-create.ts:320) is a
--      delete-everything-then-insert keyed on `mentor_profile_id` alone. The
--      first time an organiser opens /mentors/<id>/edit and saves, every field
--      a mentor declared about themselves is silently gone. There is no column
--      that could distinguish the two sources, and the primary key leaves
--      nowhere to add one.
--   2. Those junctions carry no season. A mentor's willingness is per season;
--      a row there would follow them forever.
--
-- Seeding the 036 catalogs was also considered and rejected: neither mentor
-- form filters on `is_active`, so adding 26 codes would put near-duplicate
-- Vietnamese labels next to each other in the operator's multi-select
-- ("finance_banking" beside "tài_chính_/_ngân_hàng") and invite the wrong pick.
--
-- So the legacy tables are left entirely alone, and this file builds its own.
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- Server-only, exactly like migrations 064-071: RLS enabled, zero policies,
-- every privilege revoked from PUBLIC/anon/authenticated, only what
-- service_role needs granted, and the log append-only even for service_role.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It does not touch mentoring_recaps, matches, people, events,
--     mentor_season_confirmations, industries or function_areas.
--   * The `cross_mentoring` event type is added by migration 073, separately,
--     because `alter type ... add value` cannot run inside a transaction —
--     the same reason migration 048 is its own unwrapped file.
--   * It does not widen `action_items`. That table has drifted away from the
--     migration that created it (lib/admin-corrections.ts writes five columns
--     migration 023 never made), so its live shape is unknown from the repo and
--     replacing a CHECK on it is not a risk worth taking. The queue for these
--     requests is their own screen.
--   * It creates no request and invites nobody.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — prerequisites
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.people') is null then
    raise exception 'PREREQ_MISSING: public.people is required by migration 072';
  end if;
  if to_regclass('public.seasons') is null then
    raise exception 'PREREQ_MISSING: public.seasons is required by migration 072';
  end if;
  if to_regclass('public.programs') is null then
    raise exception 'PREREQ_MISSING: public.programs is required by migration 072';
  end if;
  if to_regclass('public.events') is null then
    raise exception 'PREREQ_MISSING: public.events is required by migration 072';
  end if;
  if to_regclass('public.outbound_emails') is null then
    raise exception 'PREREQ_MISSING: public.outbound_emails (migration 064) is required by migration 072';
  end if;
  if to_regproc('public.set_updated_at') is null then
    raise exception 'PREREQ_MISSING: public.set_updated_at() is required by migration 072';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. cross_mentoring_fields — the one list of fields
-- ------------------------------------------------------------
-- Two vocabularies that overlap: `finance_banking` is an industry,
-- `finance_accounting` is a function, and 'other' is in both. A code alone is
-- not an identifier, so everything downstream carries (kind, code) together.
create table if not exists public.cross_mentoring_fields (
  id uuid primary key default gen_random_uuid(),

  kind text not null
    constraint cross_mentoring_fields_kind_check check (kind in ('industry', 'function')),
  code text not null
    constraint cross_mentoring_fields_code_shape_check check (code ~ '^[a-z][a-z0-9_]*$'),
  label text not null
    constraint cross_mentoring_fields_label_not_blank check (length(trim(label)) > 0),

  -- False for answers that are valid on an application but can never be the
  -- subject of a session: there is no group of mentors who mastered "not sure".
  is_requestable boolean not null default true,
  is_active boolean not null default true,
  sort_order smallint not null default 100,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cross_mentoring_fields_kind_code_key unique (kind, code)
);

comment on table public.cross_mentoring_fields is
  'The field vocabulary for cross-mentoring. Purpose-built rather than reusing industries/function_areas, whose rows are wiped by the admin mentor-edit screen and carry no season.';
comment on column public.cross_mentoring_fields.is_requestable is
  'False for ''other'' and ''undecided'': valid answers on an application, never the subject of a session.';

drop trigger if exists cross_mentoring_fields_set_updated_at on public.cross_mentoring_fields;
create trigger cross_mentoring_fields_set_updated_at
  before update on public.cross_mentoring_fields
  for each row execute function public.set_updated_at();

-- The codes the intake forms have been storing in applications.raw_payload all
-- along, and which lib/cross-fields-core.ts now declares in one place.
insert into public.cross_mentoring_fields (kind, code, label, is_requestable, sort_order)
values
  ('industry', 'fmcg',               'FMCG / Bán lẻ',                    true,  10),
  ('industry', 'tech',               'Công nghệ / Phần mềm',             true,  20),
  ('industry', 'finance_banking',    'Tài chính / Ngân hàng',            true,  30),
  ('industry', 'consulting',         'Tư vấn / Chiến lược',              true,  40),
  ('industry', 'manufacturing',      'Sản xuất / Công nghiệp',           true,  50),
  ('industry', 'education',          'Giáo dục / Đào tạo',               true,  60),
  ('industry', 'healthcare',         'Y tế / Dược / Chăm sóc sức khoẻ',  true,  70),
  ('industry', 'media_creative',     'Truyền thông / Sáng tạo',          true,  80),
  ('industry', 'logistics',          'Logistics / Vận chuyển',           true,  90),
  ('industry', 'real_estate',        'Bất động sản / Xây dựng',          true, 100),
  ('industry', 'energy_environment', 'Năng lượng / Môi trường',          true, 110),
  ('industry', 'public_nonprofit',   'Khu vực công / Phi lợi nhuận',     true, 120),
  ('industry', 'undecided',          'Chưa xác định rõ',                 false, 900),
  ('industry', 'other',              'Khác',                             false, 910),

  ('function', 'marketing',           'Marketing / Brand',               true,  10),
  ('function', 'sales_bd',            'Sales / Business Development',    true,  20),
  ('function', 'finance_accounting',  'Tài chính / Kế toán',             true,  30),
  ('function', 'hr_people',           'Nhân sự / People',                true,  40),
  ('function', 'operations',          'Vận hành / Operations',           true,  50),
  ('function', 'tech_engineering',    'Tech / Engineering',              true,  60),
  ('function', 'data_analytics',      'Data / Analytics',                true,  70),
  ('function', 'product',             'Product Management',              true,  80),
  ('function', 'strategy_consulting', 'Strategy / Consulting',           true,  90),
  ('function', 'supply_chain',        'Supply Chain / Logistics',        true, 100),
  ('function', 'legal_compliance',    'Pháp lý / Compliance',            true, 110),
  ('function', 'general_management',  'Quản trị tổng hợp',               true, 120),
  ('function', 'undecided',           'Chưa xác định rõ',                false, 900),
  ('function', 'other',               'Khác',                            false, 910)
on conflict (kind, code) do nothing;

-- ------------------------------------------------------------
-- 2. mentor_cross_fields — what one mentor masters, this season
-- ------------------------------------------------------------
-- Keyed on `person_id`, not `mentor_profile_id`: `mentor_profiles.person_id` is
-- nullable and not unique, and `findMentorProfileByPersonId` picks an arbitrary
-- row when there are two. Every other season-scoped table in this schema —
-- mentor_season_confirmations, person_season_memberships — keys on the person,
-- and the sweep that decides who gets an email should stand on the same ground.
create table if not exists public.mentor_cross_fields (
  id uuid primary key default gen_random_uuid(),

  person_id uuid not null references public.people(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete restrict,

  field_kind text not null,
  field_code text not null,

  -- 'application' is the answer carried forward when the mentor's application
  -- was approved, so somebody who never opens a form still has fields on file.
  source text not null default 'self'
    constraint mentor_cross_fields_source_check
    check (source in ('self', 'application', 'admin')),

  declared_at timestamptz not null default now(),
  declared_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mentor_cross_fields_person_season_field_key
    unique (person_id, season_id, field_kind, field_code),
  constraint mentor_cross_fields_field_fkey
    foreign key (field_kind, field_code)
    references public.cross_mentoring_fields (kind, code) on update cascade on delete restrict
);

comment on table public.mentor_cross_fields is
  'Fields a mentor masters, per season. Deliberately not mentor_industries: that table is wiped wholesale by the admin edit screen and carries no season.';

-- The reverse lookup the invitation sweep runs: who mastered this field, this season.
create index if not exists mentor_cross_fields_season_field_idx
  on public.mentor_cross_fields (season_id, field_kind, field_code);

create index if not exists mentor_cross_fields_person_idx
  on public.mentor_cross_fields (person_id, season_id);

drop trigger if exists mentor_cross_fields_set_updated_at on public.mentor_cross_fields;
create trigger mentor_cross_fields_set_updated_at
  before update on public.mentor_cross_fields
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. cross_requests — one mentee's wish
-- ------------------------------------------------------------
create table if not exists public.cross_requests (
  id uuid primary key default gen_random_uuid(),

  season_id uuid not null references public.seasons(id) on delete restrict,
  program_id uuid not null references public.programs(id) on delete restrict,
  requested_by_person_id uuid not null references public.people(id) on delete cascade,

  field_kind text not null,
  field_code text not null,

  topic text null
    constraint cross_requests_topic_length_check check (topic is null or char_length(topic) <= 1000),
  note text null
    constraint cross_requests_note_length_check check (note is null or char_length(note) <= 1000),

  status text not null default 'submitted'
    constraint cross_requests_status_check
    check (status in (
      'draft', 'submitted', 'approved', 'rejected',
      'inviting', 'selecting', 'scheduled', 'published',
      'completed', 'cancelled'
    )),

  reviewed_by uuid null references public.admin_users(id) on delete set null,
  reviewed_at timestamptz null,
  review_note text null
    constraint cross_requests_review_note_length_check
    check (review_note is null or char_length(review_note) <= 1000),

  -- When and where. `location` lives here because `events` has no venue column
  -- at all; it is copied into the event's description when the event is made.
  scheduled_at timestamptz null,
  location text null
    constraint cross_requests_location_length_check
    check (location is null or char_length(location) <= 500),

  -- Null until the session is scheduled. From that moment the event exists and
  -- mentees may be registering, which is why the state machine refuses to walk
  -- a request back past this point.
  event_id uuid null references public.events(id) on delete set null,

  -- The draft post for the marketing team, and where it came from.
  post_draft text null
    constraint cross_requests_post_draft_length_check
    check (post_draft is null or char_length(post_draft) <= 8000),
  post_status text not null default 'none'
    constraint cross_requests_post_status_check
    check (post_status in ('none', 'drafted', 'approved')),
  ai_model text null,
  ai_prompt_version text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cross_requests_field_fkey
    foreign key (field_kind, field_code)
    references public.cross_mentoring_fields (kind, code) on update cascade on delete restrict,

  -- A scheduled session has a time and an event; anything earlier has neither.
  constraint cross_requests_scheduled_shape_check
    check (
      status not in ('scheduled', 'published', 'completed')
      or (scheduled_at is not null and event_id is not null)
    ),

  -- A rejection says why. "No" without a reason is the thing a mentee will ask
  -- an organiser about, and the organiser should not have to remember.
  constraint cross_requests_rejected_shape_check
    check (status <> 'rejected' or (reviewed_at is not null and review_note is not null))
);

comment on table public.cross_requests is
  'One mentee''s wish for a cross-mentoring session in one field, from submission to the session having happened.';
comment on column public.cross_requests.location is
  'Venue. Lives here because public.events has no location column; copied into the event description when the event is created.';
comment on column public.cross_requests.event_id is
  'The session, once scheduled. Its presence is what makes the request irreversible.';

create index if not exists cross_requests_season_status_idx
  on public.cross_requests (season_id, status);

create index if not exists cross_requests_person_idx
  on public.cross_requests (requested_by_person_id, created_at desc);

create index if not exists cross_requests_field_idx
  on public.cross_requests (season_id, field_kind, field_code);

-- One live wish per mentee per field per season. A mentee who asks twice about
-- the same field is asking again, not asking for two sessions.
create unique index if not exists cross_requests_one_live_idx
  on public.cross_requests (season_id, requested_by_person_id, field_kind, field_code)
  where status in ('draft', 'submitted', 'approved', 'inviting', 'selecting');

drop trigger if exists cross_requests_set_updated_at on public.cross_requests;
create trigger cross_requests_set_updated_at
  before update on public.cross_requests
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 4. cross_invitations — one mentor asked about one request
-- ------------------------------------------------------------
create table if not exists public.cross_invitations (
  id uuid primary key default gen_random_uuid(),

  request_id uuid not null references public.cross_requests(id) on delete cascade,
  -- Denormalised so "how many times was this mentor passed over this season"
  -- is one indexed read rather than a join back through the request.
  season_id uuid not null references public.seasons(id) on delete restrict,
  mentor_person_id uuid not null references public.people(id) on delete cascade,

  status text not null default 'invited'
    constraint cross_invitations_status_check
    check (status in ('invited', 'accepted', 'declined', 'selected', 'not_selected', 'withdrawn')),

  -- The bearer capability for the public /cross/<token> page, exactly as
  -- mentor_season_confirmations does it. Sent by email, never listed anywhere
  -- a non-admin can read.
  token uuid not null default gen_random_uuid(),
  token_expires_at timestamptz null,

  -- Claimed before the letter is sent, not after: the claim is what stops two
  -- clicks on "send invitations" mailing every mentor twice.
  link_sent_at timestamptz null,
  link_send_error text null,
  provider_message_id text null,

  responded_at timestamptz null,
  note text null
    constraint cross_invitations_note_length_check
    check (note is null or char_length(note) <= 1000),

  decided_by uuid null references public.admin_users(id) on delete set null,
  decided_at timestamptz null,

  -- False when a mentor was passed over for a reason that is not about them —
  -- most often a session that was cancelled outright. Without this, abandoning
  -- one session silently spends several mentors' patience.
  counts_toward_decline boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cross_invitations_request_mentor_key unique (request_id, mentor_person_id),
  constraint cross_invitations_token_key unique (token),

  -- A decision was made by somebody, at some point, or not at all.
  constraint cross_invitations_decision_shape_check
    check (
      (status in ('selected', 'not_selected') and decided_at is not null)
      or (status not in ('selected', 'not_selected') and decided_at is null)
    )
);

comment on table public.cross_invitations is
  'One mentor invited to one cross-mentoring request, and what they and the organisers decided.';
comment on column public.cross_invitations.counts_toward_decline is
  'False when the mentor was passed over for a reason that is not about them, so a cancelled session does not spend anyone''s patience.';

create index if not exists cross_invitations_request_idx
  on public.cross_invitations (request_id, status);

-- The reverse lookup behind "how many times has this mentor been passed over
-- this season", which decides whether the sweep writes to them again.
create index if not exists cross_invitations_passed_over_idx
  on public.cross_invitations (season_id, mentor_person_id)
  where status = 'not_selected' and counts_toward_decline;

-- The sweep's work queue: invitations minted but not yet mailed.
create index if not exists cross_invitations_unsent_idx
  on public.cross_invitations (request_id)
  where link_sent_at is null;

drop trigger if exists cross_invitations_set_updated_at on public.cross_invitations;
create trigger cross_invitations_set_updated_at
  before update on public.cross_invitations
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. cross_invitation_slots — the hours a mentor offered
-- ------------------------------------------------------------
-- A child table rather than JSON on the invitation, because the question that
-- decides the session is "which hour did the most mentors offer" — a group-by
-- on rows, a lateral unnest on JSON.
create table if not exists public.cross_invitation_slots (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.cross_invitations(id) on delete cascade,
  starts_at timestamptz not null,
  note text null
    constraint cross_invitation_slots_note_length_check
    check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),

  -- Offering the same hour twice is a double submit, not two options.
  constraint cross_invitation_slots_invitation_time_key unique (invitation_id, starts_at)
);

comment on table public.cross_invitation_slots is
  'Optional free hours a mentor offered when accepting. Optional by design: a mentor who just says yes is still a yes.';

create index if not exists cross_invitation_slots_time_idx
  on public.cross_invitation_slots (starts_at);

-- ------------------------------------------------------------
-- 6. cross_request_log — append-only
-- ------------------------------------------------------------
-- Deciding which mentor runs a session, and which two are told "not this time",
-- is a judgement about people. It has to stay answerable afterwards.
create table if not exists public.cross_request_log (
  id uuid primary key default gen_random_uuid(),

  request_id uuid not null references public.cross_requests(id) on delete cascade,
  invitation_id uuid null references public.cross_invitations(id) on delete set null,

  old_status text null,
  new_status text not null,
  change_type text not null
    constraint cross_request_log_change_type_check
    check (change_type in (
      'created', 'status_change', 'invited', 'mentor_responded',
      'selected', 'not_selected', 'scheduled', 'post_drafted', 'cancelled'
    )),

  reason text null
    constraint cross_request_log_reason_length_check
    check (reason is null or char_length(reason) <= 1000),

  -- Two possible actors: an organiser, or the mentee themselves withdrawing
  -- from the portal — and a mentee has no admin_users row.
  changed_by uuid null references public.admin_users(id) on delete set null,
  changed_by_person_id uuid null references public.people(id) on delete set null,
  changed_at timestamptz not null default now()
);

comment on table public.cross_request_log is
  'Append-only history of a cross-mentoring request. Never updated, never deleted.';

create index if not exists cross_request_log_request_idx
  on public.cross_request_log (request_id, changed_at desc);

-- ------------------------------------------------------------
-- 7. outbound_emails.kind — the four letters this flow sends
-- ------------------------------------------------------------
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
    'recap_period_reminder',
    'participant_invite',
    'cross_invite',
    'cross_selected',
    'cross_not_selected',
    -- Without this the mentee submits a wish and hears nothing until an event
    -- appears out of the blue.
    'cross_scheduled'
  ));

-- ------------------------------------------------------------
-- 8. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.cross_mentoring_fields  enable row level security;
alter table public.mentor_cross_fields     enable row level security;
alter table public.cross_requests          enable row level security;
alter table public.cross_invitations       enable row level security;
alter table public.cross_invitation_slots  enable row level security;
alter table public.cross_request_log       enable row level security;

revoke all on public.cross_mentoring_fields from public, anon, authenticated;
revoke all on public.mentor_cross_fields    from public, anon, authenticated;
revoke all on public.cross_requests         from public, anon, authenticated;
revoke all on public.cross_invitations      from public, anon, authenticated;
revoke all on public.cross_invitation_slots from public, anon, authenticated;
revoke all on public.cross_request_log      from public, anon, authenticated;

grant select, insert, update, delete on public.cross_mentoring_fields to service_role;
grant select, insert, update, delete on public.mentor_cross_fields    to service_role;
grant select, insert, update, delete on public.cross_requests         to service_role;
grant select, insert, update, delete on public.cross_invitations      to service_role;
grant select, insert, update, delete on public.cross_invitation_slots to service_role;
-- Append-only: no update, no delete, not even for service_role.
grant select, insert                 on public.cross_request_log      to service_role;

-- ------------------------------------------------------------
-- 9. Self-check — fail the transaction if the contract is not met
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array[
    'cross_mentoring_fields', 'mentor_cross_fields', 'cross_requests',
    'cross_invitations', 'cross_invitation_slots', 'cross_request_log'
  ];
  offending text;
  seeded integer;
begin
  -- 9a. One invitation per mentor per request, so a repeated sweep is harmless.
  if not exists (
    select 1 from pg_constraint
    where conname = 'cross_invitations_request_mentor_key'
      and conrelid = 'public.cross_invitations'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: an invitation is not unique per mentor per request';
  end if;

  -- 9b. A scheduled request must carry a time and an event.
  if not exists (
    select 1 from pg_constraint
    where conname = 'cross_requests_scheduled_shape_check'
      and conrelid = 'public.cross_requests'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: a scheduled request could exist without an event';
  end if;

  -- 9c. The field vocabulary is complete and the two lists are separate.
  select count(*) into seeded
  from public.cross_mentoring_fields where is_requestable;
  if seeded <> 24 then
    raise exception 'SEED_INCOMPLETE: expected 24 requestable fields, found %', seeded;
  end if;

  select count(*) into seeded
  from public.cross_mentoring_fields where kind = 'industry';
  if seeded <> 14 then
    raise exception 'SEED_INCOMPLETE: expected 14 industry rows, found %', seeded;
  end if;

  -- 9d. Nothing may reference a field that does not exist.
  if not exists (
    select 1 from pg_constraint
    where conname = 'cross_requests_field_fkey'
      and conrelid = 'public.cross_requests'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: a request could name a field that does not exist';
  end if;

  -- 9e. The letters must be sendable.
  if not exists (
    select 1 from pg_constraint
    where conname = 'outbound_emails_kind_check'
      and conrelid = 'public.outbound_emails'::regclass
      and pg_get_constraintdef(oid) like '%cross_invite%'
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: outbound_emails.kind does not accept cross_invite';
  end if;

  -- 9f. RLS on, no policies, no client-role privileges.
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

  -- 9g. The log stays append-only even for the only role that can reach it.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      select coalesce(pg_get_userbyid(nullif(x.grantee, 0)), 'PUBLIC') as grantee_name,
             x.privilege_type
      from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as x
    ) a(grantee_name, privilege_type)
    where n.nspname = 'public'
      and c.relname = 'cross_request_log'
      and a.grantee_name = 'service_role'
      and a.privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception 'GRANT_CONTRACT_VIOLATION: the request log must be append-only';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
