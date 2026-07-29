-- =============================================================================
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
-- PRODUCTION AND STAGING MUTATION NOT AUTHORIZED
-- =============================================================================
-- VAM OS Auth Hardening — B: people.auth_user_id Linkage Column
-- Prepared: 2026-07-29
-- Purpose: Add auth_user_id column to public.people to support participant login.
-- Pre-requisites:
--   public.people table exists in production.
-- Note: This column MUST be added before any participant login can be built.
--       The column is nullable and additive — zero data migration required.
-- =============================================================================

-- --------------------------------------------------------------------------
-- B1. Add auth_user_id column (nullable, no FK to auth.users)
-- --------------------------------------------------------------------------
-- Follows the pattern of admin_users.auth_user_id (migration 017):
--   - uuid null (nullable for pre-existing rows)
--   - No explicit FK to auth.users (matches established codebase pattern)
--   - Application layer is responsible for lifecycle management
-- --------------------------------------------------------------------------

alter table public.people
  add column if not exists auth_user_id uuid null;

comment on column public.people.auth_user_id is
  'Supabase Auth user id for participant login. Null until participant account is created.
   References auth.users(id) by value (no FK constraint, following admin_users pattern).
   Application layer must null this before deleting the linked auth user.';

-- --------------------------------------------------------------------------
-- B2. Unique partial index — one auth user per person
-- --------------------------------------------------------------------------
-- Two people rows must never share the same auth_user_id.
-- Partial index (where auth_user_id is not null) allows multiple null rows.
-- --------------------------------------------------------------------------

create unique index if not exists people_auth_user_id_unique_idx
  on public.people(auth_user_id)
  where auth_user_id is not null;

-- --------------------------------------------------------------------------
-- B3. Standard lookup index for participant login resolution
-- --------------------------------------------------------------------------
-- Used in: SELECT id FROM people WHERE auth_user_id = auth.uid()
-- The unique index above also serves as a lookup index; this separate index
-- is not needed unless query planning shows otherwise.
-- SKIP THIS if unique index above is being used for lookups.
-- Included here for completeness; evaluate on production query plans.
-- --------------------------------------------------------------------------

-- create index if not exists people_auth_user_id_idx
--   on public.people(auth_user_id)
--   where auth_user_id is not null;
-- (commented out: covered by unique index above)

-- --------------------------------------------------------------------------
-- B4. TypeScript type update reminder (NOT SQL — informational comment only)
-- --------------------------------------------------------------------------
-- After this migration is applied, update lib/types.ts:
--
-- export type Person = JsonRecord & {
--   id: string;
--   full_name: string | null;
--   email_primary: string | null;
--   phone_primary: string | null;
--   gender: string | null;
--   source_sheets: string | null;
--   data_quality_flags: string | null;
--   auth_user_id?: string | null;   // Added by this migration
-- };
-- --------------------------------------------------------------------------

-- =============================================================================
-- ROLLBACK — run to undo this migration (if needed):
-- =============================================================================
-- drop index if exists public.people_auth_user_id_unique_idx;
-- alter table public.people drop column if exists auth_user_id;
-- =============================================================================
