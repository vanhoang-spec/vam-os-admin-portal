# HAM-S6 Production Import Preflight Result

## Target

- **Project:** vam-os-admin-portal
- **Ref:** qkkroesfiazsejkzflcd (production) — owner must independently verify in Supabase dashboard URL
- **Probe:** `HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_V1`
- **Read-only:** YES — single `WITH...SELECT` returning one JSONB row; no writes executed
- **Execution:** 2026-07-23T02:48:46.329Z (570ms)
- **Output valid:** YES — 1 row, 1 column (`jsonb_build_object`), JSONB parses without error
- **Probe version confirmed:** `HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_V1`

---

## Foundation State

- **HAM program:** EXISTS — count=1, `is_active=true` (from migration 036)
- **HAM-S6:** ABSENT — count=0 (correct clean state for import)
- **HAM-S6-B1:** ABSENT — count=0 (correct clean state for import)
- **Existing HAM data:** NONE — 0 existing HAM mentor profiles, mentee profiles, and matches
- **Conflicts:** NONE — no HAM-S6% prefix seasons or batches found

---

## Schema Compatibility

- **Tables:** ALL 12 PRESENT — programs, seasons, intake_batches, people, mentor_profiles, mentee_profiles, matches, person_season_memberships, mentoring_recaps, events, admin_users, admin_scope_access
- **Columns:** **4 MISSING — SCHEMA BLOCKER**
  - `people.role` → FALSE
  - `matches.season_code` → FALSE
  - `mentee_profiles.status` → FALSE
  - `mentor_profiles.linkedin_url` → FALSE
  - All other 30 checked columns: PRESENT
- **Enums:** **2 MISSING — DERIVED FROM COLUMN BLOCKER**
  - `people.role = 'mentor'` → FALSE (column or enum type absent)
  - `people.role = 'mentee'` → FALSE (column or enum type absent)
  - `matches.status = 'active'` → TRUE
- **Constraints:** ALL 11 PRESENT — PKs, FKs for all required tables confirmed
- **Indexes:** ALL 4 PRESENT — people email index, profile person indexes, matches season index
- **Compatible:** **NO** — 4 column gaps and 2 enum gaps block all write modules

### Column gap impact on production modules

| Missing column | Table | Module that fails | INSERT column reference |
|---|---|---|---|
| `people.role` | people | 03_import_people.sql | `full_name, role, email_primary, ...` |
| `mentor_profiles.linkedin_url` | mentor_profiles | 04_import_profiles_memberships.sql | `... linkedin_url, intake_batch_id` |
| `mentee_profiles.status` | mentee_profiles | 04_import_profiles_memberships.sql | `person_id, status, mentee_code, ...` |
| `matches.season_code` | matches | 05_import_matches.sql | `mentor_id, mentee_id, season_code, season_id, ...` |

All 4 columns are referenced in INSERT column lists. Modules 03, 04, and 05 would all abort
with a column-not-found error if executed against the current production schema.

---

## Identity Review

- **Source people:** 112 import_ready rows (52 mentors + 60 mentees) — from staging analysis
- **Exact existing matches:** 0 — `people_with_ham_source_sheets = 0` and `people_with_ham_data_flags = 0`; no production people have HAM provenance
- **Shared-person candidates:** 0 — `dual_role_person_count = 0`; no existing people hold both mentor and mentee profiles
- **Ambiguous matches:** 32 — `ambiguous_name_count_in_people_table = 32` (names appearing more than once in production people); informational only since production modules use email-only resolution (name-key fallback disabled)
- **Conflicting matches:** 0 — `duplicate_email_count_in_people_table = 0` and `max_email_appearances = 1`; no duplicate emails in production people table
- **Duplicate source identities:** not yet verified (import not run)
- **Expected new people:** 104–108 (formula: 112 import_ready - 0 known exact matches = 112; expect 0–4 shared via email once import runs against live data)

---

## Expected Import (if schema blockers are resolved)

- **Seasons:** 1 insert (HAM-S6) — clean target confirmed
- **Batches:** 1 insert (HAM-S6-B1) — clean target confirmed
- **New people:** 104–108 (0 existing shared; up to 4 may resolve by email during live import)
- **Reused people:** 0–4 (dry-run: 2 safe matches; production will re-evaluate)
- **Mentor profiles:** 45–52
- **Mentee profiles:** 55–60
- **Matches:** 45–52
- **Updates:** NONE — no existing row updates
- **Deletes:** NONE

---

## UEH Isolation

- **UEH rows checked:** YES — UEHM-S11 and UEHM-S12 baseline recorded
- **UEH baseline (recorded for post-import comparison):**
  - `ueh_season_count`: 2
  - `ueh_match_count`: 638
  - `ueh_mentor_profile_count`: 2
  - `ueh_mentee_profile_count`: 1
- **Planned UEH mutations:** NONE — import does not touch UEH-linked rows
- **Cross-program risk:** LOW — no existing dual-role candidates; email-only resolution prevents cross-program identity merge

---

## Backup

- **Required:** YES — before any import execution
- **Tables:** people, seasons, intake_batches, mentor_profiles, mentee_profiles, matches, person_season_memberships (as documented in backup and rollback plan)
- **Shared-person protection:** 0 known shared-person candidates; rollback module preserves all people without `source_season=HAM_S6` provenance marker
- **Recovery risk:** LOW — clean state confirmed; no existing HAM data to conflict with

---

## Blockers

- **Blocking collisions:** NONE
- **Schema blockers:** 4 COLUMNS MISSING — import modules will fail at execution
  1. `people.role` — required by module 03 INSERT into `public.people`
  2. `mentor_profiles.linkedin_url` — required by module 04 INSERT into `public.mentor_profiles`
  3. `mentee_profiles.status` — required by module 04 INSERT into `public.mentee_profiles`
  4. `matches.season_code` — required by module 05 INSERT into `public.matches`
- **Data blockers:** NONE
- **Owner decisions required:**
  1. Resolve schema gaps before import can be authorized
  2. Choose resolution path (see below)

### Resolution paths

**Path A — Add missing columns via new migration(s)**
- Write and apply a new migration that adds the 4 missing columns to production
- This requires owner authorization for the migration
- Migration 061 is NOT authorized and does NOT cover these columns (it is unrelated)
- After migration runs, re-run this preflight — it should pass

**Path B — Update production design modules to omit missing columns**
- If the production schema intentionally excludes these columns, update modules 03, 04, 05
- `people.role`: if role is tracked only via profiles, omit from INSERT and revise identity resolution accordingly
- `mentor_profiles.linkedin_url`: omit from INSERT (optional metadata)
- `mentee_profiles.status`: omit from INSERT or use a default value if schema supports it
- `matches.season_code`: omit from INSERT if denormalization is not used in production
- After module updates, re-run this preflight against the updated modules

**Path A is recommended** if the production schema is expected to match staging (where all 4 columns exist).
**Path B is recommended** if the production schema diverged intentionally from staging and the columns are genuinely not needed.

---

## Safety

- **Production mutation:** NO — read-only preflight only; no data was modified
- **Import executed:** NO
- **Backup executed:** NO
- **Accounts created:** NO
- **Migration 061:** NOT AUTHORIZED (unrelated to these schema gaps)
- **HAM-S6 created:** NO
- **HAM-S6-B1 created:** NO
- **Authorization phrase honored:** AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT

---

## Preflight Gate Summary

| Gate | Result | Detail |
|---|---|---|
| Gate 1 — HAM program | PASS | count=1, is_active=true |
| Gate 2 — HAM-S6 absent | PASS | count=0 |
| Gate 3 — HAM-S6-B1 absent | PASS | count=0 |
| Gate 4 — No conflicting codes | PASS | 0 HAM-S6% seasons, 0 HAM-S6% batches |
| Gate 5 — Required tables | PASS | All 12 present |
| Gate 6 — Required columns | **FAIL** | 4 of 34 missing |
| Gate 7 — Required enums | **FAIL** | 2 of 3 missing (derived from Gate 6) |
| Gate 8 — Required constraints | PASS | All 11 present |
| Gate 9 — Required indexes | PASS | All 4 present |
| Gate 10 — Collision counts | PASS | 0 HAM data flags, 0 duplicate emails |
| Gate 11 — Shared candidates | PASS | 0 dual-role people |
| Gate 12 — Ambiguous candidates | INFORMATIONAL | 32 duplicate names (email-only resolution in use) |
| Gate 13 — Existing HAM data | PASS | 0 existing HAM mentor profiles, mentee profiles, matches |
| Gate 14 — UEH baseline | RECORDED | Seasons=2, Matches=638, Mentor profiles=2, Mentee profiles=1 |
| Gate 15 — Schema FK | PASS | seasons.program_id FK confirmed |
| **summary_pass** | **FALSE** | Gates 6 and 7 failed |

---

## Decision

**3. HAM-S6 PREFLIGHT BLOCKED BY SCHEMA**

The production database foundation is clean and ready (HAM program present, HAM-S6 absent,
no existing HAM data, no collisions, all tables and constraints present). However, 4 columns
referenced by the production import modules are absent from the production schema:

- `people.role`
- `mentor_profiles.linkedin_url`
- `mentee_profiles.status`
- `matches.season_code`

All 4 are referenced in INSERT column lists in modules 03, 04, and 05. Executing the import
without resolving these gaps would result in an immediate column-not-found error and automatic
transaction rollback in each affected module.

**Owner action required before import can be authorized:**
Choose Path A (add columns via migration) or Path B (update modules to omit the columns).
After resolution, re-run this preflight. If `summary_pass = true`, proceed to Gate B (owner review).

No import data was loaded. No production state was changed. This preflight can be re-run
after schema resolution without any cleanup.
