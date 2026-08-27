# S12-M1 Mentor Intake & Identity — implementation report

- Date: 2026-08-27 (Asia/Saigon)
- Branch: `feat/s12-m1-mentor-intake-identity`
- Baseline SHA: `8fb6578af5ea73903f8456a1b0c91a13971b1c18`
- Final implementation HEAD SHA: `f8f62fc7a20f98e9a9f44731d881dd06d891d213`
- SHA note: the value above is the completed code/migration/test HEAD immediately before the documentation-only commit that adds this report. A Git commit cannot contain its own hash; the final documentation commit SHA is recorded in the handoff.
- Connected migration applied: no
- Production deployment: no

## Outcome

S12-M1 is implemented locally for new mentor intake, returning-mentor confirmation, and legacy mentor candidate intake. The implementation preserves the existing M071 invitation and confirmation lifecycle. Legacy CSV/manual intake creates or reuses only `people` and a minimal `mentor_profiles` row plus provenance/audit data; it does not create an application, invitation, consent, or Season 12 membership.

End-to-end browser UAT for the legacy CSV path is not yet ready on a database environment because migration M083 is intentionally unapplied. Code review and automated review are ready. New-mentor and existing-renewal browser flows can be tested against a compatible isolated environment, while complete S12-M1 UAT must wait for independent review and isolated application of M083.

## Identity behavior

Before:

- Email normalization was duplicated across application, approval, and manual person paths.
- Application duplicate detection was scoped to intake batch + role + case-insensitive email, allowing the same canonical email to create another application in the same season through another batch and leaving a concurrent-insert race.
- Anonymous application submission did not link an already-known person.
- Mentor directory search omitted `mentor_code`.

After:

- `lib/identity.ts` is the shared trim + lowercase policy and validator. No Gmail/provider-specific rewriting is performed; plus tags and dots remain significant.
- Application validation and storage use the shared canonical value.
- Duplicate logic is season + role + canonical email, so another season remains valid while a second application for the same season/role is rejected.
- An existing canonical person is linked to the application without creating a person in the anonymous flow; ambiguous lookup fails closed.
- SQLSTATE `23505` is mapped to the safe duplicate response for concurrent attempts.
- The review-only migration adds canonical unique indexes for people and season/role applications after aborting on existing conflicts.
- Mentor list and renewal console search support normalized name, mentor code, and email queries.

## Mentor-facing forms

The public mentor application no longer exposes “Batch 1 Pilot” wording, while its existing gate and intake-batch binding remain unchanged. It now includes the structured university choice with a required `OTHER` detail, `UEH Alumni` referral option, the approved mentor-profile introduction, and centrally configured support contacts.

The renewal form places the same approved mentor-profile section near the start without the new-applicant process/deadline. It requires active confirmation of company, title, exact experience, primary industry, primary function, mentee capacity, university, and at least one mentoring program. Existing profile values remain prefilled where available. Server validation mirrors required annual fields, numeric and enum constraints, commitments, active-reading acknowledgement, participation confirmation, and the existing approved privacy consent.

Consent remains mentor-supplied. Import never records consent. Renewal acceptance passes `p_consent_data_storage: true` to the existing trusted M071 RPC only after the server has validated the explicit mentor choice.

## Legacy mentor flow

CSV columns are exactly:

`full_name,email,phone,legacy_mentor_code,prior_season,notes`

The flow is upload → parse/validate → preview → identity resolution → explicit apply. It reuses the existing CSV parser and the repository's encrypted-preview pattern. Preview statuses include `NEW_PERSON`, `EXISTING_PERSON`, `DUPLICATE_IN_FILE`, `INVALID_EMAIL`, `INVALID_ROW`, and `CONFLICT_REQUIRES_REVIEW`.

Preview payloads are AES-256-GCM encrypted, actor-bound, integrity-bound, expire after ten minutes, and are consumed by delete. Migration M083 enables RLS, gives the preview table no web grants, and exposes only service-role RPC execution after checking that the actor is an active `core_team`, `admin`, or `super_admin` user.

CSV apply and manual entry call the same `resolveLegacyMentorCandidate` service. The resolver:

- canonicalizes and validates email;
- reuses exactly one existing person or creates one;
- creates/reuses one minimal mentor profile;
- refuses ambiguous canonical people and mentor-code conflicts;
- fills an existing phone only when blank;
- stores source, prior-season context, legacy code, notes, and CSV SHA-256 as provenance rather than asserting historical membership;
- writes an admin audit record;
- never accesses the membership or application tables.

Repeated source application converges on the same person/profile. After import, the candidate appears in the existing renewal mentor picker; Core Team deliberately creates a personalized invite using the current runtime.

## Renewal runtime reuse

No second renewal system was introduced. S11 and legacy candidates use the same `person_season_invites` model and existing M071/M063 operations: random bearer token generation, hash-only token storage, expiry, revoke, regenerate, one-live/one-accepted protections, accepted/declined submission, admin-reviewed profile diff, application approval, and membership reconciliation.

Import stops before invitation. Submission stops before membership. Only Core Team confirmation reaches the existing membership lifecycle, preserving the prohibition on automatic Season 12 activation.

## Admin operations

`/admin/renewals/legacy` provides template download, safe CSV preview/apply, and minimal manual entry. `/admin/renewals` now includes:

- search by mentor name, mentor code, or email;
- actual invite-state filters for live/effective, awaiting Core Team confirmation, accepted, declined, revoked, and expired;
- operational source filters for S11 renewal, legacy CSV, and legacy manual entry;
- displayed mentor code and source on each invite.

Source is derived from durable person provenance because the existing invite schema has no source column. If one person has multiple legacy provenance sources, the filter represents person provenance rather than a source captured on the individual invite.

## Migration

Added `VAM_OS_M083_S12_M1_IDENTITY_PREVIEW_REMEDIATION_20260827` remediation package as review-only. This package supersedes earlier attempts that conflicted with the historical authoritative M072 (already applied) and unrelated cross-mentoring 072 on other refs. The M083 package is actually required for:

1. database-enforced canonical people/application uniqueness and concurrent-insert safety; and
2. the encrypted one-use legacy CSV preview store/RPCs.

The M083 package was not applied anywhere. Its preflight aborts when canonical duplicate people or same-season/role applications already exist. Independent data review, SQL/security review, an isolated test apply, verifier/browser UAT, and an approved maintenance window are required before any connected application.

## Files changed

Documentation:

- `docs/S12_M1_BASELINE.md`
- `docs/S12_M1_IMPLEMENTATION_REPORT.md`

Product and service code:

- `app/actions/apply.ts`
- `app/admin/renewals/page.tsx`
- `app/admin/renewals/legacy/actions.ts`
- `app/admin/renewals/legacy/legacy-client.tsx`
- `app/admin/renewals/legacy/page.tsx`
- `app/admin/renewals/legacy/state.ts`
- `app/admin/renewals/legacy/template/route.ts`
- `app/apply/_components/gate-views.tsx`
- `app/apply/_components/mentor-profile-intro.tsx`
- `app/apply/_components/mentor-support-contacts.tsx`
- `app/apply/mentor/apply-mentor-form.tsx`
- `app/apply/mentor/page.tsx`
- `app/mentors/page.tsx`
- `app/renew/[token]/renewal-form.tsx`
- `lib/account-import.ts`
- `lib/application-approvals.ts`
- `lib/application-form-validation.ts`
- `lib/applications-create.ts`
- `lib/identity.ts`
- `lib/legacy-mentor-import.ts`
- `lib/legacy-mentor-preview-store.ts`
- `lib/legacy-mentor-service.ts`
- `lib/mentor-intake-content.ts`
- `lib/people-create.ts`
- `lib/renewal-console.ts`
- `lib/renewal-runtime.ts`
- `VAM_OS_M083_S12_M1_IDENTITY_PREVIEW_REMEDIATION_20260827/`

Tests:

- `__tests__/applications-create-commitment-cleanup.test.ts`
- `__tests__/apply-action-server-gate.test.ts`
- `__tests__/image-optimizer-attack-surface.test.ts`
- `__tests__/m073-renewal-decline-feedback.test.ts`
- `__tests__/renewal-runtime-p0.test.ts`
- `__tests__/s12-m1-admin-ux.test.ts`
- `__tests__/s12-m1-identity.test.ts`
- `__tests__/s12-m1-legacy-import.test.ts`
- `__tests__/s12-m1-mentor-forms.test.ts`
- `__tests__/uat-s12-server-validation.test.ts`

## Verification evidence

- Baseline focused suites: 274 assertions passed.
- Final S12-M1 focused run: 4 files passed, 29 tests passed.
- Full repository suite: 131 files passed, 1 skipped; 3,430 tests passed, 14 skipped; duration 46.56 seconds.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed; only the existing Next.js lint-command deprecation notice was emitted.
- `npm.cmd run build`: passed; production build generated `/admin/renewals/legacy` and its template route.
- `git diff --check`: passed.

The full suite emits existing intentional error-path logs and jsdom warnings for mocked Server Action `form[action]`, `requestSubmit`, and navigation. They are non-failing and unrelated to S12-M1 correctness.

## Unresolved issues and risks

- M083 is unapplied by design. Until reviewed and applied to an isolated environment, the legacy preview RPCs are unavailable and database-level uniqueness is not enforced; application-level checks still operate but cannot eliminate every race.
- Existing canonical conflicts must be repaired deliberately before M083 can succeed; the migration aborts rather than guessing merges.
- Legacy person/profile/provenance writes and the audit insert are not one database transaction. An audit failure is reported as failure, while the idempotent candidate rows may remain and be safely reused on retry. A future trusted transactional RPC could close this residual audit atomicity gap, but was not introduced without broader schema review.
- Invite source is inferred from person provenance, not stored per invite, because changing the invitation schema was not necessary for safe lifecycle reuse.
- No browser UAT or connected-database verification was performed under the hard safety boundary.
- Dependency installation reported 10 npm audit findings (3 moderate, 6 high, 1 critical). No automated audit fix was run because it would be an unrelated, potentially breaking dependency change.

## Review readiness

The code, tests, and review-only SQL are ready for independent review. Complete browser UAT is conditional on approval and isolated application of M083, followed by conflict-preflight verification and testing of CSV preview/apply, manual candidate entry, invite creation, mentor consent/renewal submission, and Core Team confirmation. No merge, deployment, connected migration, real invitation, consent, application, or Season 12 membership was created.

S12_M1_IMPLEMENTATION_COMPLETE=YES
IDENTITY_NORMALIZATION_PASS=YES
NEW_MENTOR_FORM_PASS=YES
RENEWAL_FORM_PASS=YES
LEGACY_CSV_IMPORT_PASS=YES
LEGACY_MANUAL_ENTRY_PASS=YES
RENEWAL_REUSE_PASS=YES
INVITE_FILTERS_PASS=YES
AUTOMATED_TESTS_PASS=YES
HIGH_RISK_REVIEW_REQUIRED=YES
CONNECTED_MIGRATION_APPLIED=NO
PRODUCTION_DEPLOYED=NO
READY_FOR_INDEPENDENT_REVIEW=YES
