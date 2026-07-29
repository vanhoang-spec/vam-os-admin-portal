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
| `people` | 106 − `shared_exact` new rows | 0 | 0 | **YES** — 0–2 shared people possible | Email-match guard; post-import aggregate. **Note: `people.role` is absent from production schema — role is not written here** |
| `person_season_memberships` | ≥ 108 (one per resolved person per role) | 0 | 0 | YES — shared people get new HAM-S6 membership rows | `ON CONFLICT DO NOTHING`. `role` column is the canonical role store (`'mentor'`/`'mentee'`) |
| `mentor_profiles` | ≥ 45 (nominally 49 from staging, may vary by shared-person count) | 0 | 0 | LOW — shared people may already have UEHM mentor_profiles; HAM-S6-B1 profile is separate | Batch-scoped NOT EXISTS guard. **Note: `linkedin_url` is absent from production schema — URL preserved in `people.data_quality_flags`** |
| `mentee_profiles` | ≥ 55 (nominally 58 from staging, may vary) | 0 | 0 | LOW | Batch-scoped NOT EXISTS guard. **Note: `status` and `mentee_status` are both absent from production schema (confirmed by preflight V2) — lifecycle status exclusively in `person_season_memberships.status`** |
| `matches` | ≥ 45 (nominally 52 from staging; varies by manual-review resolution) | 0 | 0 | LOW — match inserts are new rows scoped to HAM-S6 season_id | Pair-scoped NOT EXISTS guard. **Note: `season_code` is absent from production schema — season linked via `season_id` FK only** |
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

---

## Final exact import projection

**Added 2026-07-29.** Derived from offline source analysis (`ham_people_clean.csv`,
`ham_matches_clean.csv`) cross-referenced against the production backup
(`VAM_OS_PRODUCTION_PRE_HAM_S6_20260729_040703_UTC`). No production connection used.

### Source reconciliation

| Category | Count | Explanation |
|---|---|---|
| Total source people | 112 | 52 mentors + 60 mentees |
| Mentor-only | 52 | import_ready=TRUE, role=mentor |
| Mentee-only | 60 | import_ready=TRUE, role=mentee |
| Dual-role | 0 | no person appears in both mentor and mentee rows |
| Excluded (issue_flag or not import_ready) | 0 | all 112 rows are import_ready=TRUE, issue_flag=FALSE |
| Missing email | 0 | all 112 rows have unique emails |
| Duplicate source emails | 0 | all 112 emails unique in source |
| Email collisions with production | 0 | confirmed by backup cross-reference (1335 prod people, 0 overlap) |

Reconciliation equation satisfied:
```
source_people (112) = mentor_only (52) + mentee_only (60) + dual_role (0) + excluded (0)
```

### Match source reconciliation

| Category | Count | Explanation |
|---|---|---|
| Total match rows | 60 | all import_ready=TRUE, no issue flags |
| mentor_email present | 0 | mentor_email is absent from all 60 match rows in source CSV |
| mentee_email present | 60 | all mentee endpoints resolve by email |
| Mentor resolvable by name-key | 58 | 52 unique mentor names; 58 of 60 match rows name-key resolves |
| Unresolvable mentor rows | 2 | both reference the same mentor name not present in people source |
| Duplicate mentor+mentee pairs | 0 | no pair appears twice |
| Valid match inserts | **58** | 60 − 2 unresolvable = 58 |

**Note on the 2 skipped match rows:** Both rows (source row 9 and row 41) reference the
same mentor name — one mentor with 2 assigned mentees. This name does not appear in
`ham_people_clean.csv` (even after Vietnamese diacritic normalization). These 2 rows
cannot be imported without source data correction. They are categorized as
`unresolved_mentor_name` in the production match skip log.

### Exact expected inserts

| Object | Exact expected inserts | Exact expected updates | Exact expected deletes | Assertion |
|---|---|---|---|---|
| `programs` | 0 | 0 | 0 | HAM exists; module 02 inserts only HAM-S6 |
| `seasons` | 1 (HAM-S6) | 0 | 0 | Exact — preflight confirmed HAM-S6 absent |
| `intake_batches` | 1 (HAM-S6-B1) | 0 | 0 | Exact — preflight confirmed HAM-S6-B1 absent |
| `people` | **112** | 0 | 0 | 0 email collisions with production backup; exact assertion in module 03 |
| `person_season_memberships` | **112** | 0 | 0 | 0 pre-existing rows; ON CONFLICT DO NOTHING; 52 mentor + 60 mentee |
| `mentor_profiles` | **52** | 0 | 0 | Batch-scoped guard; 0 pre-existing HAM-S6-B1 profiles |
| `mentee_profiles` | **60** | 0 | 0 | Batch-scoped guard; 0 pre-existing HAM-S6-B1 profiles |
| `matches` | **58** | 0 | 0 | Name-key resolution; 2 skipped (unresolvable mentor); 0 dup pairs |

All assertions are fail-closed (`<>` exact value). Any deviation aborts and rolls back.

### Module assertion status (after Phase 6 fixes)

| Module | Assertion type | Value | Status |
|---|---|---|---|
| 03 — people | Exact: map+skips=112 AND new_count=112 | 112 | Fixed |
| 04 — mentor profiles | Exact: count=52 | 52 | Fixed |
| 04 — mentee profiles | Exact: count=60 | 60 | Fixed |
| 04 — memberships | Exact: count=112 | 112 | Fixed (added) |
| 05 — matches | Exact: count=58 | 58 | Fixed (name-key fallback added) |
| 05 — skips | Exact: count=2 | 2 | Fixed (added) |
| 06 — mentor profiles | Exact: count=52 | 52 | Fixed |
| 06 — mentee profiles | Exact: count=60 | 60 | Fixed |
| 06 — memberships | Exact: count=112 | 112 | Fixed (added) |
| 06 — active matches | Exact: count=58 | 58 | Fixed |

### Why 112 people and not 104–108

The preflight V3 report estimated 104–108 new people because it could not verify email
collisions offline. The production backup (`people.json`, 1335 rows) was cross-referenced
offline against all 112 HAM-S6 source emails. The intersection is **0**. No HAM-S6 source
email matches any existing production person's `email_primary`. Therefore the exact count
is 112 — all new inserts, no reused people.

### Fail-closed thresholds for rollback trigger

If the post-import verification (`HAM_S6_POST_IMPORT_VERIFICATION_V3`) returns any of the
following, the owner must execute module 07 (rollback) before any further action:

- `people_with_ham_provenance.pass` = false (count ≠ 112)
- `mentor_profiles.pass` = false (count ≠ 52)
- `mentee_profiles.pass` = false (count ≠ 60)
- `ham_s6_memberships_exact.pass` = false (count ≠ 112)
- `active_matches.pass` = false (count ≠ 58)
- `null_fk_check.pass` = false (any null FK in matches)
- `duplicate_match_check.pass` = false (any duplicate pair)
- UEH baseline counts deviate from: seasons=2, matches=638, mentor=2, mentee=1
