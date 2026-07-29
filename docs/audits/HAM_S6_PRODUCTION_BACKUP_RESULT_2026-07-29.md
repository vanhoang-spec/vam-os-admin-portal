# HAM-S6 Production Backup Result

## Target

- **Environment:** PRODUCTION
- **Project:** vam-os-mvp
- **Ref:** qkkroesfiazsejkzflcd (production) — owner must independently verify in Supabase dashboard URL
- **Database:** postgres
- **Backup name:** `VAM_OS_PRODUCTION_PRE_HAM_S6_20260729_040703_UTC`
- **Backup directory:** `<local-machine>\Backups\VAM_OS_PRODUCTION_PRE_HAM_S6_20260729_040703_UTC\` (outside repo)
- **Authorization phrase:** `AUTHORIZE HAM-S6 PRODUCTION BACKUP`
- **Started UTC:** 2026-07-29T04:11:28.163Z
- **Completed UTC:** 2026-07-29T04:11:29.046Z
- **Duration:** 882ms
- **Files written:** 9 (8 table JSON exports + MANIFEST.json)
- **Read-only:** YES — SELECT queries only; no writes executed

---

## Backup Scope

The following 8 tables were exported in their entirety:

| Table | Rows | Bytes | SHA-256 |
|---|---|---|---|
| `programs` | 9 | 2,380 | `c6afc6cc51b20c50cd6b994bf1a375572196f864f0add23c5d97d2f2dbed7765` |
| `seasons` | 2 | 682 | `7ada2b535f5204da944629ccedc146090b05d12c64c24b1b0c3a062c5cf88bb4` |
| `intake_batches` | 1 | 311 | `858da444a905fe2471990db7832164d71c885bc2889510434ce8d12b51e7fe50` |
| `people` | 1,335 | 1,079,666 | `0fa2e2f200a5edbf642dcaa8ca9b81c539ddf3f018915c6b36dc0883edd3213f` |
| `person_season_memberships` | **0** | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `mentor_profiles` | 450 | 505,104 | `414e62ba10bfb7451774d795d8261a87c3d63ff94c4ba523f99490f8f2b19da7` |
| `mentee_profiles` | 656 | 483,984 | `f687f24d610f654a7038dc1fb21cfdaa4b859ce74b8f4ea21e045a07fc29f2b2` |
| `matches` | 638 | 556,619 | `97eb89ef8e6cea642b8b147e442f111b395da3d1a2b431e134e9a7ceff050760` |

**Total exported:** 2,628,748 bytes across 8 files.

Checksums computed as SHA-256 of UTF-8 JSON (`JSON.stringify(rows, null, 2)`). Verify with `sha256sum <file>.json` against the values above before any rollback.

---

## Pre-Backup Aggregate Snapshot

| Table | Rows | Latest updated_at |
|---|---|---|
| `people` | 1,335 | (recorded in MANIFEST.json) |
| `seasons` | 2 | (recorded in MANIFEST.json) |
| `intake_batches` | 1 | (recorded in MANIFEST.json) |
| `matches` | 638 | (recorded in MANIFEST.json) |
| `mentor_profiles` | 450 | (recorded in MANIFEST.json) |
| `mentee_profiles` | 656 | (recorded in MANIFEST.json) |
| `person_season_memberships` | 0 | — |
| `programs` | 9 | — |

Exact `latest_update` timestamps are stored in `MANIFEST.json` (outside repo) for rollback comparison.

---

## UEH Baseline — Confirmed Unchanged

| Metric | V1 preflight (2026-07-23T02:48:46Z) | V2 preflight (2026-07-23T03:23:06Z) | V3 preflight (2026-07-29T03:49:42Z) | Backup (2026-07-29T04:11:28Z) |
|---|---|---|---|---|
| `ueh_season_count` | 2 | 2 | 2 | 2 |
| `ueh_match_count` | 638 | 638 | 638 | 638 |
| `ueh_mentor_profile_count` | 2 | 2 | 2 | 2 |
| `ueh_mentee_profile_count` | 1 | 1 | 1 | 1 |

UEH baseline is UNCHANGED across all four measurement points (3 preflights + backup). No UEH mutation occurred between the preflight authorizations and this backup.

---

## HAM-S6 Baseline — Confirmed Clean

| Check | Value | Expected |
|---|---|---|
| `seasons` where `code = 'HAM-S6'` | 0 | 0 (clean target) |
| `intake_batches` where `code = 'HAM-S6-B1'` | 0 | 0 (clean target) |

HAM-S6 season and batch do not yet exist in production. The import will create them as the first operation in module 01.

---

## Notable Pre-Import Observation

**`person_season_memberships` has 0 rows in production.**

The table was confirmed PRESENT with all required columns by the V3 preflight (Gate 6 PASS), but it contains no rows prior to this import. The HAM-S6 import (module 04) will be the first to write into this table. This means:

- There is no risk of `ON CONFLICT DO NOTHING` silently swallowing HAM-S6 memberships due to pre-existing UEH memberships — none exist.
- The post-import `person_season_memberships` count should exactly equal the number of HAM-S6 people successfully imported (104–112 rows expected).
- Rollback (module 07) remains safe: it deletes HAM-S6-scoped membership rows by `season_id` FK; with 0 pre-existing rows, rollback returns the table to its current empty state without touching any UEH data.

This is informational — it does not block the import.

---

## Import Projection (Fail-Closed)

Based on V3 preflight, staging reference, and this backup snapshot:

| Object | Pre-import (production) | Expected post-import (production) | Source |
|---|---|---|---|
| `seasons` where `code = 'HAM-S6'` | 0 | 1 | Module 01 |
| `intake_batches` where `code = 'HAM-S6-B1'` | 0 | 1 | Module 02 |
| New `people` with HAM-S6 provenance | 0 | 104–108 | Module 03 |
| `person_season_memberships` for HAM-S6 | 0 | 104–112 | Module 04 |
| `mentor_profiles` for HAM-S6-B1 | 0 | 45–52 (staging: 49) | Module 04 |
| `mentee_profiles` for HAM-S6-B1 | 0 | 55–60 (staging: 58) | Module 04 |
| `matches` for HAM-S6 season | 0 | 45–52 (staging: 52) | Module 05 |
| UEH seasons / matches / profiles | 2 / 638 / 2 / 1 | UNCHANGED | No UEH writes |

**Fail-closed thresholds for post-import verification (Gate F / HAM_S6_POST_IMPORT_VERIFICATION_V3):**

| Check | Fail-closed condition |
|---|---|
| HAM-S6 season exists | count ≠ 1 → rollback |
| HAM-S6-B1 batch exists | count ≠ 1 → rollback |
| Matches with null FK | count > 0 → rollback |
| Duplicate matches | count > 0 → rollback |
| Active matches < 45 | below minimum → investigate |
| UEH match count ≠ 638 | deviation → rollback (UEH contamination) |
| UEH season count ≠ 2 | deviation → rollback (UEH contamination) |

---

## Backup Validation

- **File count:** 9/9 present (8 table files + MANIFEST.json) ✓
- **Zero-byte files:** 0 — `person_season_memberships.json` is 2 bytes (`[]`, valid empty JSON array) ✓
- **MANIFEST.json written:** YES ✓
- **Executor script deleted:** YES — `run_backup.mjs` removed from project root immediately after execution; not staged, not committed ✓
- **Credentials exposed:** NO — executor read password from `.env.prod.local` at runtime; no credential appears in this report or in MANIFEST.json ✓
- **PII in backup files:** YES (by design) — table exports contain full production rows; files are stored locally outside the repo and must not be committed or shared ✓

---

## Safety

- **Production mutation:** NO — SELECT queries only; no data was modified
- **Staging query:** NO
- **Staging mutation:** NO
- **Import executed:** NO
- **HAM-S6 created:** NO
- **HAM-S6-B1 created:** NO
- **Migration 061:** NOT EXECUTED
- **Admin account creation:** NO
- **Auth operation:** NO
- **Authorization phrase honored:** `AUTHORIZE HAM-S6 PRODUCTION BACKUP`
- **Executor script:** Created in project root, deleted immediately after execution; never staged or committed

---

## Decision

**2. HAM-S6 PRODUCTION BACKUP COMPLETE — READY FOR IMPORT AUTHORIZATION**

The pre-import backup is verified. All 8 protected tables exported with confirmed row counts and SHA-256 checksums. The UEH baseline is unchanged across all measurement points. The production target is clean (no HAM-S6 season, no HAM-S6-B1 batch, no existing HAM data). The `person_season_memberships` table is empty — the import will populate it for the first time, with no risk of pre-existing conflicts.

Rollback capability is confirmed: module 07 deletes HAM-S6-scoped rows in FK-safe order; the backup files provide the restoration baseline if needed.

**Next gate:** Owner issues `AUTHORIZE HAM-S6 PRODUCTION IMPORT` to proceed to Gate D (import execution).

Do not proceed to import without reviewing and confirming this backup report. The import must not begin without a separate import authorization.
