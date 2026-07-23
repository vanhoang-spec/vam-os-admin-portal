# HAM-S6 Production Import — Preflight Runbook
## 2026-07-23

This runbook governs the owner-run, read-only preflight probe for the HAM-S6 production
foundation import. No mutation is performed in this runbook.

---

## Authorization

Exact authorization phrase (must be issued by owner before running the probe):

```
AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT
```

Do not run the probe without this authorization.

---

## Probe file

```
docs/audits/sql/HAM_S6_PRODUCTION_IMPORT_READONLY_PREFLIGHT.sql
```

---

## Pre-run checklist

Before opening the probe, the owner must independently confirm:

1. The browser URL in the Supabase dashboard contains the production project ref:
   `qkkroesfiazsejkzflcd`
2. The SQL editor is connected to the PRODUCTION project, not staging
   (`ljfneyuvpxrmejpxsmpz`)
3. The probe file has not been modified since this runbook was written
4. The probe contains no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, or DDL (`CREATE`,
   `DROP`, `ALTER`) statements — verify by searching the file for these keywords
5. The probe is a single `WITH ... SELECT` statement returning one row, one column

---

## Execution steps

1. **Open the Supabase dashboard** for production (`qkkroesfiazsejkzflcd`)
2. Navigate to **SQL Editor → New Query**
3. Paste the contents of `docs/audits/sql/HAM_S6_PRODUCTION_IMPORT_READONLY_PREFLIGHT.sql`
   unchanged
4. Run once
5. Save the single JSONB result to the approved secure review channel (do not add
   credentials, row-level exports, or personal data)

---

## Reading the result

The probe returns a single JSONB object. Each gate has a `pass` boolean.

### Required to pass before proceeding to import

| Gate | Key | Expected |
|---|---|---|
| HAM program exists exactly once | `gate_1_ham_program.pass` | `true` |
| HAM-S6 does not already exist | `gate_2_ham_s6_not_exist.pass` | `true` |
| HAM-S6-B1 does not already exist | `gate_3_ham_s6_b1_not_exist.pass` | `true` |
| No conflicting season/batch code | `gate_4_no_conflicting_codes.pass` | `true` |
| All required tables present | `gate_5_required_tables.all_required_tables_exist` | `true` |
| All required columns present | `gate_6_required_columns.all_required_columns_exist` | `true` |
| All required enum labels present | `gate_7_required_enums.all_required_enum_labels_exist` | `true` |
| All required constraints present | `gate_8_required_constraints.all_required_constraints_exist` | `true` |
| No existing HAM data (fresh import) | `gate_13_existing_ham_data.pass` | `true` |
| `summary_pass` | `summary_pass` | `true` |

### Informational (review but do not block on)

| Key | Meaning | Action if unexpected |
|---|---|---|
| `gate_10_collision_counts.people_with_ham_source_sheets` | Existing people with HAM provenance | If > 0, prior import attempted — escalate to owner |
| `gate_10_collision_counts.duplicate_email_count_in_people_table` | Duplicate emails already in production people table | Review before import; should be 0 |
| `gate_11_shared_person_candidates.dual_role_person_count` | People with both mentor and mentee profiles | Expected low; review if HAM-specific |
| `gate_14_ueh_baseline.*` | Snapshot of UEH counts before import | Record these — verify unchanged after import |
| `owner_must_verify_project_ref` | Always `true` — reminder to check project ref manually | Confirm before running |

---

## Failure handling

If any required gate does not pass, do **not** proceed to import. Actions:

| Failure | Investigation |
|---|---|
| `gate_1_ham_program.pass = false` | HAM program missing from production — verify migration 036 was applied |
| `gate_2_ham_s6_not_exist.pass = false` | HAM-S6 already exists — previous partial import? Review before proceeding |
| `gate_5_required_tables.all_required_tables_exist = false` | Check `table_existence_map` for which table is missing — may require migration |
| `gate_6_required_columns.all_required_columns_exist = false` | Schema drift — check production schema against column_existence_map |
| `gate_7_required_enums.all_required_enum_labels_exist = false` | Enum values missing — may require migration |
| `gate_13_existing_ham_data.pass = false` | HAM data already exists — do not import; investigate existing state |

---

## After probe completion

1. Save the full JSONB result with a timestamp
2. Record the UEH baseline counts from `gate_14_ueh_baseline` — these must be verified
   unchanged after the production import
3. Proceed to GATE B (Owner reviews preflight output) in the execution runbook
4. Do not proceed to import until all required gates pass

---

## What this probe does NOT check

- Supabase Auth table state
- Row-level security policies
- `admin_users` or `admin_scope_access` state
- Whether the source CSV files are available on the execution host
- Whether the psql CLI is connected to the correct database
- Content of CSV files (data is offline; probe validates schema only)
- Whether migration 061 has been applied

---

## Authorization phrase reminder

`AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 PRODUCTION IMPORT PREFLIGHT`

This phrase must be issued by the owner before the probe is run. Issuance of this phrase
does not authorize any write, any other probe, or any subsequent import step.
