# Account Administration, CSV Import and RLS Review Package

Status: VAM062 V4 local code/SQL review only. Migration, rollback, preflight, harness, Auth provider and CSV confirmation have not been run remotely.

V4 retains the encrypted, actor-bound, one-time preview design and the exact PostgreSQL policy-expression comparisons accepted by the third independent review. It does not implement monthly recap or event-participation product workflows.

## Independent specification and preflight

`VAM_OS_ACCOUNT_ADMIN_RLS_PREFLIGHT.sql` contains source-controlled required relation, column, predecessor-policy and conflict-arbiter specifications. Each emitted assertion is `PASS`, `FAIL`, or an explicitly optional `NOT_APPLICABLE`; V4 currently has no optional assertion. Missing evidence is `FAIL`, compatibility is derived rather than hard-coded, every non-PASS assertion makes eligibility false, and `failed_assertions` identifies mismatches. The query reads PostgreSQL catalogs only.

| Migration/RPC assumption | Preflight assertion |
|---|---|
| Required relations, relation kind and owner | `relation:<table>` |
| Referenced columns, types, nullability, identity/generation | `column:<table>.<column>` |
| `admin_users(email)` conflict target | `arbiter:admin_users` |
| `admin_scope_access(user_id,program_id,season_id)` | `arbiter:admin_scope_access` |
| `person_season_memberships(person_id,season_id,role)` | `arbiter:person_season_memberships` |
| Season/program and batch/season ownership | `relationship:*` |
| Account and membership lifecycle domains | `lifecycle:*` |
| Helper signature, mode, owner, search path and privileges | `helper:*` |
| Exact predecessor policies and complete inventory | `policy:*`, `policy_inventory` |
| RLS/forced-RLS baseline | `rls:*` |
| Package collisions | `package_name_collisions` |
| Import and rollback compatibility | derived `import_compatibility`, `rollback_compatibility` |

The migration repeats the three arbiter guards before material DDL and requires exactly one validated, unique, ready, ordinary-NULL, non-partial, non-expression compatible target.

## Auth ownership and deletion authority

`account-auth-ownership.ts` is the shared adapter for manual creation, synchronization and CSV import. It enumerates all normalized exact matches rather than selecting the first. States are `preexisting`, `proven_created`, `ambiguous`, `not_found`, and `failed`. Only a successful provider response containing an explicit consistent user ID yields `proven_created` and `deleteAllowed=true`. A post-operation lookup is reconciliation evidence only and never proves creation. Ambiguous/not-found outcomes are durably recorded; preexisting or ambiguous identities never reach compensation deletion.

Retries perform a new pre-lookup. A prior ambiguous identity may become `preexisting`, which permits database reconciliation but still never grants deletion authority. Reconciliation persists only operation IDs, SHA-256 identifiers and bounded non-secret correlation metadata.

## Rollback provenance

The V4 manifest records package version and original table/function OIDs. Rollback first verifies the exact manifest cardinality, table OID continuity, schema/name/kind/owner, independent ordered columns/types/nullability/defaults/generation specification, constraint inventory, grants, RLS and forced-RLS state, absence of table policies, and function/policy identity. All authentication precedes every `DROP`. Generated hashes remain tamper evidence only, not independent structural approval.

Legitimate business rows written after installation are not deleted. Schema authentication does not read or expose their contents; forward reconciliation may be required after rollback.

## Independent post-apply verification

The V4 post-apply SQL carries independent expected table arrays, constraint counts, defaults, exact policies, function signatures, owners, security modes, search paths, complete ordinary-role denial and service-role grants. Forced RLS affects assertion status. Extra package functions or policies fail inventory checks. The runtime manifest is explicitly supplementary provenance evidence, and all required assertion rows contribute to overall status and mismatch output.

## Isolation harness

The harness requires HTTPS endpoint semantics, a nontrivial whitespace-free API key, valid unexpired JWTs whose subjects equal configured IDs, distinct tokens and distinct subjects. Through the Super Admin channel it proves exact active admin roles, single exact active program/season scopes, provider-email-to-person linkage, and exact active mentor/mentee memberships. It validates active UEH/HAM programs, season ownership, distinct UEH seasons, exact nonduplicate membership topology, same-season access, cross-season and cross-program denial, inactive/missing/wrong-role denial, and a source-coded privilege-denial matrix. Package-table HTTP 200/zero rows is not accepted when privileges are required to be revoked. Output contains names, status codes, row counts and mechanisms, never tokens, keys, emails or identifiers.

## Remaining external verification

A fourth independent static review must inspect the complete V4 diff and SQL syntax. Only after that review may a separately authorized catalog-only staging preflight be considered. Actual PostgreSQL catalog rendering, object owners/grants, provider omitted-ID behavior, PostgREST status semantics, fixture linkage and cross-season behavior remain unverified until separately authorized execution.
