# HAM-S6 Production Import — Backup and Rollback
## 2026-07-23

---

## Before import: backup requirements

### Tables to snapshot

The owner must export or snapshot the following tables before any write begins:

| Table | Reason | Minimum aggregate check |
|---|---|---|
| `programs` | Foundation anchor table | Count all rows |
| `seasons` | Import will add 1 row | Count all rows |
| `intake_batches` | Import will add 1 row | Count all rows |
| `people` | Import will add ≥ 100 rows | Count all rows; count distinct emails |
| `person_season_memberships` | Import will add ≥ 100 rows | Count all rows |
| `mentor_profiles` | Import will add ≥ 45 rows | Count all rows |
| `mentee_profiles` | Import will add ≥ 55 rows | Count all rows |
| `matches` | Import will add ≥ 45 rows | Count all rows; count by status |

Tables that are read-only during import (must be unchanged after):
- `seasons` WHERE code IN ('UEHM-S11','UEHM-S12')
- `matches` WHERE season linked to UEHM
- All `mentor_profiles` / `mentee_profiles` linked to UEHM batches

### Aggregate counts (pre-import)

The owner must record the following aggregate counts from the preflight probe output
(`gate_14_ueh_baseline`) and from `01_preflight_assertions.sql` (Assertion 8):

```
ueh_seasons: __
ueh_matches: __
ueh_mentor_profiles: __
ueh_mentee_profiles: __
total_people: __
total_seasons: __
total_intake_batches: __
```

These values become the post-import comparison baseline for the UEH unchanged assertion.

### Checksum strategy

For critical tables, the owner should record:

```sql
-- Run before import (read-only)
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

Save the output before import. Verify after import that:
- Only `people`, `seasons`, `intake_batches`, `mentor_profiles`, `mentee_profiles`,
  `matches`, `person_season_memberships` row counts increased
- `seasons`, `matches`, `mentor_profiles`, `mentee_profiles` counts for UEHM are unchanged
- `max(updated_at)` for UEHM rows has not advanced

### Owner storage location

Backup outputs must be stored in the owner's approved secure channel (not in the
repository or a public location). Do not upload personal data or aggregate outputs
containing PII to any third-party service.

### Project ref confirmation

Before any backup is taken, the owner must confirm the Supabase project URL contains:
`qkkroesfiazsejkzflcd` (production)

### Import execution log

The owner should record:
- Authorization phrase issued and date/time
- Preflight probe run date/time and summary_pass result
- Backup completion date/time
- Module execution order and commit date/time for each
- Post-import verification date/time and result
- Any skips or deviations from the expected counts

---

## Rollback during transaction (automatic)

Each import module (02–05) runs inside a `BEGIN`/`COMMIT` block.

If any `DO $$ ... raise exception ...` block fires inside a transaction, PostgreSQL
automatically rolls back that transaction. No manual rollback action is needed.

The owner should verify after a failed module that:
```sql
select count(*) from public.seasons where code = 'HAM-S6';
-- Expected: 0 if module 02 rolled back; 1 if module 02 committed before module 03 failed
```

If module 02 committed but a later module failed, the owner may choose to:
1. Re-run the failed module (after fixing the root cause)
2. Perform a post-commit rollback using module 07

---

## Rollback after committed import

Module `07_rollback_design.sql` contains the rollback design. Before adapting it for
execution, the owner must:

1. Ensure a separate rollback authorization is issued
2. Verify the rollback design covers the correct scope
3. Run the rollback in a transaction
4. Verify post-rollback state

### Deletion order (FK-safe)

The following deletion order respects foreign key constraints:

1. `matches` (references `seasons.id` via `season_id`)
2. `person_season_memberships` (references `seasons.id`)
3. `mentor_profiles` (references `intake_batches.id`)
4. `mentee_profiles` (references `intake_batches.id`)
5. `people` where HAM-only (no other references)
6. `intake_batches` (references `seasons.id`)
7. `seasons` (HAM-S6 row)
8. DO NOT delete `programs` row for HAM

### Shared people preservation

The rollback script preserves any `people` row that:
- Has season memberships in seasons OTHER than HAM-S6 after step R4
- Has mentor/mentee profiles in batches OTHER than HAM-S6-B1 after steps R5/R6
- Was not created by this import (no `data_quality_flags` provenance marker)

The rollback deletes only people rows that were created by this import AND have no
other references remaining.

### Preservation of audit logs

`mentoring_recaps` rows (if recap import runs separately) are NOT deleted by the
foundation rollback. If a recap import preceded the rollback, it must be separately
rolled back first.

`admin_users` and `admin_scope_access` rows for HAM admins are NOT deleted by the
foundation rollback. Admin account removal requires a separate authorization.

### Restoration count verification

After rollback, the owner must verify:

```
seasons WHERE code = 'HAM-S6' → count = 0
intake_batches WHERE code = 'HAM-S6-B1' → count = 0
mentor_profiles linked to HAM-S6-B1 → count = 0
mentee_profiles linked to HAM-S6-B1 → count = 0
matches linked to HAM-S6 → count = 0
UEH matches → matches pre-rollback count (unchanged)
UEH mentor_profiles → unchanged
UEH mentee_profiles → unchanged
```

---

## What is NOT covered by this backup/rollback plan

| Item | Reason not covered |
|---|---|
| HAM admin accounts in Supabase Auth | Provisioned separately; require separate decision |
| `admin_scope_access` rows for HAM admins | Same as above |
| Production database Supabase point-in-time restore | Supabase PITR is available from the Supabase dashboard and is owned by the project owner |
| Recap import rows | Recap import is out of foundation scope and requires separate rollback |
| Row-level security policies | Not modified by this import |
| Supabase Auth state | Not modified by this import |
