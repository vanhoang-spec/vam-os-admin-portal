# S12-M1 baseline

- Recorded: 2026-08-27 (Asia/Saigon)
- Branch: `feat/s12-m1-mentor-intake-identity`
- Baseline SHA: `8fb6578af5ea73903f8456a1b0c91a13971b1c18`
- Working tree at baseline: clean

## Existing routes and services

- New mentor intake: `/apply/mentor` -> `submitMentorApplicationAction` -> `submitPilotApplication`.
- Returning mentor: `/renew/[token]` -> `acceptRenewalAction` / `declineRenewalAction` -> the M071 trusted renewal RPCs.
- Renewal operations: `/admin/renewals` with individual and bounded batch invite creation, revoke, regenerate, diff review, and Core Team confirmation.
- Mentor directory: `/mentors`; its table search includes name and email but does not currently include `mentor_code`.
- Manual mentor creation: `/mentors/create` -> `createMentorProfile`, with optional explicit linkage to an existing person.
- Existing CSV pattern: `/admin/users/import`, using parse -> validate -> encrypted one-use preview -> server revalidation -> explicit apply. It is membership-oriented and is not safe to reuse directly for legacy mentor candidates because it creates participant memberships.
- No legacy mentor CSV/manual candidate workflow exists at baseline.

## Relevant schema and trusted runtime

- Migration 038 adds the Season 12 application identity/contact fields, `raw_payload`, `consent_data_storage`, source, batch linkage, and a non-unique lower-email lookup index.
- Migration 043 links approved mentor/mentee profiles back to applications and intake batches.
- Migrations 062/063 provide the reviewed account import and membership lifecycle RPC patterns.
- Migration 069 controls public Season 12 application form availability.
- Migration 070 creates `person_season_invites` with hashed tokens, expiry/revocation/submission binding, one live invite, and one accepted invite per person/season/role.
- Migration 071 provides trusted create/revoke/accept/decline/confirm renewal RPCs. The accept RPC creates a person-bound `s12_mentor_renewal` application; admin confirmation applies an allowlisted profile diff and then uses the existing application approval/membership lifecycle.

## Identity and duplicate behavior

- `lib/identity.ts` already defines the intended canonical email (`trim` + lowercase) and a standards-oriented structural validator. It performs no provider-specific rewriting.
- The account import path already uses that helper and detects canonical duplicates within a file.
- The public application path duplicates normalization/validation locally instead of using the helper. Its duplicate rule is intake-batch + role + case-insensitive email; storage is lowercased. The database index supports lookups but does not enforce uniqueness, so concurrent submissions remain a schema-level risk.
- Person resolution occurs at approval, not public submission. Approval reuses a linked person or performs a case-insensitive email lookup, then creates a person only when no canonical match exists.
- Manual person/mentor creation has another local email cleaner/resolver, so identity policy is currently distributed.
- Current behavior is season/batch aware: a historical email is not globally prohibited from applying in another intake/season.

## Consent and renewal lifecycle

- New applications require `consent_data_storage` and store it on `applications`; approved commitment acknowledgements are stored in `application_answers`.
- Renewal acceptance already requires the approved `consent_data_storage` wording in the UI, validates it in the server runtime, and the M071 RPC rejects a false/missing value before creating the renewal application.
- Renewal tokens are generated as 32 random bytes, only SHA-256 hashes are stored, and the raw bearer path is returned once. Revocation, regeneration, expiry, one-live-invite, one-accepted-renewal, profile lineage stripping, admin-reviewed profile diff, audit logging, and membership reconciliation are already present.
- Baseline renewal fields are prefilled, but company/title/industry/function/experience are optional at the HTML and server layers; blank values silently preserve prior data. Capacity is explicitly re-selected. Programs willing to participate are not collected by renewal.
- The approved mentor-profile introduction exists only on the new mentor form at baseline. Support contacts are not centralized across both mentor flows.

## Baseline tests

- Initial sandboxed Vitest launch failed with `spawn EPERM`; rerun outside the process sandbox was required for esbuild workers.
- Focused baseline: 274 assertions passed across the identity/normalizer, application validation/control, application-answer cleanup, renewal token/runtime/profile safety, mentor search, and individual re-invite suites.
- One existing React test warning is emitted by the mocked Server Action `form[action]` in `m076-renewal-individual-reinvite.test.tsx`; the 8 assertions pass.

## Baseline risk conclusion

- Legacy import can reuse the encrypted one-use preview pattern and the renewal runtime, but must not call the existing participant-import membership RPC.
- A database-enforced canonical uniqueness change would require a new reviewed migration. No connected migration is authorized or applied in M1 implementation work.
