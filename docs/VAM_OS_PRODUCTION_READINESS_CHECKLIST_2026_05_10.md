# VAM OS Production Readiness Checklist - 2026-05-10

Production has not been touched yet. Use this checklist before promoting staging-tested VAM OS features to production.

## Release Scope

Staging-tested features:

- [ ] Event Registration + QR Check-in
- [ ] Dashboard / Operations / People / Events UI polish
- [ ] Phase 1A Member Lifecycle + CRM foundation
- [ ] Phase 1B staging backfill for `person_season_memberships`
- [ ] `programs.is_active` schema alignment migration `053`

Latest relevant commits:

- `0486acc` Add programs is_active schema alignment migration
- `8a0d6e0` Add Phase 1A lifecycle CRM staging QA checkpoint
- `dd998bb` Fix Phase 1A backfill for matches schema
- `cbc8b76` Tighten Phase 1A staging backfill draft
- `a5b46e0` Add Phase 1A member lifecycle and CRM foundation
- `cbae6b0` / `73b0a7b` event registration/check-in related commits

## 1. Production Environment Verification

- [ ] Vercel Production env points to Supabase production ref `qkkroesfiazsejkzflcd`.
- [ ] Staging ref `ljfneyuvpxrmejpxsmpz` is not used in Production env.
- [ ] `NEXT_PUBLIC_SUPABASE_URL` is production.
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` is production.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is production.
- [ ] `DATABASE_URL` is production.

No-go if any production env var points to staging.

## 2. Required Production Migrations

Apply only reviewed migrations, in this order:

1. [ ] `049_expand_event_participation_status_model.sql`
2. [ ] `051_event_registration_qr_checkin_foundation.sql`
3. [ ] `052_phase1a_member_lifecycle_crm_foundation.sql`
4. [ ] `053_programs_is_active_schema_alignment.sql`

Release review:

- [ ] Explicitly review whether `050_staging_profile_intake_batch_linkage.sql` should be excluded from production release.
- [ ] Do not include staging-only migrations unless separately approved.

## 3. Pre-Migration SQL Checks

Run on Supabase production before applying migrations.

```sql
-- Table existence
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'events',
    'event_links',
    'event_registrations',
    'event_participations',
    'programs',
    'seasons',
    'intake_batches',
    'people',
    'matches',
    'person_season_memberships',
    'person_season_membership_log',
    'crm_notes'
  )
order by table_name;

-- Column existence
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'programs' and column_name = 'is_active')
    or table_name in ('event_links', 'event_registrations', 'person_season_memberships', 'person_season_membership_log', 'crm_notes')
  )
order by table_name, ordinal_position;

-- Event status compatibility
select status, count(*)
from public.event_participations
group by status
order by status;

-- Existing registration/check-in tables
select to_regclass('public.event_links') as event_links,
       to_regclass('public.event_registrations') as event_registrations;

-- Existing lifecycle/CRM tables
select to_regclass('public.person_season_memberships') as person_season_memberships,
       to_regclass('public.person_season_membership_log') as person_season_membership_log,
       to_regclass('public.crm_notes') as crm_notes;

-- programs.is_active
select exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'programs'
    and column_name = 'is_active'
) as programs_is_active_exists;
```

## 4. Backup / Rollback Preparation

- [ ] Confirm latest Supabase production backup/snapshot is available.
- [ ] Record timestamp before migration: `YYYY-MM-DD HH:MM TZ`.
- [ ] Record current production Vercel deployment URL/id.
- [ ] Rollback plan prioritizes Vercel code rollback, not destructive DB rollback.

## 5. Migration Apply Plan

- [ ] Apply only reviewed migrations.
- [ ] Use Supabase production SQL Editor.
- [ ] Apply one migration at a time.
- [ ] Run post-checks after each migration.
- [ ] Stop immediately on any migration error.

## 6. Post-Migration SQL Checks

```sql
-- Required objects
select to_regclass('public.event_links') as event_links,
       to_regclass('public.event_registrations') as event_registrations,
       to_regclass('public.person_season_memberships') as person_season_memberships,
       to_regclass('public.person_season_membership_log') as person_season_membership_log,
       to_regclass('public.crm_notes') as crm_notes;

-- programs.is_active exists
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'programs'
  and column_name = 'is_active';

-- Lifecycle indexes/count sanity
select count(*) as person_season_memberships_count
from public.person_season_memberships;

select count(*) as person_season_membership_log_count
from public.person_season_membership_log;

select count(*) as crm_notes_count
from public.crm_notes;

-- Program/season consistency
select count(*) as mismatched_program_season_rows
from public.person_season_memberships psm
join public.seasons s on s.id = psm.season_id
where psm.program_id is distinct from s.program_id;
```

Expected:

- [ ] Required tables exist.
- [ ] `programs.is_active` exists with default `true`.
- [ ] Program/season mismatch count is `0`.

## 7. Production Backfill Policy

- [ ] Do not run production lifecycle backfill during the initial release.
- [ ] Run preview/count first as a separate step.
- [ ] Review counts for mentee rows, mentor rows, and log rows.
- [ ] Run production backfill only after explicit count review and approval.

## 8. Vercel Production Deploy Plan

- [ ] Confirm production env again before deploy.
- [ ] Confirm required production migrations have been applied.
- [ ] Deploy latest `main` to Vercel Production.
- [ ] Do not deploy if production migrations are missing.

## 9. Smoke Test Checklist

- [ ] Login / unlock works.
- [ ] Dashboard loads.
- [ ] Operations loads.
- [ ] Events list loads.
- [ ] Event detail loads.
- [ ] Registration link opens.
- [ ] Duplicate registration is blocked.
- [ ] Check-in link / QR works.
- [ ] Duplicate check-in is blocked.
- [ ] People detail loads.
- [ ] `Lịch sử VAM` renders.
- [ ] `Vai trò theo mùa` renders.
- [ ] CRM notes create/read works for permitted admin.
- [ ] Viewer cannot create notes.
- [ ] Private / `ops_only` notes are not visible to viewer.
- [ ] HAM / UEHM scope isolation works.

## 10. No-Go Conditions

Stop release if any condition occurs:

- [ ] Production env points to staging.
- [ ] Any migration errors.
- [ ] Required table missing after migration.
- [ ] Login fails.
- [ ] People detail shows a red banner.
- [ ] Events fail to load.
- [ ] Permission or scope isolation fails.

## 11. Rollback Plan

- [ ] Roll back Vercel to previous stable production deployment.
- [ ] Pause sharing public registration/check-in links.
- [ ] Keep additive DB migrations unless there is a critical issue.
- [ ] Document any records created during smoke testing.
- [ ] Record incident notes, timestamps, and operator actions.
