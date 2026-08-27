# M083 — S12-M1 identity and encrypted legacy-preview remediation

Status: **REVIEW ONLY — NOT APPLIED**  
Prepared: 2026-08-27 (Asia/Saigon)  
Candidate baseline: `5ab7958399ed22da775a03c09ad99b7ab408bbe3`

## Why this is M083

A full filename scan of every local head, remote-tracking ref, and tag found migration claims through M082. In particular:

- the authoritative applied M072 owns `public.vam063_trusted_api_role()` and is required by M073;
- `origin/s12-phase8-cross-mentoring` separately contains `072_cross_mentoring.sql`;
- `origin/s12-phase9-mkt-plan` contains `074_mkt_plan.sql`;
- `origin/feat/s12-core-ops-readiness` contains migrations M077–M082;
- M075 and M076 are already used throughout the repository as release/test milestone labels.

M083 is therefore the first identifier with no migration, package, RPC, crypto-prefix, documentation, or test ownership found in the scanned refs. This package does not rename or modify any historical M072/M073 artifact.

## Two auditable risk domains

`apply.sql` contains two clearly separated transactions:

1. **Domain A — core identity arbiters.** Adds verified unique indexes for canonical people email, season/role/canonical application email, season/role/person application identity, and canonical mentor code.
2. **Domain B — encrypted preview store.** Creates the RLS-protected ciphertext table and `vam083_*` create/consume RPCs.

Domain A commits before Domain B. If Domain B fails, do not guess or rerun blindly: run `verifier.sql`, inspect its phase evidence, and use the matching recovery section in `rollback.sql` before a reviewed retry.

## Operator sequence

Do not paste the old removed `072_s12_m1_canonical_email_uniqueness.sql`. Do not run the cross-mentoring `072_cross_mentoring.sql` as a substitute. Neither is this package.

1. Confirm the target is an approved **isolated test database**, never Production.
2. Verify `SHA256SUMS.txt` locally.
3. Run `preflight.sql` by itself. It is transactionally READ ONLY and performs no correction.
4. Stop if preflight raises any `M083 PREFLIGHT REFUSED` error. Duplicate people must never be auto-merged.
5. Have the SQL/security reviewer inspect both Domain A and Domain B in `apply.sql`.
6. Run `apply.sql` only in the approved isolated database.
7. Run `verifier.sql` independently. Every assertion must pass.
8. Record the outputs. True concurrency and browser UAT remain separate tests.

No connected migration is authorized by this package or by its presence in the repository.

## Preflight coverage

The read-only preflight reports:

- canonical duplicate people emails;
- duplicate applications by season/role/canonical email;
- duplicate applications by season/role/person;
- duplicate person/season/role memberships;
- null, blank, untrimmed, and mixed-case people emails;
- people emails containing `%` or `_` (observational; these valid characters are preserved);
- duplicate canonical mentor codes, including cross-person ownership;
- every existing index definition on the affected tables;
- target index/object name collisions;
- the authoritative `public.vam063_trusted_api_role()` dependency;
- the existing membership uniqueness constraint.

Duplicate identity/code rows, missing/wrong prerequisites, and object-name collisions block. Email-shape counts are reported, not rewritten: case, whitespace, `%`, `_`, plus-tags, and dots are never provider-rewritten or silently merged.

## Database invariants

- `people_canonical_email_key`: unique `lower(btrim(email_primary))` for nonblank emails.
- `applications_season_role_canonical_email_key`: unique season + role + canonical email. Canonical application email uniqueness is season-wide.
- `applications_s12_role_person_key`: unique season + role + `person_id` scoped only to UEHM-S12. Person-based application uniqueness is an S12 policy invariant. Historical pre-S12 reapplications are preserved. M083 does NOT rewrite/delete historical application records.
- `mentor_profiles_canonical_mentor_code_key`: unique canonical nonblank mentor code.

Membership uniqueness is not added by M083. Migration 052 already created the authoritative constraint `person_season_memberships_person_season_role_key UNIQUE (person_id, season_id, role)`, and M063 serializes create-or-noop with an advisory lock before relying on that constraint. M083 preflight and verifier both prove the constraint and zero duplicate rows.

## Preview-store security and residual disclosure

- The browser/RSC boundary carries the opaque preview ID plus a random integrity secret. The secret is therefore present in the rendered browser boundary, but the AES-256-GCM key is derived server-side and is not stored with ciphertext.
- TTL is at most 10 minutes. Consume is actor-bound and deletes the row atomically; replay returns no row.
- The table has RLS enabled, no policies, and explicit `REVOKE ALL` from PUBLIC, `anon`, `authenticated`, **and `service_role`**. The definer RPC owner reaches the table; `service_role` receives RPC execution only.
- Both RPCs resolve server context through the already-applied `public.vam063_trusted_api_role()`. Neither references the removed legacy JWT-role GUC.
- Direct table grants must remain absent. Adding a policy or table grant invalidates the verifier assumptions.

## Rollback/recovery

`rollback.sql` reverses Domain B first and Domain A second with bounded timeouts. Dropping Domain B deletes outstanding encrypted previews. Dropping Domain A reopens duplicate-write races. Use rollback only in the isolated environment after capturing evidence and stopping writers; it is not an automatic Production recovery instruction.

## Package inventory

- `README.md`
- `preflight.sql`
- `apply.sql`
- `verifier.sql`
- `rollback.sql`
- `SHA256SUMS.txt`

