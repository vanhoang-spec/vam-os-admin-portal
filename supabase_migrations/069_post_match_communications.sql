-- ============================================================
-- Migration 069 — Everything the season sends after the matching
-- ============================================================
--
-- Purpose: the pairs exist; now the people have to be told. Four messages go
-- out, and none of them has anywhere to live in the schema today:
--
--   1. the mentee is told they were selected, with the code of conduct and the
--      tips written for mentees;
--   2. once EVERY selected mentee has a mentor, each mentee is told who their
--      mentor is;
--   3. each mentor receives the applications of the mentees they were given,
--      with the mentor versions of the same two documents;
--   4. both sides are invited to the kick-off.
--
-- Three things are needed for that, and this migration adds all three.
--
-- DOCUMENTS. The code of conduct and the tips are written once per season and
-- linked from the emails, not attached to them: a document that is corrected
-- after five hundred emails went out is corrected for everyone. Edits keep the
-- previous text, so "which version did the mentees actually agree to" has an
-- answer.
--
-- TEMPLATES. The bodies are drafted (optionally by the assisted-writing path),
-- edited by the organisers, and APPROVED before any bulk send can use them. A
-- template holds placeholders, never a name: the personal values are filled in
-- at send time, so no personal data is ever sent to a writing assistant.
--
-- DOSSIER LINKS. A mentor needs their mentee's application, which is full of a
-- student's private answers. Putting it in an email body puts it in a mailbox
-- forever, forwardable and impossible to withdraw. Instead each mentor gets a
-- link that expires, can be revoked, and counts how many times it was opened.
--
-- Objects:
--   1. public.program_documents          — one document per season/audience/kind
--   2. public.program_document_revisions — append-only history of the text
--   3. public.email_templates            — subject + body with placeholders
--   4. public.email_template_log         — append-only audit of the approvals
--   5. public.mentee_dossier_links       — expiring per-mentor access links
--   6. public.email_batches              — one bulk send
--   plus: 4 new values on outbound_emails.kind, outbound_emails.batch_id, and
--         mentor_season_confirmations.bio_short
--
-- ============================================================
-- SECURITY CONTRACT
-- ============================================================
-- Server-only, exactly like migrations 064, 066, 067 and 068: RLS enabled, zero
-- policies, every privilege revoked from PUBLIC/anon/authenticated, and only
-- what service_role needs granted. The public pages (a document, a dossier)
-- read through the server, which resolves the slug or the token itself — the
-- browser never talks to these tables.
--
-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ============================================================
--   * It changes no table that existed before Season 12. The two tables it
--     alters — outbound_emails and mentor_season_confirmations — were both
--     created by migration 064 in this same work package, so the frozen release
--     package still applies untouched.
--   * The one constraint it replaces is outbound_emails.kind, also from 064,
--     and only to add values. No existing row can stop matching it.
--   * It writes no data: the documents start empty and are written in the app.
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
    raise exception 'PREREQ_MISSING: public.seasons is required by migration 069';
  end if;
  if to_regclass('public.applications') is null then
    raise exception 'PREREQ_MISSING: public.applications is required by migration 069';
  end if;
  if to_regclass('public.people') is null then
    raise exception 'PREREQ_MISSING: public.people is required by migration 069';
  end if;
  if to_regclass('public.matches') is null then
    raise exception 'PREREQ_MISSING: public.matches is required by migration 069';
  end if;
  if to_regclass('public.admin_users') is null then
    raise exception 'PREREQ_MISSING: public.admin_users is required by migration 069';
  end if;
  if to_regclass('public.outbound_emails') is null then
    raise exception 'PREREQ_MISSING: public.outbound_emails (migration 064) is required by migration 069';
  end if;
  if to_regclass('public.mentor_season_confirmations') is null then
    raise exception 'PREREQ_MISSING: public.mentor_season_confirmations (migration 064) is required by migration 069';
  end if;
  if to_regproc('public.set_updated_at') is null then
    raise exception 'PREREQ_MISSING: public.set_updated_at() (migration 052) is required by migration 069';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1. program_documents
-- ------------------------------------------------------------
create table if not exists public.program_documents (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,

  audience text not null,
  kind text not null,

  title text not null,
  -- The address the emails link to. Stable: changing it breaks links already
  -- sent, so the application generates it once and does not offer a rename.
  slug text not null,
  body text not null default '',

  version integer not null default 1,
  status text not null default 'draft',
  published_at timestamptz null,

  created_by uuid null references public.admin_users(id) on delete set null,
  updated_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint program_documents_audience_check check (audience in ('mentee', 'mentor')),
  constraint program_documents_kind_check check (kind in ('code_of_conduct', 'tips')),
  constraint program_documents_status_check check (status in ('draft', 'published', 'archived')),
  constraint program_documents_version_check check (version >= 1),

  -- A URL-safe slug, because it is typed into an email.
  constraint program_documents_slug_format_check check (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  constraint program_documents_slug_key unique (slug),

  -- One document per audience per kind per season.
  constraint program_documents_season_audience_kind_key unique (season_id, audience, kind),

  -- A published document says when it was published.
  constraint program_documents_published_shape_check
    check ((status = 'published' and published_at is not null) or status <> 'published')
);

comment on table public.program_documents is
  'The code of conduct and the tips, one per audience per season. Linked from the post-matching emails rather than attached to them, so a correction reaches everybody who was already written to.';
comment on column public.program_documents.slug is
  'Address used in the public URL. Generated once; renaming it would break links already sent.';

create index if not exists program_documents_season_idx
  on public.program_documents (season_id, audience, kind);

create index if not exists program_documents_status_idx
  on public.program_documents (status);

drop trigger if exists program_documents_set_updated_at on public.program_documents;
create trigger program_documents_set_updated_at
before update on public.program_documents
for each row
execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. program_document_revisions (append-only)
-- ------------------------------------------------------------
create table if not exists public.program_document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.program_documents(id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  status text not null,
  saved_by uuid null references public.admin_users(id) on delete set null,
  saved_at timestamptz not null default now(),

  constraint program_document_revisions_version_check check (version >= 1),
  constraint program_document_revisions_unique_version unique (document_id, version)
);

comment on table public.program_document_revisions is
  'Every saved version of a program document. Append-only: the text a cohort was given must still be readable after the document is edited for the next season.';

create index if not exists program_document_revisions_document_idx
  on public.program_document_revisions (document_id, version desc);

create or replace function public.prevent_program_document_revision_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'program_document_revisions is append-only';
end;
$$;

drop trigger if exists program_document_revisions_no_update on public.program_document_revisions;
create trigger program_document_revisions_no_update
before update on public.program_document_revisions
for each row
execute function public.prevent_program_document_revision_mutation();

drop trigger if exists program_document_revisions_no_delete on public.program_document_revisions;
create trigger program_document_revisions_no_delete
before delete on public.program_document_revisions
for each row
execute function public.prevent_program_document_revision_mutation();

-- ------------------------------------------------------------
-- 3. email_templates
-- ------------------------------------------------------------
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  kind text not null,

  subject text not null default '',
  body text not null default '',

  status text not null default 'draft',

  -- Provenance of the draft, so an operator can see what wrote the first pass.
  ai_generated boolean not null default false,
  ai_model text null,
  ai_prompt_version text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  approved_by uuid null references public.admin_users(id) on delete set null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_templates_kind_check
    check (kind in (
      'mentee_selected',
      'mentee_mentor_intro',
      'mentor_mentee_package',
      'kickoff_invite'
    )),

  constraint email_templates_status_check check (status in ('draft', 'approved', 'archived')),

  -- An approved template records who approved it and when; a draft has not.
  constraint email_templates_approved_shape_check
    check (
      (status = 'approved' and approved_at is not null)
      or (status <> 'approved' and approved_at is null)
    )
);

comment on table public.email_templates is
  'Bodies for the post-matching emails. A template holds placeholders, never a person: values are filled in at send time, so no personal data is ever sent to a writing assistant.';

-- Only one approved template per kind per season: a bulk send must never have
-- to choose between two approved versions.
create unique index if not exists email_templates_one_approved_idx
  on public.email_templates (season_id, kind)
  where status = 'approved';

create index if not exists email_templates_season_idx
  on public.email_templates (season_id, kind, status);

drop trigger if exists email_templates_set_updated_at on public.email_templates;
create trigger email_templates_set_updated_at
before update on public.email_templates
for each row
execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 4. email_template_log (append-only)
-- ------------------------------------------------------------
create table if not exists public.email_template_log (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.email_templates(id) on delete cascade,
  action text not null,
  detail jsonb null,
  actor_admin_user_id uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint email_template_log_action_check
    check (action in ('created', 'ai_drafted', 'edited', 'approved', 'archived'))
);

comment on table public.email_template_log is
  'Append-only audit of who drafted, edited and approved each template. UPDATE and DELETE are blocked by trigger.';

create index if not exists email_template_log_template_idx
  on public.email_template_log (template_id, created_at desc);

create or replace function public.prevent_email_template_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'email_template_log is append-only';
end;
$$;

drop trigger if exists email_template_log_no_update on public.email_template_log;
create trigger email_template_log_no_update
before update on public.email_template_log
for each row
execute function public.prevent_email_template_log_mutation();

drop trigger if exists email_template_log_no_delete on public.email_template_log;
create trigger email_template_log_no_delete
before delete on public.email_template_log
for each row
execute function public.prevent_email_template_log_mutation();

-- ------------------------------------------------------------
-- 5. mentee_dossier_links
-- ------------------------------------------------------------
create table if not exists public.mentee_dossier_links (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid(),

  season_id uuid not null references public.seasons(id) on delete restrict,
  match_id uuid null references public.matches(id) on delete set null,
  mentor_person_id uuid not null references public.people(id) on delete restrict,
  mentee_application_id uuid not null references public.applications(id) on delete restrict,

  expires_at timestamptz not null,
  revoked_at timestamptz null,

  -- Who opened it and when, without a second table: the link IS one mentor.
  view_count integer not null default 0,
  last_viewed_at timestamptz null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint mentee_dossier_links_token_key unique (token),
  constraint mentee_dossier_links_view_count_check check (view_count >= 0),
  constraint mentee_dossier_links_pair_key unique (mentor_person_id, mentee_application_id)
);

comment on table public.mentee_dossier_links is
  'Expiring, revocable access to one mentee application for one mentor. Used instead of putting a student''s answers in an email body, where they cannot be withdrawn.';
comment on column public.mentee_dossier_links.expires_at is
  'Access ends here. The page refuses an expired or revoked link and says so, rather than failing silently.';

create index if not exists mentee_dossier_links_token_idx
  on public.mentee_dossier_links (token);

create index if not exists mentee_dossier_links_season_idx
  on public.mentee_dossier_links (season_id, created_at desc);

create index if not exists mentee_dossier_links_mentor_idx
  on public.mentee_dossier_links (mentor_person_id);

-- ------------------------------------------------------------
-- 6. email_batches
-- ------------------------------------------------------------
create table if not exists public.email_batches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  kind text not null,
  template_id uuid null references public.email_templates(id) on delete set null,
  event_id uuid null,

  status text not null default 'running',
  requested_count integer not null default 0,
  sent_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  note text null,

  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,

  constraint email_batches_kind_check
    check (kind in (
      'mentee_selected',
      'mentee_mentor_intro',
      'mentor_mentee_package',
      'kickoff_invite'
    )),
  constraint email_batches_status_check check (status in ('running', 'completed', 'failed')),
  constraint email_batches_counts_check
    check (
      requested_count >= 0 and sent_count >= 0 and skipped_count >= 0 and failed_count >= 0
    ),
  constraint email_batches_completed_shape_check
    check (
      (status = 'running' and completed_at is null)
      or (status <> 'running' and completed_at is not null)
    )
);

comment on table public.email_batches is
  'One bulk send: which template went to how many people, and how many of them it reached. Individual attempts stay in outbound_emails, joined by batch_id.';

create index if not exists email_batches_season_idx
  on public.email_batches (season_id, kind, created_at desc);

-- ------------------------------------------------------------
-- 7. Extending the two tables migration 064 created
-- ------------------------------------------------------------
-- The four new kinds. Values are only added; every existing row keeps matching.
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
    'kickoff_invite'
  ));

alter table public.outbound_emails
  add column if not exists batch_id uuid references public.email_batches(id) on delete set null;

comment on column public.outbound_emails.batch_id is
  'Migration 069: the bulk send this attempt belonged to. Null for the one-off emails of migrations 064-067.';

create index if not exists outbound_emails_batch_idx
  on public.outbound_emails (batch_id)
  where batch_id is not null;

-- The mentor introduction a mentee receives. Season-scoped on purpose: a mentor
-- introduces themselves differently to a different cohort, and the text is
-- reviewed by the organisers before it is sent on.
alter table public.mentor_season_confirmations
  add column if not exists bio_short text;

comment on column public.mentor_season_confirmations.bio_short is
  'Migration 069: short introduction sent to this mentor''s mentees. Drafted from the professional fields (title, company, industry, years) and edited by the organisers before use.';

-- ------------------------------------------------------------
-- 8. Privilege contract — applied last, after every object exists
-- ------------------------------------------------------------
alter table public.program_documents          enable row level security;
alter table public.program_document_revisions enable row level security;
alter table public.email_templates            enable row level security;
alter table public.email_template_log         enable row level security;
alter table public.mentee_dossier_links       enable row level security;
alter table public.email_batches              enable row level security;

revoke all on public.program_documents          from public, anon, authenticated;
revoke all on public.program_document_revisions from public, anon, authenticated;
revoke all on public.email_templates            from public, anon, authenticated;
revoke all on public.email_template_log         from public, anon, authenticated;
revoke all on public.mentee_dossier_links       from public, anon, authenticated;
revoke all on public.email_batches              from public, anon, authenticated;

grant select, insert, update, delete on public.program_documents    to service_role;
grant select, insert                 on public.program_document_revisions to service_role;
grant select, insert, update, delete on public.email_templates      to service_role;
grant select, insert                 on public.email_template_log   to service_role;
grant select, insert, update, delete on public.mentee_dossier_links to service_role;
grant select, insert, update, delete on public.email_batches        to service_role;

-- ------------------------------------------------------------
-- 9. Self-check — fail the transaction if the contract is not met
-- ------------------------------------------------------------
do $$
declare
  target_tables text[] := array[
    'program_documents',
    'program_document_revisions',
    'email_templates',
    'email_template_log',
    'mentee_dossier_links',
    'email_batches'
  ];
  offending text;
  missing text;
begin
  -- 9a. The columns added to the two existing tables must be there.
  select string_agg(format('%s.%s', expected.tbl, expected.col), ', ')
    into missing
  from (values
    ('outbound_emails', 'batch_id'),
    ('mentor_season_confirmations', 'bio_short')
  ) as expected(tbl, col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected.tbl
      and c.column_name = expected.col
  );

  if missing is not null then
    raise exception 'COLUMN_CONTRACT_VIOLATION: expected columns are missing: %', missing;
  end if;

  -- 9b. The widened kind vocabulary must accept the four new values.
  if not exists (
    select 1 from pg_constraint
    where conname = 'outbound_emails_kind_check'
      and conrelid = 'public.outbound_emails'::regclass
      and pg_get_constraintdef(oid) like '%kickoff_invite%'
  ) then
    raise exception 'CONSTRAINT_CONTRACT_VIOLATION: outbound_emails.kind does not accept the new values';
  end if;

  -- 9c. RLS on, no policies, no client-role privileges.
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
