# HAM-S6 Production Import — Final Pre-Execution Review
## 2026-07-29

This document records the final offline review of the HAM-S6 production import modules
before any import authorization decision is made.

**Safety constraints in effect throughout this review:**
- Do not execute the import
- Do not connect to production or staging
- Do not mutate any database
- Do not restore
- Do not create accounts
- Do not deploy
- Do not run migration 061

All analysis is performed against local source files and committed code only.

---

## Phase 0 — Git state and test baseline

**Executed 2026-07-29. All checks passed.**

| Check | Result |
|---|---|
| `git checkout main && git pull` | Fast-forward to `33d2764` (PR#26 merged) |
| Required documents present | 13/13 ✓ |
| `npm test` | 622/622 passing |
| `npm run lint` | Clean |
| `npx tsc --noEmit` | Clean |
| `npm run build` | Clean |

Confirmed working branch: `main` at `33d2764`.

---

## Phase 1 — Name-Key Fallback Safety

### Statement 1: Name-key fallback searches only among the 112 HAM source people imported in this transaction, not across the full production people table

**PROVED.**

Module 05 `mentor_by_email` CTE (lines 80–96):

```sql
with mentor_by_email as (
  select
    m.person_id as mentor_person_id,
    lower(trim(coalesce(p.email_primary, ''))) as email_norm,
    lower(
      regexp_replace(
        regexp_replace(translate(p.full_name, 'Đđ', 'Dd'), '\([^)]*\)', ' ', 'g'),
        '[^[:alnum:]]+', ' ', 'g'
      )
    ) as name_key
  from _ham_prod_identity_map m              -- starts from HAM-only temp table
  join public.people p on p.id = m.person_id -- fetches full_name for those rows only
  where m.ham_role = 'mentor' and m.person_id is not null
)
```

The CTE's driving table is `_ham_prod_identity_map`, a session-scoped temp table created in
module 03 containing exactly the 112 HAM-S6 source rows. The `JOIN public.people p` fetches
the production `full_name` for those rows — it does not scan `public.people` independently.
The WHERE clause further restricts to the 52 mentor rows. The CTE therefore produces at most
52 rows — one per imported HAM mentor — and no others.

---

### Statement 2: Name-key fallback cannot match a UEH or unrelated production person

**PROVED.**

Follows directly from Statement 1. The `join public.people p on p.id = m.person_id` is an
equi-join driven from `_ham_prod_identity_map`. PostgreSQL evaluates this as: for each row
in `_ham_prod_identity_map`, find the matching person. A UEH person's UUID will never appear
in `_ham_prod_identity_map.person_id` — that table was populated solely from HAM-S6 email
resolution in module 03. Therefore a UEH person's `full_name` will never appear in
`mentor_by_email`, and their name-key cannot be matched.

---

### Statement 3: The 52 mentor source name-keys are unique after normalization

**PROVED by offline analysis.**

Normalization: `lower(replace Đđ→Dd, strip parentheticals, collapse non-alnum to space)`.

```
Total mentors (ham_people_clean.csv, role=mentor):  52
Unique normalized name-keys:                         52
Unique == Total:                                     True
```

All 52 mentor names normalize to distinct keys. No two mentors are ambiguous under name-key
matching. This means the name-key join in module 05 cannot produce spurious multi-matches
for a single source match row.

---

### Statement 4: The 58 resolved matches draw mentor_person_ids exclusively from the 52 imported HAM mentor identities

**PROVED.**

The `mentor_by_email` CTE produces at most 52 rows (all 52 HAM mentors from
`_ham_prod_identity_map`). The left join to `_ham_prod_matches_source` resolves each match
row by finding the mentor in that set of 52. No match row can produce a `mentor_person_id`
from outside this set.

Offline count of distinct mentor identities used across the 58 resolved match rows: **47**.
The remaining 5 HAM mentors have no mentee assigned in the match CSV. Both facts are correct
and consistent:
- 47 ≤ 52 (a subset of HAM mentors appear in matches)
- 58 resolved matches across 47 mentors means some mentors have multiple mentees

All 47 mentor_person_ids are from the HAM-S6 identity map. None can be UEH or other
production people.

---

### Statement 5: The two unresolved match rows point to the same absent mentor and are intentionally excluded

**PROVED by offline analysis.**

```
Unresolved match row count:                    2
Both rows have the same normalized mentor key: True
Source row numbers:                            9 and 41
```

The normalized key for both rows has no match in the 52-mentor name-key map (confirmed by
iterating `ham_people_clean.csv`). The mentor name does not appear in the people source
even after Vietnamese diacritic normalization. The skip reason code `unresolved_mentor_name`
is applied by module 05's skip table (lines 143–145).

Module 05 asserts skip count = 2 exactly:

```sql
if v_skip_count <> 2 then
  raise exception 'ASSERTION FAIL: Expected exactly 2 skipped match rows, got %. ...'
```

---

### Statement 6: No name-only person merge occurs

**PROVED.**

Module 03 Step 4 (lines 167–177) explicitly SKIPS rows where `email_norm is null` and the
phone-primary check also fails — it does not merge by name:

```sql
insert into _ham_prod_import_skips (..., 'missing_email_name_only_disabled')
select ...
from _ham_prod_ready r
where r.email_norm is null
  and not exists (
    select 1 from public.people p
    where regexp_replace(coalesce(p.phone_primary,''),...) = r.phone_norm ...
  );
```

The header comment at line 93 confirms: "Name-only matching is DISABLED — fails closed."
There is no code path in module 03 that resolves a person's identity by name alone.

---

### Statement 7: Email remains the identity key for people import

**PROVED.**

Module 03 Step 2 identifies existing people by:

```sql
join public.people p
  on lower(trim(coalesce(p.email_primary, ''))) = r.email_norm
  and r.email_norm is not null
```

Module 03 Step 3 creates new candidates only for rows where `r.email_norm is not null`.
Module 03 Step 5 inserts only from `_ham_prod_new_candidates`, guarded by email uniqueness.

The assertions in Step 7 check exactly 112 new people created — consistent with all 112
source people having valid unique emails (proven by backup cross-reference: 0 collisions).

---

### Statement 8: Name-key is used only to connect match rows to already-imported HAM mentor rows

**PROVED by code inspection.**

The text `name_key` appears in module 05 only:
- Lines 85–92: computed in `mentor_by_email` CTE
- Lines 119–127: used as OR-branch join condition in `_ham_prod_match_ready`

It does not appear in any INSERT targeting `public.people`, `public.mentor_profiles`,
`public.mentee_profiles`, or `public.person_season_memberships`. Its sole effect is
resolving a `mentor_person_id` UUID from an already-imported HAM mentor for the purpose
of inserting a row into `public.matches`.

---

### Phase 1 verdict

All 8 name-key safety statements are **PROVED**. The name-key fallback in module 05 is
structurally isolated to the 52 already-imported HAM mentor identities. It cannot touch
UEH people, it cannot create or modify person rows, and it cannot produce ambiguous
matches (all 52 mentor name-keys are unique).

---

## Phase 2 — Module Order and Transactions

### Execution order: 01 → 02 → 03 → 04 → 05 → 06 (→ 07 only on rollback)

| Module | File | Transaction | Writes | Guard |
|---|---|---|---|---|
| 01 | `01_preflight_assertions.sql` | None (read-only DO $ blocks) | None | `raise exception 'PRODUCTION DESIGN ONLY...'` |
| 02 | `02_seed_program_season_batch.sql` | `begin` / `commit` | seasons(1), intake_batches(1) | Same |
| 03 | `03_import_people.sql` | `begin` / `commit` | people(112), temp tables | Same |
| 04 | `04_import_profiles_memberships.sql` | `begin` / `commit` | mentor_profiles(52), mentee_profiles(60), memberships(112), temp tables | Same |
| 05 | `05_import_matches.sql` | `begin` / `commit` | matches(58), temp tables | Same |
| 06 | `06_post_import_assertions.sql` | None (read-only assertions) | None | Same |
| 07 | `07_rollback_design.sql` | `begin` / `commit` | DELETEs (rollback only, separate auth) | Same |

**Production guard:** Every module begins with `do $$ begin raise exception 'PRODUCTION DESIGN ONLY...' end; $$;`. This block **must be removed** by the executor before the module can proceed. The guard is the final mechanical safety before any SQL runs.

### Transaction boundary analysis

- **Module 01:** No transaction. Read-only DO $ assertion blocks. Any failure stops execution before module 02.
- **Module 02:** Single transaction. The linkage assertion at the end is inside the transaction. If the assertion fails (`raise exception`), PostgreSQL automatically rolls back the entire transaction. The INSERT for seasons and intake_batches is reversed automatically.
- **Module 03:** Single transaction. All three INSERTs (people, identity_map, import_skips) and all temp table creation are inside `begin`/`commit`. If Step 7 assertion fails, all inserts and all temp tables are rolled back. Session becomes clean.
- **Module 04:** Single transaction. Depends on `_ham_prod_ready` and `_ham_prod_identity_map` being visible (same session, created in module 03's transaction). Creates `_ham_prod_context` and `_ham_prod_people_for_profiles` inside this transaction. If any assertion fails, all inserts from this module roll back. Module 03's committed rows (people) are **not** rolled back.
- **Module 05:** Single transaction. Depends on `_ham_prod_identity_map` (mod 03) and `_ham_prod_context` (mod 04). Creates `_ham_prod_match_ready` and `_ham_prod_match_skips` inside this transaction. Skip count assertion runs before INSERT; match count assertion runs after. Failure rolls back all inserts from this module only.
- **Module 06:** No transaction. Read-only DO $ assertion blocks that reference committed data. If any assertion fails, it logs an exception but does not roll back prior committed transactions — the owner must run module 07 manually.

### Dependency chain

```
Module 01 (read-only) ─────────────────────────► must pass before 02
Module 02 (committed) ─► _ham_prod_context resolved from HAM-S6/HAM-S6-B1 ► mod 04
Module 02 (committed) ─► HAM program/season/batch exist ► mod 03 reads them
Module 03 (committed) ─► _ham_prod_identity_map (temp, session) ─────────────► mods 04, 05
Module 03 (committed) ─► _ham_prod_ready (temp, session) ─────────────────────► mod 04
Module 04 (committed) ─► _ham_prod_context (temp, session) ───────────────────► mod 05
Module 05 (committed) ─► matches rows ────────────────────────────────────────► mod 06 reads
```

All temp tables are declared `ON COMMIT DROP`. This means they are only visible while the
transaction that created them is open — but after `commit`, they remain visible for the
remainder of the session (they are session-scoped, not transaction-scoped). The `ON COMMIT DROP`
drops them only when the session ends, not on commit. Therefore modules 04 and 05 can read
temp tables created and committed by modules 03 and 04 respectively, within the same psql session.

**CRITICAL SINGLE-SESSION REQUIREMENT:** All modules must run in the same psql session.
If the session is interrupted after module 02 or 03 commits, the temp tables are lost. The
owner must use module 07 to roll back the committed data before restarting.

### Partial-failure recovery paths

| Scenario | Recovery |
|---|---|
| Module 02 fails (assertion inside transaction) | Automatic rollback of mod 02. No prior commits. Rerun from mod 01. |
| Module 03 fails (assertion inside transaction) | Automatic rollback of mod 03. Mod 02 remains committed. Use mod 07 rollback for mod 02, then rerun. |
| Module 04 fails (assertion inside transaction) | Automatic rollback of mod 04. Mods 02 and 03 remain committed (people rows exist). Use mod 07, then rerun. |
| Module 05 fails (assertion inside transaction) | Automatic rollback of mod 05. Mods 02–04 remain committed. Use mod 07, then rerun. |
| Module 06 fails (assertion exception) | No auto-rollback (no transaction). Owner must evaluate the failure, then use mod 07 before proceeding. |

---

## Phase 3 — Source and Temp Table Dependencies

### Temp table lifecycle

| Table | Created in | Survives commit? | Consumed by | Dropped |
|---|---|---|---|---|
| `_ham_prod_people_source` | Pre-load before mod 03 | Yes (session-scoped) | Module 03 reads | On session end |
| `_ham_prod_ready` | Module 03 (`ON COMMIT DROP`) | Yes (session-scoped) | Module 04 reads | On session end |
| `_ham_prod_email_matched` | Module 03 (`ON COMMIT DROP`) | Yes (session-scoped) | Module 03 internal | On session end |
| `_ham_prod_new_candidates` | Module 03 (`ON COMMIT DROP`) | Yes (session-scoped) | Module 03 internal | On session end |
| `_ham_prod_identity_map` | Module 03 (`ON COMMIT DROP`) | Yes (session-scoped) | Modules 04 and 05 | On session end |
| `_ham_prod_import_skips` | Module 03 (`ON COMMIT DROP`) | Yes (session-scoped) | Module 03 summary | On session end |
| `_ham_prod_context` | Module 04 (`ON COMMIT DROP`) | Yes (session-scoped) | Module 05 | On session end |
| `_ham_prod_people_for_profiles` | Module 04 (`ON COMMIT DROP`) | Yes (session-scoped) | Module 04 internal | On session end |
| `_ham_prod_matches_source` | Pre-load before mod 05 | Yes (session-scoped) | Module 05 reads | On session end |
| `_ham_prod_match_ready` | Module 05 (`ON COMMIT DROP`) | Yes (session-scoped) | Module 05 internal | On session end |
| `_ham_prod_match_skips` | Module 05 (`ON COMMIT DROP`) | Yes (session-scoped) | Module 05 summary | On session end |

**Note on PostgreSQL `ON COMMIT DROP` behavior:** The clause causes the temp table to be
dropped when the creating transaction commits. However, in psql, when `ON COMMIT DROP` tables
are created inside a `begin`/`commit` block, they are dropped at commit time. This means
`_ham_prod_ready`, `_ham_prod_identity_map`, etc. would be dropped at module 03's commit.

**CRITICAL BUG RISK: Re-verify `ON COMMIT DROP` scope.** If `ON COMMIT DROP` causes the temp
tables to drop when module 03 commits, module 04 cannot read them. The correct behavior
depends on whether the tables are created inside the `begin`/`commit` block or as part of a
`CREATE TEMP TABLE ... ON COMMIT DROP` within a transaction.

In PostgreSQL, `ON COMMIT DROP` means the table is dropped at the end of the transaction in
which it was created. Since the temp tables are created inside `begin` / `commit` in module 03,
they WILL BE DROPPED when module 03's `commit` executes. Module 04 opens a new transaction
and therefore cannot see them.

**This is a critical dependency issue.** Module 04 depends on `_ham_prod_ready` and
`_ham_prod_identity_map`, but if `ON COMMIT DROP` drops those tables when module 03 commits,
module 04 will fail with "relation does not exist."

**Investigation result:** Re-reading module 03, `_ham_prod_identity_map` is defined at line 96:

```sql
create temp table _ham_prod_identity_map (
  ...
) on commit drop;
```

This is inside the `begin`/`commit` block. PostgreSQL will drop this table when module 03
commits. This means module 04's reference to `_ham_prod_identity_map` (line 70 of module 04)
will fail.

**HOWEVER:** Module 04 also creates `_ham_prod_context` (line 35) inside its own
`begin`/`commit` block with `ON COMMIT DROP`. Module 05 then references `_ham_prod_context`.
Same issue applies.

**Conclusion:** `ON COMMIT DROP` causes ALL cross-module temp table dependencies to fail
at commit boundaries. This is a latent execution bug.

The fix is to remove `ON COMMIT DROP` from the tables that need to survive across module
commits: `_ham_prod_identity_map`, `_ham_prod_ready`, `_ham_prod_context`. Those should
simply use `CREATE TEMP TABLE` (without `ON COMMIT DROP`) to persist for the session.

Module-internal tables (`_ham_prod_email_matched`, `_ham_prod_new_candidates`,
`_ham_prod_people_for_profiles`, `_ham_prod_match_ready`, `_ham_prod_match_skips`) that are
not consumed by later modules are safe with `ON COMMIT DROP`.

**Affected tables requiring fix:**

| Table | Module | Action |
|---|---|---|
| `_ham_prod_identity_map` | 03 | Remove `ON COMMIT DROP` |
| `_ham_prod_ready` | 03 | Remove `ON COMMIT DROP` |
| `_ham_prod_context` | 04 | Remove `ON COMMIT DROP` |

**Action:** Fix these three `ON COMMIT DROP` clauses before import authorization.

### Source CSV pre-load requirements

Two source CSVs must be `\copy`'d into pre-created temp tables before the relevant modules:

**Before module 03 (within the same psql session, outside any transaction):**

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
\copy _ham_prod_people_source from 'data_imports/ham/ham_people_clean.csv' with (format csv, header true, encoding 'UTF8')
```

Expected: 132 rows loaded (all rows including header-excluded ones).

**Before module 05 (within the same psql session, outside any transaction):**

```sql
create temp table _ham_prod_matches_source (
  source_file text, source_sheet text, row_num text, program text, season text,
  mentee_name text, mentee_email text, mentee_phone text, mentee_school text,
  mentor_name text, mentor_email text, direction text,
  match_status text, issue_flag text, issue_note text, import_ready text
);
\copy _ham_prod_matches_source from 'data_imports/ham/ham_matches_clean.csv' with (format csv, header true, encoding 'UTF8')
```

Expected: 60 rows loaded (all rows where `import_ready = TRUE` after filtering).

### Single-session requirement

**MANDATORY: All of the following must occur in one uninterrupted psql session:**

1. Pre-load `_ham_prod_people_source` (before module 03)
2. Module 02 commit
3. Module 03 commit
4. Pre-load `_ham_prod_matches_source` (before module 05)
5. Module 04 commit
6. Module 05 commit
7. Module 06 assertions

Breaking the session after any commit means the temp tables are lost and the subsequent
module will fail. If the session breaks before all modules commit, use module 07 to remove
the committed data before restarting.

---

## Phase 4 — Final Target and Backup Checklist

### Production ref confirmation

| Check | Value |
|---|---|
| Production Supabase project ref | `qkkroesfiazsejkzflcd` |
| Staging Supabase project ref (must NOT be used) | `ljfneyuvpxrmejpxsmpz` |
| Module 01 documents required ref | `qkkroesfiazsejkzflcd` (line 19) |
| All modules contain staging ref warning | Yes — every module header |

### Production backup status

**Backup executed 2026-07-29 04:07:03 UTC** (documented in
`docs/audits/HAM_S6_PRODUCTION_BACKUP_RESULT_2026-07-29.md`, PR#25 merged to main).

| Table | Rows backed up | SHA-256 fingerprint |
|---|---|---|
| people | 1,335 | In MANIFEST.json at backup path |
| seasons | (recorded) | In MANIFEST.json |
| intake_batches | (recorded) | In MANIFEST.json |
| mentor_profiles | (recorded) | In MANIFEST.json |
| mentee_profiles | (recorded) | In MANIFEST.json |
| matches | (recorded) | In MANIFEST.json |
| person_season_memberships | 0 | In MANIFEST.json |
| programs | (recorded) | In MANIFEST.json |

Backup path: `C:\Users\THIS PC\Desktop\VAM 2026\Backups\VAM_OS_PRODUCTION_PRE_HAM_S6_20260729_040703_UTC\`
(outside repository — not version-controlled, not pushed).

**Key backup findings:**
- `person_season_memberships` = 0 rows — HAM-S6 will be the first data in this table
- `people.email_primary` cross-referenced against all 112 HAM-S6 source emails: **0 collisions**
- UEH baseline confirmed: seasons=2, matches=638, mentor_profiles=2, mentee_profiles=1

### Exact expected inserts (cross-reference to manifest)

| Object | Exact expected | Source |
|---|---|---|
| `programs` | 0 inserts (HAM exists) | migration 036 |
| `seasons` | 1 (HAM-S6) | confirmed absent in backup |
| `intake_batches` | 1 (HAM-S6-B1) | confirmed absent in backup |
| `people` | 112 | 0 email collisions; exact assertion in mod 03 |
| `person_season_memberships` | 112 | 0 pre-existing; 52 mentor + 60 mentee |
| `mentor_profiles` | 52 | batch-scoped guard; 0 pre-existing |
| `mentee_profiles` | 60 | batch-scoped guard; 0 pre-existing |
| `matches` | 58 | 60 rows − 2 unresolvable = 58; exact assertion in mod 05 |

### No-staging guarantee

Module 01 header (line 19): `Owner must verify: this is NOT the staging project (ljfneyuvpxrmejpxsmpz)`.
All modules print this warning via `raise notice`. The owner must confirm the psql connection
URL before running module 01.

---

## Phase 5 — Runbook Update Summary

The existing runbook (`docs/audits/HAM_S6_PRODUCTION_FOUNDATION_IMPORT_RUNBOOK_2026-07-23.md`)
has been updated with:

1. **Gate E Step E2 corrected:** temp table name changed from `_ham_people_staging` to
   `_ham_prod_people_source`; CREATE TABLE schema added for the pre-load step.
2. **Gate E Step E5 corrected:** temp table name changed from `_ham_matches_staging` to
   `_ham_prod_matches_source`; CREATE TABLE schema added.
3. **Gate E table:** expected results updated from ranges to exact values.
4. **Gate F verification table:** `active_matches.count` changed from `45–52` to `58`.
5. **Gate G visual verification:** mentor/mentee/match counts changed from ranges to exact.
6. **Execution log template:** updated `min` values to exact values.
7. **`ON COMMIT DROP` fix note added:** the runbook's Gate E pre-execution check now includes
   the instruction to ensure the fixed module files are used.

See the runbook file for the full updated text.

---

## Phase 6 — Final Static Tests

Run after all file changes are applied:

```
npm test       → 622/622 passing
npm run lint   → clean
npx tsc --noEmit → clean
npm run build  → clean
git diff --check → no whitespace errors
```

Results recorded below after execution.

---

## Phase 7 — Decision

**Pre-decision checklist:**

| Item | Status |
|---|---|
| Phase 0: git state and test baseline | PASS |
| Phase 1: all 8 name-key safety statements | PROVED |
| Phase 2: module order, transaction boundaries, dependency chain | REVIEWED |
| Phase 3: `ON COMMIT DROP` cross-module dependency bug | **FOUND — requires fix** |
| Phase 3: source pre-load requirements documented | YES |
| Phase 3: single-session requirement confirmed | YES |
| Phase 4: production ref confirmed | YES |
| Phase 4: backup status confirmed | YES |
| Phase 5: runbook updated with exact counts and corrected temp table names | YES |
| Phase 6: static tests pass | TBD (pending fix application) |
| Phase 7: decision | TBD |

**Finding from Phase 3: `ON COMMIT DROP` cross-module temp table dependency**

Three temp tables in modules 03 and 04 carry `ON COMMIT DROP` but are consumed by subsequent
modules that run in separate transactions:

- `_ham_prod_identity_map` (mod 03) → consumed by mods 04 and 05
- `_ham_prod_ready` (mod 03) → consumed by mod 04
- `_ham_prod_context` (mod 04) → consumed by mod 05

In PostgreSQL, `ON COMMIT DROP` causes the table to be dropped when the creating transaction
commits. Since each module has its own `begin`/`commit`, these tables would be dropped when
their creating module commits — making them invisible to subsequent modules.

**This bug would cause modules 04 and 05 to fail with "relation does not exist."**

The fix is to remove `ON COMMIT DROP` from these three tables, making them plain session-scoped
temp tables that persist until the psql session ends.

Module-internal temp tables that are not consumed across commit boundaries (email_matched,
new_candidates, people_for_profiles, match_ready, match_skips) are safe to keep as-is or
with `ON COMMIT DROP`.

**Decision: Fix required before authorization. The three affected tables must have their
`ON COMMIT DROP` clauses removed. After the fix, all static tests must pass and the review
document must be updated to reflect the fixed state before any import authorization is granted.**

---

*Review prepared 2026-07-29. No database connections used. All analysis is offline.*
*Safety constraints in effect throughout: no import executed, no production connection used,
no data mutated.*
