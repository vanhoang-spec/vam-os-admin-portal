# HAM-S6 Production Import Preflight V2 Result

## Target

- **Project:** vam-os-admin-portal
- **Ref:** qkkroesfiazsejkzflcd (production) — owner must independently verify in Supabase dashboard URL
- **Probe:** `HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_V2`
- **Read-only:** YES — single `WITH...SELECT` returning one JSONB row; no writes executed
- **Execution:** 2026-07-23T03:23:06.076Z (300ms)
- **Output valid:** YES — 1 row, 1 column (`jsonb_build_object`), JSONB parses without error
- **Output bytes:** 4617
- **Probe version confirmed:** `HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_V2`
- **Truncated:** NO
- **Schema alignment flag:** `V2 — canonical schema; legacy columns removed from column checks`

---

## Foundation State

- **HAM program:** EXISTS — count=1, `is_active=true` (Gate 1: PASS)
- **HAM-S6:** ABSENT — count=0 (Gate 2: PASS — clean target)
- **HAM-S6-B1:** ABSENT — count=0 (Gate 3: PASS — clean target)
- **Existing HAM data:** NONE — 0 existing HAM mentor profiles, mentee profiles, and matches (Gate 13: PASS)
- **Conflicts:** NONE — 0 HAM-S6% seasons, 0 HAM-S6% batches (Gate 4: PASS)

---

## Canonical Schema

- **Tables:** ALL 12 PRESENT (Gate 5: PASS)
  - programs, seasons, intake_batches, people, mentor_profiles, mentee_profiles, matches,
    person_season_memberships, mentoring_recaps, events, admin_users, admin_scope_access
- **Columns:** **1 MISSING — SCHEMA BLOCKER** (Gate 6: FAIL)
  - All 32 other canonical columns: PRESENT
  - `mentee_profiles.mentee_status` → **FALSE — ABSENT from production**
  - Note: The four columns removed in the previous schema alignment (`people.role`,
    `mentor_profiles.linkedin_url`, `mentee_profiles.status`, `matches.season_code`)
    are no longer checked and were correctly omitted.
- **Membership model:** FULLY SUPPORTED
  - `person_season_memberships.person_id`: PRESENT
  - `person_season_memberships.program_id`: PRESENT ✓ (new in V2 check)
  - `person_season_memberships.season_id`: PRESENT
  - `person_season_memberships.role`: PRESENT
  - `person_season_memberships.status`: PRESENT
- **Profile model — mentor:** COMPATIBLE — all required columns present
  - `mentor_profiles.person_id`: PRESENT
  - `mentor_profiles.mentor_code`: PRESENT
  - `mentor_profiles.intake_batch_id`: PRESENT
- **Profile model — mentee:** **INCOMPATIBLE**
  - `mentee_profiles.person_id`: PRESENT
  - `mentee_profiles.mentee_code`: PRESENT
  - `mentee_profiles.intake_batch_id`: PRESENT
  - `mentee_profiles.mentee_status`: **ABSENT** — module 04 currently writes this column
- **Match model:** COMPATIBLE — all required columns present
  - `matches.season_id`: PRESENT
  - `matches.mentor_person_id`: PRESENT
  - `matches.mentee_person_id`: PRESENT
  - `matches.status`: PRESENT
  - `matches.match_type`: PRESENT
  - (`matches.season_code` is no longer required — correctly removed)
- **Enums:** ALL 1 CHECKED PRESENT (Gate 7: PASS)
  - `matches.status = 'active'`: TRUE
  - (People.role enum checks removed in V2 — column absent)
- **Constraints:** ALL 11 PRESENT (Gate 8: PASS)
  - PKs, FKs for all required tables confirmed
- **Indexes:** ALL 4 PRESENT (Gate 9: PASS)
  - people email index, profile person indexes, matches season index
- **Legacy columns required:** NONE — no legacy columns are required by V2 modules
- **Compatible:** **NO** — 1 column gap blocks module 04

### Column gap impact on module 04

| Missing column | Table | Module that fails | INSERT column reference |
|---|---|---|---|
| `mentee_profiles.mentee_status` | mentee_profiles | 04_import_profiles_memberships.sql | `mentee_code, ..., mentee_status, intake_batch_id` |

Module 04 currently writes `mentee_status = 'active'` into `mentee_profiles`. This column
is absent from production. The INSERT will abort with a column-not-found error.

**Note on status columns:** Both `mentee_profiles.status` (removed in prior alignment) and
`mentee_profiles.mentee_status` (newly discovered) are absent from production. The canonical
lifecycle status for mentees is `person_season_memberships.status`, which is already written
by module 04 and is confirmed PRESENT. No status column exists on `mentee_profiles` in production.

---

## Identity Review

- **Source people:** 112 import_ready rows (52 mentors + 60 mentees) — from staging analysis
- **Exact reused people:** 0 — `people_with_ham_source_sheets = 0` and `people_with_ham_data_flags = 0`; no production people have HAM provenance
- **Shared-person candidates:** 0 — `dual_role_person_count = 0` (Gate 11: PASS)
- **Ambiguous candidates:** 32 — `ambiguous_name_count_in_people_table = 32` (names appearing more than once); informational only — production modules use email-only resolution (name-key fallback disabled)
- **Conflicting candidates:** 0 — `duplicate_email_count_in_people_table = 0`, `max_email_appearances = 1`; no duplicate emails (Gate 10: PASS)
- **Duplicate source identities:** not yet verified (import not run)
- **Expected new people:** 104–108 (formula: 112 import_ready - 0 known exact matches = 112; expect 0–4 shared via email once import runs against live data)

---

## Expected Import (if schema blocker is resolved)

- **Seasons:** 1 insert (HAM-S6)
- **Batches:** 1 insert (HAM-S6-B1)
- **New people:** 104–108
- **Reused people:** 0–4 (to be confirmed by live identity resolution)
- **Memberships:** 104–112 (one per resolved person per role; `ON CONFLICT DO NOTHING`)
- **Mentor profiles:** 45–52
- **Mentee profiles:** 55–60 (once `mentee_status` blocker is resolved)
- **Matches:** 45–52
- **Updates:** NONE
- **Deletes:** NONE

Ambiguous name-only records (32 people with duplicate names in production): these are
informational. Email-only resolution means they do not block import. No names are recorded here.

---

## UEH Isolation

- **UEH baseline recorded:** YES — UEHM-S11 and UEHM-S12 counted (Gate 14)
- **UEH baseline (current V2 run):**
  - `ueh_season_count`: 2
  - `ueh_match_count`: 638
  - `ueh_mentor_profile_count`: 2
  - `ueh_mentee_profile_count`: 1
- **Comparison to V1 preflight baseline (2026-07-23T02:48:46Z):**
  - seasons: 2 → 2 ✓ UNCHANGED
  - matches: 638 → 638 ✓ UNCHANGED
  - mentor profiles: 2 → 2 ✓ UNCHANGED
  - mentee profiles: 1 → 1 ✓ UNCHANGED
- **Planned UEH mutations:** NONE — import does not touch UEH-linked rows
- **Cross-program risk:** LOW — no existing dual-role candidates; email-only resolution

---

## Backup Readiness

- **Backup required:** YES — before any import execution
- **Tables:** people, seasons, intake_batches, mentor_profiles, mentee_profiles, matches,
  person_season_memberships (as documented in backup and rollback plan)
- **Shared-person protection:** 0 known shared-person candidates; rollback module preserves
  all people without `source_season=HAM_S6` provenance marker
- **Rollback readiness:** READY (module 07 present; deletion order FK-safe)
- **Status:** Backup not yet authorized or executed — Gate C blocked pending schema resolution

---

## Blockers

- **Schema blockers:** 1 COLUMN MISSING
  1. `mentee_profiles.mentee_status` — referenced in module 04's `mentee_profiles` INSERT;
     column absent from production schema. Neither `status` nor `mentee_status` exists
     on `mentee_profiles` in production. Lifecycle status is canonical in
     `person_season_memberships.status`.
- **Identity blockers:** NONE
- **Existing-data blockers:** NONE
- **Owner decisions required:**
  - Resolve `mentee_profiles.mentee_status` before import can be authorized
  - Choose: Path B (remove `mentee_status` from module 04 INSERT) is recommended since
    `person_season_memberships.status` already provides the canonical lifecycle field

### Resolution path

**Path B — Remove `mentee_status` from module 04's `mentee_profiles` INSERT**

Module 04 currently writes:
```sql
insert into public.mentee_profiles (
  person_id, mentee_code, school_raw, university,
  career_interest, target_industry, target_function,
  mentee_status,   ← REMOVE THIS
  intake_batch_id
)
select
  r.person_id,
  'HAM-S6-MENTEE-...',
  nullif(r.school, ''), nullif(r.school, ''),
  nullif(...), nullif(r.field, ''), nullif(r.expertise, ''),
  'active',          ← REMOVE THIS
  ...
```

After removal, mentee lifecycle status is tracked exclusively via
`person_season_memberships.status = 'active'` (already written by module 04).

After the module update, re-run the V2 preflight — it should then report `summary_pass = true`.

---

## Safety

- **Production mutation:** NO — read-only preflight only; no data was modified
- **Import executed:** NO
- **Backup executed:** NO
- **Accounts created:** NO
- **Migration 061:** NOT AUTHORIZED (unrelated to this schema gap)
- **HAM-S6 created:** NO
- **HAM-S6-B1 created:** NO
- **Authorization phrase honored:** `AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT V2`
- **Executor script:** Created in project root, deleted immediately after execution; not committed

---

## Preflight Gate Summary

| Gate | Result | Detail |
|---|---|---|
| Gate 1 — HAM program | PASS | count=1, is_active=true |
| Gate 2 — HAM-S6 absent | PASS | count=0 |
| Gate 3 — HAM-S6-B1 absent | PASS | count=0 |
| Gate 4 — No conflicting codes | PASS | 0 HAM-S6% seasons, 0 HAM-S6% batches |
| Gate 5 — Required tables | PASS | All 12 present |
| Gate 6 — Required columns | **FAIL** | 1 of 33 missing: `mentee_profiles.mentee_status` |
| Gate 7 — Required enums | PASS | matches.status=active present |
| Gate 8 — Required constraints | PASS | All 11 present |
| Gate 9 — Required indexes | PASS | All 4 present |
| Gate 10 — Collision counts | PASS | 0 HAM data flags, 0 duplicate emails |
| Gate 11 — Shared candidates | PASS | 0 dual-role people |
| Gate 12 — Ambiguous candidates | INFORMATIONAL | 32 duplicate names (email-only resolution in use) |
| Gate 13 — Existing HAM data | PASS | 0 HAM mentor/mentee profiles, 0 matches |
| Gate 14 — UEH baseline | RECORDED + UNCHANGED | seasons=2, matches=638, mentor=2, mentee=1 — matches V1 |
| Gate 15 — Schema FK | PASS | seasons.program_id FK confirmed |
| **summary_pass** | **FALSE** | Gate 6 failed — 1 column missing |

---

## Progress vs. V1

The V1 preflight (2026-07-23T02:48:46Z) had 4 schema blockers (Gates 6 and 7 both failed).
The V2 preflight has 1 remaining schema blocker (Gate 6 only):

| Column | V1 | V2 |
|---|---|---|
| `people.role` | BLOCKER | Removed from modules (no longer checked) |
| `mentor_profiles.linkedin_url` | BLOCKER | Removed from modules (no longer checked) |
| `mentee_profiles.status` | BLOCKER | Removed from modules (no longer checked) |
| `matches.season_code` | BLOCKER | Removed from modules (no longer checked) |
| `mentee_profiles.mentee_status` | Not checked | **NEW BLOCKER** |
| `person_season_memberships.program_id` | Not checked | PASS (present) |
| All other 27 canonical columns | Pass | PASS |

4 blockers resolved; 1 new blocker discovered.

---

## Decision

**2. HAM-S6 PREFLIGHT V2 BLOCKED BY SCHEMA**

The production foundation is clean and ready (HAM program present, HAM-S6 absent, zero
existing HAM data, zero identity collisions, all tables and constraints present, UEH
baseline unchanged from V1). The `person_season_memberships` table fully supports all
required columns including `program_id`. All prior schema blockers have been resolved.

However, one new column gap was discovered during V2 column checking:

- `mentee_profiles.mentee_status` — absent from production schema

This column is currently referenced in module 04's `mentee_profiles` INSERT
(`mentee_status = 'active'`). Executing module 04 without resolving this gap would cause
a column-not-found error and automatic transaction rollback.

**Resolution:** Remove `mentee_status` from module 04's `mentee_profiles` INSERT.
No information is lost — lifecycle status is fully captured in `person_season_memberships.status`.
After this one-column fix, re-run the V2 preflight.

**Owner action required before import can be authorized:**
Apply the one-column fix to module 04, then re-run
`HAM_S6_PRODUCTION_IMPORT_READONLY_PREFLIGHT.sql` (V2). If `summary_pass = true`, proceed to
Gate B (owner review).

No import data was loaded. No production state was changed. The V2 preflight can be re-run
after the module fix without any cleanup.
