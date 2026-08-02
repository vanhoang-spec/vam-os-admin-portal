# VAM OS — V5 Schema Authority Decision Pack (2026-08-01)

Status: **STATIC PREPARATION ONLY. STAGING CATALOG CAPTURE NOT YET EXECUTED.**

This document was drafted during a Bash-free, database-connection-free autonomous phase.
No `psql`, shell, or database command of any kind ran while producing it. Every
staging-dependent value is marked `UNAVAILABLE` / `PENDING_CATALOG_CAPTURE` below —
nothing here should be read as a captured fact about the live database.

---

## 1. Purpose and Scope

Prepare the schema-authority decision pack that V5 Artifact 1 needs before its
prerequisite-object inventory can stop being string-only placeholders
(`docs/audits/VAM_OS_ACCOUNT_ADMIN_V5_SPEC.json` currently lists `"prerequisites"` as
eleven bare strings). This turn:

- completes the **prerequisite dependency inventory** from repository evidence alone;
- statically reviews the **capture SQL** that will (on separate human approval) pull
  read-only catalog metadata from staging;
- documents the **sanitizer architecture** that will screen that capture before anything
  touches disk;
- surfaces every conflict and gap **discoverable from repository evidence alone**, several
  of which turn out to be self-contained defects in migration 062 itself, independent of
  what staging will show.

This is not migration 062 preflight, not migration application, not rollback, not
post-apply verification, not an HTTP isolation test, and not a business-data audit.

---

## 2. Baseline Already Confirmed (earlier in this session, under human-approved Bash use)

| Item | Value |
|---|---|
| Repository | VAM_OS_Admin_Portal |
| Branch | `batch-account-admin-csv-rls-foundation` |
| HEAD | `611ff7228f3dedeffef7459630211a797ba1b5e6` |
| Index | empty |
| Dirty worktree | preserved, matches the pre-turn `git status` snapshot |
| env.json | absent (checked for existence only, never opened) |
| Blueprint docs | untouched |

Protected artifact SHA-256 hashes (computed once, under human-approved Bash use; **not
recomputed during this autonomous phase**, and not edited by it either):

| File | SHA-256 |
|---|---|
| `supabase_migrations/062_review_only_account_admin_rls_foundation.sql` | `1a366dc03cc4810fb53946bbe6a7c04e30828adecec51963ccd9c2d74ff96c58` |
| `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql` | `ab6dfb708a855da97466814d2ec770c40d61fc8985a6c24531f3c9185b53848a` |
| `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql` | `062d924dd688c419dc4a1c16ef2faa6ef0b209f825a5de8e827d3bbdd7f6ddbe` |
| `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql` | `5cff548d8df4a55dadf5742a537586ff444a760b32d9df7d5b737bb73764ac60` |

## 3. Sanitized Staging-Target Proof (from the prior, human-approved session phase)

- `STAGING_DATABASE_URL` present; contains approved ref `ljfneyuvpxrmejpxsmpz`; does not
  contain production ref `qkkroesfiazsejkzflcd`. Connection string never printed or persisted.
- Minimal read-only connection test result: `database=postgres`,
  `transaction_read_only=on`, `server_version=17.6`, `role_check=expected_role_shape`.
- No database command of any kind executed **during this autonomous phase**.

---

## 4. Package-Created vs. Prerequisite-Object Model

**The count of eight applies only to the V5 package-created tables**, all created fresh
by migration 062 itself:

| ID | Table |
|---|---|
| PKG-01 | `account_rls_package_state` |
| PKG-02 | `account_rls_package_manifest` |
| PKG-03 | `account_import_batches` |
| PKG-04 | `account_import_outcomes` |
| PKG-05 | `account_auth_reconciliation` |
| PKG-06 | `account_auth_operations` |
| PKG-07 | `account_person_auth_links` |
| PKG-08 | `account_import_previews` |

Alongside these, migration 062 creates **10 package functions** (`vam062_*`) and **5
package policies** (`vam062_*`) — 8 + 10 + 5 = 23 objects, matching the rollback script's
own expected manifest count of 23. None of these 23 objects exist in staging yet, because
migration 062 has not been applied (review-only). The capture SQL's `relations` section
probes for them defensively with `LEFT JOIN` so absence reads as evidence, not an error.

**Prerequisite objects are a separate inventory** (below) — pre-existing relations,
functions, and policies that migration 062 *depends on* but does not create. Artifact 1
ultimately needs both: the eight package-table specs (unaffected by this turn) **and** a
fully specified prerequisite-object inventory, replacing the current string-only
`"prerequisites"` array in the V5 spec JSON. This turn gathers/organizes that evidence;
it does not edit the V5 spec file.

---

## 5. Prerequisite Dependency Inventory (repository evidence)

| ID | Object | Classification | Key source |
|---|---|---|---|
| PREREQ-01 | `public.people` (table) | MISSING_REPOSITORY_EVIDENCE | no CREATE TABLE anywhere in `supabase_migrations/` |
| PREREQ-02 | `public.programs` (table) | REPO_AUTHORITATIVE_MATCH | migration 036 |
| PREREQ-03 | `public.seasons` (table) | MISSING_REPOSITORY_EVIDENCE | no CREATE TABLE anywhere in `supabase_migrations/` |
| PREREQ-04 | `public.intake_batches` (table) | REPO_AUTHORITATIVE_MATCH (table shape); see CONFLICT-02 for its FK guard | migration 036 |
| PREREQ-05 | `public.person_season_memberships` (table) | REPO_AUTHORITATIVE_MATCH (table/arbiter); see CONFLICT-03 for its lifecycle guard | migration 052 |
| PREREQ-06 | `public.person_season_membership_log` (table) | REPO_AUTHORITATIVE_MATCH | migration 052 |
| PREREQ-07 | `public.admin_users` (table) | REPO_AUTHORITATIVE_MATCH | migrations 017, 047 |
| PREREQ-08 | `public.admin_scope_access` (table) | CONFLICT (arbiter) | migrations 020, 026; see CONFLICT-01 |
| PREREQ-09 | `public.admin_audit_log` (table) | REPO_AUTHORITATIVE_MATCH (caveat CAVEAT-08) | migrations 024, 026 |
| PREREQ-10 | `public.current_admin_role()` | REPO_AUTHORITATIVE_MATCH (definition); RISK-04 on grant state | migrations 018, 020 |
| PREREQ-11 | `public.is_active_admin()` | REPO_AUTHORITATIVE_MATCH (definition + grants) | migrations 018, 020, 057 |
| PREREQ-12 | `auth` schema | NOT_REQUIRED_BY_PACKAGE (Supabase-managed) | migration 062 existence probe |
| PREREQ-13 | `gen_random_uuid()` | REPO_AUTHORITATIVE_MATCH | pgcrypto ext., migration 026 |
| PREREQ-14 | policy `admin_users.read_admin_users_super_admin_or_self` | REPO_AUTHORITATIVE_MATCH | migration 018 |
| PREREQ-15 | policy `admin_scope_access.read_admin_scope_access_self_or_super_admin` | REPO_AUTHORITATIVE_MATCH | migration 020 |
| PREREQ-16 | policy `admin_audit_log.read_admin_audit_log_super_admin_only` | MISSING_REPOSITORY_EVIDENCE | see MISSING-07 |
| PREREQ-17 | `admin_users` unique(email) arbiter | REPO_AUTHORITATIVE_MATCH | migration 017 |
| PREREQ-18 | `admin_scope_access` conflict arbiter | CONFLICT | see CONFLICT-01 |
| PREREQ-19 | `person_season_memberships` unique(person_id,season_id,role) arbiter | REPO_AUTHORITATIVE_MATCH | migration 052 |
| PREREQ-20 | FK `seasons.program_id -> programs.id` | MISSING_REPOSITORY_EVIDENCE | seasons has no authoritative DDL; migration 062 vs preflight disagree on ON DELETE |
| PREREQ-21 | FK `intake_batches.season_id -> seasons.id` | CONFLICT | see CONFLICT-02 |
| PREREQ-22 | FKs `person_season_memberships.{person_id,program_id,season_id}` | REPO_AUTHORITATIVE_MATCH (not independently checked by migration 062's own guard) | migration 052 |
| PREREQ-23 | `admin_users_status_check` | REPO_AUTHORITATIVE_MATCH | migration 017 |
| PREREQ-24 | `person_season_memberships.{role_check,status_check}` | CONFLICT | see CONFLICT-03 |
| PREREQ-25 | `admin_users_role_check` | REPO_AUTHORITATIVE_MATCH | migration 047 |
| PREREQ-26 | `admin_audit_log` FK validation state | CATALOG_EVIDENCE_ONLY | added `NOT VALID` in migration 026 (CAVEAT-08) |

---

## 6. Conflicts Found From Repository Evidence Alone (no staging access required)

These three are **deterministic defects in migration 062's own prerequisite guards**,
provable purely by reading the migration files. They would reproduce identically
regardless of what staging's catalog shows, because they are contradictions between
migration 062 and its own sibling repository files / earlier migrations.

### CONFLICT-01 — `admin_scope_access` ON CONFLICT arbiter does not exist (HIGH, blocking)

- Migration 062 line 28 requires a `pg_constraint` row (`contype='u'`) whose definition
  is exactly `UNIQUE (user_id, program_id, season_id)`.
- The repository-authoritative schema (migration 020, lines 63–70, unchanged through
  migration 026) defines only a **partial, expression-based unique index**:
  `admin_scope_access_unique_active_scope_idx` on
  `(user_id, coalesce(program_id,''), coalesce(season_id,''), role) WHERE status='active'`.
  A bare `CREATE UNIQUE INDEX` never registers a `pg_constraint` row at all.
- **Consequence:** migration 062's own guard at line 28 will find zero matching rows and
  raise `VAM062 admin_scope_access conflict target missing, altered, or ambiguous`,
  aborting before any table is created. Even if the guard were bypassed, the
  `on conflict(user_id,program_id,season_id)` clauses inside
  `vam062_admin_mutation_atomic` / `vam062_upsert_staff_account_atomic` /
  `vam062_import_participant_membership_atomic`-adjacent inserts (lines 57, 63, 69) would
  fail at runtime with "no unique or exclusion constraint matching the ON CONFLICT
  specification."
- **Decision required:** add a plain `UNIQUE (user_id, program_id, season_id)` constraint
  to the real schema, or rewrite migration 062 to target the real partial/expression
  arbiter, or redesign the upsert logic. This is an actionable repo-level fix, not a
  staging-evidence question.

### CONFLICT-02 — `intake_batches → seasons` FK guard string mismatch (HIGH, blocking)

- Migration 062 line 15 requires
  `pg_get_constraintdef(oid,true) = 'FOREIGN KEY (season_id) REFERENCES seasons(id)'`
  (no `ON DELETE` clause).
- Migration 036 line 231 actually defines
  `season_id uuid not null references public.seasons(id) on delete restrict`, which
  Postgres renders as
  `'FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT'`.
- These strings are never equal, so migration 062's guard will always raise
  `VAM062 batch-season relationship mismatch` against the real schema.
- Preflight (line 25) already expects the correct `... ON DELETE RESTRICT` string — it
  agrees with the real schema. **Migration 062 is the outlier and is internally
  inconsistent with its own sibling preflight file.**

### CONFLICT-03 — `person_season_memberships` combined lifecycle-constraint guard mismatch (HIGH, blocking)

- Migration 062 line 30 requires a **single** check constraint whose definition text
  contains `'mentor'` AND `'mentee'` AND `'invited'`.
- Migration 052 splits these into two separate constraints:
  `person_season_memberships_role_check` (contains `mentor`/`mentee`, not `invited`) and
  `person_season_memberships_status_check` (contains `invited`, not `mentor`/`mentee`).
- No single constraint satisfies all three substrings, so migration 062's guard will
  always raise `VAM062 membership lifecycle constraint mismatch` against the real schema.

**Net effect of CONFLICT-01/02/03: as currently written, migration 062 cannot
successfully execute against the schema its own sibling repository files describe.**
All three are fixable by editing migration 062's guard logic — but per this turn's
authorization, migration 062 is a protected, byte-for-byte file and was not touched.
These findings are handed off for explicit human decision.

---

## 7. Risk Pending Staging Capture (not yet a proven conflict)

### RISK-04 — `current_admin_role()` may still have default `anon` EXECUTE

Migration 057 explicitly revokes `EXECUTE` on `is_active_admin()` (and
`current_admin_context()`, `admin_can_access_season(text)`) from `anon`/`public` and
grants it to `authenticated`. **No tracked migration ever does the same for
`current_admin_role()`.** Postgres grants `EXECUTE` to `PUBLIC` by default on new
functions unless explicitly revoked. Migration 062 line 17 requires `anon` to *not* have
execute on `current_admin_role()`. Repository evidence cannot confirm or deny the current
grant state (an untracked manual revoke may exist). **This is exactly what the
`function_acl` capture section is for — first thing to check once staging capture runs.**

---

## 8. Missing Repository Evidence

- **MISSING-05** — `public.people` has no `CREATE TABLE` anywhere in `supabase_migrations/`
  (tracked history starts at `012_*`; whatever created `people` predates tracked history
  or happened out-of-band). Full column/constraint/index/RLS shape is unknown from repo
  alone.
- **MISSING-06** — `public.seasons` has no `CREATE TABLE` anywhere in
  `supabase_migrations/`. Its FK to `programs` is asserted with *different* `ON DELETE`
  expectations by migration 062 (implicitly none) and preflight (`ON DELETE RESTRICT`) —
  an internal repo-vs-repo disagreement about a table neither side actually defines.
- **MISSING-07** — the predecessor policy
  `admin_audit_log.read_admin_audit_log_super_admin_only`, which migration 062's
  tolerance-list references and which preflight's `expected_baseline` requires to already
  exist (hard PASS/FAIL dependency), is created by **no tracked migration**, and **no**
  tracked migration ever enables RLS on `admin_audit_log`. Whether it exists in staging —
  created out-of-band, matching the "production schema sync" pattern already seen for
  `admin_scope_access`/`admin_audit_log` in migration 026 — is unconfirmed.

## 9. Caveat

- **CAVEAT-08** — `admin_audit_log`'s two FKs to `admin_users`
  (`admin_audit_log_actor_admin_user_id_fkey`, `admin_audit_log_target_admin_user_id_fkey`)
  were added `NOT VALID` in migration 026, so Postgres never validated them against
  existing rows and does not enforce them retroactively. Whether they have since been
  validated is unknown from repo alone (the `constraints` capture section's
  `is_validated` field will resolve this).

---

## 10. Static SQL Compliance Review — `VAM_OS_V5_METADATA_EVIDENCE_CAPTURE.sql`

| Check | Result |
|---|---|
| Begins `BEGIN TRANSACTION READ ONLY` | Yes |
| `SET LOCAL statement_timeout` | `15s` (at the authorized maximum) |
| `SET LOCAL lock_timeout` | `3s` (at the authorized maximum) |
| Ends `ROLLBACK` | Yes |
| Catalog relations queried | `pg_class, pg_namespace, pg_attribute, pg_attrdef, pg_collation, pg_constraint, pg_index, pg_am, pg_proc, pg_language, pg_policies` |
| `information_schema` views queried | none (pure `pg_catalog`, which is within the authorized scope) |
| Catalog-rendering functions used | `pg_get_expr, pg_get_constraintdef, pg_get_indexdef, pg_get_functiondef, pg_get_function_identity_arguments, pg_get_function_arguments, pg_get_userbyid, aclexplode, acldefault, format_type, to_regnamespace, to_regprocedure, current_setting, current_database` |
| Application relations selected from | none — `people`, `admin_users`, etc. appear only as `relname = '...'` predicates against `pg_catalog` joins, never as a `FROM`/data source |
| Application functions/RPCs invoked | none — `current_admin_role`/`is_active_admin` definitions are retrieved via `pg_get_functiondef`, never called |
| `auth.users` accessed | no |
| DDL/DML present | no |
| Output framing | each of the 11 sections is emitted as one `jsonb_agg(row_to_json(...))` line behind a plain-text `---SECTION:<name>---` marker, so the sanitizer can stream-parse stdout without ever materializing raw output on disk |

Sections defined: `relations, columns, constraints, indexes, relation_acl, function_acl,
policies, rls_state, helper_functions, prerequisite_probe, session_context`.

SHA-256 of this file: **not computed during this Bash-free phase** (recorded as
`PENDING_HASH_COMPUTATION_AT_EXECUTION_TIME` in the evidence JSON, to avoid fabricating a
hash value).

---

## 11. Sanitizer Architecture (designed and locally dry-run tested; not executed against staging)

**Revision note (this turn):** a human review of the originally proposed workflow found
four blocking defects — (1) `PIPESTATUS` captured via two sequential assignments, where
the first read could be clobbered before the second; (2) no `trap` covering
`EXIT HUP INT TERM`; (3) capture and publication were two separate steps, so an
interruption between them could leave partial/orphaned state; (4) the sanitizer script
was outside the three files originally authorized for the unattended phase and needed
explicit provenance review before further reliance. All four are corrected below. The
sanitizer was rewritten from a two-intermediate-file design to a single-candidate design;
see §"FINAL HUMAN EXECUTION GATE" for the corrected pipeline and provenance details.

`scripts/vam_v5_metadata_evidence_sanitizer.mjs` reads psql's combined stdout+stderr from
stdin and:

1. Splits on `---SECTION:<name>---` markers to attribute each JSON line to its section.
2. Buffers the full stdin stream in memory and parses it only once, in the stream's `end`
   handler (not incremental per-chunk parsing — accurate characterization, not "true
   streaming"). `JSON.parse`s each data line (produced by `jsonb_agg(row_to_json(...))`);
   a line that fails to parse increments a `diagnosticLineCount` only — **no diagnostic
   line text, redacted or otherwise, is ever retained or written anywhere**, and the
   catch block never references the caught error object, so no fragment of a malformed
   line can leak via a thrown-error message.
3. Recursively scans every string value in every row against seven pattern classes:
   connection strings with embedded credentials, JWT-shaped tokens, AWS access keys, PEM
   private-key blocks, generic `password=`/`token=`/`secret=` assignments, bearer tokens,
   and email addresses.
4. On a match, replaces **only that field's value** with
   `{ manual_review_required: true, reason: "possible_secret_pattern_detected", pattern }`
   and tags the row with `_manual_review_required`, `_flagged_fields`, and
   `_object_identity` (built from whichever of `schema_name/rel_name/table_name/
   function_name/object_name/policy_name/constraint_name/index_name/column_name` are
   present) — never the original value.
5. Merges the sanitized sections into the **existing evidence-document template**
   (`docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json`, read-only),
   computes the capture SQL's own SHA-256 directly from the file (via `node:crypto`, not
   trusted from a caller-supplied string), embeds a `publicationValidation` block with
   per-check booleans and an `allPassed` flag, and writes **one complete candidate
   evidence JSON** via write-to-`.writing` then `renameSync` — never two repository-
   resident intermediate files requiring a later manual merge.
6. Never receives, stores, or forwards `STAGING_DATABASE_URL` / `PROD_DATABASE_URL` — it
   only ever sees psql's query output on stdin, plus the four non-secret CLI arguments
   (template path, candidate path, capture-SQL path, approved/excluded ref strings).
7. Exits `0` only if every embedded validation check passed; `1` if the candidate was
   written but a check failed (caller must not publish); `2` on a usage/fatal error
   before any output was produced (no candidate file written at all in that case).

### Sanitizer provenance

- Created in this session via the `Write` tool; **no prior git history** —
  `git log -- scripts/vam_v5_metadata_evidence_sanitizer.mjs` returns no commits, and
  `git ls-files` does not track it (confirmed `??` / untracked in `git status`).
- Current SHA-256 (post Phase-8 fix AND Round-2 Task 3 additions, computed via `sha256sum`,
  see §16 and §17 below): `c9d0f3d3473fdc95045b439fb88a6e49bb80d9b09e69feed4cbed92a35114494`
  (intermediate SHA-256, after the Phase-8 nested-flag-propagation fix but before the
  Round-2 Task 3 session-evidence checks: `eaf38ac7a841c1e2c55757748f22666b9db7ef6cd27e227c2de5c69e330276a3`;
  original SHA-256, before any fix: `6b198115cad05ba32cad97d391baa2de6864f0c578e83b31086cffde9e849a4e`)
- Syntax-checked locally with `node --check` (Node v24.14.1) — passes, no execution.
- Logic-checked with **fabricated, non-secret dummy stdin** (no database connection),
  re-run after the Phase 8 fix: a negative case that deliberately omitted the `indexes`
  section and embedded a fake email correctly produced `allPassed:false`, exit code `1`,
  and the fake email replaced with a `manual_review_required` marker (confirmed absent
  verbatim from the candidate via `grep`); a positive case with all 11 sections present
  and `transaction_read_only:"on"` correctly produced `allPassed:true`, exit code `0`,
  and a real 64-character SHA-256 computed from the actual capture SQL file; a third,
  new case (added this turn, see FINDING-A in §16) with a secret pattern embedded inside
  a **nested object** field value correctly produced `allPassed:false`, exit code `1`,
  and `flaggedSecretCandidateCount:1` at the top level — verifying the fix. All three
  dry-run candidate files were written only under the session scratchpad directory
  (outside the repository) and deleted immediately after inspection.
- Filesystem permissions: the script does not set an explicit file mode; written files
  inherit the process's umask. The pipeline in the execution gate below sets `umask 077`
  before any file is created, so candidate files end up owner-only (`0600`) by
  inheritance, not by an explicit mode the script hardcodes.

---

## FINAL HUMAN EXECUTION GATE

**Status: NOT EXECUTED. Superseded as of Round 3 (§18): the sole current execution
authority is the standalone file `scripts/vam_v5_metadata_capture_wrapper.sh`, not any
Bash block embedded in this document. Both the v1 and v2 pipelines below are retained
collapsed, explicitly marked SUPERSEDED / MUST NOT EXECUTE, for audit-trail continuity
only. No line in this section, and no line in the standalone file, has been run against
staging.**

### Record: capture SQL

- Path: `docs/audits/sql/design_only/VAM_OS_V5_METADATA_EVIDENCE_CAPTURE.sql`
- SHA-256: `b8315d1bb6d89ff482d20ccccc8e659f9f5ebd2f9f5b57dee092aa70dfac9c56`
- Unchanged in this remediation turn (no defect was found in the SQL itself; the four
  defects were all in the shell pipeline and the sanitizer). Re-verified this turn to
  still begin `BEGIN TRANSACTION READ ONLY`, still bound `statement_timeout` to `15s` and
  `lock_timeout` to `3s`, still end `ROLLBACK`, and still query only `pg_catalog` via
  catalog-rendering functions (no application table, no `information_schema` needed, no
  `auth.users`, no RPC, no DDL/DML) — see §10 above for the full compliance table.

### Record: sanitizer

- Path: `scripts/vam_v5_metadata_evidence_sanitizer.mjs`
- SHA-256: `c9d0f3d3473fdc95045b439fb88a6e49bb80d9b09e69feed4cbed92a35114494`
- Provenance, full behavior, and dry-run test results: see §11 above, §16 (Phase 8
  adversarial review), and §17 (Round-2 remediation) below.

### Record: final evidence document

- Path: `docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json`
- This is both the **template** the sanitizer reads (for static metadata already
  approved: repository baseline, protected-file hashes, prerequisite inventory,
  conflicts, etc.) and the **publication target** the pipeline atomically renames the
  validated candidate onto. It is never opened for writing directly by any step except
  the final `mv` — every step before that operates on a candidate file outside the repo.

### Temporary-path rules

- All candidate/temporary files live under a directory created by `mktemp -d` (the OS
  temporary directory), never under the repository.
- The candidate file itself is `$TMPDIR_CANDIDATE/candidate_evidence.json`, written by
  the sanitizer via `<candidate>.writing` + `renameSync` (so a mid-write crash cannot
  leave a half-written file at the candidate path either).
- `trap cleanup EXIT HUP INT TERM` is installed **before** `mktemp -d` runs, so every exit
  path — normal, error, or signal — removes the candidate, its `.writing` twin, and the
  temporary directory, unless publication has already succeeded (at which point the
  script clears its own reference to the candidate before the trap fires, so there is
  nothing left to clean up).
- The final `mv -f "$CANDIDATE" "$FINAL"` is a same-filesystem rename: both paths resolve
  to locations under the `C:` volume in this environment (repository under
  `C:\Users\THIS PC\Desktop\...`, OS temp under `C:\Users\THIS PC\AppData\Local\Temp\...`),
  which is the documented assumption that makes this rename atomic. If a future
  environment puts the OS temp directory on a different volume from the repository, this
  assumption must be re-verified before relying on `mv` for atomicity.
- No `_sanitized_sections.json`, `_capture_execution_log.json`, or any other raw/temp file
  is ever created inside the repository by this design.

### Record: protected-file hashes (unchanged, re-verified this turn)

| File | SHA-256 |
|---|---|
| `supabase_migrations/062_review_only_account_admin_rls_foundation.sql` | `1a366dc03cc4810fb53946bbe6a7c04e30828adecec51963ccd9c2d74ff96c58` |
| `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql` | `ab6dfb708a855da97466814d2ec770c40d61fc8985a6c24531f3c9185b53848a` |
| `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql` | `062d924dd688c419dc4a1c16ef2faa6ef0b209f825a5de8e827d3bbdd7f6ddbe` |
| `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql` | `5cff548d8df4a55dadf5742a537586ff444a760b32d9df7d5b737bb73764ac60` |

**Migration 062 remains blocked and unapplied.** Executing the pipeline below performs a
read-only catalog capture only; it does not fix, remediate, or apply migration 062, and
does not authorize doing so.

### ⚠ SUPERSEDED — v1 pipeline (audit trail only; MUST NOT be executed)

**This v1 pipeline is superseded by the v2 pipeline below. It is retained verbatim only
for audit-trail continuity. Do not run it. Its `-d "$STAGING_DATABASE_URL"` line is
exactly FINDING-B: the full connection URI, including embedded credentials, would appear
in this process's command-line arguments for its entire lifetime, visible to anything on
the host that can enumerate process argv.**

<details>
<summary>v1 pipeline (superseded, click to expand — do not execute)</summary>

```bash
#!/usr/bin/env bash
set -u
set -o pipefail
umask 077

export PGSSLMODE=require
export PGCONNECT_TIMEOUT=10

PSQL="/c/Program Files/PostgreSQL/17/bin/psql.exe"
BASE="/c/Users/THIS PC/Desktop/VAM 2026/VAM_OS_Admin_Portal"
SQLFILE="$BASE/docs/audits/sql/design_only/VAM_OS_V5_METADATA_EVIDENCE_CAPTURE.sql"
SANITIZER="$BASE/scripts/vam_v5_metadata_evidence_sanitizer.mjs"
TEMPLATE="$BASE/docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json"
FINAL="$BASE/docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json"
APPROVED_REF="ljfneyuvpxrmejpxsmpz"
EXCLUDED_PROD_REF="qkkroesfiazsejkzflcd"

TMPDIR_CANDIDATE=""
CANDIDATE=""

cleanup() {
  local ec=$?
  if [ -n "$CANDIDATE" ] && [ -f "$CANDIDATE" ]; then
    rm -f "$CANDIDATE" "$CANDIDATE.writing"
  fi
  if [ -n "$TMPDIR_CANDIDATE" ] && [ -d "$TMPDIR_CANDIDATE" ]; then
    rm -rf "$TMPDIR_CANDIDATE"
  fi
  exit "$ec"
}
trap cleanup EXIT HUP INT TERM

TMPDIR_CANDIDATE="$(mktemp -d)"
CANDIDATE="$TMPDIR_CANDIDATE/candidate_evidence.json"

"$PSQL" -X -q -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f "$SQLFILE" 2>&1 \
  | node "$SANITIZER" "$TEMPLATE" "$CANDIDATE" "$SQLFILE" "$APPROVED_REF" "$EXCLUDED_PROD_REF"

PIPE_CODES=("${PIPESTATUS[@]}")
PSQL_EXIT="${PIPE_CODES[0]:-999}"
NODE_EXIT="${PIPE_CODES[1]:-999}"

if [ "$PSQL_EXIT" != "0" ] || [ "$NODE_EXIT" != "0" ]; then
  echo "CAPTURE_FAILED psql_exit=$PSQL_EXIT node_exit=$NODE_EXIT"
  exit 1
fi

if [ ! -s "$CANDIDATE" ]; then
  echo "CAPTURE_FAILED reason=candidate_missing_or_empty"
  exit 1
fi

if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$CANDIDATE"; then
  echo "CAPTURE_FAILED reason=candidate_not_valid_json"
  exit 1
fi

ALLPASSED="$(node -e "
  const c = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
  console.log(c.publicationValidation && c.publicationValidation.allPassed === true);
" "$CANDIDATE")"

if [ "$ALLPASSED" != "true" ]; then
  echo "CAPTURE_FAILED reason=validation_failed"
  exit 1
fi

if ! mv -f "$CANDIDATE" "$FINAL"; then
  echo "CAPTURE_FAILED reason=publish_rename_failed"
  exit 1
fi

CANDIDATE=""
echo "CAPTURE_OK"
exit 0
```

v1's four-blocking-defect fixes (PIPESTATUS race, missing trap, split capture/publish,
sanitizer provenance) and its own local validation record remain true of v1 in isolation,
but v1 itself must not be run — use v2 below.

</details>

### ⚠ SUPERSEDED — v2 pipeline (audit trail only; MUST NOT be executed; superseded by the standalone wrapper file — see §18)

**v2 is superseded by `scripts/vam_v5_metadata_capture_wrapper.sh` (§18 below). It is
retained here only for audit-trail continuity — it documents FINDING-B/D closure but
predates the hash-pinning, checked/same-filesystem temp-directory creation, and
signal-safe (EXIT vs HUP/INT/TERM) cleanup added in the standalone file. Do not run it.**

<details>
<summary>v2 pipeline (superseded, click to expand — do not execute)</summary>

```bash
#!/usr/bin/env bash
set -u
set -o pipefail
set +x
umask 077

export PGSSLMODE=require
export PGCONNECT_TIMEOUT=10

PSQL="/c/Program Files/PostgreSQL/17/bin/psql.exe"
BASE="/c/Users/THIS PC/Desktop/VAM 2026/VAM_OS_Admin_Portal"
SQLFILE="$BASE/docs/audits/sql/design_only/VAM_OS_V5_METADATA_EVIDENCE_CAPTURE.sql"
SANITIZER="$BASE/scripts/vam_v5_metadata_evidence_sanitizer.mjs"
TEMPLATE="$BASE/docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json"
FINAL="$BASE/docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json"
APPROVED_REF="ljfneyuvpxrmejpxsmpz"
EXCLUDED_PROD_REF="qkkroesfiazsejkzflcd"

TMPDIR_CANDIDATE=""
CANDIDATE=""

cleanup() {
  local ec=$?
  if [ -n "$CANDIDATE" ] && [ -f "$CANDIDATE" ]; then
    rm -f "$CANDIDATE" "$CANDIDATE.writing"
  fi
  if [ -n "$TMPDIR_CANDIDATE" ] && [ -d "$TMPDIR_CANDIDATE" ]; then
    rm -rf "$TMPDIR_CANDIDATE"
  fi
  exit "$ec"
}
trap cleanup EXIT HUP INT TERM

STAGING_VAR_PRESENT=false
POSTGRES_URI_SHAPE=false
APPROVED_STAGING_REF_PRESENT=false
PRODUCTION_REF_ABSENT=false

if [ -n "${STAGING_DATABASE_URL:-}" ]; then
  STAGING_VAR_PRESENT=true
fi

if [ "$STAGING_VAR_PRESENT" = true ]; then
  case "$STAGING_DATABASE_URL" in
    postgres://*|postgresql://*) POSTGRES_URI_SHAPE=true ;;
  esac
  case "$STAGING_DATABASE_URL" in
    *"$APPROVED_REF"*) APPROVED_STAGING_REF_PRESENT=true ;;
  esac
  case "$STAGING_DATABASE_URL" in
    *"$EXCLUDED_PROD_REF"*) PRODUCTION_REF_ABSENT=false ;;
    *) PRODUCTION_REF_ABSENT=true ;;
  esac
fi

PREFLIGHT_MSG="TARGET_PREFLIGHT stagingVariablePresent=$STAGING_VAR_PRESENT"
PREFLIGHT_MSG="$PREFLIGHT_MSG postgresUriShape=$POSTGRES_URI_SHAPE"
PREFLIGHT_MSG="$PREFLIGHT_MSG approvedStagingRefPresent=$APPROVED_STAGING_REF_PRESENT"
PREFLIGHT_MSG="$PREFLIGHT_MSG productionRefAbsent=$PRODUCTION_REF_ABSENT"
echo "$PREFLIGHT_MSG"

if [ "$STAGING_VAR_PRESENT" != true ] || [ "$POSTGRES_URI_SHAPE" != true ] || \
   [ "$APPROVED_STAGING_REF_PRESENT" != true ] || [ "$PRODUCTION_REF_ABSENT" != true ]; then
  echo "CAPTURE_FAILED reason=target_preflight_failed"
  exit 1
fi

TMPDIR_CANDIDATE="$(mktemp -d)"
CANDIDATE="$TMPDIR_CANDIDATE/candidate_evidence.json"

export PGDATABASE="$STAGING_DATABASE_URL"
unset STAGING_DATABASE_URL

"$PSQL" -X -q -v ON_ERROR_STOP=1 -f "$SQLFILE" 2>&1 \
  | node "$SANITIZER" "$TEMPLATE" "$CANDIDATE" "$SQLFILE" "$APPROVED_REF" "$EXCLUDED_PROD_REF"

PIPE_CODES=("${PIPESTATUS[@]}")
PSQL_EXIT="${PIPE_CODES[0]:-999}"
NODE_EXIT="${PIPE_CODES[1]:-999}"

if [ "$PSQL_EXIT" != "0" ] || [ "$NODE_EXIT" != "0" ]; then
  echo "CAPTURE_FAILED psql_exit=$PSQL_EXIT node_exit=$NODE_EXIT"
  exit 1
fi

if [ ! -s "$CANDIDATE" ]; then
  echo "CAPTURE_FAILED reason=candidate_missing_or_empty"
  exit 1
fi

if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$CANDIDATE"; then
  echo "CAPTURE_FAILED reason=candidate_not_valid_json"
  exit 1
fi

ALLPASSED="$(node -e "
  const c = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
  console.log(c.publicationValidation && c.publicationValidation.allPassed === true);
" "$CANDIDATE")"

if [ "$ALLPASSED" != "true" ]; then
  echo "CAPTURE_FAILED reason=validation_failed"
  exit 1
fi

if ! mv -f "$CANDIDATE" "$FINAL"; then
  echo "CAPTURE_FAILED reason=publish_rename_failed"
  exit 1
fi

CANDIDATE=""
echo "CAPTURE_OK"
exit 0
```

### How v2 closes FINDING-B and FINDING-D

**FINDING-B (credential in argv) — closed.**
- `-d "$STAGING_DATABASE_URL"` is removed entirely; `psql` is invoked with no `-d`/
  `--dbname` argument at all.
- `export PGDATABASE="$STAGING_DATABASE_URL"` hands the value to `psql` purely through
  the libpq `PGDATABASE` environment variable. libpq treats a `dbname`-style value that
  is itself a full connection URI (`postgres://...` / `postgresql://...`) as a complete
  connection string regardless of whether it arrived via `-d` or via `PGDATABASE` — this
  is documented libpq behavior, not a workaround specific to this repository.
  **Not live-verified against a real server in this Bash-free, database-free turn** — the
  next execution turn should treat this as a design claim to spot-check (e.g. with a
  throwaway non-secret local connection string) before relying on it in anger, not as
  something already proven against Postgres 17.6.
- `unset STAGING_DATABASE_URL` immediately after the `export`, so from that point on the
  secret exists under exactly one environment-variable name (`PGDATABASE`) in the
  wrapper's own process, not two — a small additional hardening step beyond what was
  strictly requested, kept because it was free and strictly reduces residual copies.
- `export`, `unset`, `case`, and `[ ]`/`[[ ]]` are shell builtins; none of them fork/exec
  an external process, so `STAGING_DATABASE_URL`'s value is never placed in any argv array
  for any process this script creates, at any point, including during the preflight.
- `set +x` is now explicit in the preamble (previously only an operator instruction not to
  use `bash -x`; now enforced by the script itself regardless of how it was invoked).

**FINDING-D (ref checks prove string survival, not live connection target) — narrowed,
not eliminated (there is no way to eliminate it with Postgres alone; see below).**
- The non-printing target preflight (new in v2, above) is a *new, independent* check that
  did not exist in v1: it inspects the *actual* `STAGING_DATABASE_URL` the wrapper is
  about to hand to `psql`, immediately before handing it over, and refuses to start `psql`
  at all unless `stagingVariablePresent`, `postgresUriShape`, `approvedStagingRefPresent`,
  and `productionRefAbsent` are all true. Only those four booleans (plus a `reason=` tag on
  failure) are ever printed or persisted — never the URI itself, never a substring of it.
  This is what Task 2 asked for and closes the "no live pre-execution check of the actual
  variable" gap that FINDING-D implicitly exposed.
- What v2 still cannot do, and what no wrapper ever will be able to do with Postgres
  alone: prove *from inside the opened database session* that the session is the approved
  project, because Postgres has no built-in notion of its own external Supabase
  project-ref hostname to query back (`current_database()` returns `postgres` regardless
  of which project it is). This is why target assurance is, and remains, **two
  independent parts that must both be trusted, not one proof that supersedes the other**:
  - **(A)** the new non-printing preflight above, checking the env var the wrapper is
    about to use, before `psql` starts; and
  - **(B)** the `session_context` evidence the sanitizer now gates on more strictly (Task
    3 below: bounded timeouts, server version present, database name present, exactly one
    row, transaction read-only) — which proves the session *behaved* like the intended
    read-only capture, not which project it belongs to.
  A future capture SQL extension could add a query-time check (e.g. against a table only
  the approved project is expected to contain) for a third, session-side confirmation, but
  that is out of scope for this local-only turn and is not proposed here.

</details>

### Local static validation performed this turn (Round-2 remediation; historical — see §18
for the current standalone-wrapper validation record)

- `bash -n` on the v2 pipeline (written only to the session scratchpad, outside the
  repository, then deleted) → syntax OK; longest line measured, none over 100 characters.
- `node --check scripts/vam_v5_metadata_evidence_sanitizer.mjs` → syntax OK, post the
  Task 3 session-evidence-check additions.
- Five fabricated, non-secret dummy-URI preflight cases run entirely as in-process shell
  function calls (no subprocess ever received the dummy value as an argv element):
  approved-ref-good → all four booleans true, placeholder-psql marker printed, exit `0`;
  staging-ref-absent → `approvedStagingRefPresent=false`, marker withheld, exit `1`;
  production-ref-present → `productionRefAbsent=false`, marker withheld, exit `1`;
  malformed-URI → `postgresUriShape=false`, marker withheld, exit `1`; empty variable →
  all four false, marker withheld, exit `1`. Grepped the captured test output for both
  dummy-URI substrings used (`postgres://u:p@` and the fabricated hostname) — zero matches
  in both cases, confirming only the four named booleans (plus `reason=`/`exit=`) were
  ever printed.
- Re-ran the sanitizer's positive/negative dry-run fixtures (unchanged from the prior
  turn) plus three new fixtures for the Task 3 session-evidence gate: unmodified
  positive case → `allPassed:true`; `statement_timeout_setting:"0"` (disabled/unbounded)
  → `statementTimeoutBounded:false`, `allPassed:false`; `statement_timeout_setting:"60s"`
  (exceeds the 15s bound) → `statementTimeoutBounded:false`, `allPassed:false`. All
  fixture and candidate files were written and deleted entirely within the session
  scratchpad.
- Re-hashed the capture SQL (`b8315d1b...`) — unchanged; not edited this turn.
- Re-hashed all four protected migration/preflight/rollback/post-verify files — all four
  unchanged, matching every prior hash in this document.
- Re-hashed the sanitizer post-Task-3-edit — recorded in the updated §11/§"Record:
  sanitizer" entries and in the evidence JSON's `safetyControlsForFutureExecution`.
- Re-ran `git status --porcelain=v1` and `git diff --cached --quiet` — index remains
  empty; only the three turn-authorized files that were actually edited this round
  (sanitizer, this decision pack, the evidence JSON — the capture SQL was not edited)
  appear as changes beyond the pre-existing session baseline; no unauthorized file was
  created or modified.
- No `psql`, no network call, no `STAGING_DATABASE_URL` inspection or display (real or
  fabricated-as-real), and no edit to migration 062 / preflight / rollback /
  post-apply-verify / the V5 spec JSON occurred during this phase.

---

## 12. Corrected Artifact 1 Data Model (proposed, not implemented)

Artifact 1 currently represents prerequisites as eleven bare strings in
`docs/audits/VAM_OS_ACCOUNT_ADMIN_V5_SPEC.json`. The corrected model — to be implemented
in a future, explicitly authorized turn — separates:

1. **`packageTables`** — exactly the 8 tables in §4, each with a full column/constraint/
   index/RLS/grant spec (already well-defined by migration 062 itself; low risk).
2. **`packageFunctions`** — the 10 `vam062_*` functions, similarly fully specified.
3. **`packagePolicies`** — the 5 `vam062_*` policies.
4. **`prerequisiteObjects`** — a new, first-class array/object keyed by the evidence IDs
   in §5, each carrying: object type, schema, name, repository source references (or
   `MISSING_REPOSITORY_EVIDENCE`), and — once approved — the staging-confirmed structural
   shape. This replaces the current flat `"prerequisites": ["admin_users", ...]` string
   array entirely.
5. **`knownConflicts`** — a first-class list carrying CONFLICT-01/02/03 and RISK-04 so
   they are not silently lost between audit turns.

---

## 13. Candidate Canonical Definitions

| Value | Label |
|---|---|
| `programs`, `intake_batches` (table shape), `person_season_memberships` (table+arbiter shape), `person_season_membership_log`, `admin_users` (table+role_check+status_check+email arbiter), `admin_audit_log` (table shape), `current_admin_role()`/`is_active_admin()` definitions, predecessor policies PREREQ-14/15, `gen_random_uuid()` | **APPROVED_REPOSITORY_AUTHORITY** |
| Every field listed under §"Expected Evidence Sections" in the JSON evidence doc (full staging column/constraint/index/ACL/policy metadata for all prerequisite + package relations) | **STAGING_EVIDENCE_AWAITING_APPROVAL** (pending capture; currently `UNAVAILABLE`) |
| CONFLICT-01 (admin_scope_access arbiter), CONFLICT-02 (intake_batches FK guard string), CONFLICT-03 (membership lifecycle guard) | **UNRESOLVED_CONFLICT** |
| `public.people` full shape, `public.seasons` full shape, `seasons->programs` FK definition, `admin_audit_log.read_admin_audit_log_super_admin_only` policy existence, `current_admin_role()` anon-execute grant state | **UNAVAILABLE** |

---

## 14. Risks and Stop Conditions

- Migration 062 cannot be safely applied until CONFLICT-01/02/03 are resolved by explicit
  human decision — these are not staging-dependent and will not be fixed by capturing
  more evidence.
- RISK-04 must be resolved by the `function_acl` capture section before migration 062 is
  attempted, or its line-17 guard may unexpectedly abort (a benign fail-safe, but worth
  knowing in advance).
- `public.people` and `public.seasons` remain entirely unanchored in this repository;
  their real shape can only come from staging capture, explicitly reviewed and approved,
  never auto-promoted.
- Stop conditions for the next (execution) turn: any secret/PII detected by the sanitizer
  requires manual review before the affected field's value is ever used, even internally;
  any transaction that is not read-only; any target that cannot be proven to be the
  approved staging ref.

---

## 15. Exact Authorization Required for the Next Turn

1. Explicit approval of the psql-plus-sanitizer command in §11 (already presented for
   review; not executed).
2. Post-execution, explicit human review and approval of each `STAGING_EVIDENCE_AWAITING_APPROVAL`
   value before it can become `APPROVED_REPOSITORY_AUTHORITY` in a future Artifact 1
   revision.
3. Explicit human decision on CONFLICT-01/02/03 (fix migration 062's guards, fix the
   underlying schema, or redesign the affected upsert logic) — none of these three
   require staging access to resolve, only a decision.
4. Separate, explicit authorization to edit `docs/audits/VAM_OS_ACCOUNT_ADMIN_V5_SPEC.json`
   itself to adopt the corrected data model in §12 — not authorized by, and not performed
   during, this turn.

---

## 16. Phase 7–10 — Wrapper Review, Independent Adversarial Review, and Local Hardening Closeout

**Status: local-only, Bash-free for review, database-free throughout. No `psql`, no
network, no staging/production connection, no migration 062 execution occurred while
producing this section. `STAGING_DATABASE_URL` was neither inspected nor displayed.**

Phase 7 (execution wrapper design) was already complete as of the prior turn — it is the
fenced pipeline recorded above under "FINAL HUMAN EXECUTION GATE". This turn performed an
independent adversarial re-read of that wrapper, the sanitizer, and the capture SQL
(Phase 8), applied the one in-scope code fix that review produced (Phase 9), and re-ran
local-only validation (Phase 10, folded into §"Local static validation performed this
turn" above plus the additions below).

### FINDING-A — sanitizer: nested-object secret flags did not propagate to row level (FIXED)

- **Defect:** `sanitizeValue()`'s object branch called `sanitizeRow(value)` for any
  non-array object field but never fed that nested call's own `rowFlags` back into the
  *enclosing* row's `flags` array. A secret pattern found inside a nested object value
  would still be redacted at the leaf (no raw secret ever reached the candidate file),
  but the top-level row would not be marked `_manual_review_required`, so
  `flaggedSecretCandidateCount` and the publication check
  `checks.noOutstandingSecretPatternMatches` could both read as "clean" even though a
  secret-shaped value had in fact been found and silently redacted one level down —
  defeating the human-review gate that finding is supposed to force.
- **Exploitability today:** none. Every column the current capture SQL selects is a
  scalar or an array (`text[]`); no column is `json`/`jsonb`-typed, so
  `row_to_json(sub)` never produces a nested object value and this branch is dead code
  under the SQL as written (re-confirmed this turn: `grep -i 'jsonb\|json\b'` against the
  capture SQL matches only the top-level `jsonb_agg(row_to_json(...))` wrapper, no
  per-column `json`/`jsonb` type). It is a **latent** defect, not a live one — but the
  sanitizer's own `AUTH_IDENTITY_KEY_RE` comment already documents an intent to stay
  correct "for any future extension of the capture SQL," so it was fixed rather than
  left as a documented risk.
- **Fix:** `sanitizeValue()`'s object branch now inspects the nested `sanitizeRow()`
  result; if it carries `_manual_review_required`, each of its `_flagged_fields` is
  re-pushed onto the enclosing row's `rowFlags` as `"<outerKey>.<innerField>"`, so nested
  detections now count at every enclosing level, all the way to
  `flaggedSecretCandidateCount` and `noOutstandingSecretPatternMatches`.
- **Verification:** three local dry runs against fabricated, non-secret stdin (no `psql`,
  no network) — see the updated §11 "Sanitizer provenance" above for the full list,
  including the new nested-object case, which now correctly yields
  `flaggedSecretCandidateCount:1`, `noOutstandingSecretPatternMatches:false`,
  `allPassed:false`, exit `1`.
- SHA-256 immediately after this fix (before Round-2 Task 3 additions, now superseded):
  `eaf38ac7a841c1e2c55757748f22666b9db7ef6cd27e227c2de5c69e330276a3`. Current SHA-256
  after all edits this session: `c9d0f3d3473fdc95045b439fb88a6e49bb80d9b09e69feed4cbed92a35114494`
  (see §17).

### FINDING-B — wrapper: `STAGING_DATABASE_URL` passed as a psql CLI argument (RESOLVED in §17 / v2 pipeline)

- The reviewed pipeline invokes `"$PSQL" ... -d "$STAGING_DATABASE_URL" -f "$SQLFILE"`.
  Passing a full connection URI (which embeds the password) as a command-line argument
  makes it visible, for the life of the process, to anything that can enumerate process
  argv on the host (`ps`/`/proc/<pid>/cmdline` on Unix-like systems; `tasklist`/Process
  Explorer/WMI with sufficient privilege on Windows). This is a well-known hardening gap
  in ad hoc `psql -d "<uri>"` invocations generally, independent of anything specific to
  this repository.
- **Not fixed in this turn.** Rule 2 of this turn's authorization requires explicit human
  approval for *any* use, inspection, or display of `STAGING_DATABASE_URL` — restructuring
  how it is passed to `psql` (e.g. splitting it into non-secret `-h/-p/-U`/dbname
  arguments plus a separately-scoped `PGPASSWORD`/`.pgpass`/`PGSERVICE` mechanism for the
  secret component) is exactly that kind of change and needs to be designed and approved
  as part of the next execution-authorization turn, not silently altered here.
- **Recorded as a required input to Exact Authorization §15** (see updated item 1 below):
  the wrapper in §"FINAL HUMAN EXECUTION GATE" should not be treated as final-approved
  for execution until this is either fixed or explicitly accepted as a residual risk by
  the human approver.
- **Resolved this round (§17):** the v2 pipeline removes `-d "$STAGING_DATABASE_URL"`
  entirely and hands the value to `psql` only via the `PGDATABASE` libpq environment
  variable, immediately `unset`s `STAGING_DATABASE_URL` afterward, and adds an explicit
  `set +x`. See §17 for the full closure record and its residual-risk caveat (env-var
  exposure via `/proc/<pid>/environ`-equivalent channels is a materially smaller, but
  non-zero, surface than argv — accepted as a residual, not eliminated to zero).

### FINDING-C — wrapper: `psql ... 2>&1 | node sanitizer` can interleave stdout/stderr (documented, fail-closed, not fixed)

- Redirecting stderr onto the same pipe as stdout for a non-interactive `psql` process
  can, depending on libpq/stdio buffering, interleave or split lines relative to how the
  sanitizer expects to see them (one `---SECTION:<name>---` marker immediately followed
  by exactly one JSON data line).
- **Verified this turn (by code inspection, not execution) that this fails closed, not
  open:** any corruption of a marker line causes the marker regex not to match, so the
  following data line is discarded as unsectioned and that section never leaves `MISSING`
  state; any corruption of a data line causes a `JSON.parse` failure, marking that
  section `MALFORMED`. Either outcome makes `checks.allExpectedSectionsResolved` false,
  which makes `allPassed` false, which the wrapper's own `ALLPASSED` check turns into
  `CAPTURE_FAILED reason=validation_failed` and a non-zero exit — the candidate is never
  published. Net effect: a possible spurious capture failure requiring a retry, never a
  corrupted-but-published evidence file.
- Also verified this turn: the capture SQL pairs every `\echo` marker with exactly one
  single-row aggregate `select jsonb_agg(...) from (...) sub;`, and the wrapper passes
  `-v ON_ERROR_STOP=1`, so a mid-script query error aborts the whole capture immediately
  rather than leaving a marker permanently "PENDING" with no corresponding failure
  signal — re-confirmed by re-reading the capture SQL this turn, no change made to it.
- No fix proposed here since the current behavior is already safe; noted as a possible
  future reliability improvement (e.g. routing stderr to a separate, never-published
  diagnostic-only stream) if capture retries become operationally annoying.

### FINDING-D — wrapper: staging/production ref checks validate string survival, not live connection target (NARROWED in §17 / v2 pipeline; not fully eliminable)

- `checks.approvedStagingRefPresent` / `checks.productionRefAbsent` test whether the
  approved/excluded ref strings appear (or don't) in the serialized candidate JSON. Those
  strings currently only ever enter the candidate via the static `template` object
  (`structuredClone`d verbatim from `docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json`,
  where `sanitizedApprovedProjectRef` is already a literal), not from anything the live
  `psql` session reports about which server it actually connected to (Postgres itself has
  no built-in notion of its own external Supabase project-ref hostname to query back).
- **Consequence for the next execution turn:** these two checks catch template
  corruption, not a misconfigured `STAGING_DATABASE_URL`. The only real assurance that
  the capture will hit the approved staging ref and not production remains the
  human-approved verification already recorded in §3 above (`ljfneyuvpxrmejpxsmpz`
  present, `qkkroesfiazsejkzflcd` absent, confirmed prior to this Bash-free phase) — this
  must be re-confirmed, not assumed, immediately before the next execution turn, since it
  is time-of-check/time-of-use sensitive and this turn did not and could not re-verify it.
- No fix proposed (there is no reliable server-side signal to add); recorded purely so a
  future operator does not over-trust these two checks as connection-target proof.
- **Narrowed this round (§17):** v2 adds a non-printing target preflight that checks the
  *actual* `STAGING_DATABASE_URL` immediately before `psql` starts (Task 2), and the
  sanitizer's `session_context` checks were tightened (Task 3: bounded timeouts, server
  version present, database name present). Target assurance is now explicitly documented
  as two independent parts (pre-execution env-var check + post-execution session-behavior
  evidence) rather than one over-trusted string-survival check — see §17 for detail. This
  still cannot prove *which project* the open session belongs to, because Postgres has no
  such self-referential signal; that residual limitation is inherent to the technology,
  not a defect in this design.

### Confirmed-safe (no finding) on re-review

- The wrapper's two `node -e "..." "$CANDIDATE"` invocations pass the candidate path as a
  separate argv element, never string-interpolated into the `-e` source — no shell/JS
  injection vector via a maliciously-named path.
- `PIPE_CODES=("${PIPESTATUS[@]}")` captures both exit codes in one atomic array
  assignment immediately after the pipeline, before any other command can overwrite
  `PIPESTATUS` — re-confirmed correct.
- `trap cleanup EXIT HUP INT TERM` is installed before `mktemp -d` — re-confirmed correct
  ordering.
- No `set -x` / shell tracing anywhere in the wrapper (which would otherwise print the
  literal `-d "$STAGING_DATABASE_URL"` argument to the terminal/log) — re-confirmed
  absent. Recorded as an explicit operator instruction: never run this pipeline under
  `bash -x` or with `set -x` enabled.

### Local static validation performed this turn (Phase 10; no database access, no network)

- `node --check scripts/vam_v5_metadata_evidence_sanitizer.mjs` → syntax OK, post-fix.
- Three sanitizer dry runs against fabricated, non-secret stdin (documented above and in
  §11): positive (all 11 sections, clean) → `allPassed:true`; negative (missing section +
  fake email) → `allPassed:false`, fake email absent verbatim from candidate; new nested-
  secret case → `allPassed:false`, top-level flag now correctly propagated.
- Re-hashed the capture SQL: `b8315d1bb6d89ff482d20ccccc8e659f9f5ebd2f9f5b57dee092aa70dfac9c56`
  — unchanged from every prior turn.
- Re-hashed all four protected migration/preflight/rollback/post-verify files — all four
  unchanged, matching every prior hash recorded in this document.
- Re-hashed the sanitizer post-FINDING-A-fix: `eaf38ac7a841c1e2c55757748f22666b9db7ef6cd27e227c2de5c69e330276a3`
  — accurate at that point in this turn, before the Round-2 Task 3 edits described in §17
  changed the file again. See §17 for the current, superseding hash
  (`c9d0f3d3473fdc95045b439fb88a6e49bb80d9b09e69feed4cbed92a35114494`) and §11/§"Record:
  sanitizer" above, which have been updated to the current value.
- No `psql`, no network call, no `STAGING_DATABASE_URL` inspection, and no edit to
  migration 062 / preflight / rollback / post-apply-verify / the V5 spec JSON occurred
  during this phase.

### Updated Exact Authorization Required for the Next Turn (supersedes §15 item 1 and this
own item 1; see §17, §18, and, current, §19)

1. **Superseded by §19:** explicit approval of the standalone file
   `scripts/vam_v5_metadata_capture_wrapper.sh`, verified against the **current** SHA-256
   recorded in §19 "FINAL EXECUTION ATTESTATION" (not the Round-3 value quoted earlier in
   §18, which is now stale), independently re-verified immediately before running — not
   any Bash block embedded in this document (v1 and v2 are both superseded). FINDING-B is
   closed (§17 Task 1 / §18 / §19); the residual env-var exposure documented there should
   be explicitly acknowledged by the approver, not silently assumed away. The known
   SIGINT-under-backgrounding limitation in §18 should also be acknowledged if the
   approver intends to ever background this script rather than run it in the foreground.
2. (unchanged) Post-execution, explicit human review and approval of each
   `STAGING_EVIDENCE_AWAITING_APPROVAL` value before promotion to
   `APPROVED_REPOSITORY_AUTHORITY`.
3. (unchanged) Explicit human decision on CONFLICT-01/02/03.
4. (unchanged) Separate, explicit authorization to edit
   `docs/audits/VAM_OS_ACCOUNT_ADMIN_V5_SPEC.json` to adopt §12's corrected data model.
5. Immediately before executing, re-confirm the staging-target proof in §3 (approved ref
   present / production ref absent in `STAGING_DATABASE_URL`) is still accurate. The v2
   pipeline's own preflight (§17 Task 2) now performs this check live, at execution time,
   which narrows but does not remove the need for this human re-confirmation beforehand —
   the preflight trusts whatever `STAGING_DATABASE_URL` is set to; it cannot detect a
   variable that is syntactically valid, contains the approved ref, and is nonetheless
   wrong for some reason outside its four checks.

---

## 17. Round-2 Remediation — FINDING-B and FINDING-D Closure (Tasks 1–6, this turn)

**Status: local-only throughout. No `psql`, no network/HTTP, no staging/production
connection, no migration 062 execution, no Git write. `STAGING_DATABASE_URL` was neither
inspected nor printed — all preflight logic was designed, then exercised only against
fabricated, non-secret dummy URIs in the session scratchpad.**

This round accepted the Phase 7–10 report except for FINDING-B and FINDING-D, and asked
for both to be closed as far as they can be, with the wrapper still not authorized to run.

### Task 1 — credential removed from psql argv (closes FINDING-B)

`-d "$STAGING_DATABASE_URL"` is gone from the v2 pipeline (§"FINAL HUMAN EXECUTION GATE"
→ "✅ CURRENT — v2 pipeline" above). `STAGING_DATABASE_URL` is exported as `PGDATABASE`
(libpq's dbname parameter accepts a full connection URI, a documented libpq behavior, not
a repository-specific workaround) and immediately `unset`, so it exists under exactly one
environment-variable name for the rest of the process's life. `set +x` is now explicit in
the preamble. `PGSSLMODE=require`, `PGCONNECT_TIMEOUT=10`, the exact PostgreSQL 17 psql
binary path, and `-X -q -v ON_ERROR_STOP=1 -f "$SQLFILE"` are all unchanged from v1. The
real URI was never split into separate `-h`/`-U`/password arguments, per the instruction
not to do that.

**Residual, explicitly not claimed as zero:** environment variables are still readable by
anything with equivalent privilege to inspect this process's environment block (e.g.
`/proc/<pid>/environ` for the same user or root on Unix-like systems; process-environment
inspection with sufficient privilege on Windows). This is a materially smaller exposure
surface than argv (which is readable by *any* local user via plain `ps`/`tasklist` with no
special privilege), and is exactly the environment-based design Task 1 asked for — recorded
as a residual, not re-litigated as a new open finding.

### Task 2 — non-printing target preflight (new control, supports closing FINDING-D)

Added to the v2 pipeline, before `PGDATABASE` is ever set: a preflight computing exactly
the four requested booleans — `stagingVariablePresent`, `postgresUriShape`,
`approvedStagingRefPresent`, `productionRefAbsent` — using only shell builtins (`[ ]`,
`case`), which never fork/exec an external process and therefore never place
`STAGING_DATABASE_URL`'s value in any process's argv. On any failing condition, only the
four booleans and a static `reason=target_preflight_failed` are printed; the pipeline
exits non-zero **before** `PGDATABASE` is set and before `psql` is invoked at all. Verified
in Task 5 below with five fabricated dummy-URI cases and a placeholder-psql marker that
only appears when every check passes.

### Task 3 — session_context publication gate strengthened (implemented in the sanitizer)

`scripts/vam_v5_metadata_evidence_sanitizer.mjs` now requires, in addition to the
pre-existing exactly-one-row and `transaction_read_only:"on"` checks: `statementTimeoutBounded`
(parses `statement_timeout_setting`, fails unless `0 < value <= 15000ms`, so both "disabled"
and "too generous" fail closed), `lockTimeoutBounded` (same, `<= 3000ms`),
`serverVersionPresent`, and `databaseNamePresent`. All four are additional entries in the
same `checks` object gating `publicationValidation.allPassed`, so a session missing any of
this evidence cannot publish. **Explicitly documented, per instruction, that this proves
session *behavior* (bounded/read-only), never *which project* — see the new "How v2 closes
FINDING-B and FINDING-D" subsection above for the two-part (A)/(B) framing.**

### Task 4 — atomicity and secret-safety properties reconfirmed unchanged in v2

| Property | Status in v2 |
|---|---|
| `set -u` | present |
| `set -o pipefail` | present |
| `umask 077` | present |
| `trap cleanup EXIT HUP INT TERM`, installed before `mktemp -d` | present, same ordering |
| Candidate files under `mktemp -d` (OS temp), never under the repository | unchanged |
| Raw psql stdout/stderr flow only through the sanitizer pipe, never to any other file | unchanged |
| `PIPE_CODES=("${PIPESTATUS[@]}")` captured in one atomic array assignment | unchanged |
| Failure on either `psql` or sanitizer non-zero exit | unchanged (now also gated earlier by the preflight's own non-zero exit) |
| Candidate JSON-parsed and `allPassed` checked before the only publish step | unchanged |
| Existing evidence file (`$FINAL`) untouched on every failure path, including preflight failure (which now exits before `mktemp -d` even runs) | unchanged, and strictly earlier for target-check failures |
| Publication is a single `mv -f "$CANDIDATE" "$FINAL"`, same-filesystem rename | unchanged |
| No temp residue: `trap` removes candidate + `.writing` twin + tempdir on every exit path | unchanged |
| No raw diagnostic/unsectioned line text ever persisted (sanitizer counts only) | unchanged |

### Task 5 — local-only validation (no database, no real credential)

- `bash -n` on the v2 pipeline → syntax OK; every line measured ≤ 100 characters (the
  preflight status line was split across four `PREFLIGHT_MSG="$PREFLIGHT_MSG ..."`
  concatenation lines specifically to stay under the limit while still emitting one
  logical status line).
- `node --check scripts/vam_v5_metadata_evidence_sanitizer.mjs` → syntax OK post-Task-3.
- Five fabricated dummy-URI preflight cases (approved-ref-good, staging-ref-absent,
  production-ref-present, malformed-URI, empty-variable) run as in-process shell function
  calls — see the "Local static validation performed this turn (Round-2 remediation)"
  subsection above for the full per-case results. A `PSQL_PLACEHOLDER_WOULD_RUN_MARKER`
  stood in for the real `psql` invocation and appeared **only** in the one passing case,
  proving the gate actually gates. Grepped the captured output for both dummy-URI
  substrings used in the test — zero matches in both cases.
- Re-ran the sanitizer's existing positive/negative/nested-secret fixtures (unchanged
  results) plus three new fixtures exercising Task 3's bounded-timeout gate: clean →
  `allPassed:true`; `statement_timeout_setting:"0"` → `allPassed:false`; `"60s"` (over the
  15s bound) → `allPassed:false`.
- `docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json` re-parsed with
  `JSON.parse` after this round's edits → valid.
- All fabricated fixtures, dummy URIs, and test scripts were written to and deleted from
  the session scratchpad only; none were added to the repository.

### Task 6 — FINAL HUMAN EXECUTION GATE updated

The v1 pipeline is retained, verbatim, inside a collapsed `<details>` block explicitly
marked **"SUPERSEDED ... MUST NOT be executed"**. The v2 pipeline immediately follows,
containing no `-d "$STAGING_DATABASE_URL"`, using `PGDATABASE` only as an environment
value, containing the full non-printing target preflight, printing only the four
sanitized booleans plus a static `reason=`, and failing before `psql` starts on any
target mismatch. **This does not authorize execution** — the section header still reads
"Status: NOT EXECUTED" and no line of v2 has been run against staging or any other
database.

**Superseding note (added in §18, Round 3): v2 was marked "✅ CURRENT" when this Task 6
was written. It no longer is — v2 is now also collapsed and marked SUPERSEDED, and the
sole current execution authority is the standalone file
`scripts/vam_v5_metadata_capture_wrapper.sh`. See §18.**

---

## 18. Round-3 Remediation — Standalone Capture Wrapper (this turn)

**Status: local-only throughout. No `psql`, no network/HTTP, no staging/production
connection, no migration 062 execution, no Git write. `STAGING_DATABASE_URL` was neither
inspected nor printed — all testing used fabricated, non-secret dummy URIs against a
scratchpad test harness, never the real repository evidence file.**

This round moved the authoritative execution workflow out of this Markdown document into
one standalone, syntax-checked, hashable script file, and closed the remaining
execution-safety gaps: hash-pinning of dependencies before any credential handling,
checked/same-filesystem temp-directory creation, and signal-safe cleanup that cannot
return a zero exit code on interruption.

### Sole current execution authority

**Historical record of this section's state as of Round 3. The wrapper's SHA-256 and the
`template_json` dependency hash below changed in Round 4 (credential-scope hardening) —
see §19 "FINAL EXECUTION ATTESTATION" for the current, authoritative values. Do not use
the hash values in this §18 section to verify the file; they are intentionally preserved
here, unedited, as an audit trail of what was true at the end of Round 3.**

- **Path:** `scripts/vam_v5_metadata_capture_wrapper.sh`
- **SHA-256 (Round 3, superseded by §19):** `e5e119144ee336c324a46e2899eafbbca1a093f2d5fa43bad87a7ea4f9bd8037`
- Every Bash wrapper embedded in this document (v1 in §"FINAL HUMAN EXECUTION GATE", v2
  immediately below it) is **superseded**, collapsed, and marked
  "SUPERSEDED ... MUST NOT be executed". Execution is authorized only by running the
  current file, and only after independently re-verifying its SHA-256 matches the
  current value in §19 (see §19 "Exact later command").

### Hash pinning before database access

The wrapper computes the actual SHA-256 of three dependencies and compares each against
a literal constant embedded in its own source, **before** `STAGING_DATABASE_URL` is
touched in any way. Any mismatch fails closed, printing only
`CAPTURE_FAILED reason=artifact_hash_mismatch artifact=<name>` (`<name>` ∈
`{sanitizer, capture_sql, template_json}`) — never a hash value or file content.

| Dependency | Pinned SHA-256 (Round 3, superseded by §19 for `template_json`) |
|---|---|
| `scripts/vam_v5_metadata_evidence_sanitizer.mjs` | `c9d0f3d3473fdc95045b439fb88a6e49bb80d9b09e69feed4cbed92a35114494` (unchanged in Round 4) |
| `docs/audits/sql/design_only/VAM_OS_V5_METADATA_EVIDENCE_CAPTURE.sql` | `b8315d1bb6d89ff482d20ccccc8e659f9f5ebd2f9f5b57dee092aa70dfac9c56` (unchanged in Round 4) |
| `docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json` | `ef11e53c30b86925d64edae8e976795e0a0f6e3cfe97e8f7d7235ee7cc5ee4f6` **(Round 3 value — see §19 for the current value, changed because Round 4 added `round4CredentialScopeHardening` documentation to this file before re-hashing it)** |

All three were finalized and hashed **before** any hash constant was written into the
wrapper, and were not modified again afterward in that turn — re-verified by a final
self-consistency `sha256sum` pass after all edits, which reproduced these exact values
**as of Round 3**. Round 4 repeated this same discipline independently — see §19.

### Temporary-directory and same-filesystem design

- `TMPDIR_CANDIDATE="$(mktemp -d "$REPO_PARENT_DIR/.vam_v5_capture_tmp.XXXXXXXXXX")"` is
  explicitly exit-status-checked; failure prints `CAPTURE_FAILED
  reason=tempdir_creation_failed` and exits before any further state is created.
- `REPO_PARENT_DIR="$(dirname "$BASE")"` — the temp directory is a hidden,
  unpredictable-suffix **sibling of the repository root**, guaranteeing it is outside the
  repository yet on the same filesystem/volume as the final evidence file **by
  construction**, not by assumption (a parent directory and its child are always on the
  same filesystem).
- Immediately before the only publication step, the wrapper additionally compares
  `stat -c %d` of the candidate's and the final destination's containing directories and
  fails closed (`reason=same_filesystem_unproven`) if this cannot be proven, or if `stat`
  itself is unavailable — defense in depth on top of the by-construction guarantee.
  **Not independently verified against real cross-volume NTFS/MSYS behavior in this
  database-free turn** (there was no second volume available to construct a genuine
  cross-filesystem failure case); flagged for a human spot-check before relying on it.

### Signal safety

Separate handlers for `EXIT` versus `HUP`/`INT`/`TERM` — never one shared function. The
`EXIT` handler trusts `$?` (well-defined there). Each signal handler ignores `$?`
entirely, disables every trap (`trap - EXIT HUP INT TERM`) before exiting so the `EXIT`
handler cannot re-fire and overwrite the code, and exits with a hardcoded, signal-specific
code: `HUP`→129, `INT`→130, `TERM`→143. `CAPTURE_OK` can only be reached by the one
success path, after every gate has already passed.

### Local validation performed this turn (no database access, no real credential)

- `bash -n scripts/vam_v5_metadata_capture_wrapper.sh` → syntax OK. `awk` line-length scan
  → no line over 100 characters (225 lines total).
- `node --check scripts/vam_v5_metadata_evidence_sanitizer.mjs` → syntax OK (unchanged
  this round).
- Built a scratchpad test harness: a byte-faithful copy of the real wrapper with only
  `PSQL`/`BASE`/`TEMPLATE`/`FINAL`/the template hash constant redirected to scratch
  locations (verified via `node`-based exact string substitution, not manual retyping),
  a fabricated `fake_psql.sh` placeholder driven only by env vars (never argv), and a
  dummy `NOT_EXECUTED` template. The real sanitizer and real capture SQL were used
  read-only (their content was never modified, only hashed and read).
- **Full success path**, run end-to-end through the real sanitizer: correct hashes,
  passing preflight, complete 11-section fixture → `allPassed:true` → `CAPTURE_OK`, exit
  `0`, dummy evidence file correctly published, no temp residue afterward.
- **Three hash-mismatch cases** (one corrupted constant each: sanitizer, capture_sql,
  template_json): each failed with the correct `artifact=` name, exit `1`, the fake-psql
  placeholder marker **never** created (proving `psql` was never reached), dummy evidence
  file byte-identical to its pre-test baseline afterward.
- **Five preflight cases** (approved-good, staging-ref-absent, production-ref-present,
  malformed-URI, empty-variable): only the passing case produced the placeholder marker;
  all four failing cases did not, each exited `1`, each left the dummy evidence file
  untouched.
- **mktemp failure** (repository-parent directory made to not exist): `CAPTURE_FAILED
  reason=tempdir_creation_failed`, exit `1`, placeholder marker never created, no
  directory was created anywhere (confirmed by listing), evidence file untouched.
- **Candidate-validation failures**: a fixture missing the `indexes` section, and a
  fixture with a non-JSON data line — both correctly produced `node_exit=1` /
  `CAPTURE_FAILED`, exit `1`, placeholder marker present (psql *was* reached; only the
  sanitizer's own validation failed), evidence file untouched.
- **`psql` non-zero exit** (`FAKE_PSQL_EXIT_CODE=2`): `CAPTURE_FAILED psql_exit=2
  node_exit=0`, exit `1`, evidence file untouched.
- **Signal handling — direct function test**: the wrapper's own `cleanup_on_signal`
  function, extracted verbatim, invoked directly with `TERM`/`143` against fabricated
  candidate/temp files and a fabricated `PGDATABASE` value → correctly removed both temp
  files, printed `CAPTURE_FAILED reason=interrupted_by_signal signal=TERM`, exited `143`,
  and the line after the call was confirmed **never** reached (proving `CAPTURE_OK` is
  structurally unreachable from that path).
- **Signal handling — real OS signal delivery** against a running instance (backgrounded
  via `&`, signaled ~1s into a 4-second fabricated `psql` delay): `HUP` → exit `129`,
  `TERM` → exit `143`, both with the evidence file preserved and no temp residue, matching
  the design exactly. **`INT` did not interrupt the run** (it completed normally, exit
  `0`, `CAPTURE_OK`) when delivered to a *backgrounded* instance. Root-caused with an
  isolated 4-line reproduction (`trap ... INT; sleep 3` run via `&`) showing the identical
  symptom with no wrapper-specific code involved: this is documented bash/POSIX behavior
  — SIGINT (and SIGQUIT) are pre-set to ignored for asynchronous (`&`) commands in
  non-interactive shells, and bash's own rule is that **a signal already ignored on entry
  to a non-interactive shell cannot be trapped or reset** by that shell. This is not a
  defect this script's own logic can fix; it is a property of how bash treats backgrounded
  jobs, independent of anything in this file. The wrapper's intended invocation is a
  direct **foreground** run (a human or CI step executing it as the main command after
  explicit approval), where SIGINT is not pre-ignored and the trap applies normally — this
  was not independently re-verified via a live foreground interactive signal in this
  sandboxed, non-interactive tool environment, but is supported by (a) the direct
  function-level test above showing the handler logic itself is correct, (b) `HUP`/`TERM`
  real-signal delivery succeeding through the identical trap-registration mechanism, and
  (c) this being long-standing, well-documented bash behavior rather than an
  environment-specific quirk. **Recorded as a known, inherent limitation of backgrounded
  invocation, not a defect to fix**, and flagged so a human operator knows not to
  background this script (e.g. `capture_wrapper.sh &`) if SIGINT-based cancellation needs
  to be reliable in that specific invocation mode; `TERM` (the standard signal used by
  process supervisors, CI cancellation, and `Docker stop`) is unaffected either way.
- Confirmed via `grep` across the entire failure-matrix log (all cases above) that neither
  fabricated dummy-URI substring used in testing appears anywhere in captured output —
  zero matches — and that `CAPTURE_OK` appears **exactly once**, in the single success
  case.
- Confirmed no stray temp file or directory remained in the real repository, its parent
  directory, or the scratch harness root after every test completed.
- `git diff --check` on `scripts/vam_v5_metadata_capture_wrapper.sh` and
  `docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json` → clean.
- `git diff --cached --quiet` → index remains empty.
- Re-hashed all four protected migration/preflight/rollback/post-verify files — all four
  unchanged from every prior turn.
- Final self-consistency `sha256sum` pass over the wrapper and all three of its pinned
  dependencies, after all edits — reproduced the exact values in the table above with no
  drift.

### Exact later command that would verify and then execute this wrapper (Round 3 value — SUPERSEDED, see §19)

```bash
EXPECTED="e5e119144ee336c324a46e2899eafbbca1a093f2d5fa43bad87a7ea4f9bd8037"
ACTUAL="$(sha256sum scripts/vam_v5_metadata_capture_wrapper.sh | cut -d' ' -f1)"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "WRAPPER_HASH_MISMATCH refuse_to_run"
else
  bash scripts/vam_v5_metadata_capture_wrapper.sh
fi
```

**This command was not run in Round 3, and the `EXPECTED` value above is now stale** —
the wrapper changed in Round 4 (credential-scope hardening). Use §19's version instead.
Preserved here only as an audit-trail record of what Round 3 presented.

---

## 19. FINAL EXECUTION ATTESTATION (Round 4 — credential-scope hardening, this turn)

**Status: local-only throughout. No `psql`, no network/HTTP, no staging/production
connection, no migration 062 execution, no Git write. `STAGING_DATABASE_URL` was neither
inspected nor printed — every test in this round used a fabricated, non-secret dummy URI
against a scratchpad test harness, never the real repository evidence file, and never a
real credential.**

This round replaced the wrapper's global `export PGDATABASE="$STAGING_DATABASE_URL"` with
a process-scoped assignment, so the credential lives only in the environment of the single
`psql` child process, never in the wrapper's own persistent shell state, and added
explicit `unset`s of every other libpq environment variable at startup and at cleanup.

### Credential-scope design (this round)

- **Startup:** `PGDATABASE`, `PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
  `PGPASSFILE`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS` are all unset before
  `PGSSLMODE`/`PGCONNECT_TIMEOUT` are set, so no inherited libpq variable from a parent
  process can combine with or override the URI handled later.
- **Credential holder:** `DB_URI` — a plain, never-exported shell variable — replaces the
  Round-3 design's exported `PGDATABASE` as the temporary holder for
  `STAGING_DATABASE_URL`'s value, populated only after the non-printing target preflight
  has already passed, with `STAGING_DATABASE_URL` unset in the same step.
- **`psql` invocation:** `PGDATABASE="$DB_URI" "$PSQL" -X -q -v ON_ERROR_STOP=1 -f
  "$SQLFILE"` — a simple-command prefix assignment. Bash scopes this to that one child
  process's environment only; it is never added to argv and never exported into the
  wrapper's own environment.
- **Sanitizer invocation:** piped through `env -u PGDATABASE -u DB_URI -u
  STAGING_DATABASE_URL -u PGPASSWORD node "$SANITIZER" ...` — explicit, self-documenting
  proof in the wrapper's own source that the sanitizer process cannot inherit any of the
  four credential-bearing variable names, even though none of them are exported to begin
  with.
- **Post-pipeline cleanup:** `unset DB_URI` runs immediately after `PIPE_CODES=
  ("${PIPESTATUS[@]}")` is captured, and `remove_temp_state()` (called by both the `EXIT`
  and every signal handler) additionally unsets `DB_URI`, `STAGING_DATABASE_URL`,
  `PGDATABASE`, and `PGPASSWORD` on every exit path, success or failure.

### Fabricated environment-scope test results (Task 2)

Built a dedicated environment/argv probe pair in the scratchpad test harness — an
upgraded fake `psql` placeholder that records which of `PGDATABASE`/`DB_URI`/
`STAGING_DATABASE_URL`/`PGPASSWORD` it can see plus its own argv, and a fake sanitizer
stand-in (used only for this one test, never the real sanitizer, so argv/env could be
inspected directly) that records the same. Run against a fabricated dummy URI
(`postgres://u:p@db.<approved-ref>.example.invalid:5432/postgres`, never the real
`STAGING_DATABASE_URL`):

| Check | Result |
|---|---|
| `psql` placeholder: `PGDATABASE` present | **yes** |
| `psql` placeholder: `DB_URI` present | no |
| `psql` placeholder: `STAGING_DATABASE_URL` present | no |
| `psql` placeholder: `PGPASSWORD` present | no |
| `psql` placeholder argv | `-X -q -v ON_ERROR_STOP=1 -f <capture-sql-path>` — no URI |
| sanitizer stand-in: `PGDATABASE` present | no |
| sanitizer stand-in: `DB_URI` present | no |
| sanitizer stand-in: `STAGING_DATABASE_URL` present | no |
| sanitizer stand-in: `PGPASSWORD` present | no |
| sanitizer stand-in argv | template path, candidate path, capture-SQL path, approved ref, excluded ref — no URI |
| `grep` for both dummy-URI substrings across the psql probe, sanitizer probe, and full captured wrapper output | **zero matches in all three** |
| Target-preflight failure (4 fabricated cases: staging-ref-absent, production-ref-present, malformed-URI, empty-variable) | psql placeholder marker never created in any case; wrapper exited `1` in all four |
| Hash-mismatch (3 fabricated cases: corrupted sanitizer/capture_sql/template_json expected-hash constant) | psql placeholder marker never created in any case; wrapper exited `1` with the correct `artifact=` name in all three |
| Direct, in-process test of `remove_temp_state()` (verbatim from the real file) with all four credential variables fabricated and pre-populated | all four confirmed unset immediately after the call, in the same shell — proving the cleanup logic itself, not just process-exit, removes them |
| Live OS signal delivery (`HUP`, `TERM`) to a running instance mid-pipeline | both correctly triggered `remove_temp_state()` (confirmed via temp-directory removal and prior evidence-file preservation), exited `129`/`143` respectively |

`INT` was not re-tested this round beyond what §18 already recorded: SIGINT is not
reliably trappable when this script is invoked as a *backgrounded* (`&`) job in a
non-interactive shell — a documented, independently-reproduced bash/POSIX property, not a
defect in this script's own logic (see §18 for the full root-cause analysis). The intended
foreground invocation is unaffected, and `TERM`/`HUP` — the signals actually used by
process supervisors and CI cancellation — are unaffected in either invocation mode.

### Revalidation (Task 3)

- `bash -n scripts/vam_v5_metadata_capture_wrapper.sh` → **syntax OK**. No line over 100
  characters (255 lines total).
- `node --check scripts/vam_v5_metadata_evidence_sanitizer.mjs` → **syntax OK**
  (unchanged this round).
- Full 12-case positive/negative matrix (3 hash-mismatch, 5 preflight, 1 mktemp-failure,
  2 candidate-validation-failure, 1 psql-non-zero-exit) re-run against the credential-
  scoped wrapper end-to-end through the real sanitizer: identical, correct results to
  Round 3 — no regression from the credential-scoping change. Exactly one `CAPTURE_OK`
  across the entire matrix; the previous dummy evidence file was preserved byte-for-byte
  on every failing case.
- `git diff --check` on `scripts/vam_v5_metadata_capture_wrapper.sh` and
  `docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json` → **clean**.
- `git diff --cached --quiet` → **index remains empty**.
- No repository-resident or repository-parent-resident temporary file confirmed absent
  after every test (checked both `scripts/` and the repository's parent directory).

### Machine-verifiable values

| Item | Path | SHA-256 |
|---|---|---|
| Wrapper (sole execution authority) | `scripts/vam_v5_metadata_capture_wrapper.sh` | `0ccead7fa82e897e485e8ecd03c5da1837fb09cae491506fc831e86308160a87` |
| Sanitizer | `scripts/vam_v5_metadata_evidence_sanitizer.mjs` | `c9d0f3d3473fdc95045b439fb88a6e49bb80d9b09e69feed4cbed92a35114494` |
| Capture SQL | `docs/audits/sql/design_only/VAM_OS_V5_METADATA_EVIDENCE_CAPTURE.sql` | `b8315d1bb6d89ff482d20ccccc8e659f9f5ebd2f9f5b57dee092aa70dfac9c56` |
| Evidence template (also the publication target) | `docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json` | `fc675160638dc0d978be0d1f5dddf13ec12ca4a7ca97f7ea5ec19378a47da3bd` |
| Migration 062 (protected, unchanged, not edited) | `supabase_migrations/062_review_only_account_admin_rls_foundation.sql` | `1a366dc03cc4810fb53946bbe6a7c04e30828adecec51963ccd9c2d74ff96c58` |
| Preflight (protected, unchanged, not edited) | `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql` | `ab6dfb708a855da97466814d2ec770c40d61fc8985a6c24531f3c9185b53848a` |
| Rollback (protected, unchanged, not edited) | `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_ROLLBACK.sql` | `062d924dd688c419dc4a1c16ef2faa6ef0b209f825a5de8e827d3bbdd7f6ddbe` |
| Post-apply verification (protected, unchanged, not edited) | `docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql` | `5cff548d8df4a55dadf5742a537586ff444a760b32d9df7d5b737bb73764ac60` |

- **Final evidence path:** `docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json`
  (both the sanitizer's read-only template and the wrapper's sole publication target).
- **Index-empty state:** confirmed (`git diff --cached --quiet` exit `0`).
- **Wrapper syntax result:** OK (`bash -n`, no line over 100 characters).
- **Sanitizer syntax result:** OK (`node --check`).
- **Fabricated test result:** full 12-case matrix passed with no regression; exactly one
  `CAPTURE_OK`; zero dummy-URI leaks anywhere in captured output.
- **Credential-scope test result:** `psql` placeholder receives `PGDATABASE` only; the
  sanitizer stand-in receives none of the four credential-bearing variable names; the
  dummy URI never appeared in any argv or captured stdout/stderr; `remove_temp_state()`
  verified to unset all four variables directly, in-process.

### Explicit statements

- **The standalone wrapper file, `scripts/vam_v5_metadata_capture_wrapper.sh`, is the
  sole execution authority.** Its SHA-256 as of this attestation is
  `0ccead7fa82e897e485e8ecd03c5da1837fb09cae491506fc831e86308160a87`.
- **All embedded Markdown wrappers (v1 and v2 in §"FINAL HUMAN EXECUTION GATE") are
  superseded and must not be executed.**
- **Migration 062 remains blocked and unapplied.**
- **Executing Artifact 0 (the read-only metadata capture) does not authorize migration
  remediation or application** — CONFLICT-01/02/03 (§6) still require a separate,
  explicit human decision regardless of what the capture returns.

### Exact later command that would verify the wrapper's hash and, only on an exact match,
execute it (not run in this turn)

```bash
EXPECTED="0ccead7fa82e897e485e8ecd03c5da1837fb09cae491506fc831e86308160a87"
ACTUAL="$(sha256sum scripts/vam_v5_metadata_capture_wrapper.sh | cut -d' ' -f1)"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "WRAPPER_HASH_MISMATCH refuse_to_run"
  exit 1
else
  bash scripts/vam_v5_metadata_capture_wrapper.sh
fi
```

**This command was not run in this turn.** Presenting it satisfies the report requirement
to state the exact later command; it does not authorize running it, and running the
wrapper it invokes still requires `STAGING_DATABASE_URL` to be set to the approved staging
value by whoever runs it — this attestation does not set, inspect, or supply that value.

---

## 20. Minimal Staging Diagnostic — Overnight Readiness Review

**Status: independent static review only. No database, no Bash, no PowerShell, no Node
execution, no Python execution, no psql, no network, no Git write. This section was
produced using only the Read/Glob/Grep/Edit tools against this repository file and the
session's own prior scratchpad artifacts. No real diagnostic has run. No root cause of
the first capture failure has been proven.**

### 20.1 First capture failure summary

The first human-approved Artifact 0 capture attempt (via
`scripts/vam_v5_metadata_capture_wrapper.sh`, executed under a separate, explicit
one-time authorization) produced:

```
TARGET_PREFLIGHT stagingVariablePresent=true postgresUriShape=true approvedStagingRefPresent=true productionRefAbsent=true
sanitizer: sections=11 flagged=0 diagnostics=0 unsectioned=1 unknownMarkers=0 dupMarkers=0 allPassed=false
CAPTURE_FAILED psql_exit=2 node_exit=1
```

The wrapper's own preflight, hash-pinning, and credential-scoping all passed — the
failure occurred inside the `psql`-to-sanitizer pipeline itself. `psql` exit code `2` is
psql's own documented exit status for "the connection to the server went bad and the
session was not interactive" — distinct from exit code `3` ("an error occurred in a
script and `ON_ERROR_STOP` was set"). This is a **connection-layer** failure signature,
not a SQL-script-error signature, and must not be described as the latter. The previous
evidence file (`docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json`)
was preserved unchanged, exactly as the wrapper's fail-closed design requires.

### 20.2 Diagnostic purpose and limits

The prepared diagnostic package exists to answer one narrow question — can the same
credential-scoped `PGDATABASE` connection establish and complete a tiny read-only
transaction — with enough sanitized detail to classify *why* it cannot, without ever
touching application data or exposing any credential. It does **not** attempt to
determine the specific root cause of the exit-2 failure on its own; §20.10 below is a
hypothesis matrix, not a diagnosis. It does **not** authorize retrying the full metadata
capture, and it does **not** authorize migration 062 under any outcome.

### 20.3 Complete classifier source (scratchpad only, not a repository file)

**⚠ SUPERSEDED — MUST NOT EXECUTE.** This scratchpad classifier and its four material
defects (§20.8 items 11, 12, 15, 16) are superseded by the finalized, defect-fixed
repository file `scripts/vam_v5_psql_diagnostic_classifier.mjs` — see §20.15. Retained
below only for audit-trail continuity.

Path: `<session scratchpad>/diagnostic/vam_v5_connection_diagnostic_classifier.mjs`
SHA-256 (as of this review): `cb6c4566715563fc696a1f14be889c573a240f2fb175e18300f495f5b1afd565`

```javascript
#!/usr/bin/env node
// VAM OS V5 connection-diagnostic classifier -- SCRATCHPAD DESIGN ARTIFACT, NOT A
// REPOSITORY FILE. Not executed against any real psql output in this turn.
//
// Contract
// --------
// Stdin:  the complete combined stdout+stderr of ONE run of the minimal read-only
//         diagnostic SQL (see vam_v5_connection_diagnostic.sql) through psql --csv.
//         Buffered fully in memory, never written to disk, never echoed back.
// Output: exactly one line on stdout:
//           "DIAGNOSTIC_OK database=<name> transaction_read_only=<on|off> "
//           "server_version_present=<true|false> statement_timeout=<value> "
//           "lock_timeout=<value>"
//         or
//           "DIAGNOSTIC_FAILED category=<enum>"
// Exit:   0 only for DIAGNOSTIC_OK with transaction_read_only=on; 1 otherwise.
//
// This process is the streaming second stage of a shell pipeline
// (psql ... | node this-script.mjs), started concurrently with psql, so it has no way
// to know psql's own exit code (only available to the calling shell afterward, via
// PIPESTATUS). It therefore never claims a psql_exit value of its own -- the calling
// wrapper is responsible for reporting psql_exit separately, alongside this script's
// category, exactly like the existing capture wrapper's
// "CAPTURE_FAILED psql_exit=$PSQL_EXIT node_exit=$NODE_EXIT" convention.
//
// Never prints, persists, or re-throws any fragment of stdin: no hostnames, usernames,
// passwords, connection strings, emails, SQL error text, server messages, or excerpts.
// Category matching happens against the in-memory buffer only; the buffer is never
// referenced again once a verdict has been produced, and no catch block below ever
// reads the caught error object (so no fragment of buffered input can leak via an
// exception message or stack trace).

const CATEGORY_PATTERNS = [
  {
    category: "authentication_failed",
    re: /password authentication failed|role "[^"]*" does not exist|SASL authentication failed|FATAL:\s*.*[Pp]assword/i,
  },
  {
    category: "dns_resolution_failed",
    re: /could not translate host ?name|Name or service not known|Temporary failure in name resolution|nodename nor servname provided/i,
  },
  {
    category: "connection_refused",
    re: /Connection refused|Is the server running on host/i,
  },
  {
    category: "connection_timeout",
    re: /timeout expired|Connection timed out|Operation timed out/i,
  },
  {
    category: "tls_or_ssl_failure",
    re: /SSL error|SSL SYSCALL|SSL connection has been closed|certificate verify failed|server does not support SSL|SSL is not enabled on the server/i,
  },
  {
    category: "server_closed_connection",
    re: /server closed the connection unexpectedly|the connection to the server was lost|EOF detected/i,
  },
  {
    category: "pooler_or_server_unavailable",
    re: /too many clients already|remaining connection slots are reserved|no more connections allowed|max_client_conn|terminating connection due to administrator command/i,
  },
  {
    category: "malformed_connection_uri",
    re: /invalid URI query parameter|invalid connection option|missing "=" after|invalid integer value|invalid connection-string syntax|failed to parse/i,
  },
  {
    category: "sql_script_error",
    re: /^ERROR:\s/m,
  },
];

const EXPECTED_HEADER =
  "database_name,transaction_read_only,server_version,statement_timeout,lock_timeout";

function classifyFailure(buffer) {
  for (const p of CATEGORY_PATTERNS) {
    if (p.re.test(buffer)) return p.category;
  }
  return "unknown_connection_failure";
}

function tryParseSuccessRow(buffer) {
  const lines = buffer.split(/\r?\n/).map((l) => l.trim());
  const headerIdx = lines.findIndex((l) => l === EXPECTED_HEADER);
  if (headerIdx === -1) return null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].length === 0) continue;
    const cols = lines[i].split(",");
    if (cols.length !== 5) return null;
    const [database, txReadOnly, serverVersion, statementTimeout, lockTimeout] = cols;
    return {
      database,
      transactionReadOnly: txReadOnly,
      serverVersionPresent: serverVersion.length > 0,
      statementTimeout,
      lockTimeout,
    };
  }
  return null;
}

let buffer = "";
let sawAnyData = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  sawAnyData = true;
});
process.stdin.on("error", () => {
  process.stdout.write("DIAGNOSTIC_FAILED category=unknown_connection_failure\n");
  process.exit(1);
});

process.stdin.on("end", () => {
  try {
    if (!sawAnyData || buffer.trim().length === 0) {
      process.stdout.write("DIAGNOSTIC_FAILED category=unexpected_output\n");
      process.exit(1);
      return;
    }

    const row = tryParseSuccessRow(buffer);
    if (row) {
      if (row.transactionReadOnly !== "on") {
        // DIAGNOSTIC_OK must never be printed for anything but a genuine read-only
        // session -- a caller matching on the "DIAGNOSTIC_OK" string alone (rather
        // than also checking the exit code) must not be misled. This state (the
        // connection and query succeeded, but the session was not read-only) is not
        // a "connection failure" in the sense the eleven defined categories describe,
        // so it maps to unexpected_output rather than inventing a twelfth category
        // outside that closed list.
        process.stdout.write("DIAGNOSTIC_FAILED category=unexpected_output\n");
        process.exit(1);
        return;
      }
      const line =
        `DIAGNOSTIC_OK database=${row.database} ` +
        `transaction_read_only=${row.transactionReadOnly} ` +
        `server_version_present=${row.serverVersionPresent} ` +
        `statement_timeout=${row.statementTimeout} ` +
        `lock_timeout=${row.lockTimeout}`;
      process.stdout.write(line + "\n");
      process.exit(0);
      return;
    }

    const category = classifyFailure(buffer);
    process.stdout.write(`DIAGNOSTIC_FAILED category=${category}\n`);
    process.exit(1);
  } catch {
    // Deliberately does not reference the caught error object -- no message, no
    // stack, so no fragment of buffered input can leak via an exception path.
    process.stdout.write("DIAGNOSTIC_FAILED category=unexpected_output\n");
    process.exit(1);
  } finally {
    buffer = "";
  }
});
```

### 20.4 Classifier contract

- **Input:** combined stdout+stderr of one `psql --csv` run of the minimal diagnostic SQL.
- **Output:** exactly one line — `DIAGNOSTIC_OK database=<name> transaction_read_only=on server_version_present=<bool> statement_timeout=<value> lock_timeout=<value>`, or `DIAGNOSTIC_FAILED category=<enum>`.
- **Exit codes:** `0` only for a genuine `DIAGNOSTIC_OK` with `transaction_read_only=on`; `1` for every other reachable path (stdin error, empty input, unparseable/truncated output, non-read-only session, any classified or unclassified failure).
- **Allowed categories:** `authentication_failed`, `dns_resolution_failed`, `connection_refused`, `connection_timeout`, `tls_or_ssl_failure`, `server_closed_connection`, `pooler_or_server_unavailable`, `malformed_connection_uri`, `sql_script_error`, `unexpected_output`, `unknown_connection_failure`.
- **Never prints:** raw input, hostnames, usernames, passwords, connection strings, emails, SQL error text, server messages, or any excerpt/fragment of stdin, under any code path including exceptions.

### 20.5 Minimal diagnostic SQL

Path: `<session scratchpad>/diagnostic/vam_v5_connection_diagnostic.sql`

```sql
-- VAM_OS_V5_CONNECTION_DIAGNOSTIC.sql -- SCRATCHPAD DESIGN ARTIFACT, NOT A REPOSITORY
-- FILE. Not executed against any database in this turn.
--
-- Purpose: minimal read-only probe to determine whether the credential-scoped
-- PGDATABASE connection can establish and complete a tiny read-only transaction.
-- No application relations, no catalog inventory, no row counts, no auth.users, no
-- application function, no DDL, no DML, no RPC, no HTTP, no production access.

begin transaction read only;

set local statement_timeout = '10s';
set local lock_timeout = '3s';

select
  current_database() as database_name,
  current_setting('transaction_read_only') as transaction_read_only,
  current_setting('server_version') as server_version,
  current_setting('statement_timeout') as statement_timeout,
  current_setting('lock_timeout') as lock_timeout;

rollback;
```

### 20.6 Complete proposed one-time diagnostic command (not executed)

**⚠ SUPERSEDED — MUST NOT EXECUTE.** This scratchpad command (which also lacked
hash-pinning and signal traps) is superseded by the finalized repository file
`scripts/vam_v5_minimal_staging_diagnostic.sh` — see §20.15. Retained below only for
audit-trail continuity.

Path: `<session scratchpad>/diagnostic/vam_v5_connection_diagnostic_command.sh`.
`CLASSIFIER` is deliberately left as a placeholder — a future, separately-authorized turn
must decide where the classifier is allowed to live at execution time (scratchpad again,
or promoted into the repository with explicit approval, mirroring the capture wrapper's
own phased history).

```bash
#!/usr/bin/env bash
# VAM OS V5 connection diagnostic -- SCRATCHPAD DESIGN ARTIFACT, NOT A REPOSITORY FILE
# AND NOT EXECUTED IN THIS TURN. Prepared for a future, separately-authorized turn.
set -u
set -o pipefail
set +x
umask 077

unset PGDATABASE
unset PGHOST
unset PGHOSTADDR
unset PGPORT
unset PGUSER
unset PGPASSWORD
unset PGPASSFILE
unset PGSERVICE
unset PGSERVICEFILE
unset PGOPTIONS

export PGSSLMODE=require
export PGCONNECT_TIMEOUT=10

PSQL="/c/Program Files/PostgreSQL/17/bin/psql.exe"
# CLASSIFIER path is intentionally a placeholder -- see 20.6 for rationale.
CLASSIFIER="<classifier-path>"
APPROVED_REF="ljfneyuvpxrmejpxsmpz"
EXCLUDED_PROD_REF="qkkroesfiazsejkzflcd"

STAGING_VAR_PRESENT=false
POSTGRES_URI_SHAPE=false
APPROVED_STAGING_REF_PRESENT=false
PRODUCTION_REF_ABSENT=false

if [ -n "${STAGING_DATABASE_URL:-}" ]; then
  STAGING_VAR_PRESENT=true
fi

if [ "$STAGING_VAR_PRESENT" = true ]; then
  case "$STAGING_DATABASE_URL" in
    postgres://*|postgresql://*) POSTGRES_URI_SHAPE=true ;;
  esac
  case "$STAGING_DATABASE_URL" in
    *"$APPROVED_REF"*) APPROVED_STAGING_REF_PRESENT=true ;;
  esac
  case "$STAGING_DATABASE_URL" in
    *"$EXCLUDED_PROD_REF"*) PRODUCTION_REF_ABSENT=false ;;
    *) PRODUCTION_REF_ABSENT=true ;;
  esac
fi

PREFLIGHT_MSG="TARGET_PREFLIGHT stagingVariablePresent=$STAGING_VAR_PRESENT"
PREFLIGHT_MSG="$PREFLIGHT_MSG postgresUriShape=$POSTGRES_URI_SHAPE"
PREFLIGHT_MSG="$PREFLIGHT_MSG approvedStagingRefPresent=$APPROVED_STAGING_REF_PRESENT"
PREFLIGHT_MSG="$PREFLIGHT_MSG productionRefAbsent=$PRODUCTION_REF_ABSENT"
echo "$PREFLIGHT_MSG"

if [ "$STAGING_VAR_PRESENT" != true ] || [ "$POSTGRES_URI_SHAPE" != true ] || \
   [ "$APPROVED_STAGING_REF_PRESENT" != true ] || [ "$PRODUCTION_REF_ABSENT" != true ]; then
  echo "DIAGNOSTIC_REFUSED reason=target_preflight_failed"
  exit 1
fi

DB_URI="$STAGING_DATABASE_URL"
unset STAGING_DATABASE_URL

PGDATABASE="$DB_URI" "$PSQL" -X -q --csv -v ON_ERROR_STOP=1 2>&1 <<'DIAG_SQL' \
  | env -u PGDATABASE -u DB_URI -u STAGING_DATABASE_URL -u PGPASSWORD \
      node "$CLASSIFIER"
begin transaction read only;
set local statement_timeout = '10s';
set local lock_timeout = '3s';
select
  current_database() as database_name,
  current_setting('transaction_read_only') as transaction_read_only,
  current_setting('server_version') as server_version,
  current_setting('statement_timeout') as statement_timeout,
  current_setting('lock_timeout') as lock_timeout;
rollback;
DIAG_SQL

PIPE_CODES=("${PIPESTATUS[@]}")
unset DB_URI
PSQL_EXIT="${PIPE_CODES[0]:-999}"
CLASSIFIER_EXIT="${PIPE_CODES[1]:-999}"

echo "DIAGNOSTIC_RESULT psql_exit=$PSQL_EXIT classifier_exit=$CLASSIFIER_EXIT"
```

### 20.7 Fabricated 16-case test matrix (all local, no real credential; results as captured
in the scratchpad session log)

| # | Case | Result | Exit |
|---|---|---|---|
| 1 | Valid success CSV | `DIAGNOSTIC_OK database=postgres transaction_read_only=on server_version_present=true statement_timeout=10s lock_timeout=3s` | 0 |
| 2 | Authentication failure | `category=authentication_failed` | 1 |
| 3 | DNS failure | `category=dns_resolution_failed` | 1 |
| 4 | Connection refused | `category=connection_refused` | 1 |
| 5 | Connection timeout | `category=connection_timeout` | 1 |
| 6 | SSL failure | `category=tls_or_ssl_failure` | 1 |
| 7 | Server closed connection | `category=server_closed_connection` | 1 |
| 8 | Malformed URI | `category=malformed_connection_uri` | 1 |
| 9 | SQL-script error | `category=sql_script_error` | 1 |
| 10 | Unknown error | `category=unknown_connection_failure` | 1 |
| 11 | Empty input | `category=unexpected_output` | 1 |
| 12 | Truncated success (header, no row) | `category=unknown_connection_failure` | 1 |
| 13 | Embedded fabricated connection URI | `category=authentication_failed`, URI absent from output | 1 |
| 14 | Embedded fabricated password | `category=authentication_failed`, password absent from output | 1 |
| 15 | Embedded fabricated email | `category=connection_refused`, email absent from output | 1 |
| 16 | Valid row, `transaction_read_only=off` | `category=unexpected_output` (not `DIAGNOSTIC_OK`) | 1 |

A separate live scratchpad test of the full diagnostic command (fake `psql` + fake
classifier stand-in, fabricated dummy URI, never the real `STAGING_DATABASE_URL`)
confirmed: the fake `psql` received `PGDATABASE` only, with argv limited to
`-X -q --csv -v ON_ERROR_STOP=1` (no URI); the fake classifier stand-in received none of
`PGDATABASE`/`DB_URI`/`STAGING_DATABASE_URL`/`PGPASSWORD` and empty argv; zero matches for
the fabricated dummy URI anywhere in captured output across every case.

### 20.8 Independent classifier review (20 items)

Reviewed as an independent reader of §20.3's source, not as its author.

| # | Item | Verdict | Note |
|---|---|---|---|
| 1 | Exact success recognition | PASS | Requires exact header match + a parseable 5-column row. |
| 2 | CSV parsing assumptions | RESIDUAL LIMITATION | Naive `split(",")`, no RFC4180 quote/escape handling. None of the five expected columns can legitimately contain a comma, and a violation fails closed (`cols.length !== 5` → null → classified as failure), never open. |
| 3 | CRLF and LF handling | PASS | `split(/\r?\n/)` handles both. |
| 4 | Optional UTF-8 BOM handling | RESIDUAL LIMITATION | A leading BOM is not stripped before the header comparison. `.trim()` does not remove U+FEFF. If a BOM ever prefixed the header line itself, a genuinely healthy connection would be misreported as unclassifiable — a false negative, never a false positive, but a real precision gap. Not verified against this specific Windows/Git-Bash/libpq environment's actual encoding behavior. |
| 5 | Quoted CSV fields | RESIDUAL LIMITATION | Same root cause as #2. |
| 6 | Empty rows | PASS | Blank lines after the header are skipped correctly. |
| 7 | Truncated output | PASS | Empirically verified (case 12): falls through to `unknown_connection_failure`. |
| 8 | Duplicate rows | RESIDUAL LIMITATION | Only the first non-empty line after the header is read; a second, contradictory row would be silently ignored. Not expected under normal operation (a single unaggregated `SELECT`), but not defended against either. |
| 9 | Multiple success rows | RESIDUAL LIMITATION | Same mechanism as #8. |
| 10 | `transaction_read_only` must equal exactly `"on"` | PASS | Strict `!==` check; corrected during this session's earlier round after an initial gap where `off` would have wrongly printed inside a `DIAGNOSTIC_OK` line — re-verified in this review by re-reading the current source (§20.3), which reflects the corrected version. |
| 11 | `statement_timeout` must equal the bounded expected value | **MATERIAL DEFECT** | The classifier echoes `row.statementTimeout` verbatim into the `DIAGNOSTIC_OK` line but never validates it against any bound. A disabled (`0`) or excessively large value would still print inside an otherwise-successful-looking line. The capture-wrapper's own sanitizer enforces exactly this kind of bound (`statementTimeoutBounded`); this classifier does not mirror that check. |
| 12 | `lock_timeout` must equal the bounded expected value | **MATERIAL DEFECT** | Same gap as #11, for `lock_timeout`. |
| 13 | `database_name` must equal the expected database where appropriate | RESIDUAL LIMITATION | Not enforced. Low incremental value even if added: Supabase reports `current_database()` as `"postgres"` for every project regardless of identity (already established in §16 FINDING-D), so this specific field cannot distinguish the approved staging project from any other Supabase project either way. |
| 14 | Server version present but not trusted as project identity | PASS | Reports only a boolean (`server_version_present`), never the actual version string — matches the design intent exactly. |
| 15 | Classification precedence | **MATERIAL DEFECT** | This review specifies checking order: malformed URI, authentication, DNS, refusal, timeout, SSL, server-closed, SQL-script error, unknown. The implemented order (§20.3) is: authentication, DNS, refused, timeout, SSL, server-closed, pooler, **malformed URI is eighth**, SQL-script error, unknown-as-fallback. `malformed_connection_uri` should plausibly be checked first (a malformed URI is a client-side configuration error, logically prior to and distinct from any server-side auth/network symptom), and does not occupy that position today. No fixture in §20.7 currently demonstrates a concrete misclassification from this ordering (the two patterns' trigger phrases do not appear to overlap in practice), but the deviation from the specified order is real and unverified as harmless. |
| 16 | Whether a generic pattern could hide a more specific category | **MATERIAL DEFECT** | `sql_script_error`'s pattern (`/^ERROR:\s/m`) is a broad, generic, line-start match, positioned immediately before the final `unknown_connection_failure` fallback. An unrecognized *connection-level* failure that happens to contain any line starting with `ERROR:` would be misclassified as `sql_script_error` rather than `unknown_connection_failure`. This is precisely the miscategorization this diagnostic exists to avoid — psql exit code 3 (SQL script error under `ON_ERROR_STOP`) and exit code 2 (connection went bad, the observed first-attempt result) are documented as distinct by psql itself, and the classifier's text-only category has no way to cross-check itself against the numeric exit code the outer command separately reports (see §20.9 item 23) — so a `sql_script_error` category label appearing alongside `psql_exit=2` would be an internally inconsistent combination that nothing currently flags as suspicious. |
| 17 | Whether any raw input can reach stdout/stderr/exceptions/stack traces/files/diagnostics | PASS | Verified line by line: no `fs` writes anywhere; no `console.error`/`process.stderr.write` calls at all; the sole `catch` block never references the caught error object; every reachable branch emits only a fixed-template string or an individually-extracted, position-validated CSV field value. |
| 18 | Whether hostile input (newlines, ANSI control characters, fake classifier-shaped output) can spoof the sanitized result | RESIDUAL LIMITATION | The classifier never echoes raw input verbatim under any path (confirmed in #17), so injected text cannot itself appear on the classifier's stdout. Success-recognition short-circuits before failure-pattern matching runs, so incidental failure-phrase text embedded within an otherwise-valid row's field values would not flip a genuine success to a reported failure. The classifier inherently trusts whatever byte stream arrives on its stdin (a standard, unavoidable trust boundary for a pipe's second stage reading its own locally-spawned first stage) — every constructed adversarial scenario analyzed fails closed; none produces a false `DIAGNOSTIC_OK`. |
| 19 | Whether the classifier ever returns success when parsing is incomplete | PASS | Success requires an exact header match, a subsequent line with exactly 5 columns, and `transactionReadOnly === "on"`; any shortfall in any of these falls through to a failure category. |
| 20 | Whether failure always returns non-zero | PASS | Every reachable code path (stdin error, empty input, non-read-only, classified failure, unclassified failure, caught exception) calls `process.exit(1)` explicitly; success calls `process.exit(0)` only after the strict `"on"` check. No path can fall through to an implicit exit code. |

**Summary: 4 MATERIAL DEFECT, 7 RESIDUAL LIMITATION, 9 PASS.** None of the material
defects create a false-success or credential-leak risk — all four are precision/coverage
gaps that a future, explicitly-authorized editing turn should close before the classifier
is relied upon for a nuanced diagnosis (as opposed to a plain success/failure signal,
which remains reliable today).

### 20.9 Independent command review (25 items)

Reviewed as an independent reader of §20.6's source, not as its author.

| # | Item | Verdict | Note |
|---|---|---|---|
| 1 | `set -u` | PASS | Present. |
| 2 | `set -o pipefail` | PASS | Present. |
| 3 | `set +x` | PASS | Present, explicit. |
| 4 | `umask 077` | NOT APPLICABLE | Present (matches capture-wrapper convention) but inert here: this diagnostic never writes any file, so there is nothing for the umask to apply to. Harmless, not a defect. |
| 5 | Removal of inherited libpq variables | PASS | Identical 10-variable `unset` block to the capture wrapper. |
| 6 | Non-printing staging target preflight | PASS | Pure `[ ]`/`case` builtins; no subprocess ever sees the value. |
| 7 | URI-shape validation | PASS | `postgres://*` / `postgresql://*` case match. |
| 8 | Approved staging ref validation | PASS | Substring `case` match against `ljfneyuvpxrmejpxsmpz`. |
| 9 | Production ref rejection | PASS | Substring `case` match against `qkkroesfiazsejkzflcd`. |
| 10 | No URI in argv | PASS | Empirically verified this session: fake-psql argv probe showed only `-X -q --csv -v ON_ERROR_STOP=1`. |
| 11 | `PGDATABASE` scoped only to `psql` | PASS | Simple-command prefix assignment, not `export`. |
| 12 | Classifier receives none of `PGDATABASE`/`DB_URI`/`STAGING_DATABASE_URL`/`PGPASSWORD` | PASS | `env -u` ×4; empirically verified via a fake-classifier env probe this session (all four reported `absent`). |
| 13 | Correct heredoc and pipeline syntax | PASS | `bash -n` syntax-clean; live test confirmed the heredoc correctly fed the fake psql's stdin while stdout/stderr piped to the fake classifier. |
| 14 | Exact PostgreSQL 17 psql path | PASS | Matches the capture wrapper's own pinned path exactly. |
| 15 | Correct use of `-X`/`-q`/`--csv`/`-v ON_ERROR_STOP=1` | PASS | All four present, no extraneous flags. |
| 16 | Minimal SQL sent through stdin | PASS | Heredoc (`<<'DIAG_SQL'`), not `-f`. |
| 17 | Immediate one-operation `PIPESTATUS` capture | PASS | `PIPE_CODES=("${PIPESTATUS[@]}")` immediately after the pipeline, before any other command. |
| 18 | `DB_URI` unset immediately after pipeline completion | PASS | Line immediately following the `PIPE_CODES` capture. |
| 19 | No automatic retry | PASS | No loop, no re-invocation anywhere in the script. |
| 20 | No file output | PASS | No redirection to any file anywhere in the script; the classifier itself writes no files either. |
| 21 | No repository mutation | PASS | No `git`, no file-write, no `mv`/`cp` targeting any repository path anywhere in the script. |
| 22 | Sanitized-only terminal output | PASS | The script's own lines (`TARGET_PREFLIGHT ...`, `DIAGNOSTIC_REFUSED ...`, `DIAGNOSTIC_RESULT psql_exit=... classifier_exit=...`) are all fixed-template/boolean/numeric; the classifier's own line was independently reviewed in §20.8 and found to only ever print fixed-shape sanitized content. |
| 23 | Correct distinction between classifier exit / psql exit / combined interpretation | RESIDUAL LIMITATION | The script reports `psql_exit` and `classifier_exit` as two separate numbers but does not itself cross-validate their combination against the classifier's *category* — e.g. it would not flag `classifier_exit=1` with a `sql_script_error` category occurring alongside `psql_exit=2` as the internally-inconsistent combination it actually is (§20.8 item 16). A human reading the two lines together must currently do that cross-referencing themselves. |
| 24 | Safe behavior on HUP, INT, TERM | RESIDUAL LIMITATION | No `trap` of any kind is present, unlike the capture wrapper's explicit split EXIT/HUP/INT/TERM handlers. This is materially less consequential here than it would be for the capture wrapper, because this diagnostic creates no persistent state (no temp files, no candidate file, no publication target) — `DB_URI`/`PGDATABASE` are transient shell/child-process state that vanishes with the process regardless of an explicit `unset`. The main real gap is cosmetic: on interruption there is no explicit `DIAGNOSTIC_INTERRUPTED signal=...` message, only bash's own default termination behavior, leaving a human watching the terminal without an explicit confirmation of what happened. Worth adding in a future round; not a safety gap given the absence of mutable state to protect. |
| 25 | Windows Git Bash path and quoting behavior | PASS (with a caveat) | `"$PSQL"` is correctly double-quoted for the space-containing path, mirroring the already-tested capture-wrapper convention; the heredoc delimiter is correctly single-quoted (`<<'DIAG_SQL'`) to disable all interpolation, which is defensively correct even though the static SQL body contains no `$`. **Not independently verified against a real `psql.exe` invocation in this environment** — only against the fabricated stand-in — which is exactly the limitation §20.2 and §20.10 already flag: no real diagnostic has run. |

**Summary: 21 PASS (1 marked NOT APPLICABLE in effect), 2 RESIDUAL LIMITATION, 0 MATERIAL
DEFECT.** The command's own structure is sound; its two residual limitations are minor
UX/cross-referencing gaps, not safety gaps.

### 20.10 `psql` exit-2 hypothesis matrix

No hypothesis below is selected as the root cause. The minimal diagnostic, once
explicitly authorized and run, is what can actually discriminate between these.

| Hypothesis | Consistent with exit 2? | Existing evidence support | Can the minimal diagnostic confirm/reject it? | Next safe action if confirmed | Full capture retry prohibited regardless |
|---|---|---|---|---|---|
| Authentication failure | Yes | Neutral — the failed capture's sanitized output contains no auth-specific signal | Yes — classifier would report `authentication_failed` | Stop; verify/reset the staging password through a separately-approved process | Yes |
| DNS resolution failure | Yes | Neutral | Yes — `dns_resolution_failed` | Stop; diagnose DNS/network layer | Yes |
| Connection refused | Yes | Neutral | Yes — `connection_refused` | Stop; diagnose whether the target host/port is reachable and accepting connections | Yes |
| Connection timeout | Yes | Neutral | Yes — `connection_timeout` | Stop; diagnose network path / firewall / VPN | Yes |
| SSL/TLS failure | Yes | Neutral | Yes — `tls_or_ssl_failure` | Stop; diagnose certificate/SSL negotiation | Yes |
| Pooler unavailable | Yes | Neutral | Yes — `pooler_or_server_unavailable` | Stop; diagnose Supabase pooler/connection-limit state | Yes |
| Server closed connection | Yes | Neutral | Yes — `server_closed_connection` | Stop; diagnose server-side stability/restart | Yes |
| Malformed URI | Yes (psql would refuse to even attempt the connection) | Weak — the wrapper's own preflight already confirms `postgresUriShape=true` (a `postgres://`/`postgresql://` prefix check), which somewhat reduces but does not eliminate this possibility (the preflight does not validate the full URI grammar, only the scheme prefix) | Yes — `malformed_connection_uri` | Stop; review `STAGING_DATABASE_URL`'s full structure through a separately-approved process | Yes |
| Network interruption (transient) | Yes | Neutral | Partial — a single diagnostic run cannot distinguish transient from persistent; would need to be observed as intermittent across attempts | Stop; consider retrying only the diagnostic (not the full capture) once, with explicit approval | Yes |
| Pooler session termination mid-query | Yes | **Weak positive** — the capture query is a substantially larger, longer-running, multi-section catalog query than this diagnostic's trivial one-row `SELECT`; if the pooler enforces a statement/session duration limit tighter than the capture SQL's own `statement_timeout=15s`, a mid-query termination is plausible | The minimal diagnostic (a much shorter, simpler query) could succeed even if this hypothesis is true, since it wouldn't run long enough to trigger the same limit — a **negative** diagnostic result here would not fully rule this out | If the minimal diagnostic succeeds but a future, separately-authorized full capture still exit-2s, this hypothesis gains support | Yes |
| Statement or server-side timeout | Yes | Weak positive, same reasoning as above | Same caveat as above — a short diagnostic query may not exercise the same timeout path as the full capture | If diagnostic succeeds but capture still fails, consider a future, separately-authorized *section-by-section* capture design | Yes |
| Output interleaving (stdout/stderr race, §16 FINDING-C) | Consistent as a *contributing* factor, not as the exit-2 cause itself | **Positive** — the actual failure showed `unsectioned=1`, exactly the signature FINDING-C predicted for a connection-layer message landing outside any section marker; this is consistent with (though does not by itself prove) a connection-level FATAL message arriving interleaved with the section stream shortly before termination | No — the diagnostic's own psql invocation has the identical `2>&1` merge design, so it would exhibit the same interleaving behavior if triggered, but a one-row response gives interleaving very little surface area to manifest on | None specific to this hypothesis; already-documented residual, fails closed | Yes |
| Large catalog query/response causing connection termination | Yes | Weak positive, same reasoning as the pooler/timeout hypotheses — the capture SQL queries 17 relations across 11 sections; the diagnostic queries nothing but session state | Same caveat — a negative diagnostic result would not fully rule this out | If confirmed by a future, separately-authorized narrower capture test, consider redesigning the capture SQL into smaller batches | Yes |
| Windows/Git Bash/libpq environment behavior | Possible but unquantified | Neutral — nothing in the captured evidence specifically implicates the local client environment over the server/network | Partial — a successful diagnostic run would somewhat reduce suspicion of a purely-local client misconfiguration, since it uses the identical `psql.exe` binary and libpq environment handling as the capture wrapper | If the diagnostic itself fails to even start correctly (as opposed to psql reporting a categorized connection error), suspect the local environment first | Yes |

**Most evidentially supported hypotheses given current information, in order:** (1)
pooler/server session-duration or statement-timeout limits shorter than the capture
SQL's own bounds, given the capture query's greater size/duration versus a trivial probe,
and (2) output interleaving as a contributing factor to how the failure presented
(`unsectioned=1`), though not as an independent root cause. **This is a ranked hypothesis
list, not a conclusion** — the minimal diagnostic is what would actually test these once
authorized to run.

### 20.11 Morning decision tree

**A. Minimal diagnostic returns success (`DIAGNOSTIC_OK ... transaction_read_only=on`,
`psql_exit=0`, `classifier_exit=0`):** Do not immediately run migration 062. Prepare a
section-by-section metadata-capture diagnostic (splitting the 11-section capture SQL into
smaller, independently-timed probes) or an explicitly-approved plain retry plan — either
requires its own separate authorization.

**B. Authentication fails:** Stop. Verify/reset the staging database password only
through a separately-approved process. Do not retry the full capture automatically.

**C. DNS, refusal, timeout, SSL, or pooler failure occurs:** Stop. Diagnose the
connection layer. Preserve all repository artifacts. Do not modify the capture SQL.

**D. Minimal diagnostic reports `sql_script_error`:** Distinguish `psql` exit `3` from
exit `2` before concluding anything (§20.1, §20.8 item 16) — the classifier's category
alone is not sufficient; the numeric `psql_exit` on the `DIAGNOSTIC_RESULT` line must be
checked too. Review only the minimal SQL and command syntax, nothing else.

**E. Output is unknown or unclassifiable (`unknown_connection_failure` or
`unexpected_output`):** Stop. Do not expose raw output under any circumstance. Prepare a
narrower sanitized diagnostic (e.g. an additional, still-closed-list category, or an
adjustment to §20.8's flagged pattern-precedence/genericity gaps) as a separate,
explicitly-authorized editing turn.

**F. The diagnostic command itself fails a local safety gate (target preflight, or a
future hash-pinning check if one is added):** Do not connect. Repair locally and repeat
static/fabricated testing before proposing another authorization request.

### 20.12 Exact human approval required to run the diagnostic

A future turn must receive, at minimum: (1) explicit authorization to execute the
diagnostic command specifically (not a standing/blanket approval); (2) an explicit
decision on where the classifier is authorized to live at execution time, replacing the
`<classifier-path>` placeholder in §20.6; (3) acknowledgment of the four MATERIAL DEFECT
findings in §20.8 (items 11, 12, 15, 16) — accepted as residual for a plain success/
failure signal, or fixed first, at the approver's discretion; (4) confirmation that
`STAGING_DATABASE_URL` in the terminal that will run it is still the approved staging
value, re-checked at that time, not assumed from this session.

### 20.13 Exact stop conditions

Stop immediately, without retrying, if: the diagnostic's own target preflight fails; any
hash-pinning check (if added in a future revision) fails; `psql_exit` and
`classifier_exit` disagree with each other in a way §20.8/§20.9 flagged as
internally-inconsistent (e.g. `sql_script_error` alongside `psql_exit=2`); the classifier
reports `unknown_connection_failure` or `unexpected_output`; or any output does not match
one of the exact allowed formats in §20.4.

### 20.14 Explicit statements

- **No database diagnostic has run.** Everything in this section is static preparation
  and independent review, produced without Bash, PowerShell, Node execution, Python
  execution, psql, or network access.
- **No root cause of the first capture failure has been proven.** §20.10 is a ranked
  hypothesis matrix, not a diagnosis.
- **Migration 062 remains blocked and unapplied.**
- **A successful diagnostic does not authorize migration 062**, and does not authorize
  remediating CONFLICT-01/02/03 (§6) — those still require a separate, explicit human
  decision regardless of what any diagnostic or capture returns.
- **The full metadata capture must not be retried automatically** under any outcome of a
  future diagnostic run — any retry requires its own separate, explicit human
  authorization, exactly as the first capture attempt did.

### 20.15 Final Hardened Package (this turn — all four material defects fixed)

**Status: local-only. No `psql`, no network, no staging/production connection, no Git
write, no migration. `STAGING_DATABASE_URL` was neither inspected nor printed — every
test used a fabricated `.invalid`-TLD dummy URI (guaranteed never to resolve, per
RFC 2606) against a scratchpad harness, never the real repository evidence file.**

The overnight review (§20.8/§20.9) correctly declined to accept the four material
defects as residual. This turn moved the classifier and wrapper out of the scratchpad
into two permanent, hash-pinned repository files, fixing all four defects rather than
documenting them as accepted risk.

#### Final files (wrapper hash below is the value as of this Round's turn — see §20.16
for the current, superseding value after the TLS-hardening edit)

| File | SHA-256 |
|---|---|
| `scripts/vam_v5_psql_diagnostic_classifier.mjs` | `29a253bb763865445c3de8e7ec34dc4a3b2b17c0bc1e196596b424f2f05dacf6` (unchanged, current) |
| `scripts/vam_v5_minimal_staging_diagnostic.sh` | `0eaf9ac7ac23fbe34046dfbf1f8e2fc9df236af20a621715758a2e9552f8d6fd` (superseded — see §20.16) |

The wrapper embeds the classifier's hash as `EXPECTED_CLASSIFIER_SHA256` and refuses to
proceed (`DIAGNOSTIC_REFUSED reason=classifier_hash_mismatch`) before
`STAGING_DATABASE_URL` is touched in any way if the two ever diverge. The classifier was
finalized and hashed first; the wrapper was not written until that hash was fixed; the
classifier was not edited again afterward — re-verified by a final self-consistency
`sha256sum` pass after all testing, which reproduced both values above with no drift.

#### Classifier contract (final)

- **Input:** combined stdout+stderr of one `psql --csv` run of the minimal diagnostic
  SQL, on stdin only. No file input. No environment-variable dependency of any kind.
- **Success output (one exact literal line, never interpolated from input):**
  `DIAGNOSTIC_OK database=postgres transaction_read_only=on server_version_present=true statement_timeout=10s lock_timeout=3s`
- **Failure output:** `DIAGNOSTIC_FAILED category=<enum>`, `<enum>` one of
  `malformed_connection_uri`, `authentication_failed`, `dns_resolution_failed`,
  `connection_refused`, `connection_timeout`, `tls_or_ssl_failure`,
  `server_closed_connection`, `pooler_or_server_unavailable`, `sql_script_error`,
  `unexpected_output`, `unknown_connection_failure`.
- **Exit codes:** `0` only for a fully valid, exact-match success row; `1` for a
  classified diagnostic failure (including a structurally valid row with wrong values);
  `2` for a usage or internal classifier failure (stdin I/O error, uncaught exception).

#### Exact success criteria (Material Defects #1/#2 fixed)

Success now requires **all five** of: `transaction_read_only = on`,
`statement_timeout = 10s` (exact), `lock_timeout = 3s` (exact),
`database_name = postgres` (exact), and a non-empty `server_version`. Any single field
mismatch — including a disabled (`0`) or oversized timeout — returns
`DIAGNOSTIC_FAILED category=unexpected_output` directly, without running any text-pattern
matching (the CSV structure was well-formed; only the values were wrong, so there is
nothing further to search the buffer for).

#### Classification precedence (Material Defect #3 fixed)

Exactly the order specified for this review: `malformed_connection_uri` →
`authentication_failed` → `dns_resolution_failed` → `connection_refused` →
`connection_timeout` → `tls_or_ssl_failure` → `server_closed_connection` →
`pooler_or_server_unavailable` → `sql_script_error` → `unknown_connection_failure`
(fallback).

#### Generic-`ERROR:` guard (Material Defect #4 fixed)

`sql_script_error` now requires **both** a line matching `/^ERROR:\s+\S/m` **and the
absence** of any connection-fatal marker (`FATAL:`, `could not connect`,
`connection to server`) anywhere in the buffer. An unrecognized connection-level failure
that happens to also contain a stray `ERROR:`-prefixed line now falls through to
`unknown_connection_failure` instead of being mislabeled as a SQL-script error —
empirically verified (§20.15 test matrix, case 29).

#### Robust CSV parsing (Task 3 requirements)

A minimal RFC4180-shaped line parser (quoted fields, doubled-quote escaping, truncated-
quote detection) replaces the naive `split(",")` from the scratchpad version. The
success-recognizer requires: an optional single leading BOM stripped; LF or CRLF line
endings; an exact one-time header match; exactly one data row (zero or two-or-more both
reject); no unrecognized non-blank content anywhere in the stream other than the header,
the one data row, and a fixed set of expected psql command tags (`BEGIN`, `SET`,
`ROLLBACK`) — so genuine `psql` framing output is tolerated regardless of whether `-q`
suppresses it, while injected or anomalous content (including a fabricated
`DIAGNOSTIC_OK`-shaped line) is not.

#### Credential-scope and wrapper design

Identical discipline to `scripts/vam_v5_metadata_capture_wrapper.sh`: ten inherited
libpq variables unset at startup; hash-pinning before any credential handling; a
non-printing four-boolean target preflight; `DB_URI` as a plain, never-exported holder;
`PGDATABASE` scoped to `psql` only via a simple-command prefix assignment; the
classifier invoked through `env -u PGDATABASE -u DB_URI -u STAGING_DATABASE_URL
-u PGPASSWORD`; split `EXIT`-vs-`HUP`/`INT`/`TERM` signal handlers with hardcoded
non-zero signal exit codes (129/130/143); no file output; no repository mutation.

**Design change from the capture wrapper:** this environment's `bash` does not propagate
the `PIPESTATUS` array through a command substitution boundary (empirically verified
this turn — `out="$(false | echo x)"` immediately followed by reading `PIPESTATUS`
yields a single stale value, not the two-element array a direct pipeline produces). The
wrapper therefore runs `psql` alone inside its own plain substitution (`PSQL_EXIT=$?`
immediately after, unambiguous) and separately feeds the captured output to the
classifier inside a second, piped substitution (`CLASSIFIER_EXIT=$?` immediately after —
reliable specifically because `set -o pipefail` makes a substitution's own exit status
the rightmost non-zero code among its pipeline stages, also empirically verified this
turn). This is a *more* capable design than the capture wrapper's, not a weaker one: it
additionally captures the classifier's own output line into a variable, which is what
makes the cross-check below possible.

#### `psql`/classifier exit-code cross-check (Task 5 item 19)

- `psql_exit = 0` and classifier failure → overall failure (verified: case 41).
- `psql_exit = 2` and classifier reports `sql_script_error` → overall failure **and** an
  additional `DIAGNOSTIC_INCONSISTENT reason=sql_script_error_with_connection_level_exit_code`
  line (verified: extra case in §20.15 test matrix) — psql's own documented exit codes
  make exit `3`, not exit `2`, the one associated with a script error under
  `ON_ERROR_STOP=1`, so this specific combination is flagged as suspicious rather than
  silently accepted.
- `psql_exit = 3` alongside `sql_script_error` is not flagged (verified: case 40) —
  consistent with psql's own documented semantics.
- Any non-zero `psql_exit` always yields overall wrapper failure (verified throughout).
- Overall wrapper exit is `0` only when both `psql_exit = 0` and `classifier_exit = 0`.

#### Complete 44-case fabricated test matrix (all local, no real credential, no real
`psql`; dummy URIs use the reserved `.invalid` TLD so they can never resolve even if
misconfigured)

| # | Case | Expected | Result | PASS/FAIL | Leak? | psql reached? |
|---|---|---|---|---|---|---|
| 1 | Valid LF success | `DIAGNOSTIC_OK`, exit 0 | Match | PASS | No | — |
| 2 | Valid CRLF success | `DIAGNOSTIC_OK`, exit 0 | Match | PASS | No | — |
| 3 | Valid success with BOM | `DIAGNOSTIC_OK`, exit 0 | Match | PASS | No | — |
| 4 | Quoted CSV field | `DIAGNOSTIC_OK`, exit 0 | Match | PASS | No | — |
| 5 | Header only | `unknown_connection_failure`, exit 1 | Match | PASS | No | — |
| 6 | Empty input | `unexpected_output`, exit 1 | Match | PASS | No | — |
| 7 | Multiple data rows | `unknown_connection_failure`, exit 1 | Match | PASS | No | — |
| 8 | Duplicate header | `unknown_connection_failure`, exit 1 | Match | PASS | No | — |
| 9 | Unexpected column (6 fields) | `unknown_connection_failure`, exit 1 | Match | PASS | No | — |
| 10 | Missing column (4 fields) | `unknown_connection_failure`, exit 1 | Match | PASS | No | — |
| 11 | Truncated quoted field | `unknown_connection_failure`, exit 1 | Match | PASS | No | — |
| 12 | Trailing diagnostic line | `unknown_connection_failure`, exit 1 | Match | PASS | No | — |
| 13 | `transaction_read_only=off` | `unexpected_output`, exit 1 | Match | PASS | No | — |
| 14 | `statement_timeout=0` | `unexpected_output`, exit 1 | Match | PASS | No | — |
| 15 | `statement_timeout=60s` | `unexpected_output`, exit 1 | Match | PASS | No | — |
| 16 | `lock_timeout=0` | `unexpected_output`, exit 1 | Match | PASS | No | — |
| 17 | `lock_timeout=30s` | `unexpected_output`, exit 1 | Match | PASS | No | — |
| 18 | Empty `server_version` | `unexpected_output`, exit 1 | Match | PASS | No | — |
| 19 | Wrong `database_name` | `unexpected_output`, exit 1 | Match | PASS | No | — |
| 20 | Authentication failure | `authentication_failed`, exit 1 | Match | PASS | No | — |
| 21 | DNS failure | `dns_resolution_failed`, exit 1 | Match | PASS | No | — |
| 22 | Connection refused | `connection_refused`, exit 1 | Match | PASS | No | — |
| 23 | Connection timeout | `connection_timeout`, exit 1 | Match | PASS | No | — |
| 24 | SSL failure | `tls_or_ssl_failure`, exit 1 | Match | PASS | No | — |
| 25 | Server closed connection | `server_closed_connection`, exit 1 | Match | PASS | No | — |
| 26 | Pooler unavailable | `pooler_or_server_unavailable`, exit 1 | Match | PASS | No | — |
| 27 | Malformed URI | `malformed_connection_uri`, exit 1 | Match | PASS | No | — |
| 28 | Recognizable SQL-script error (no FATAL) | `sql_script_error`, exit 1 | Match | PASS | No | — |
| 29 | Generic `ERROR:` **with** `FATAL:` present | `unknown_connection_failure` (not `sql_script_error`), exit 1 | Match | PASS | No | — |
| 30 | Unknown failure | `unknown_connection_failure`, exit 1 | Match | PASS | No | — |
| 31 | Input containing fake `DIAGNOSTIC_OK` | Rejected as unsectioned content, falls to failure classify, exit 1 | Match | PASS | No | — |
| 32 | ANSI/control-character input | Classified normally (`authentication_failed`), no raw bytes echoed | Match | PASS | No | — |
| 33 | Fabricated connection URI embedded | `authentication_failed`, URI absent from output | Match | PASS | No | — |
| 34 | Fabricated password embedded | `authentication_failed`, password absent from output | Match | PASS | No | — |
| 35 | Fabricated email embedded | `connection_refused`, email absent from output | Match | PASS | No | — |
| 36 | Fabricated JWT embedded | `authentication_failed`, JWT absent from output | Match | PASS | No | — |
| 37 | Classifier hash mismatch | `DIAGNOSTIC_REFUSED reason=classifier_hash_mismatch`, exit 1 | Match | PASS | No | **No** |
| 38 | Target preflight failure | `DIAGNOSTIC_REFUSED reason=target_preflight_failed`, exit 1 | Match | PASS | No | **No** |
| 39 | Fake `psql` exit 2 | `DIAGNOSTIC_RESULT psql_exit=2 classifier_exit=1`, overall exit 1 | Match | PASS | No | Yes |
| 40 | Fake `psql` exit 3 (real SQL-script-error text) | `sql_script_error`, `psql_exit=3`, no inconsistency flag, exit 1 | Match | PASS | No | Yes |
| 41 | Classifier failure with fake `psql` exit 0 | `psql_exit=0 classifier_exit=1`, overall exit 1 | Match | PASS | No | Yes |
| 42 | HUP (live signal, mid-run) | `DIAGNOSTIC_REFUSED reason=interrupted_by_signal signal=HUP`, exit 129 | Match | PASS | No | Yes (interrupted) |
| 43 | INT (isolated handler-function test — see note) | `DIAGNOSTIC_REFUSED reason=interrupted_by_signal signal=INT`, exit 130 | Match | PASS | No | N/A |
| 44 | TERM (live signal, mid-run) | `DIAGNOSTIC_REFUSED reason=interrupted_by_signal signal=TERM`, exit 143 | Match | PASS | No | Yes (interrupted) |

Plus one additional case beyond the required 44: `psql_exit=2` **with** genuine
`sql_script_error`-shaped text → correctly produced both
`DIAGNOSTIC_RESULT psql_exit=2 classifier_exit=1` **and**
`DIAGNOSTIC_INCONSISTENT reason=sql_script_error_with_connection_level_exit_code`,
proving the cross-check fires exactly when it should.

**Case 43 note:** identical to the capture wrapper's own documented, independently-
reproduced finding — `SIGINT` is not reliably delivered to a *backgrounded* (`&`) job in
a non-interactive bash shell (a property of bash itself, not this script), so INT was
verified by direct, in-process invocation of the `cleanup_on_signal` function instead,
confirming the handler logic itself is correct; `HUP` and `TERM` were both verified via
real OS signal delivery to a running instance, and neither is affected by the
backgrounding limitation. **44/44 required cases PASS, plus 1 bonus case PASS. Zero
leaks of any fabricated sensitive value across every case. `psql` (the fabricated stand-
in) was never reached in the two refusal cases (37, 38), confirming both gates work
before any credential-handling code runs.**

An additional, dedicated environment/argv-isolation test (using a fake classifier stand-
in that reports its own environment and argv, hash-pinned to match so the wrapper's own
gate would accept it) confirmed for this exact final design: the fake `psql` received
`PGDATABASE` only, with argv limited to `-X -q --csv -v ON_ERROR_STOP=1` (no URI, no SQL
text — the SQL travels via heredoc/stdin, never argv); the fake classifier received none
of `PGDATABASE`/`DB_URI`/`STAGING_DATABASE_URL`/`PGPASSWORD` and empty argv; zero matches
for the fabricated dummy URI anywhere in captured output.

#### Independent second review (Task 8)

Re-read both finalized files as a fresh reviewer, after implementation and testing.

| Check | Finding |
|---|---|
| False success | None found — success requires exact structural match (header, exactly one row, no unrecognized content) and exact value match on all five fields; verified by cases 1–19. |
| Category shadowing | None found — precedence matches the required order exactly; malformed-URI-vs-auth co-occurrence tested (§20.15 smoke test), malformed URI correctly wins. |
| Generic pattern overreach | Fixed and verified (case 29): `sql_script_error` cannot fire when a connection-fatal marker is also present. Residual, non-blocking: the `malformed_connection_uri` pattern's `"invalid integer value"` phrase is heuristically close to (but distinct from) a generic SQL-level `"invalid input syntax for type integer"` message; no test constructed this turn triggers a false match, but the theoretical overlap is unquantified. |
| CSV parser ambiguity | None material found. Residual, non-blocking: an unquoted field containing a literal, unescaped `"` character is treated as an ordinary character rather than rejected (RFC4180 leaves this case implementation-defined); this cannot produce a false success, since the resulting field value would then fail the exact-match value check. |
| BOM/CRLF errors | None found — all three dedicated cases (1–3) pass. |
| Multiple-row acceptance | Fixed and verified (case 7): rejected. |
| Timeout bypass | Fixed and verified (cases 14–17): both `statement_timeout` and `lock_timeout` must exactly match; disabled or oversized values are rejected. |
| Raw-input leakage | None found — verified across cases 31–36 via `grep` for every fabricated sensitive substring used; zero matches. |
| Environment-variable leakage | None found — dedicated env-probe test (above) confirmed the classifier receives none of the four credential-bearing names. |
| URI in argv | None found — same env-probe test confirmed `psql`'s argv contains only its four flags. |
| Hash bypass | None found — case 37 confirms a mismatched hash refuses before any credential handling. |
| `PIPESTATUS` race | Not applicable to the final design — redesigned specifically to avoid depending on `PIPESTATUS` propagating through a substitution boundary (see "Credential-scope and wrapper design" above); both exit codes are captured via unambiguous, immediately-adjacent `$?` reads with no intervening command. |
| Signal returning success | None found — cases 42–44 (plus the isolated function test for INT) confirm every signal path exits non-zero and never reaches the success line. |
| Accidental database execution in tests | None occurred — every test used a local fabricated `psql` stand-in; every dummy URI used the reserved, non-resolvable `.invalid` TLD as additional defense-in-depth even if something had been misconfigured. |
| Repository temp files | None found — `scripts/` directory confirmed clean of any candidate/temp file after all testing. |

**No material defect found in the second review.** Two residual, non-blocking,
theoretical-only observations recorded above (malformed-URI phrase specificity;
unquoted-embedded-quote handling), neither of which can produce a false success or a
leak under any constructed test.

#### Residual limitations (carried forward, all non-blocking)

- Regex-based category matching is inherently heuristic; the two second-review
  observations above are the only currently-identified imprecision, both fail-closed.
- `database_name` equality to `"postgres"` is now enforced (closing the previous
  residual), but this still cannot by itself distinguish the approved staging project
  from any other Supabase project, since Supabase reports `"postgres"` for every
  project's `current_database()` regardless of identity (§16 FINDING-D) — target
  assurance still rests on the preflight's ref-substring check, not on this field.
  server_version remains reported only as a boolean, never the actual string, by design.
- The two-step (plain-substitution-then-piped-substitution) design is specific to this
  environment's observed bash behavior; re-verify the same `PIPESTATUS`-through-
  substitution and `pipefail`-rightmost-nonzero behavior if this script is ever run on a
  materially different bash build.

#### Exact human approval phrase for the future one-time diagnostic (SUPERSEDED — see
§20.16 for the current phrase, which names the current wrapper hash after TLS hardening)

> "Run `scripts/vam_v5_minimal_staging_diagnostic.sh`, verified against SHA-256
> `0eaf9ac7ac23fbe34046dfbf1f8e2fc9df236af20a621715758a2e9552f8d6fd`, using the
> `STAGING_DATABASE_URL` already present in this terminal. Do not retry the full
> metadata capture and do not touch migration 062 regardless of outcome."

This phrase was in fact used once, successfully, and the resulting run returned
`tls_or_ssl_failure` (§20.16) — it is preserved here as an audit-trail record of what
was authorized and run, not as a currently-valid phrase to reuse (the wrapper has since
changed and re-hashed).

#### Explicit statements (this turn)

- **No `psql` ran, no database connection occurred, no real credential was inspected, no
  network access occurred, no migration ran, no Git write occurred.**
- **Migration 062 remains blocked and unapplied.**
- **The full metadata capture must not be retried automatically** under any outcome of a
  future diagnostic run.
- **A successful diagnostic does not authorize migration 062** or remediating
  CONFLICT-01/02/03 (§6).

### 20.16 Clean TLS Differential Diagnostic (this turn)

**Status: local-only. No `psql`, no network, no staging/production connection, no Git
write, no migration. `STAGING_DATABASE_URL` was neither inspected nor printed.**

#### TLS failure result (context)

The one authorized run of `scripts/vam_v5_minimal_staging_diagnostic.sh` (prior turn)
returned:

```
TARGET_PREFLIGHT stagingVariablePresent=true postgresUriShape=true approvedStagingRefPresent=true productionRefAbsent=true
DIAGNOSTIC_FAILED category=tls_or_ssl_failure
DIAGNOSTIC_RESULT psql_exit=2 classifier_exit=1
```

A definitive `tls_or_ssl_failure` classification — the connection failed during SSL/TLS
negotiation, not from an unrelated or unclassifiable cause. No retry occurred, no file
was modified, migration 062 remains blocked and unapplied.

#### Non-secret environment-presence matrix (local shell, values never printed)

| Variable | Present |
|---|---|
| PGSSLNEGOTIATION | false |
| PGSSLMODE | **true** |
| PGREQUIRESSL | false |
| PGSSLCOMPRESSION | false |
| PGSSLCERT | false |
| PGSSLKEY | false |
| PGSSLCERTMODE | false |
| PGSSLROOTCERT | false |
| PGSSLCRL | false |
| PGSSLCRLDIR | false |
| PGSSLSNI | false |
| PGSSLMINPROTOCOLVERSION | false |
| PGSSLMAXPROTOCOLVERSION | false |
| PGGSSENCMODE | false |
| PGCHANNELBINDING | false |
| PGREQUIREAUTH | false |
| PGKRBSRVNAME | false |
| PGGSSLIB | false |
| PGGSSDELEGATION | false |
| OPENSSL_CONF | false |
| SSL_CERT_FILE | false |
| SSL_CERT_DIR | false |

Only `PGSSLMODE` is present ambiently in the local shell environment (value never
inspected or printed). This is a real, non-hypothetical finding, not a null result: it
confirms the wrapper's unset-then-explicitly-set discipline (§20.16 "Wrapper hardening"
below) is doing real work, not defending against a purely theoretical threat — whatever
ambient value `PGSSLMODE` carries is now unconditionally overwritten with `require`
before any future connection attempt, and the twenty other SSL/GSS/certificate variables,
though absent today, are unset defensively regardless, so a future change to the ambient
environment cannot silently alter the diagnostic's TLS posture.

#### Standard certificate-file existence matrix (existence only; no file opened, read, or
hashed)

| Location | exists | regular_file |
|---|---|---|
| `%APPDATA%\postgresql\root.crt` | false | false |
| `%APPDATA%\postgresql\postgresql.crt` | false | false |
| `%APPDATA%\postgresql\postgresql.key` | false | false |
| `~/.postgresql/root.crt` | false | false |
| `~/.postgresql/postgresql.crt` | false | false |
| `~/.postgresql/postgresql.key` | false | false |

None of libpq's default certificate/key locations are populated on this machine. Since
`PGSSLCERT`/`PGSSLKEY` are also confirmed absent (table above) and no default file
exists to fall back to, no client certificate would be sent even without
`PGSSLCERTMODE=disable` explicitly set — that setting is still retained as an explicit,
self-documenting guarantee rather than an implicit one.

#### Wrapper hardening (`scripts/vam_v5_minimal_staging_diagnostic.sh`, this turn)

The startup `unset` block was expanded from 10 to 31 variables, adding
`PGSSLNEGOTIATION`, `PGSSLMODE`, `PGREQUIRESSL`, `PGSSLCOMPRESSION`, `PGSSLCERT`,
`PGSSLKEY`, `PGSSLCERTMODE`, `PGSSLROOTCERT`, `PGSSLCRL`, `PGSSLCRLDIR`, `PGSSLSNI`,
`PGSSLMINPROTOCOLVERSION`, `PGSSLMAXPROTOCOLVERSION`, `PGGSSENCMODE`,
`PGCHANNELBINDING`, `PGREQUIREAUTH`, `PGKRBSRVNAME`, `PGGSSLIB`, `PGGSSDELEGATION`,
`PGAPPNAME`, `PGTARGETSESSIONATTRS`, and `PGLOADBALANCEHOSTS`. Immediately after, exactly
seven variables are explicitly exported: `PGSSLMODE=require`,
`PGSSLNEGOTIATION=postgres`, `PGGSSENCMODE=disable`, `PGSSLCERTMODE=disable`,
`PGSSLSNI=1`, `PGCONNECT_TIMEOUT=10`, `PGAPPNAME=vam_os_artifact0_diagnostic`. No
weakening of `sslmode` (never `disable`/`allow`/`prefer`) and no `sslnegotiation=direct`
in this file — this is Variant A (below); Variant B is documented but not implemented
here. The classifier (`scripts/vam_v5_psql_diagnostic_classifier.mjs`) was not edited —
no material classifier defect was found this turn.

New wrapper SHA-256: `93fe114054ef2d4e02ff61cf6ca2bdc7d843ef18c3ce8a6a6c8a924422735c99`
(supersedes the prior value `0eaf9ac7ac23fbe34046dfbf1f8e2fc9df236af20a621715758a2e9552f8d6fd`
recorded in §20.15 — that value is now stale). Classifier SHA-256 unchanged:
`29a253bb763865445c3de8e7ec34dc4a3b2b17c0bc1e196596b424f2f05dacf6`, still correctly
embedded as `EXPECTED_CLASSIFIER_SHA256` in the updated wrapper.

#### Variant A — clean traditional TLS negotiation (implemented; this is the current
wrapper file, unmodified further)

`PGSSLMODE=require`, `PGSSLNEGOTIATION=postgres`, `PGGSSENCMODE=disable`,
`PGSSLCERTMODE=disable`. The default, traditional PostgreSQL SSL negotiation path (a
plaintext startup packet requesting SSL, upgraded in-place) — the same negotiation style
`psql` has always used prior to direct-SSL support, isolated from every other inherited
libpq variable that could otherwise alter the attempt.

#### Variant B — direct TLS negotiation (documented only; not implemented in the
repository file; must not run automatically after Variant A)

**Exact and only difference from Variant A:** `PGSSLNEGOTIATION=direct` in place of
`PGSSLNEGOTIATION=postgres`. Every other setting — `PGSSLMODE=require`,
`PGGSSENCMODE=disable`, `PGSSLCERTMODE=disable`, `PGSSLSNI=1`, `PGCONNECT_TIMEOUT=10`,
`PGAPPNAME=vam_os_artifact0_diagnostic`, and all 31 startup unsets — is identical.
Direct TLS negotiation (RFC 8446-style ALPN, no plaintext startup packet) is a newer
PostgreSQL 17 protocol option; testing it is diagnostically useful only if Variant A's
result indicates the negotiation style itself might be the failure point (e.g. a pooler
or load balancer in front of staging that mishandles the traditional SSL upgrade
request). **Variant B is diagnostic-only. It must never run as an automatic follow-up to
Variant A, regardless of Variant A's outcome — it requires its own separate, explicit
human authorization, naming Variant B specifically.**

#### Exact authorization required for each

- **Variant A:** the phrase in "Exact future authorization phrase for Variant A only"
  below, naming the current wrapper file and its current SHA-256.
- **Variant B:** a separate future turn, explicitly authorized to (1) edit the wrapper's
  single `PGSSLNEGOTIATION` line from `postgres` to `direct`, (2) re-hash and re-pin,
  and (3) then receive its own one-time run authorization naming Variant B specifically
  and the new hash. Editing to Variant B and running it in the same turn as Variant A,
  or automatically after Variant A fails, is explicitly out of scope for any standing
  authorization.

#### Local fabricated validation (13 items, all local, no real credential, no real
`psql`)

| # | Item | Result |
|---|---|---|
| 1 | All 31 inherited variables absent from fake `psql` except the 7 explicitly permitted | Confirmed via a full env-dump fake `psql` stand-in: every one of `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGSSLCERT`/`PGSSLKEY`/`PGSSLROOTCERT`/`PGREQUIRESSL`/`PGSSLCOMPRESSION`/`PGSSLCRL`/`PGSSLCRLDIR`/`PGSSLMINPROTOCOLVERSION`/`PGSSLMAXPROTOCOLVERSION`/`PGCHANNELBINDING`/`PGREQUIREAUTH`/`PGKRBSRVNAME`/`PGGSSLIB`/`PGGSSDELEGATION`/`PGTARGETSESSIONATTRS`/`PGLOADBALANCEHOSTS` reported absent; `PGDATABASE` (scoped, expected), `PGSSLMODE=require`, `PGSSLNEGOTIATION=postgres`, `PGSSLCERTMODE=disable`, `PGSSLSNI=1`, `PGGSSENCMODE=disable`, `PGAPPNAME=vam_os_artifact0_diagnostic`, `PGCONNECT_TIMEOUT=10` all reported present with the correct value. |
| 2 | Classifier receives no credential or libpq target variable | Unchanged from §20.15's dedicated env-probe test; classifier logic itself untouched this turn. |
| 3 | Variant A sets `sslnegotiation=postgres` | Confirmed via the env-dump probe (item 1). |
| 4 | Variant B sets `sslnegotiation=direct` | Confirmed via a scratchpad-only harness copy with the single line changed (never written to the real repository file); all other settings identical to Variant A. |
| 5 | Neither variant changes `sslmode` away from `require` | Confirmed for both (item 1 and item 4's probe). |
| 6 | GSS encryption disabled | Confirmed: `PGGSSENCMODE=disable` present with that exact value in both variants. |
| 7 | Client certificate sending disabled | Confirmed: `PGSSLCERTMODE=disable` present with that exact value in both variants; reinforced by the certificate-file existence matrix above (no default cert file exists to send regardless). |
| 8 | No fabricated URI in argv or output | Confirmed: fake `psql` argv contained only `-X -q --csv -v ON_ERROR_STOP=1`; `grep` across all wrapper stdout logs for the fabricated dummy URI substring found zero matches (the URI appears, as intended, only inside the dedicated env-probe file as the value of `PGDATABASE`, never in argv or in the wrapper's own printed output). |
| 9 | Classifier positive/negative regression | Re-ran unchanged: success fixture → `DIAGNOSTIC_OK`, exit 0; authentication-failure fixture → `category=authentication_failed`, exit 1. No drift. |
| 10 | `bash -n` on the wrapper | Syntax OK; no line over 100 characters (216 lines total). |
| 11 | `node --check` on the classifier | Syntax OK (unchanged file). |
| 12 | Git index empty | Confirmed. |
| 13 | Protected-file hashes unchanged | Confirmed for migration 062, preflight, rollback, post-apply-verify, the capture wrapper, the capture sanitizer, the capture SQL, and the evidence JSON — all eight identical to every prior turn's recorded value. |

**All 13 items PASS.** The preflight-failure gate was also re-confirmed working
(empty `STAGING_DATABASE_URL` → `DIAGNOSTIC_REFUSED reason=target_preflight_failed`,
exit 1) — no regression from the hardening edit.

#### Exact future authorization phrase for Variant A only

> "Run `scripts/vam_v5_minimal_staging_diagnostic.sh`, verified against SHA-256
> `93fe114054ef2d4e02ff61cf6ca2bdc7d843ef18c3ce8a6a6c8a924422735c99`, using the
> `STAGING_DATABASE_URL` already present in this terminal. This is Variant A (clean
> traditional TLS negotiation) only — do not follow with Variant B automatically. Do not
> retry the full metadata capture and do not touch migration 062 regardless of outcome."

#### Explicit statements (this turn)

- **No `psql` ran, no database connection occurred, no real credential was inspected, no
  network access occurred, no migration ran, no Git write occurred.**
- **Migration 062 remains blocked and unapplied.**
- **The full metadata capture remains prohibited** under any outcome of a future
  diagnostic run.
- **Variant B must not run automatically after Variant A**, under any outcome, without
  its own separate, explicit human authorization.

### 20.17 Credential-Free Postgres TLS Handshake Probe (this turn)

**Status: local implementation and fabricated testing only. No network connection was
opened. No `psql`, no database, no SQL, no authentication. `STAGING_DATABASE_URL` was
not inspected this turn (the previous connection-string structure audit already covered
that, separately). No Git write. No migration.**

#### Why the cross-network result does not yet prove a Supabase-side TLS defect

The minimal diagnostic has now failed identically three times: original network, a
cleaned local SSL/GSS environment (§20.16), and a different network entirely (mobile
hotspot). This is strong evidence against a *local, network-path-specific* cause (a
particular router, ISP, or captive portal), but it is **not yet sufficient to conclude
the defect is on Supabase's side**, because every failure so far has come from the same
**client machine** running the same **`psql`/libpq build**. A TLS handshake failure that
reproduces across networks is equally consistent with: (a) something in this specific
`psql.exe`/OpenSSL build's TLS stack or its Windows certificate/trust configuration, (b)
a persistent client-side factor that travels with the machine rather than the network
(e.g., a local antivirus/endpoint-security product performing TLS interception on
outbound connections, which would affect every network the machine joins identically),
or (c) an actual server/pooler-side issue, which *would* also reproduce identically
across client networks. The three prior runs cannot distinguish between these. A
handshake-isolation probe that removes `psql` and libpq from the equation entirely —
using Node's own independent TLS stack — is what can start to separate "this specific
client tool" from "this specific network" from "the server."

#### Purpose and limits of the probe

`scripts/vam_v5_postgres_tls_probe.mjs` tests exactly one thing: can a TCP connection be
opened to the staging host on port 5432, does the server respond to a PostgreSQL
`SSLRequest` with the single expected acceptance byte, and does a TLS handshake (SNI,
`TLSv1.2`+) then complete. It does **not** authenticate, does **not** send a
`StartupMessage`, does **not** run SQL, and does **not** certify server identity
(`rejectUnauthorized: false` is deliberate — this is a handshake-isolation probe, not a
trust decision). A successful run would show the TLS layer itself is reachable and
functional using a *different* TLS implementation than `psql`'s, which narrows the
hypothesis space; it would not, by itself, prove the earlier `psql` failures have the
same root cause, only that TLS-in-general is not universally broken to this host from
this client.

#### Exact protocol sequence

1. Non-printing preflight (in memory only): `STAGING_DATABASE_URL` present; parses as a
   `postgres`/`postgresql` URI; approved staging ref present; production ref absent;
   host/port/database shape matches the Supabase Session Pooler pattern (`*.pooler.
   supabase.com`, port `5432`, database `postgres`). Prints only the five named
   booleans.
2. One TCP socket, one overall 10-second timeout covering the entire probe.
3. Exactly one `SSLRequest` packet: `Int32BE(8)` followed by `Int32BE(80877103)` — 8
   bytes total, the well-known PostgreSQL SSL-negotiation request code.
4. The server's first response byte is required to be exactly ASCII `S` with no other
   bytes in the same read; `N` is classified `ssl_request_rejected`; anything else
   (wrong byte, extra bytes, no bytes) is `unexpected_ssl_response`.
5. On `S`, the same socket is upgraded via `tls.connect({ socket, servername: <host>,
   rejectUnauthorized: false, minVersion: "TLSv1.2" })` — SNI is set via `servername`;
   no `ALPNProtocols` option is set (traditional negotiation only, never `direct`).
6. On `secureConnect`, only three booleans are recorded: TLS protocol present, cipher
   present, peer certificate present. No certificate field, cipher name, or protocol
   version string is ever printed.
7. The socket is destroyed immediately after recording the result. No StartupMessage,
   no credentials, no SQL are ever sent. Runs once; no retry logic exists in the script.

#### Fixed sanitized output (unchanged from the authorization request)

Success: `TARGET_PREFLIGHT ...` then `TLS_PROBE_OK sslRequestAccepted=true
secureConnect=true protocolPresent=true cipherPresent=true peerCertificatePresent=true`
(exit `0`). Failure: `TARGET_PREFLIGHT ...` then `TLS_PROBE_FAILED stage=<enum>
category=<enum>` (exit `1` for any classified connection/protocol category, exit `2`
only for `internal_failure`, e.g. an unhandled exception or a delivered `HUP`/`INT`/
`TERM` signal).

#### Independent review — two material defects found and fixed

1. **Main-module detection was broken.** The original hand-rolled comparison
   (`import.meta.url === \`file://${process.argv[1]}\`` and a backslash-converted
   variant) does not account for URL percent-encoding: a literal `~` in this machine's
   own temp-path convention is encoded as `%7E` in `import.meta.url` but appears
   unencoded in `process.argv[1]`, so the comparison always evaluated `false`. Verified
   with an isolated, harmless throwaway twin script (never the real probe): the original
   logic printed `isMainModule=false` even on **direct invocation** — meaning the
   finalized script, as originally written, would have silently done nothing at all when
   a human actually tried to run it. **Fixed** by replacing the hand-rolled comparison
   with `import.meta.url === pathToFileURL(process.argv[1]).href` (Node's own, correct
   conversion) — re-verified with the same throwaway-twin technique: `true` on direct
   invocation, `false` when imported for testing.
2. **`process.exit()` immediately after `process.stdout.write()`** is a known Node.js
   risk of truncating the write on some platforms when stdout is a pipe. **Fixed** by
   moving the `process.exit()` call into the write's completion callback in both
   `finishOk()` and `finishFail()`, guaranteeing the sanitized output line is fully
   flushed before the process exits.

No other material defect was found. `SSLRequest` bytes, absence of a `StartupMessage`,
absence of authentication/SQL, SNI presence, ALPN absence, timeout handling, duplicate-
event handling (the raw socket's own listeners are explicitly removed before the TLS
upgrade, so the underlying connection's events are never handled twice), socket cleanup,
false-success prevention, raw-error non-leakage, absence of the URI from argv, and signal
behavior were all reviewed and found correct — see the fabricated test matrix below for
the corresponding empirical verification of each.

#### Fabricated test matrix (all 27 required cases, local only, no network)

Testing used two complementary techniques: (a) the script's pure classification/parsing
functions (`classifyConnectError`, `classifyTlsError`, `buildSslRequestPacket`,
`evaluateSslResponseByte`, `parsePreflight`) are exported and were unit-tested by
importing the actual finalized file directly (`main()` does not run on import, gated by
the corrected `isMainModule` check) — 34 assertions, all fabricated dummy values, never
the real `STAGING_DATABASE_URL`; (b) the event-driven connection state machine was
exercised via a faithful mirror using fake `EventEmitter` "sockets" in place of
`net.connect`/`tls.connect`, calling the same real, imported classification functions —
22 scenario assertions.

| # | Case | Result |
|---|---|---|
| 1 | Valid `S` → successful TLS handshake | PASS — `TLS_PROBE_OK`, exit 0 |
| 2 | `N` response | PASS — `stage=ssl_request category=ssl_request_rejected` |
| 3 | Unexpected response byte | PASS — `category=unexpected_ssl_response` |
| 4 | Empty response | PASS — `category=unexpected_ssl_response` |
| 5 | Multiple plaintext bytes before TLS | PASS — `category=unexpected_ssl_response` |
| 6 | DNS failure | PASS — `stage=tcp_connect category=dns_resolution_failed` |
| 7 | TCP refusal | PASS — `category=connection_refused` |
| 8 | TCP timeout | PASS — `category=connection_timeout` |
| 9 | TCP reset | PASS — `category=connection_reset` |
| 10 | Close before SSL response | PASS — `stage=ssl_request category=premature_close` |
| 11 | TLS handshake failure | PASS — `stage=tls_handshake category=tls_handshake_failure` |
| 12 | Reset during TLS | PASS — `category=connection_reset` |
| 13 | TLS timeout | PASS — `stage=tls_handshake category=connection_timeout` |
| 14 | Missing protocol | PASS — `category=tls_handshake_failure` |
| 15 | Missing cipher | PASS — `category=tls_handshake_failure` |
| 16 | Missing peer certificate | PASS — `category=tls_handshake_failure` |
| 17 | Wrong staging ref | PASS — `approvedStagingRefPresent=false` (unit test) |
| 18 | Production ref present | PASS — `productionRefAbsent=false` (unit test) |
| 19 | Wrong host shape | PASS — `sessionPoolerShape=false` (unit test) |
| 20 | Wrong port | PASS — `sessionPoolerShape=false` (unit test) |
| 21 | Missing password | PASS — correctly does **not** block preflight (password presence is intentionally not a gating condition for this credential-free probe) |
| 22 | Malformed URI | PASS — `uriShape=false`, `sessionPoolerShape=false`, no exception-based leak (unit test) |
| 23 | Fake `TLS_PROBE_OK` in socket data | PASS — rejected as `unexpected_ssl_response`, never echoed |
| 24 | ANSI/control-character payload | PASS — rejected as `unexpected_ssl_response`, never echoed |
| 25 | HUP | PASS — `stage=shutdown category=internal_failure`, exit 2 |
| 26 | INT | PASS — same |
| 27 | TERM | PASS — same |

Plus one bonus case beyond the required 27: a second `data` event and a subsequent
`error` event delivered after the state machine had already settled were both confirmed
to be no-ops (the `settled` guard), proving no duplicate-event path can overwrite an
already-decided result. **56/56 total assertions pass** (34 unit + 22 state-machine).
No fabricated secret, dummy URI, or raw error ever appeared in any captured output.

#### Interpretation matrix (what each future real outcome would and would not mean)

| Real outcome | Supports | Does not prove | Next safe action |
|---|---|---|---|
| `TLS_PROBE_OK` | The network path and server both support a standard TLS handshake on port 5432 from this client, using a non-`psql` TLS stack | That `psql`'s specific failures share the same cause — points suspicion toward `psql`/libpq's own TLS handling on this machine | Investigate the local `psql`/libpq/OpenSSL build and its certificate/trust configuration; do not yet suspect the server |
| `stage=tcp_connect`, any category | The TCP layer itself cannot be established | Nothing about TLS specifically — this would be a *more* basic failure than the three prior `tls_or_ssl_failure` results, which implies TCP was fine but TLS negotiation was not | Stop; this would be a materially different signature from the three prior runs and warrants re-examining network reachability before anything else |
| `stage=ssl_request category=ssl_request_rejected` | The server actively refuses SSL for this connection (unusual for a `sslmode=require`-compatible Supabase pooler) | Nothing about certificate/cipher compatibility | Stop; this would suggest a server/pooler-side SSL posture change, not a client TLS stack issue |
| `stage=tls_handshake`, any category | The TCP and SSLRequest layers work, but the TLS handshake itself (cipher/protocol negotiation, certificate exchange) fails even from Node's independent TLS stack | Nothing rules out a shared network-level TLS interception affecting both `psql` and Node identically | Stop; this would meaningfully support a network-level (not `psql`-specific) TLS interception hypothesis, strengthening the case for the Pooler Logs review already documented in the connection-string audit |
| `target_rejected` (preflight failure) | Only that the ambient `STAGING_DATABASE_URL` no longer matches expectations at run time | Nothing about the network/TLS layer at all | Stop; re-verify the environment before considering any further diagnostic |

#### Exact future human authorization required

A future turn must receive explicit authorization naming: the probe path
(`scripts/vam_v5_postgres_tls_probe.mjs`), its exact SHA-256
(`68f82430c4a3b420194c35fbf705e91ba0e1d7ffabea832c9f8659dc3bc42d18`), confirmation that
`STAGING_DATABASE_URL` in the running terminal is still the approved staging value, and
an explicit statement that this is a TLS-handshake-only probe that does not authorize
the full metadata capture, Variant B, or any subsequent connection attempt beyond the one
run.

#### No scratchpad prototype to supersede

Unlike earlier rounds, this probe was authored directly as the final repository file —
no standalone scratchpad prototype of the probe itself was created this turn. The only
scratchpad artifacts produced are pure test infrastructure (unit tests importing the
real file's exported functions, and a fake-`EventEmitter` state-machine mirror) that
never opens a real socket under any circumstance; there is nothing there that could be
mistaken for an executable diagnostic and nothing to mark superseded.

#### Explicit statements (this turn)

- **The full metadata capture remains prohibited** under any outcome of a future probe
  run.
- **Migration 062 remains blocked and unapplied.**
- **A successful probe run does not authorize the full metadata capture, Variant B, or
  migration 062** — each still requires its own separate, explicit human authorization.

---

## Conclusion

**STATIC PREPARATION COMPLETE — DATABASE CAPTURE AWAITS HUMAN APPROVAL**

**Phase 7–10 local hardening closeout: ARTIFACT 0 LOCAL PIPELINE HARDENED — READY FOR
HUMAN REVIEW BEFORE READ-ONLY CAPTURE.**

**Round-2 remediation: FINAL EXECUTION GATE HARDENED — READY FOR INDEPENDENT HUMAN
REVIEW.** FINDING-B and FINDING-D closed/narrowed as documented in §17.

**Round-3 remediation: STANDALONE CAPTURE WRAPPER HARDENED — READY FOR FINAL HUMAN
APPROVAL.** The execution workflow moved into one standalone, hash-pinned, signal-safe,
syntax-checked file (`scripts/vam_v5_metadata_capture_wrapper.sh` — SHA-256 as of Round 3
was `e5e119144ee336c324a46e2899eafbbca1a093f2d5fa43bad87a7ea4f9bd8037`, since superseded
by Round 4, see §19), superseding every Bash block embedded in this document. One genuine,
well-documented limitation was found and recorded, not hidden: SIGINT is not reliably
trappable when this script is invoked as a backgrounded (`&`) job in a non-interactive
shell, a property of bash itself, not of this script's logic — the intended foreground
invocation is unaffected.

**Round-4 remediation (this turn): FINAL EXECUTION ATTESTATION COMPLETE — READY FOR ONE
HUMAN-APPROVED METADATA-ONLY STAGING CAPTURE.** The credential is now scoped to the
single `psql` child process's environment only (`PGDATABASE="$DB_URI" "$PSQL" ...`),
never exported into the wrapper's own persistent shell state, and explicitly stripped
from the sanitizer's environment (`env -u PGDATABASE -u DB_URI -u STAGING_DATABASE_URL
-u PGPASSWORD`). Every inherited libpq environment variable is unset at startup. Cleanup
unsets all four credential-bearing variable names on every exit path, verified directly
via an in-process function test. Current wrapper SHA-256:
`0ccead7fa82e897e485e8ecd03c5da1837fb09cae491506fc831e86308160a87` — see §19 for the
complete machine-verifiable attestation. No database, network, or Git write operation of
any kind occurred while producing this section. Migration 062 remains blocked and
unapplied. Executing Artifact 0 does not authorize migration remediation or application.
The standalone wrapper is presented for review; it is not authorized to run by this
document.

**Overnight minimal-diagnostic review: MINIMAL STAGING DIAGNOSTIC PACKAGE PARTIAL —
SPECIFIC STATIC DEFECT REMAINS.** An independent static review (§20.8/§20.9, no Bash, no
database) of a scratchpad-only classifier and command found four material defects
(unenforced timeout bounds, wrong classification precedence, an over-broad
`sql_script_error` pattern) and declined to accept them as residual.

**Minimal-diagnostic hardening: MINIMAL STAGING DIAGNOSTIC HARDENED — READY FOR ONE
HUMAN-APPROVED RUN.** All four material defects were fixed, not accepted, in two new
permanent, hash-pinned repository files —
`scripts/vam_v5_psql_diagnostic_classifier.mjs` (SHA-256
`29a253bb763865445c3de8e7ec34dc4a3b2b17c0bc1e196596b424f2f05dacf6`, still current) and
`scripts/vam_v5_minimal_staging_diagnostic.sh` (SHA-256 as of that turn was
`0eaf9ac7ac23fbe34046dfbf1f8e2fc9df236af20a621715758a2e9552f8d6fd`, since superseded —
see §20.16). A 44-case fabricated test matrix plus one bonus case (§20.15) all passed,
with zero leakage of any fabricated sensitive value in any case, and a fresh independent
second review found no further material defects.

**One human-approved run occurred using that phrase, and returned a definitive
`tls_or_ssl_failure` classification** (`psql_exit=2`, `classifier_exit=1`) — no retry,
no file modification, migration 062 unaffected.

**Clean TLS differential diagnostic (this turn): CLEAN TLS VARIANT A READY FOR ONE
HUMAN-APPROVED RUN.** The wrapper's startup `unset` block was expanded from 10 to 31
libpq/SSL/GSS/certificate/target variables, and exactly seven are now explicitly set
(`PGSSLMODE=require`, `PGSSLNEGOTIATION=postgres`, `PGGSSENCMODE=disable`,
`PGSSLCERTMODE=disable`, `PGSSLSNI=1`, `PGCONNECT_TIMEOUT=10`,
`PGAPPNAME=vam_os_artifact0_diagnostic`) — new wrapper SHA-256
`93fe114054ef2d4e02ff61cf6ca2bdc7d843ef18c3ce8a6a6c8a924422735c99`. A non-secret local
environment audit found `PGSSLMODE` ambiently present (value never inspected) and all
twenty other SSL/GSS/certificate variables absent; a certificate-file existence check
found none of libpq's six default certificate/key locations populated. Variant B
(`PGSSLNEGOTIATION=direct`, otherwise identical) is fully documented but not implemented
in the repository file, and explicitly must not run automatically after Variant A. 13/13
local fabricated validation items passed. See §20.16 for the complete record. No `psql`,
no database connection, no real credential inspection, no network access, no migration,
and no Git write occurred while producing this section. Migration 062 remains blocked
and unapplied. The hardened wrapper is not authorized to run by this document — that
requires a separate, explicit human approval using the exact phrase in §20.16.

**Variant A repeated on a different network (mobile hotspot) and returned the identical
`tls_or_ssl_failure` result** (`psql_exit=2`, `classifier_exit=1`) — no retry, no file
modification. A subsequent sanitized structure audit confirmed the existing
`STAGING_DATABASE_URL` fully matches the official Supabase Session Pooler format
(`structureMatchesOfficialSessionPooler=true`, no mismatches).

**Credential-free TLS handshake probe (this turn): CREDENTIAL-FREE POSTGRES TLS PROBE
READY FOR ONE HUMAN-APPROVED RUN.** `scripts/vam_v5_postgres_tls_probe.mjs` (SHA-256
`68f82430c4a3b420194c35fbf705e91ba0e1d7ffabea832c9f8659dc3bc42d18`) tests TCP connect →
`SSLRequest` → server acceptance byte → TLS handshake (SNI, no ALPN) → immediate clean
close, using Node's own independent TLS stack instead of `psql`/libpq, without ever
authenticating, sending a `StartupMessage`, or sending SQL. Independent review found and
fixed two material defects before finalizing: a broken main-module detection that would
have silently no-op'd on direct invocation (fixed using Node's own `pathToFileURL`,
verified both directions with a harmless throwaway twin script), and a
`process.exit()`-after-`write()` pattern that could truncate output on some platforms
(fixed by deferring the exit to the write's completion callback). All 56 fabricated test
assertions (34 unit tests against the real exported functions, 22 state-machine
scenarios via a fake-socket mirror) pass, covering all 27 required cases plus a
duplicate-event/settled-guard proof — zero leakage of any fabricated secret in any case.
See §20.17 for the complete record, including the interpretation matrix for what each
possible real outcome would and would not prove. No network connection was opened, no
`psql`, no database, no SQL, no authentication, no migration, no Git write. Migration 062
remains blocked and unapplied. The probe is not authorized to run by this document — that
requires a separate, explicit human approval naming the probe and its exact SHA-256.
