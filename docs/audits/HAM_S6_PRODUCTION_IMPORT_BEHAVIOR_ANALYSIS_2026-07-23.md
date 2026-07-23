# HAM-S6 Production Import — Behavior Analysis
## 2026-07-23

Static analysis of all foundation import scripts. No execution. No database query.

**Schema alignment (2026-07-23):** Production modules were updated to remove 4 columns
absent from the production schema. See `HAM_S6_PRODUCTION_IMPORT_SCHEMA_ALIGNMENT_2026-07-23.md`
for the full canonical mapping. The "Summary of production-incompatible elements" table
below is updated to reflect these resolutions.

---

## Script-level summary

| Script | Insert tables | Update tables | Delete tables | Conflict behavior | Transaction | Idempotency | Guard |
|---|---|---|---|---|---|---|---|
| `ham_s6_01_seed_program_season.sql` | `programs`, `seasons`, `intake_batches` | None | None | `ON CONFLICT (code) DO NOTHING` for all three | `BEGIN`/`COMMIT` ✓ | Full (all three inserts are conflict-safe) | Post-insert DO $$ assertion |
| `ham_s6_02_import_people.sql` | `staging_ham_s6_people_identity_map` (CREATE), `staging_ham_s6_import_skips` (CREATE), `people` | `staging_ham_s6_people_identity_map` (ON CONFLICT DO UPDATE) | None | `ON CONFLICT DO NOTHING` for skips; `ON CONFLICT (source_row) DO UPDATE` for identity map | `BEGIN`/`COMMIT` ✓ | Partial — new people guarded by `WHERE NOT EXISTS (... email_primary ...)` and `email_norm IS NOT NULL`; null-email rows have no guard | None beyond STAGING ONLY header comment |
| `ham_s6_03_import_profiles_matches.sql` | `staging_ham_s6_import_skips`, `mentor_profiles`, `mentee_profiles`, `matches` | None | None | `ON CONFLICT DO NOTHING` for skips; `NOT EXISTS` guard for profiles; `NOT EXISTS` guard for matches | `BEGIN`/`COMMIT` ✓ | Full for profiles and matches on rerun; skips use conflict-safe upsert | DO $$ context assertion (raises exception if HAM-S6 missing) |
| `ham_s6_04_import_strict_recap_pilot_DRAFT.sql` | `staging_ham_s6_recap_pilot_audit` (CREATE), `mentoring_recaps` | None | None | `NOT EXISTS` guard on recap URL + date + participants | `BEGIN`/`COMMIT` ✓ | Full for recaps on rerun | DO $$ double assertion (context + match count = 52) |

---

## Program and season ID resolution

### Script 01

Inserts program with `code = 'HAM'`. If a `programs` row with `code = 'HAM'` already exists (it does, from migration 036), the insert does nothing. The subsequent season insert resolves `program_id` by:

```sql
select p.id from public.programs p where p.code = 'HAM'
```

No UUID is hardcoded. Resolution is by canonical code at runtime. The intake batch resolves `season_id` by:

```sql
select s.id from public.seasons s where s.code = 'HAM-S6'
```

All three insertions are fully code-based. No staging UUID is embedded.

### Script 03

Resolves all three IDs at runtime:

```sql
create temp table _ham_context as
select p.id as program_id, s.id as season_id, ib.id as intake_batch_id
from public.programs p
join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
where p.code = 'HAM' limit 1;
```

If `_ham_context` is empty, the DO $$ block raises an exception and aborts. This is a
positive safety guard.

**Conclusion: No staging UUID is embedded in any script. All IDs are resolved by canonical
code at runtime. This is production-compatible.**

---

## People matching method (script 02)

### Step 1 — Load and join CSV sources

Both `ham_people_clean.csv` and `ham_identity_resolution_dry_run.csv` are `\copy`-loaded
into temp tables. The join uses `source_file`, `source_sheet`, and `full_name` as composite
key. This is then filtered to `import_ready = TRUE`.

### Step 2 — Classify by dry-run match_status

| match_status | unsafe_auto_import | Action |
|---|---|---|
| `matched_existing_person` | `no` | Linked to existing person via `matched_person_ids` (staging UUID!) |
| `no_match_new_person_candidate` | `no` | New `people` row inserted |
| `manual_review` | `yes` | Logged to `staging_ham_s6_import_skips`; NOT imported |

**CRITICAL PRODUCTION ISSUE**: The `matched_existing_person` path reads
`matched_person_ids` from the dry-run CSV, which contains **staging UUIDs**. In production,
these UUIDs will not correspond to the correct production person rows. This path is broken
for production unless the dry-run is regenerated against production data.

### Step 3 — New person insert guard

```sql
where not exists (
  select 1 from public.people existing
  where lower(trim(coalesce(existing.email_primary, ''))) = c.email_norm
    and c.email_norm is not null
)
```

The guard prevents duplicate insertion for people with a non-null email. People with
`email_norm IS NULL` have **no deduplication guard** and could be inserted multiple times
on rerun if their email is missing.

---

## Profile and match matching method (script 03)

### People resolution

Script 03 joins `ham_people_clean.csv` to `staging_ham_s6_people_identity_map` on
`(full_name, role, lower(email))`. It only processes rows where `person_id IS NOT NULL`
in the identity map. This means:

1. The identity map must be populated (by script 02) before script 03 runs.
2. The 4 manual-review people will produce no profiles or matches.
3. The 2 existing-person links in staging **used staging UUIDs** from the dry-run CSV
   — the same issue as described above.

### Match resolution method

The match CTE uses:

```sql
left join mentor_lookup ml
  on (
    lower(nullif(trim(ms.mentor_email), '')) is not null
    and ml.email_norm = lower(nullif(trim(ms.mentor_email), ''))
  )
  or (
    lower(nullif(trim(ms.mentor_email), '')) is null
    and ml.name_key = …normalized name key…
  )
```

**Name-key fallback**: when `mentor_email` is null/empty in the matches CSV, resolution
falls back to a normalized name key. In the staging data, mentor email was absent for
some matches, requiring name-key resolution.

**Production risk**: If the production `people` table contains a person with the same
normalized name as a HAM mentor but a different identity, the name-key fallback would
create an incorrect match. This risk is low (HAM-sourced people are isolated) but not zero.

---

## Staging UUIDs — embedded or not

| Source | Staging UUIDs | Risk |
|---|---|---|
| `ham_s6_01_seed_program_season.sql` | None | Safe |
| `ham_s6_02_import_people.sql` (SQL only) | None embedded in SQL | Safe |
| `ham_identity_resolution_dry_run.csv` (`matched_person_ids` column) | **YES** — staging UUIDs for 2 existing-person matches | **PRODUCTION RISK** — must re-run identity resolution against production people table |
| `ham_s6_03_import_profiles_matches.sql` | None embedded | Safe (resolves via identity map at runtime) |

---

## Pre-existing person reuse

Script 02 was designed to reuse 2 existing staging people (one mentor, one mentee) who
were identified as safe matches by email or phone. In production, these 2 staging UUIDs
are invalid. The correct production behavior is:

1. Re-run identity resolution against production `people` table.
2. Classify any existing-person matches by email match (safe) or phone match (human review).
3. Reuse the production UUID (not the staging UUID) for those 2 matches.

---

## Multi-program participation safety

The import does NOT check whether a person already participates in UEH seasons. The
`people` table is shared across programs. A person who exists in both UEH and HAM will:
- Be reused (if identified by email) or
- Appear as a new person (if not identified by email)

The import does NOT update any existing person's identity fields (`full_name`,
`email_primary`, `phone_primary`, `gender`). It only inserts new people rows. Existing
people are linked by UUID without modification.

---

## Global cleanup behavior

No script performs any global `DELETE`, `TRUNCATE`, or `UPDATE` that could affect rows
outside the HAM-S6 scope. Every write is scoped to:
- The specific `source_row` (identity map)
- The specific HAM-S6 `season_id` (profiles and matches via `_ham_context`)
- New rows only (people with no existing email match)

---

## Partial failure risk

### Script 01 (with transaction)

If any of the three inserts fails, `ROLLBACK` fires automatically. The DO $$ assertion
after the inserts will also raise an exception (rolling back) if the season/batch linkage
is not established. Safe.

### Script 02 (with transaction)

The identity map and people inserts are inside a single transaction. A failure in any step
rolls back all changes. However:
- The staging helper tables (`staging_ham_s6_people_identity_map`,
  `staging_ham_s6_import_skips`) are created with `CREATE TABLE IF NOT EXISTS` outside
  the temp table scope, meaning they persist even if the transaction rolls back. These
  DDL statements run before `BEGIN` — actually, `BEGIN` is at line 16, before the
  `CREATE TABLE IF NOT EXISTS` statements. Wait — re-reading the script: `begin;` is at
  line 16, then `CREATE TABLE IF NOT EXISTS` are inside the transaction. DDL inside a
  transaction in PostgreSQL is transactional — the tables will be rolled back if the
  transaction fails.
- If the transaction commits but the process is killed mid-commit, partial person rows
  could exist. This is a standard PostgreSQL atomicity concern, not a script-specific
  weakness.

### Script 03 (with transaction)

All profile and match inserts are inside a single transaction. The DO $$ assertion fires
before any writes and will abort the transaction if HAM-S6 context is missing. Safe.

---

## Rerun behavior

| Script | Rerun safe | Notes |
|---|---|---|
| Script 01 | Yes — fully idempotent | `ON CONFLICT ... DO NOTHING` for all three rows |
| Script 02 | Mostly — new people safe; existing-link row updates identity map | `ON CONFLICT (source_row) DO UPDATE` overwrites existing map entries. People with null email could be re-inserted. |
| Script 03 | Yes — profiles and matches guarded by `NOT EXISTS` | Skip logs use `ON CONFLICT DO NOTHING` |

---

## Summary of production-incompatible elements

| Issue | Severity | Affected scripts | Mitigation in production modules |
|---|---|---|---|
| `\copy` command (psql CLI only) | BLOCKER | 02, 03, 04 | **RESOLVED** — Production modules use session-scoped TEMP tables; `\copy` appears only in documentation comments |
| Staging UUID in `matched_person_ids` | BLOCKER | 02 (reads dry-run CSV) | **RESOLVED** — Production modules use email-only identity resolution against live production `people` table; no staging UUIDs |
| `staging_ham_s6_people_identity_map` dependency | BLOCKER | 03 depends on 02 | **RESOLVED** — Production modules use `_ham_prod_identity_map` TEMP table (session-scoped, dropped on commit) |
| `people.role` column absent | BLOCKER | 03 | **RESOLVED (schema alignment 2026-07-23)** — `role` removed from `people` INSERT; canonical role tracked via `person_season_memberships.role` |
| `mentor_profiles.linkedin_url` column absent | BLOCKER | 04 | **RESOLVED (schema alignment 2026-07-23)** — `linkedin_url` removed from mentor INSERT; URL preserved in `people.data_quality_flags` |
| `mentee_profiles.status` column absent | BLOCKER | 04 | **RESOLVED (schema alignment 2026-07-23)** — `status` removed from mentee INSERT; lifecycle status in `person_season_memberships.status`; `mentee_status` column is populated |
| `matches.season_code` column absent | BLOCKER | 05 | **RESOLVED (schema alignment 2026-07-23)** — `season_code` removed from matches INSERT; season linked via canonical `season_id` FK |
| No production project ref check | HIGH | All | Owner must independently verify project ref in Supabase dashboard URL; preflight runbook documents this requirement |
| Name-key fallback in match resolution | MEDIUM | 03 | **RESOLVED** — Name-key fallback is EXPLICITLY DISABLED in module 05; fails closed on missing email |
| No source count assertion | MEDIUM | 02, 03 | **RESOLVED** — Source count assertions present in modules 03 (112 rows) and 05 (60 rows) |
| `notify pgrst` | LOW | 01, 02, 03 | Harmless in production; keep for schema reload; documented in module headers |
| Staging helper table PII columns | LOW | 02 | **RESOLVED** — Production identity map is a session-scoped TEMP table; no persistent PII table created |
