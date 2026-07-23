# HAM-S6 Production Import — Manifest
## 2026-07-23

Expected row-level changes to the production database.
Counts marked with `≥` are minimum guarantees; exact counts depend on the number of
shared-person matches found during production preflight.

No database was queried. These are design-time expectations derived from source analysis
and staging results.

---

## Table-level manifest

| Table | Expected inserts | Expected updates | Expected deletes | Shared-row risk | Verification |
|---|---|---|---|---|---|
| `programs` | 0 (HAM row exists from migration 036) | 0 | 0 | None | Conflict-safe (do nothing) |
| `seasons` | 1 (HAM-S6) | 0 | 0 | None | Assertion in module 02 |
| `intake_batches` | 1 (HAM-S6-B1) | 0 | 0 | None | Assertion in module 02 |
| `people` | 106 − `shared_exact` new rows | 0 | 0 | **YES** — 0–2 shared people possible | Email-match guard; post-import aggregate |
| `person_roles` | 0 (if table exists; role is a column on `people`) | 0 | 0 | N/A | N/A |
| `person_season_memberships` | ≥ 108 (one per resolved person per role) | 0 | 0 | YES — shared people get new HAM-S6 membership rows | `ON CONFLICT DO NOTHING` |
| `mentor_profiles` | ≥ 45 (nominally 49 from staging, may vary by shared-person count) | 0 | 0 | LOW — shared people may already have UEHM mentor_profiles; HAM-S6-B1 profile is separate | Batch-scoped NOT EXISTS guard |
| `mentee_profiles` | ≥ 55 (nominally 58 from staging, may vary) | 0 | 0 | LOW | Batch-scoped NOT EXISTS guard |
| `matches` | ≥ 45 (nominally 52 from staging; varies by manual-review resolution) | 0 | 0 | LOW — match inserts are new rows scoped to HAM-S6 season_id | Pair-scoped NOT EXISTS guard |
| `admin_users` | **NOT INCLUDED** | 0 | 0 | N/A | Separate authorization |
| `admin_scope_access` | **NOT INCLUDED** | 0 | 0 | N/A | Separate authorization |
| `staging_ham_s6_people_identity_map` | **NOT INCLUDED** in production | N/A | N/A | N/A | Production uses temp table only |
| `staging_ham_s6_import_skips` | **NOT INCLUDED** in production | N/A | N/A | N/A | Production uses temp table only |
| `mentoring_recaps` | **NOT INCLUDED** (recap import is deferred) | 0 | 0 | N/A | Out of foundation scope |
| `events` | **NOT INCLUDED** | 0 | 0 | N/A | Out of foundation scope |

---

## Row categorization

### Guaranteed new rows (no production dependency)

| Row | Count |
|---|---|
| `seasons` row (HAM-S6) | 1 |
| `intake_batches` row (HAM-S6-B1) | 1 |

### Conditional inserts (depend on production identity resolution)

| Row | Expected range | Condition |
|---|---|---|
| `people` — new | 104–106 | 106 are new in source; fewer if production has email-matching people for 2–4 HAM participants |
| `people` — reused (linked, not inserted) | 2–4 | Staging found 2 safe matches; production may find 0–4 |
| `mentor_profiles` | 45–52 | Depends on how many mentor-role people resolve + whether they already have HAM-S6-B1 profiles |
| `mentee_profiles` | 55–60 | Same reasoning for mentee role |
| `matches` | 45–52 | Depends on resolution of manual-review people in match rows |
| `person_season_memberships` | 104–112 | One per resolved person; at least 108 in staging |

### Formulas

```
new_people    = 108_imported_in_staging - exact_existing_shared_people_in_production
               (exact_existing_shared_people_in_production is unknown until preflight)

mentor_profiles = min(52, new_people_with_mentor_role)
                  + shared_mentor_people_without_ham_s6_b1_profile

matches         = 60_source_pairs - unresolved_pairs
                  (staging: 60 - 8 = 52; production may differ slightly)
```

---

## Possible reused people

From identity resolution summary, 2 people in the staging run were matched to existing
people by email (1) and phone/name (1). In production:
- The email-matched person will be reused if their email exists in production `people` table
- The phone/name-matched person requires re-evaluation against production data
- Up to 4 additional manual-review rows may be resolved by the owner

**No personal values are reproduced here. The count ranges and conditions are documented
for the owner's preflight planning only.**

---

## Prohibited updates

The following updates must NEVER occur during this import:

| Field | Table | Reason |
|---|---|---|
| `full_name` | `people` | Existing identity must not be overwritten |
| `email_primary` | `people` | Primary identity key must not be modified |
| `phone_primary` | `people` | Secondary identifier must not be modified |
| `gender` | `people` | Identity field; not part of import scope |
| Any column | `seasons` where code = `UEHM-S11` or `UEHM-S12` | Cross-program mutation prohibited |
| Any column | `mentor_profiles` linked to UEHM seasons | Cross-program mutation prohibited |
| Any column | `mentee_profiles` linked to UEHM seasons | Cross-program mutation prohibited |
| Any column | `matches` linked to UEHM seasons | Cross-program mutation prohibited |

---

## Prohibited deletes

No `DELETE` statement runs during the foundation import. The rollback module (07) defines
deletion only for authorized post-import rollback scenarios.

---

## Import execution log tables (production temp only)

The production modules use session-scoped `TEMP` tables (not persistent) for:
- `_ham_prod_identity_map`: per-row identity resolution results
- `_ham_prod_import_skips`: skipped rows with reason codes
- `_ham_prod_match_skips`: skipped match rows
- `_ham_prod_context`: resolved HAM-S6/HAM-S6-B1 IDs

These tables exist only for the duration of the psql session and are automatically
dropped on disconnect. No PII is persisted to non-temp tables beyond what was already
in `people.email_primary` (existing rows) or newly inserted `people` rows.

---

## Summary comparison: staging vs. production expected

| Metric | Staging result | Production expected |
|---|---|---|
| People imported | 108 | 104–108 |
| Mentor profiles | 49 | 45–52 |
| Mentee profiles | 58 | 55–60 |
| Active matches | 52 | 45–52 |
| Skipped people | 4 | 4 (same manual-review cases) |
| Season memberships | Not tracked in staging | ≥ 104 |
