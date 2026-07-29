# HAM-S6 Production Foundation Import — Owner Execution Runbook
## 2026-07-23

This runbook is the single authoritative sequence for the owner-run HAM-S6 production
foundation import. It governs all 8 gates from preflight to admin account provisioning.

**This runbook does not authorize any action.** Each gate has its own authorization phrase
that must be issued before that gate's actions are taken. Authorizing one gate does not
authorize any other.

---

## Absolute safety constraints

These constraints apply for the entire duration of this runbook:

- Do not execute SQL that is not explicitly listed in the relevant gate
- Do not run any module marked `PRODUCTION DESIGN ONLY — NOT AUTHORIZED — DO NOT EXECUTE`
  without first removing the guard block under a separate authorization decision
- Do not connect to staging (`ljfneyuvpxrmejpxsmpz`) during production steps
- Do not run migration 061 (it is not part of this import)
- Do not merge automatically
- Do not create admin accounts before Gate H
- Do not execute the rollback module without a separate rollback authorization

---

## Overview

| Gate | Name | Authorization phrase | Writes? |
|---|---|---|---|
| A | Preflight probe | `AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT` | No |
| B | Owner preflight review | (owner decision — no phrase) | No |
| C | Backup | `AUTHORIZE HAM-S6 PRODUCTION BACKUP` | No (snapshot only) |
| D | Foundation import authorization | `AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT` | No (authorization record only) |
| E | Import execution | `AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT` (same phrase) | YES |
| F | Post-import verification | `AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 POST-IMPORT VERIFICATION` | No |
| G | Visual verification | (owner decision — no phrase) | No |
| H | Admin account provisioning | `AUTHORIZE PRODUCTION HAM ADMIN ACCOUNTS` | YES |

No gate may be skipped. Gate B blocks Gate C; Gate C blocks Gate D; Gate D blocks Gate E;
Gate E blocks Gate F; Gate F blocks Gate G; Gate G blocks Gate H.

---

## GATE A — Preflight Probe

**Authorization phrase (must be issued before running):**

```
AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT
```

**Full procedure:** See `docs/audits/HAM_S6_PRODUCTION_IMPORT_PREFLIGHT_RUNBOOK_2026-07-23.md`

**Summary:**
1. Confirm the Supabase dashboard URL contains `qkkroesfiazsejkzflcd` (production)
2. Open SQL Editor → New Query
3. Paste `docs/audits/sql/HAM_S6_PRODUCTION_IMPORT_READONLY_PREFLIGHT.sql` unchanged
4. Run once
5. Save the JSONB result with a timestamp

**Gate A passes when:** `summary_pass = true` in the probe output (V3 probe) and all required
gates listed in the preflight runbook pass.

**On any gate failure:** do not proceed. Investigate the specific failing gate. Do not
attempt to work around a failing gate.

**Record before proceeding:**
```
gate_14_ueh_baseline.ueh_season_count:         __
gate_14_ueh_baseline.ueh_match_count:           __
gate_14_ueh_baseline.ueh_mentor_profile_count:  __
gate_14_ueh_baseline.ueh_mentee_profile_count:  __
total_people_in_people_table:                   __
total_seasons_before_import:                    __
```

---

## GATE B — Owner Preflight Review

No authorization phrase. Gate B is an owner decision checkpoint.

**Owner must review:**

1. Gate A preflight JSONB output — all required gates pass
2. Collision count keys:
   - `gate_10_collision_counts.people_with_ham_source_sheets` — expected 0
   - `gate_10_collision_counts.duplicate_email_count_in_people_table` — expected 0
   - `gate_11_shared_person_candidates.*` — review shared candidate counts
3. Confirm the import scope matches the manifest
   (`docs/audits/HAM_S6_PRODUCTION_IMPORT_MANIFEST_2026-07-23.md`)
4. Confirm the identity collision policy is understood
   (`docs/audits/HAM_S6_PRODUCTION_IDENTITY_COLLISION_POLICY_2026-07-23.md`)
5. Confirm manual-review rows (up to 4) have been resolved or will be skipped

**Owner must sign off with a written record:** "Gate A passed. I have reviewed the
preflight output. I approve proceeding to backup."

**Gate B passes when:** the owner has reviewed Gate A output and issued the written record.

---

## GATE C — Backup

**Authorization phrase (must be issued before any backup action):**

```
AUTHORIZE HAM-S6 PRODUCTION BACKUP
```

**Full procedure:** See `docs/audits/HAM_S6_PRODUCTION_IMPORT_BACKUP_AND_ROLLBACK_2026-07-23.md`

**Summary:**
1. Confirm Supabase dashboard URL contains `qkkroesfiazsejkzflcd`
2. Enable or verify Supabase Point-in-Time Recovery (PITR) is active for the project
3. Run the checksum query (below) in the production SQL editor and save the output

```sql
-- Run read-only before import (copy results to secure channel)
select
  'people'          as tbl, count(*) as rows, max(updated_at) as latest_update from public.people
union all
select 'seasons', count(*), max(updated_at) from public.seasons
union all
select 'matches', count(*), max(updated_at) from public.matches
union all
select 'mentor_profiles', count(*), max(updated_at) from public.mentor_profiles
union all
select 'mentee_profiles', count(*), max(updated_at) from public.mentee_profiles;
```

4. Record all aggregate counts from the Gate A UEH baseline
5. Store backup outputs in the approved secure channel — not in the repository

**Gate C passes when:** PITR is confirmed active AND checksum snapshot is saved.

---

## GATE D — Foundation Import Authorization (Decision Record)

**Authorization phrase (must be issued and recorded before Gate E begins):**

```
AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
```

Gate D is a decision gate — no SQL is run here. The owner issues the authorization
phrase as a written record (e.g., in the secure review channel with a timestamp).

The record must state:
- Authorization phrase issued
- Date and time
- Owner identity
- Gate A passed (summary_pass = true)
- Gate C (backup) completed
- Acknowledgment that Gate E will write data to the production database

**Gate D passes when:** the written authorization record exists with all fields above.

---

## GATE E — Import Execution

**Authorization phrase (same as Gate D — already issued in Gate D):**

```
AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT
```

**Execution environment requirements:**
- `psql` CLI connected to production: `postgresql://[connection string for qkkroesfiazsejkzflcd]`
- Source CSV files available on the execution host:
  - `ham_people_clean.csv` (132 rows including header)
  - `ham_matches_clean.csv` (60 import-ready rows)
- **Single session required:** ALL steps E1–E8 must run in the same uninterrupted psql session.
  Temp tables (`_ham_prod_identity_map`, `_ham_prod_ready`, `_ham_prod_context`) are
  session-scoped and are lost if the session ends between modules. If the session breaks
  after any module commits, use module 07 to roll back committed data before restarting.
- Do not run modules in parallel — run sequentially in order

### Pre-execution environment check

Before running any module, confirm:

```sql
-- In psql, run this read-only check:
select current_database(), inet_server_addr(), version();
```

Confirm the response matches the production Supabase project (`qkkroesfiazsejkzflcd`). If
it does not, stop immediately — do not proceed.

### Source CSV pre-load: people (before module 03)

Run the following in the same psql session, outside any transaction, before Step E4:

```sql
create temp table _ham_prod_people_source (
  source_file text, source_sheet text, row_num text, stt text,
  full_name text, role text, program text, season text,
  email text, phone text, gender text, dob text,
  school text, company text, title text, expertise text, field text,
  fb_profile text, linkedin text, vam_profile_link text,
  mentee_names_raw text, mentee_count_raw text,
  issue_flag text, issue_note text, import_ready text
);
```

```
\copy _ham_prod_people_source from 'data_imports/ham/ham_people_clean.csv' with (format csv, header true, encoding 'UTF8')
```

Expected: 132 rows loaded. Confirm with `select count(*) from _ham_prod_people_source;`

### Source CSV pre-load: matches (before module 05)

Run the following in the same psql session, outside any transaction, before Step E7:

```sql
create temp table _ham_prod_matches_source (
  source_file text, source_sheet text, row_num text, program text, season text,
  mentee_name text, mentee_email text, mentee_phone text, mentee_school text,
  mentor_name text, mentor_email text, direction text,
  match_status text, issue_flag text, issue_note text, import_ready text
);
```

```
\copy _ham_prod_matches_source from 'data_imports/ham/ham_matches_clean.csv' with (format csv, header true, encoding 'UTF8')
```

Expected: 60 rows loaded. Confirm with `select count(*) from _ham_prod_matches_source;`

### Module execution sequence

All modules are in `data_imports/ham/production_design_only/`. Before executing any
module, the production guard `DO $$ begin raise exception ... end; $$;` block must be
removed under the existing authorization (Gate D). Each module still contains
`-- PRODUCTION DESIGN ONLY` header comments for audit trail.

**Updated 2026-07-29:** Expected counts updated from ranges to exact values based on
production backup cross-reference (0 email collisions confirmed). Temp table names corrected
(`_ham_prod_people_source` and `_ham_prod_matches_source`). `ON COMMIT DROP` removed from
cross-module temp tables (`_ham_prod_identity_map`, `_ham_prod_ready`, `_ham_prod_context`).

| Step | Module | Action | Expected result |
|---|---|---|---|
| E1 | `01_preflight_assertions.sql` | Run — asserts pre-conditions | No exception raised; UEH baseline recorded |
| E2 | Pre-load people CSV | See "Source CSV pre-load: people" above | 132 rows loaded |
| E3 | `02_seed_program_season_batch.sql` | Run | HAM-S6 + HAM-S6-B1 inserted; post-insert assertion passes |
| E4 | `03_import_people.sql` | Run | **Exactly 112** new people created; identity map populated; 0 skips |
| E5 | Pre-load matches CSV | See "Source CSV pre-load: matches" above | 60 rows loaded |
| E6 | `04_import_profiles_memberships.sql` | Run | **Exactly 52** mentor profiles, **60** mentee profiles, **112** memberships |
| E7 | `05_import_matches.sql` | Run | **Exactly 58** matches inserted; **2** skipped (unresolvable mentor) |
| E8 | `06_post_import_assertions.sql` | Run | All assertions pass; JSONB summary returned |

**On any module raising an exception:**
- The transaction for that module automatically rolls back
- Stop immediately — do not run subsequent modules
- Record the error message verbatim
- Diagnose the root cause using the error and the module's DO $ assertion messages
- If a previous module committed (e.g., E3 committed but E4 failed), use the rollback
  design in module 07 under a separate rollback authorization

**On successful completion of all modules:**
- Save the Gate E execution log (module order, timestamps, row counts returned by E8)
- Proceed to Gate F

---

## GATE F — Post-Import Read-Only Verification

**Authorization phrase (must be issued before running the probe):**

```
AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 POST-IMPORT VERIFICATION
```

**Probe file (V3):**

```
docs/audits/sql/HAM_S6_PRODUCTION_POST_IMPORT_READONLY_VERIFICATION.sql
```

**Procedure:**
1. Confirm still connected to production (`qkkroesfiazsejkzflcd`)
2. Open SQL Editor → New Query
3. Paste the probe file unchanged
4. Run once
5. Save the JSONB result with a timestamp

**Required checks:**

| Key | Expected |
|---|---|
| `ham_program.pass` | `true` |
| `ham_s6_season.pass` | `true` |
| `ham_s6_b1_batch.pass` | `true` |
| `linkage_valid.ham_program_to_season_linked` | `true` |
| `linkage_valid.season_to_batch_linked` | `true` |
| `people_with_ham_provenance.count` | **112** |
| `people_with_ham_provenance.pass` | `true` |
| `mentor_profiles.count` | **52** |
| `mentor_profiles.pass` | `true` |
| `mentee_profiles.count` | **60** |
| `mentee_profiles.pass` | `true` |
| `ham_s6_memberships_exact.count` | **112** |
| `ham_s6_memberships_exact.pass` | `true` |
| `active_matches.count` | **58** |
| `active_matches.pass` | `true` |
| `null_fk_check.pass` | `true` |
| `duplicate_match_check.pass` | `true` |
| `summary_pass` | `true` |

*(Updated 2026-07-29: all counts are now exact fail-closed values, not ranges.)*

**UEH baseline check (compare to Gate A baseline):**

```
gate_14_ueh_baseline (Gate A):   ueh_seasons = __  ueh_matches = __
post-import ueh_baseline_after_import.ueh_season_count = __
post-import ueh_baseline_after_import.ueh_match_count  = __
```

Both must match Gate A values exactly. If they differ, stop and investigate
before proceeding.

**Gate F passes when:** `summary_pass = true` AND UEH baseline is unchanged.

---

## GATE G — Visual Verification

No authorization phrase. Gate G is an owner decision checkpoint using the application UI.

**Owner must verify in the production application:**

1. Log in to the production application as a super-admin
2. Navigate to the HAM program view — confirm HAM-S6 appears in the season list
3. Navigate to the HAM-S6 season — confirm the expected counts appear:
   - Mentors: **52** visible
   - Mentees: **60** visible
   - Active matches: **58**
   - Season memberships: **112** total (52 mentor + 60 mentee)
4. Confirm no UEHM-S11 or UEHM-S12 data has changed in the portal
5. Confirm no console errors or broken routes related to HAM-S6

*(Updated 2026-07-29: counts are now exact, not ranges.)*

**Gate G passes when:** the owner has visually confirmed HAM-S6 data is accessible and
correct in the production portal.

---

## GATE H — Admin Account Provisioning

**Authorization phrase (must be issued before any account action):**

```
AUTHORIZE PRODUCTION HAM ADMIN ACCOUNTS
```

**Full procedure:** See `docs/audits/HAM_S6_PRODUCTION_ADMIN_ACCOUNT_PLAN_2026-07-23.md`

**Summary:**
1. Confirm Gate F and Gate G both passed
2. Check existing production Auth users for HAM admin emails (Supabase dashboard →
   Authentication → Users)
3. Create or update Auth accounts via Supabase dashboard
4. Insert `admin_users` and `admin_scope_access` rows manually via SQL editor:

```sql
-- Template only — fill in actual values; do not embed passwords
insert into public.admin_users (auth_user_id, email, full_name, role, status)
values ('[uuid]', '[email]', '[name]', 'admin', 'active')
on conflict (email) do update
  set auth_user_id = excluded.auth_user_id,
      full_name    = excluded.full_name,
      role         = excluded.role,
      status       = excluded.status;

insert into public.admin_scope_access (user_id, program_id, season_id, role, status)
values ('[uuid]', 'HAM', 'HAM-S6', 'operations', 'active')
on conflict do nothing;
```

5. Run smoke tests as described in the admin account plan
6. Confirm HAM admins can access HAM-S6 data but cannot access UEHM routes

**Gate H passes when:** admin accounts are provisioned, smoke tests pass, and access
isolation is confirmed.

---

## Execution log template

Owner should complete this log as each gate is passed:

```
Runbook: HAM_S6_PRODUCTION_FOUNDATION_IMPORT_RUNBOOK_2026-07-23.md
Date:    ________________

GATE A — Preflight probe
  Authorization issued: ________________ (date/time)
  summary_pass:         ________________
  Completed:            ________________

GATE B — Owner review
  Reviewed by:          ________________
  Written record:       ________________
  Completed:            ________________

GATE C — Backup
  PITR confirmed:       ________________
  Checksum saved:       ________________
  Completed:            ________________

GATE D — Authorization record
  Authorization issued: ________________ (date/time)
  Owner identity:       ________________
  Completed:            ________________

GATE E — Execution
  E1 completed:         ________________
  E2 rows loaded:       ________________ (expected 132)
  E3 completed:         ________________
  E4 people created:    ________________ (expected exactly 112)
  E5 rows loaded:       ________________ (expected 60)
  E6 mentor profiles:   ________________ (expected exactly 52)
  E6 mentee profiles:   ________________ (expected exactly 60)
  E6 memberships:       ________________ (expected exactly 112)
  E7 matches inserted:  ________________ (expected exactly 58)
  E7 matches skipped:   ________________ (expected exactly 2)
  E8 summary_pass:      ________________
  Completed:            ________________

GATE F — Verification
  Authorization issued: ________________ (date/time)
  summary_pass:         ________________
  UEH baseline matches Gate A: ________________
  Completed:            ________________

GATE G — Visual
  HAM-S6 visible:       ________________
  Counts correct:       ________________
  UEH unchanged:        ________________
  Completed:            ________________

GATE H — Admin accounts
  Authorization issued: ________________ (date/time)
  Accounts provisioned: ________________
  Smoke tests pass:     ________________
  Completed:            ________________
```

---

## If anything goes wrong

| Scenario | Action |
|---|---|
| Module raises exception during E1–E8 | Transaction auto-rolls back. Stop. Record error. Diagnose. Do not proceed. |
| Module committed but later module failed | Use rollback design (module 07) under separate rollback authorization |
| Gate F fails (summary_pass = false) | Stop. Do not proceed to Gate G. Investigate failing keys. |
| UEH baseline changed | Stop. Do not proceed to Gate G. Investigate cross-program mutation. |
| Gate G visual mismatch | Stop. Run Gate F probe again. Compare to verify data integrity. |
| Gate H account smoke test fails | Revoke the provisioned accounts (set inactive). Investigate. |

---

## Authorization phrase reference

| Gate | Phrase |
|---|---|
| A | `AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT` |
| C | `AUTHORIZE HAM-S6 PRODUCTION BACKUP` |
| D + E | `AUTHORIZE PRODUCTION HAM-S6 FOUNDATION IMPORT` |
| F | `AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 POST-IMPORT VERIFICATION` |
| H | `AUTHORIZE PRODUCTION HAM ADMIN ACCOUNTS` |

No phrase implicitly authorizes any other gate. Authorizing Gate A does not authorize
any write action. Authorizing Gate D+E does not authorize Gate F or Gate H.
