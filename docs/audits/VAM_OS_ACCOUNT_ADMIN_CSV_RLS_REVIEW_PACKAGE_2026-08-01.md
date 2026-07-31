# Account Administration, CSV Import and RLS Review Package

Status: code and SQL review only. Migration 062 and rollback were not applied.

The import accepts exactly: `email,display_name,role,program_code,season_code,intake_batch_code`. Staff roles create or reuse Supabase invitation identities and remain `invited`. `mentor` and `mentee` create/update business people and season memberships only; participant Auth is never created.

Preview reads reference catalogs and performs no invitation or business-data mutation. V3 encrypts valid CSV with a one-time AES-256-GCM key and stores only ciphertext in the existing Supabase/PostgreSQL infrastructure. The browser receives the random preview id and key material, never raw CSV. A service-only RPC atomically deletes and returns a matching, unexpired, actor-bound ciphertext row. The database enforces the ten-minute maximum, bounded capacity, expiry cleanup, and replay protection. Store outage, cache miss, restart, load balancing, actor mismatch, tampering, expiry, or replay fails closed. No new vendor or credential is required.

Migration 062 V3 replaces the never-applied V2 artifact. It uses one explicit transaction and rejects ownership, type, relationship, helper, privilege, package-name, and any pre-existing affected-table policy conflict before material DDL. NULL season is never program-wide: operators require an explicit active season matching the record. Privileged RPCs validate active program, season ownership and batch ownership transactionally. Package tables and RPCs are ordinary-role denied; service-role bypass remains an explicit application-security dependency.

Participant person/membership/outcome/audit writes occur inside one PostgreSQL RPC transaction and cross-program reassignment is rejected. Staff scopes use deterministic conflict updates and verify the requested resulting state before success. Auth/PostgreSQL cannot share a transaction: existing Auth is never deleted; a newly invited identity is compensated after database failure; failed compensation must create a durable operation-id/SHA-256 reconciliation row. Failure to record reconciliation returns a distinct critical failure.

Rollback validates the exact five-row RLS state set and deterministic checksums, plus a package-owner-only manifest containing the exact function and policy definition hashes. `service_role` cannot update/delete state or manifest evidence. Rollback refuses missing, extra, altered, or wrong-owner package evidence, removes only proven V3 objects, and restores captured RLS enabled/forced flags. It does not delete legitimate business rows created before rollback.

Before any staging application: perform another independent static review, then separately authorize the V3 read-only preflight. The isolation harness rejects empty, malformed, duplicate or identity-mismatched credentials; validates every session against its configured synthetic user id; proves fixtures through Super Admin; and covers both operators' positive access, cross-program and cross-season denial, ordinary roles, and import metadata. It never prints credentials or identifiers and has not been run remotely.

Known wider dependencies remain outside this package: `matches`, `mentee_profiles`, `mentor_profiles`, `mentoring_recaps`, and `event_participations` have previously evidenced unsafe production RLS states. Account rollout must not broaden until those paths are separately verified/remediated where authenticated users could reach them.

## Second independent static review remediation

Migration 062 V3 remains blocked and unapplied. The remediation adds fail-closed structural evidence for all prerequisite columns, constraints, relationships, grants, RLS state, helpers, policies, collisions, and rollback compatibility. Each required preflight section is tri-state (`PASS`, `FAIL`, or `NOT APPLICABLE`) and missing required evidence makes overall eligibility false.

Every `ON CONFLICT` target is now proven before material DDL as an exact, validated, non-partial, non-expression unique/exclusion constraint with compatible column order and ordinary PostgreSQL NULL semantics. Predecessor policies are compared by exact catalog expression and complete policy attributes; grouping-removing normalization was deleted.

Rollback authenticates package identity, ownership, the exact table set, column counts, RLS state, absence of table policies, ordinary-role grants, functions, and policy hashes before any package table drop. It refuses altered, missing, duplicated, additional, or replacement evidence. Legitimate business rows written through package RPCs remain intentionally preserved and can require forward reconciliation after rollback.

Post-apply verification carries an independent expected policy specification, exact roles/commands/permissiveness/expressions, expected table/RLS/grant state, service-only functions, provenance, NULL-season denial, and unexpected-policy rejection. Runtime-generated manifest hashes are supplementary evidence only.

Auth recovery uses one ownership contract. A successful invitation with an omitted user id is resolved by exact post-invite lookup and treated as operation-created; unresolved or ambiguous ownership is never deleted and is durably reconciled. Pre-existing identities are never compensated. Manual create, sync, and CSV staff import use sanitized hashes and metadata.

The local harness rejects malformed, expired, duplicate, or reused identities; proves JWT subjects and exact active database roles; requires role-separated users; authenticates UEH/HAM program-season-person membership topology; and proves same-program/cross-season denial separately. Import-metadata assertions distinguish HTTP privilege denial from intentional RLS zero-row filtering; invalid authentication is rejected before denial tests and any returned metadata row fails.