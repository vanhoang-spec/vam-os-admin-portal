# VAM OS Migration 061 Pre-Authorization Review

Date: 2026-07-22
Reviewed baseline: `bc62825109b601755919fec8f35438244af1d8f4`

## Recommendation

**BLOCKED BY SCHEMA UNCERTAINTY**

Migration 061 must not be authorized on staging yet. Static SQL issues were corrected in this review, but the Supabase environment configured in this workspace reports that `recruitment_campaigns` and all four proposed `applications` columns already exist. Direct PostgreSQL metadata access failed authentication, so their exact types, constraints, triggers, indexes, RLS and policies could not be verified. The revised migration deliberately aborts with `OBJECT_CONFLICT` rather than silently accepting this uncertainty.

No migration or rollback SQL was executed. No database row was written, seeded, updated, deleted or backfilled.

## 1. State

- Main: `bc62825109b601755919fec8f35438244af1d8f4`.
- PR 5B-1A merge is present.
- Baseline: 481/481 tests, lint clean, TypeScript 0 errors, build 37/37.
- Repository has no generated Supabase database-types file; `lib/types.ts` contains hand-maintained structural types.
- Repository migration history begins at 012, not 001. Base definitions are therefore partially inferred from later migrations and read-only probes.
- Twelve pre-existing untracked files were preserved.

## 2. SQL Object Inventory

| Object | Action in revised 061 | Existing dependency | Lock risk | Rollback |
|---|---|---|---|---|
| `recruitment_campaigns` | Create table, RLS enabled | programs, seasons, batches, admin users | AccessExclusive for create; no existing-row rewrite | Drop only when no linked application |
| `applications.recruitment_campaign_id` | Add nullable UUID FK | applications, campaign table | Short AccessExclusive metadata lock | Drop only before linked rows exist |
| `applications.application_reference` | Add nullable text | applications | Short metadata lock | Same guarded rollback |
| `applications.consent_version` | Add nullable text | applications | Short metadata lock | Same guarded rollback |
| `applications.consented_at` | Add nullable timestamptz | applications | Short metadata lock | Same guarded rollback |
| Campaign PK | UUID primary key | `gen_random_uuid()` | New-table only | Dropped with table |
| Campaign FKs | Program/season/batch RESTRICT; actor SET NULL | UUID PKs | New-table only | Dropped with table |
| Campaign checks | role/status/time/archive/text/capacity | Built-in types | New-table only | Dropped with table |
| Slug unique index | Unique lower+trim slug | campaign table | New empty table | Dropped with table |
| Campaign scope index | Program/season/batch/role/status | campaign table | New empty table | Dropped with table |
| Campaign duplicate index | Campaign/role/lower(trim(email)) partial unique | existing applications | Scans applications; stronger lock/time risk | Explicit drop |
| Reference unique index | Non-null application reference | existing applications | Scans applications | Explicit drop |
| Campaign/status index | Campaign/status/submitted date | existing applications | Scans applications | Explicit drop |
| Campaign scope trigger/function | Validate hierarchy; lock scope after first application; update timestamp | applications, programs, seasons, batches | Per-row runtime overhead | Explicit drop |
| Application scope trigger/function | Validate campaign/season/batch/role | campaign table | Per-row runtime overhead | Explicit drop |
| Campaign RLS | Enable RLS | auth/admin/scope tables | Access control change on new table | Dropped with table |
| Scoped SELECT policy | Super Admin or matching program/season grant | admin_users, admin_scope_access | Query-policy overhead | Dropped with table |
| Grants/revokes | Authenticated SELECT only; anon none; no authenticated mutations | Supabase roles | Privilege change | Dropped with table; application anon revoke needs explicit restoration only if owner documents prior grant |

No enum is created or altered. Campaign role/status use checked text, avoiding production enum changes.

## 3. Static SQL Safety

### Passed after revision

1. No `DROP`, `TRUNCATE`, data `DELETE`, data `UPDATE`, seed or backfill in migration 061.
2. Existing applications remain null-linked; no historical row rewrite.
3. No production enum alteration.
4. Parent FKs point campaign to program/season/batch with `ON DELETE RESTRICT`; actor FKs use `SET NULL`; application campaign FK uses `RESTRICT`.
5. Duplicate index is limited to same campaign + role + canonical email.
6. Partial predicate excludes null and blank email.
7. Trigger graph has no self-update or recursion.
8. Application scope trigger loads trusted campaign scope; it does not accept client scope as authority.
9. Both functions use `SET search_path = pg_catalog, public` and schema-qualified relations.
10. Functions are not SECURITY DEFINER; direct EXECUTE is revoked from public/anon/authenticated.
11. RLS is enabled before transaction commit and before table access is exposed.
12. Anonymous privileges are revoked from campaigns and applications; no anon policy is created.
13. Public runtime must be a server action; service-role credentials are never client-side.
14. Slug check and unique index both use lowercase/trim canonical semantics.
15. Timestamps are `timestamptz`; runtime boundary remains `opens_at <= now < closes_at`.
16. Database check enforces `opens_at < closes_at`.
17. Campaign scope trigger blocks program/season/batch changes after the first linked application.
18. Rollback aborts if any linked application exists.
19. Revised preflight checks all required tables and target object conflicts.
20. Revised migration does not silently reuse an object name with uncertain definition.

### Idempotency boundary

This is a first-install migration, not a repair migration. A second or partial execution fails closed with `OBJECT_CONFLICT`. Transactional failure rolls back the first execution. This behavior is intentionally safer than `IF NOT EXISTS`, which could accept incompatible objects. An already-installed environment requires schema comparison and either a separate reconciliation migration or a migration-ledger decision; 061 must not be rerun blindly.

## 4. Duplicate Semantics

| Case | Result | Rationale |
|---|---|---|
| Same campaign, role, email differing only case | Block | `lower(btrim(email_primary))` unique key |
| Leading/trailing email whitespace | Block | Trimmed in unique expression |
| Null email | Not indexed | Server validation must reject before insert |
| Empty/whitespace email | Not indexed | Server validation must reject; DB avoids a misleading single-empty unique bucket |
| Mentor vs mentee | Allowed | Role is part of unique key |
| Same person changes email | Not detected by this index | Requires verified identity/person linkage; documented limitation |
| Concurrent same campaign submit | One succeeds, one receives unique violation | Database is authoritative |
| Withdrawn/rejected application | Still blocks resubmission | History is preserved; reopening requires explicit owner workflow |
| Archived campaign | Existing uniqueness remains | Archive does not erase history |
| Same season, different campaign | Allowed by DB; application layer flags for review | Campaign ID is part of key |
| Previous season/cross-program | Allowed | Different campaign; no false global duplicate |

The runtime must canonicalize and validate email before inserting and translate SQLSTATE `23505` for `applications_campaign_email_role_uniq` into a safe duplicate response. Changed-email identity duplication remains unresolved and must not be guessed from names/phones.

## 5. RLS and Permission Matrix

| Actor | Campaign SELECT | INSERT | UPDATE | Archive | Application submit | Application read |
|---|---|---|---|---|---|---|
| Anonymous/public | No direct table read | No | No | No | Guarded server action only | No |
| Authenticated applicant | No applicant role exists today | No | No | No | Same guarded public path | No |
| Viewer | Granted program/season rows | No direct mutation | No | No | Not admin function | Existing scoped admin route only |
| Reviewer | Granted program/season rows | No | No | No | Not admin function | Assigned/scoped review routes |
| Program operations | Granted program/season rows | Server action after access guard | Server action after access guard | Server action after confirmation | Not applicable | Scoped admin route |
| Program full-access | Granted program/season rows | Guarded server action | Guarded server action | Guarded server action | Not applicable | Scoped admin route |
| Super Admin | All rows | Guarded server action | Guarded server action | Guarded server action | Not applicable | Authorized admin route |
| Service role | Bypasses RLS | Technically yes | Technically yes | Technically yes | Only after campaign/status/scope/rate guards | Only after application authorization |

There are no direct campaign INSERT/UPDATE/DELETE policies. UEH and HAM isolation for SELECT is expressed through UUID-or-code compatible `admin_scope_access` checks. Service-role bypass remains an application-security responsibility and must receive negative integration tests in 5B-1B.

## 6. Read-only Schema Comparison

Direct `DATABASE_URL` metadata access failed with PostgreSQL authentication error `28P01`. No retry with guessed credentials was attempted.

Supabase REST probes used service-role credentials for SELECT/HEAD only and returned no PII:

| Assumption | Actual/source | Match | Required change |
|---|---|---:|---|
| `programs(id,code)` exists | REST probe; 8 rows | Yes | None |
| `seasons(id,code,program_id)` exists | REST probe; 2 rows | Yes | None |
| `intake_batches(id,code,season_id)` exists | REST probe; 1 row | Yes | None |
| `admin_users` required columns exist | REST probe; 8 rows | Yes | None |
| Core application columns exist | REST probe succeeded | Yes | Exact types still need pg_catalog verification |
| Campaign table is absent | REST probe says table exists | **No** | Identify environment and compare exact schema |
| Four new application columns are absent | REST probe says all exist | **No** | Compare types/FKs/indexes/ownership |
| Target triggers/functions absent | PostgreSQL metadata unavailable | Unknown | Query `pg_proc`/`pg_trigger` before authorization |
| Target indexes absent/equivalent | PostgreSQL metadata unavailable | Unknown | Query `pg_indexes` and definitions |
| Campaign RLS/policies match design | PostgreSQL metadata unavailable | Unknown | Query `pg_class`/`pg_policies` |
| Applications has no anon grant | PostgreSQL metadata unavailable | Unknown | Query grants/policies/RLS state |

The configured Supabase environment was not independently identified as staging or production. Because target objects exist, neither environment should receive migration 061 until exact ownership and schema provenance are known.

## 7. Lock and Rollback Risk

- `CREATE TABLE` is low risk when the target is absent.
- Four nullable `ADD COLUMN` operations require an AccessExclusive metadata lock on active `applications`; no default avoids a table rewrite.
- Three application indexes scan the live table. Plain `CREATE INDEX` is transactional but can block writes; `CONCURRENTLY` cannot run inside this transaction. Staging timing must measure duration before production planning.
- The unique index should be cheap if all historical campaign IDs are null, but this assumption must be verified count-only.
- Trigger installation changes all future application writes and requires legacy form regression tests.
- Rollback is safe only before any campaign-linked row. It intentionally refuses destructive rollback afterward.
- `REVOKE ALL ON applications FROM anon` may affect an undocumented direct-anon workflow; preflight grants and legacy public form tests are mandatory.

## 8. Required SQL Changes Completed

- Replaced unsafe `IF NOT EXISTS` behavior with dependency/object-conflict preflight and clean first-install DDL.
- Added whitespace-canonical duplicate index and blank-email predicate.
- Added database scope lock after first application.
- Hardened function search paths and revoked direct execution.
- Removed broad all-internal campaign SELECT policy; added program/season-scoped read policy.
- Explicitly removed anonymous campaign/application privileges.
- Kept all campaign mutations behind authorized server code.
- Added static contract tests for every change.

Remaining required action is not another guessed SQL edit: obtain exact read-only pg_catalog output for the already-existing objects and decide whether a separate reconciliation migration is needed.

## 9. Staging Execution Plan — DO NOT RUN WITHOUT OWNER AUTHORIZATION

1. Confirm the target project ID/host is staging, not production.
2. Confirm a current staging backup/snapshot and documented restore point.
3. Run metadata-only preflight: tables, columns/types/defaults, constraints, triggers, functions, indexes, RLS, policies, grants and migration ledger.
4. Abort immediately if any 061 target object exists; do not edit/drop it ad hoc.
5. Record count-only historical baselines for applications by season/batch/role/status and total rows; select no PII.
6. Verify no campaign-linked application columns/rows exist in a true first-install target.
7. Run the owner-approved migration command once through the standard migration mechanism; never paste selected fragments.
8. Verify transaction completion, object definitions, FK/check constraints, function ownership/search path, trigger enablement, RLS and grants.
9. Confirm before/after historical application counts and checksums/count groups are unchanged.
10. With disposable staging fixtures only, run negative tests: cross-program campaign, cross-season batch, draft/paused/closed submission, hidden scope tamper, anon SELECT/INSERT, reviewer mutation and UEH/HAM cross-access.
11. Run a two-connection concurrent duplicate submit; require exactly one application and one safe unique-conflict result.
12. Run legacy `/apply/mentor`, `/apply/mentee`, application list/detail/review paths and confirm no regression.
13. Rehearse rollback only before linked campaign applications; confirm it aborts afterward.
14. Regenerate database types if the project adopts generated types; today none exist.
15. Preserve logs and results for owner review before any production authorization.

## 10. Pass and Abort Gates

### Staging pass gates

- Exact target objects are absent before first install, or a separately reviewed reconciliation plan replaces 061.
- Migration completes once in a transaction.
- Historical row counts and grouped checks are unchanged.
- All object definitions match reviewed SQL.
- RLS negative tests pass for anonymous, reviewer and cross-program users.
- UEH/HAM isolation passes.
- Duplicate race yields one row only.
- Legacy application routes still work.
- Rollback boundary is demonstrated and understood.
- Tests/build pass and types are regenerated if a generator is adopted.

### Immediate abort gates

- Target cannot be proven to be staging.
- Backup/restore point is missing.
- Any campaign table/column/function/trigger/index/policy already exists unexpectedly.
- Dependency type differs from UUID/text assumptions.
- `admin_scope_access` semantics differ from documented code/UUID compatibility.
- Existing anonymous application privilege is required by an undocumented workflow.
- Historical data would require backfill or cleanup.
- Index creation duration/blocking exceeds the approved staging window.
- Any negative RLS, cross-program or concurrency test fails.

## 11. Final Validation

- Tests: 487/487 passed across 20 files.
- Migration 061 contract: 12/12 passed.
- ESLint: no warnings or errors.
- TypeScript: 0 errors.
- Production build: successful; 37/37 static pages generated and 48 application routes listed.
- `git diff --check`: passed.

Migration execution was not part of validation. No staging or production mutation, seed or backfill was performed.
