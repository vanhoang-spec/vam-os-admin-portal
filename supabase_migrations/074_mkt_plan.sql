-- ============================================================
-- Migration 074 — MKT plan: from a month's theme to a post somebody publishes
-- ============================================================
--
-- Purpose: every programme runs its own fanpage, and the content for it is
-- planned in a spreadsheet and a group chat. Nobody can answer "what is still
-- missing this week", "which request got dropped", or "is this post waiting on
-- a designer or on an approver".
--
-- This migration is the record of that process:
--
--   master plan (month) → week plan → one post per slot → approved → posted
--
-- ============================================================
-- THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM: A SPACE
-- ============================================================
-- The imported specification assumed one brand and one settings row. VAM is
-- five programmes, each with its own fanpage, its own audience and its own
-- support team who approves and publishes. A single settings row would have
-- meant one voice for all five and one approval queue.
--
-- So the unit is a SPACE, and a space is one of two things:
--
--   * a PROGRAMME space  — program_id set. Owns that programme's fanpage.
--     The brand name is never typed in; it is read from programs.name, so
--     "UEH Mentoring" appears in the prompt because that is the programme's
--     name, and it cannot drift from the rest of the application.
--
--   * the SHARED space   — program_id null. Exactly one, for VAM as a whole.
--     Owns the LinkedIn channel, which is one account for the organisation
--     rather than one per school.
--
-- ============================================================
-- WHY CHANNELS ARE A TABLE AND NOT A JSONB COLUMN
-- ============================================================
-- The specification kept the channel mix and the golden hours in jsonb. Two
-- requirements from the owner made a child table the better shape:
--
--   1. LinkedIn belongs to the shared space and to no programme. With a child
--      table this is a CHECK the database enforces — `(channel = 'linkedin')
--      = is_shared` — rather than a rule the code has to remember. A LinkedIn
--      post inside UEH Mentoring's week is not a bug that can happen.
--
--   2. TikTok is optional and the support team decides later whether to run
--      it. Switching a channel on is then flipping `is_active` on one row, not
--      editing a jsonb blob. Rows for the optional channels are seeded
--      inactive so the switch is visible without anybody inserting anything.
--
-- mkt_posts carries a composite foreign key (space_id, channel) to this table,
-- so a post can only exist on a channel its own space actually has.
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- Server-only, exactly like migrations 064-072: RLS enabled, zero policies,
-- every privilege revoked from PUBLIC/anon/authenticated, only what
-- service_role needs granted, and the log append-only even for service_role.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It does not touch programs, events, cross_requests, people or seasons.
--     The plan READS the real calendar out of events and cross_requests; it
--     never writes to them.
--   * It creates no storage bucket. The application uses Supabase Storage
--     nowhere at all today, and introducing it for this module would mean a
--     new bucket-policy surface for one feature. Designers record a link to
--     the finished artwork instead — the same way bio_url, recap_url and
--     posted_url already work here.
--   * It posts nothing anywhere. There is no auto-post, by design; a post
--     reaches `approved` and a person publishes it.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Phase 0 — prerequisites
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.programs') is null then
    raise exception 'PREREQ_MISSING: public.programs is required by migration 074';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: public.admin_users is required by migration 074';
  end if;
  if to_regproc('public.set_updated_at') is null then
    raise exception 'PREREQ_MISSING: public.set_updated_at() is required by migration 074';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. mkt_spaces — one fanpage's worth of planning
-- ------------------------------------------------------------
create table if not exists public.mkt_spaces (
  id uuid primary key default gen_random_uuid(),

  -- Null means the shared VAM space. The partial unique indexes below allow
  -- one row per programme and exactly one row with null.
  program_id uuid null references public.programs(id) on delete restrict,

  -- Generated rather than stored by hand so it can never disagree with
  -- program_id, and so the channel table can key off it.
  is_shared boolean not null generated always as (program_id is null) stored,

  -- The brand profile: audience, voice, content pillars, do and avoid, and the
  -- `chan_doan` diagnosis of how the page is actually performing. The brand
  -- NAME is deliberately not in here — it comes from programs.name.
  brand jsonb not null default '{}',

  -- Where the finished post goes. Shown to whoever publishes; never posted to.
  page_url text null
    constraint mkt_spaces_page_url_check
    check (page_url is null or page_url ~* '^https?://'),

  notes text null
    constraint mkt_spaces_notes_length_check
    check (notes is null or char_length(notes) <= 2000),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.admin_users(id) on delete set null,

  -- Lets the channel table point at (id, is_shared) as a unit.
  constraint mkt_spaces_id_shared_unique unique (id, is_shared)
);

comment on table public.mkt_spaces is
  'One planning space: a mentoring programme with its own fanpage, or the single shared VAM space that owns LinkedIn.';
comment on column public.mkt_spaces.brand is
  'Audience, voice, content pillars with their ratios, do/avoid, and the diagnosis of the page as it stands. The brand NAME is not here - it is read from programs.name so it cannot drift.';
comment on column public.mkt_spaces.is_shared is
  'Generated from program_id. True for the one VAM-wide space, which owns LinkedIn and nothing else.';

create unique index if not exists mkt_spaces_program_idx
  on public.mkt_spaces (program_id)
  where program_id is not null;

-- Exactly one shared space, enforced rather than trusted.
create unique index if not exists mkt_spaces_one_shared_idx
  on public.mkt_spaces ((program_id is null))
  where program_id is null;

drop trigger if exists mkt_spaces_set_updated_at on public.mkt_spaces;
create trigger mkt_spaces_set_updated_at
  before update on public.mkt_spaces
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. mkt_space_channels — which channels a space runs, and how hard
-- ------------------------------------------------------------
create table if not exists public.mkt_space_channels (
  space_id uuid not null references public.mkt_spaces(id) on delete cascade,

  channel text not null
    constraint mkt_space_channels_channel_check
    check (channel in ('facebook', 'tiktok', 'youtube', 'linkedin')),

  -- Denormalised from the space so the CHECK below can see it. The composite
  -- foreign key keeps the two honest.
  is_shared boolean not null,

  -- Off until somebody switches it on. TikTok ships this way: the owner asked
  -- for it to be optional, decided later by the support team.
  is_active boolean not null default false,

  posts_per_week integer not null default 0
    constraint mkt_space_channels_posts_per_week_check
    check (posts_per_week between 0 and 7),

  -- One post per channel per day at most, so seven is the ceiling and the
  -- slot algorithm needs no other bound.
  best_times text[] not null default '{}',

  -- Who reads THIS channel, what may be written on it, how, and what never.
  -- Separate from the space's brand profile: brand is the shared voice,
  -- this is the audience, and the two change for different reasons.
  audience text null,
  topics text null,
  do_write text null,
  avoid_write text null,

  -- True when this channel speaks to a different audience than the rest of the
  -- space. Such a channel is given its own variant group so the model cannot
  -- carry an idea across from a channel written for somebody else.
  distinct_audience boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (space_id, channel),

  constraint mkt_space_channels_space_fkey
    foreign key (space_id, is_shared)
    references public.mkt_spaces (id, is_shared) on delete cascade,

  -- The owner's rule, made structural: LinkedIn is one VAM-wide account, and
  -- the shared space exists for nothing else.
  constraint mkt_space_channels_linkedin_is_shared_check
    check ((channel = 'linkedin') = is_shared),

  -- An active channel that produces no posts is a contradiction the operator
  -- should resolve rather than discover in an empty week.
  constraint mkt_space_channels_active_shape_check
    check (not is_active or posts_per_week > 0)
);

comment on table public.mkt_space_channels is
  'Which channels a space runs. Turning TikTok on is flipping is_active on one row; the linkedin/is_shared CHECK makes a LinkedIn post inside a programme space impossible.';
comment on column public.mkt_space_channels.distinct_audience is
  'True when this channel speaks to a different audience than the rest of the space, which earns it its own variant group so ideas are not carried across.';

drop trigger if exists mkt_space_channels_set_updated_at on public.mkt_space_channels;
create trigger mkt_space_channels_set_updated_at
  before update on public.mkt_space_channels
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. mkt_master_plans — the month
-- ------------------------------------------------------------
create table if not exists public.mkt_master_plans (
  id uuid primary key default gen_random_uuid(),

  space_id uuid not null references public.mkt_spaces(id) on delete cascade,

  month text not null
    constraint mkt_master_plans_month_check check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- Doubles as the month's topic. One field rather than two with the same
  -- meaning: two fields with one meaning disagree within a season.
  theme text null
    constraint mkt_master_plans_theme_length_check
    check (theme is null or char_length(theme) <= 500),

  goals jsonb not null default '[]',
  weekly_focus jsonb not null default '[]',

  -- The steering note. Loaded into every prompt that generates content, and
  -- printed as "chưa có" when empty rather than omitted - a missing line reads
  -- to the model as a concept that does not exist, and it invents its own.
  content_notes text null
    constraint mkt_master_plans_content_notes_length_check
    check (content_notes is null or char_length(content_notes) <= 4000),

  notes text null,

  status text not null default 'draft'
    constraint mkt_master_plans_status_check check (status in ('draft', 'approved')),

  -- Whatever the model returned, verbatim, so a bad month can be traced to the
  -- answer that produced it.
  ai_raw jsonb null,
  ai_model text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid null references public.admin_users(id) on delete set null,
  approved_at timestamptz null,
  updated_at timestamptz not null default now(),

  constraint mkt_master_plans_space_month_unique unique (space_id, month),

  constraint mkt_master_plans_approved_shape_check
    check (status <> 'approved' or approved_at is not null)
);

comment on table public.mkt_master_plans is
  'One month of direction for one space. theme doubles as the month topic on purpose.';

drop trigger if exists mkt_master_plans_set_updated_at on public.mkt_master_plans;
create trigger mkt_master_plans_set_updated_at
  before update on public.mkt_master_plans
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 4. mkt_week_plans — the week
-- ------------------------------------------------------------
create table if not exists public.mkt_week_plans (
  id uuid primary key default gen_random_uuid(),

  space_id uuid not null references public.mkt_spaces(id) on delete cascade,
  master_plan_id uuid null references public.mkt_master_plans(id) on delete set null,

  -- Always a Monday. Enforced here so the slot algorithm never has to wonder.
  week_start date not null
    constraint mkt_week_plans_monday_check check (extract(isodow from week_start) = 1),

  topic text null
    constraint mkt_week_plans_topic_length_check
    check (topic is null or char_length(topic) <= 500),
  focus text null
    constraint mkt_week_plans_focus_length_check
    check (focus is null or char_length(focus) <= 500),
  content_notes text null
    constraint mkt_week_plans_content_notes_length_check
    check (content_notes is null or char_length(content_notes) <= 4000),

  -- What the model said it did with each request, and which requests it could
  -- not fit. Shown on the screen: this is what makes the person who asked for
  -- a post trust the queue.
  order_review jsonb not null default '[]',
  orders_unplaced jsonb not null default '[]',

  status text not null default 'draft'
    constraint mkt_week_plans_status_check check (status in ('draft', 'approved')),

  ai_raw jsonb null,
  ai_model text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid null references public.admin_users(id) on delete set null,
  approved_at timestamptz null,
  updated_at timestamptz not null default now(),

  constraint mkt_week_plans_space_week_unique unique (space_id, week_start)
);

comment on table public.mkt_week_plans is
  'One week of slots for one space. week_start is always a Monday, enforced by CHECK.';
comment on column public.mkt_week_plans.order_review is
  'What the model reports it did with each request: merged, adjacent, or given its own post. Shown to the person who asked.';

create index if not exists mkt_week_plans_space_week_idx
  on public.mkt_week_plans (space_id, week_start desc);

drop trigger if exists mkt_week_plans_set_updated_at on public.mkt_week_plans;
create trigger mkt_week_plans_set_updated_at
  before update on public.mkt_week_plans
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. mkt_orders — somebody asks for a post
-- ------------------------------------------------------------
create table if not exists public.mkt_orders (
  id uuid primary key default gen_random_uuid(),

  space_id uuid not null references public.mkt_spaces(id) on delete cascade,

  title text not null
    constraint mkt_orders_title_length_check check (char_length(trim(title)) between 3 and 300),

  purpose text null
    constraint mkt_orders_purpose_length_check
    check (purpose is null or char_length(purpose) <= 1000),

  -- The brief as the requester wrote it. Handed to the model as evidence, not
  -- rewritten by an organiser first.
  body text not null
    constraint mkt_orders_body_length_check check (char_length(trim(body)) between 10 and 4000),

  -- Which channels they hope for. Advisory: the plan decides.
  wanted_channels text[] not null default '{}',

  -- When it must be live by. The plan places high-priority requests earliest.
  needed_by date null,

  -- Two different ideas, kept in two columns. `is_urgent` is about the
  -- production schedule; `content_priority` is about how important the message
  -- is. A request can be either without being the other, and folding them into
  -- one column loses both.
  is_urgent boolean not null default false,
  content_priority text not null default 'normal'
    constraint mkt_orders_content_priority_check
    check (content_priority in ('high', 'priority', 'normal')),

  status text not null default 'new'
    constraint mkt_orders_status_check
    check (status in ('new', 'planned', 'done', 'declined')),

  decline_reason text null
    constraint mkt_orders_decline_reason_length_check
    check (decline_reason is null or char_length(decline_reason) <= 1000),

  requested_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Saying no without saying why is the thing the requester will come and ask
  -- about, and the person who said it will not remember.
  constraint mkt_orders_declined_shape_check
    check (status <> 'declined' or decline_reason is not null)
);

comment on table public.mkt_orders is
  'A request for a post, from whoever runs the thing being announced. is_urgent is about the schedule; content_priority is about the message.';

create index if not exists mkt_orders_space_status_idx
  on public.mkt_orders (space_id, status, content_priority);

drop trigger if exists mkt_orders_set_updated_at on public.mkt_orders;
create trigger mkt_orders_set_updated_at
  before update on public.mkt_orders
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 6. mkt_posts — one slot in one week
-- ------------------------------------------------------------
create table if not exists public.mkt_posts (
  id uuid primary key default gen_random_uuid(),

  week_plan_id uuid not null references public.mkt_week_plans(id) on delete cascade,

  -- Carried from the week plan so the composite key below can reach it.
  space_id uuid not null references public.mkt_spaces(id) on delete cascade,
  channel text not null,

  post_date date not null,
  slot_time time null,

  -- Posts sharing a group are one idea in several shapes. A channel with a
  -- different audience gets a group of its own so nothing is carried across.
  variant_group text null,

  pillar text null,
  idea text null,

  content text null
    constraint mkt_posts_content_length_check
    check (content is null or char_length(content) <= 8000),

  hashtags text[] not null default '{}',
  cta text null,

  -- {format, size, visual, text_on_image, assets_needed, deadline}
  brief jsonb null,

  -- Links to the finished artwork. Links rather than uploads: this application
  -- uses Supabase Storage nowhere, and a link is how a volunteer design team
  -- already works.
  asset_urls text[] not null default '{}',

  status text not null default 'planned'
    constraint mkt_posts_status_check
    check (status in ('planned', 'content_ready', 'draft_ready', 'approved', 'posted', 'skipped')),

  scheduled_at timestamptz null,
  posted_at timestamptz null,
  posted_url text null
    constraint mkt_posts_posted_url_check
    check (posted_url is null or posted_url ~* '^https?://'),

  order_id uuid null references public.mkt_orders(id) on delete set null,

  approved_by uuid null references public.admin_users(id) on delete set null,
  approved_at timestamptz null,
  posted_by uuid null references public.admin_users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A post can only sit on a channel its own space actually runs. This is what
  -- makes "LinkedIn belongs to VAM, not to UEH Mentoring" structural.
  constraint mkt_posts_channel_fkey
    foreign key (space_id, channel)
    references public.mkt_space_channels (space_id, channel) on delete restrict,

  -- One post per channel per day. The slot algorithm already respects this;
  -- the constraint is what makes a hand edit respect it too.
  constraint mkt_posts_one_per_channel_per_day unique (space_id, channel, post_date),

  -- Approving fixes the hour it goes out.
  constraint mkt_posts_approved_shape_check
    check (status not in ('approved', 'posted') or scheduled_at is not null),

  -- "Posted" is a claim about the outside world, so it carries the evidence.
  constraint mkt_posts_posted_shape_check
    check (status <> 'posted' or (posted_at is not null and posted_url is not null))
);

comment on table public.mkt_posts is
  'One slot in one week: date, channel, hour, idea, caption, design brief. Reaches approved and waits for a person to publish it - nothing here posts anywhere.';
comment on column public.mkt_posts.asset_urls is
  'Links to finished artwork. Links, not uploads: the application uses Supabase Storage nowhere and a link is how a volunteer design team already works.';

create index if not exists mkt_posts_week_idx on public.mkt_posts (week_plan_id, post_date);
create index if not exists mkt_posts_sched_idx on public.mkt_posts (status, scheduled_at);
create index if not exists mkt_posts_order_idx on public.mkt_posts (order_id) where order_id is not null;

drop trigger if exists mkt_posts_set_updated_at on public.mkt_posts;
create trigger mkt_posts_set_updated_at
  before update on public.mkt_posts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 7. mkt_post_log — append-only
-- ------------------------------------------------------------
create table if not exists public.mkt_post_log (
  id uuid primary key default gen_random_uuid(),

  post_id uuid null references public.mkt_posts(id) on delete cascade,
  week_plan_id uuid null references public.mkt_week_plans(id) on delete cascade,
  space_id uuid not null references public.mkt_spaces(id) on delete cascade,

  change_type text not null
    constraint mkt_post_log_change_type_check
    check (change_type in (
      'plan_generated', 'content_generated', 'edited',
      'approved', 'posted', 'skipped', 'order_placed', 'order_declined'
    )),

  old_status text null,
  new_status text null,
  reason text null,

  changed_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.mkt_post_log is
  'Append-only. Who approved a post and who published it are questions that get asked after something has already gone out.';

create index if not exists mkt_post_log_post_idx on public.mkt_post_log (post_id, created_at desc);
create index if not exists mkt_post_log_space_idx on public.mkt_post_log (space_id, created_at desc);

-- ------------------------------------------------------------
-- 8. Seed — one space per active programme, plus the shared VAM space
-- ------------------------------------------------------------
-- The module is usable the moment the migration lands. Every space starts with
-- an empty brand profile, which the support team fills in; the channels are
-- there so the switches are visible.

insert into public.mkt_spaces (program_id)
select p.id
from public.programs p
where p.is_active
  and not exists (select 1 from public.mkt_spaces s where s.program_id = p.id);

insert into public.mkt_spaces (program_id)
select null
where not exists (select 1 from public.mkt_spaces where program_id is null);

-- Facebook is every programme's main channel, on from the start.
insert into public.mkt_space_channels
  (space_id, channel, is_shared, is_active, posts_per_week, best_times)
select s.id, 'facebook', false, true, 3, array['12:00', '20:00']
from public.mkt_spaces s
where s.program_id is not null
on conflict (space_id, channel) do nothing;

-- TikTok and YouTube exist but are OFF. The owner asked for TikTok to be
-- optional and decided later by the support team; switching it on is flipping
-- is_active and setting a number, which is one screen, not a migration.
insert into public.mkt_space_channels
  (space_id, channel, is_shared, is_active, posts_per_week, best_times)
select s.id, 'tiktok', false, false, 0, array['12:00', '20:00']
from public.mkt_spaces s
where s.program_id is not null
on conflict (space_id, channel) do nothing;

insert into public.mkt_space_channels
  (space_id, channel, is_shared, is_active, posts_per_week, best_times)
select s.id, 'youtube', false, false, 0, array['19:00']
from public.mkt_spaces s
where s.program_id is not null
on conflict (space_id, channel) do nothing;

-- LinkedIn: one account for the whole of VAM, one post a week, which the owner
-- said is enough.
insert into public.mkt_space_channels
  (space_id, channel, is_shared, is_active, posts_per_week, best_times,
   audience, topics, distinct_audience)
select
  s.id, 'linkedin', true, true, 1, array['08:30'],
  'Cựu sinh viên đi làm, quản lý và doanh nghiệp quan tâm tới mentoring',
  'Kết quả chương trình, câu chuyện mentor, tuyển mentor, hợp tác doanh nghiệp',
  true
from public.mkt_spaces s
where s.program_id is null
on conflict (space_id, channel) do nothing;

-- ------------------------------------------------------------
-- 9. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.mkt_spaces          enable row level security;
alter table public.mkt_space_channels  enable row level security;
alter table public.mkt_master_plans    enable row level security;
alter table public.mkt_week_plans      enable row level security;
alter table public.mkt_orders          enable row level security;
alter table public.mkt_posts           enable row level security;
alter table public.mkt_post_log        enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'mkt_spaces', 'mkt_space_channels', 'mkt_master_plans',
    'mkt_week_plans', 'mkt_orders', 'mkt_posts', 'mkt_post_log'
  ]
  loop
    execute format('revoke all on public.%I from public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end;
$$;

grant select, insert, update, delete on public.mkt_spaces         to service_role;
grant select, insert, update, delete on public.mkt_space_channels to service_role;
grant select, insert, update, delete on public.mkt_master_plans   to service_role;
grant select, insert, update, delete on public.mkt_week_plans     to service_role;
grant select, insert, update, delete on public.mkt_orders         to service_role;
grant select, insert, update, delete on public.mkt_posts          to service_role;

-- The log is append-only for everybody, including the only role that reaches it.
grant select, insert on public.mkt_post_log to service_role;

-- ------------------------------------------------------------
-- 10. Self-check — refuse to commit a half-built contract
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array[
    'mkt_spaces', 'mkt_space_channels', 'mkt_master_plans',
    'mkt_week_plans', 'mkt_orders', 'mkt_posts', 'mkt_post_log'
  ];
  offending text;
  n integer;
begin
  -- 10a. Every table exists.
  foreach offending in array target_tables loop
    if to_regclass(format('public.%I', offending)) is null then
      raise exception 'TABLE_MISSING: public.% was not created', offending;
    end if;
  end loop;

  -- 10b. Exactly one shared space, and it owns LinkedIn.
  select count(*) into n from public.mkt_spaces where program_id is null;
  if n <> 1 then
    raise exception 'SEED_INCOMPLETE: expected exactly 1 shared space, found %', n;
  end if;

  select count(*) into n
  from public.mkt_space_channels
  where channel = 'linkedin' and is_shared;
  if n <> 1 then
    raise exception 'SEED_INCOMPLETE: expected exactly 1 shared LinkedIn channel, found %', n;
  end if;

  -- 10c. No programme space may hold LinkedIn. The CHECK should make this
  -- impossible; asserting it is how we find out if the CHECK was dropped.
  select count(*) into n
  from public.mkt_space_channels
  where channel = 'linkedin' and not is_shared;
  if n <> 0 then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: % programme space(s) hold LinkedIn', n;
  end if;

  -- 10d. A post cannot name a channel its space does not run.
  if not exists (
    select 1 from pg_constraint
    where conname = 'mkt_posts_channel_fkey'
      and conrelid = 'public.mkt_posts'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: a post could name a channel its space does not run';
  end if;

  -- 10e. One post per channel per day.
  if not exists (
    select 1 from pg_constraint
    where conname = 'mkt_posts_one_per_channel_per_day'
      and conrelid = 'public.mkt_posts'::regclass
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: the one-post-per-channel-per-day rule is missing';
  end if;

  -- 10f. RLS on, no policies, no client-role privileges.
  select string_agg(c.relname, ', ')
    into offending
  from pg_class c
  join pg_namespace n2 on n2.oid = c.relnamespace
  where n2.nspname = 'public'
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
  join pg_namespace n2 on n2.oid = c.relnamespace
  cross join lateral (
    select coalesce(pg_get_userbyid(nullif(x.grantee, 0)), 'PUBLIC') as grantee_name,
           x.privilege_type
    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as x
  ) a(grantee_name, privilege_type)
  where n2.nspname = 'public'
    and c.relname = any (target_tables)
    and a.grantee_name in ('PUBLIC', 'anon', 'authenticated');

  if offending is not null then
    raise exception 'GRANT_CONTRACT_VIOLATION: client-role privileges remain: %', offending;
  end if;

  -- 10g. The log stays append-only even for the only role that can reach it.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n2 on n2.oid = c.relnamespace
    cross join lateral (
      select coalesce(pg_get_userbyid(nullif(x.grantee, 0)), 'PUBLIC') as grantee_name,
             x.privilege_type
      from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as x
    ) a(grantee_name, privilege_type)
    where n2.nspname = 'public'
      and c.relname = 'mkt_post_log'
      and a.grantee_name = 'service_role'
      and a.privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception 'GRANT_CONTRACT_VIOLATION: the post log must be append-only';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
