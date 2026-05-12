# Production Release Checkpoint - 2026-05-12

VAM OS production has been updated and deployed. Team testing has started.

## Release Scope Completed

Completed production release scope:

- Event Registration.
- QR Check-in.
- CRM notes foundation.
- People detail CRM and lifecycle sections.
- UEHM admin permission setup.
- Production deployment of the updated VAM OS admin portal.

No app code changes are included in this checkpoint document.

## Production DB Migrations / Alignment Completed

Production database migration and alignment work for this release has been completed for the deployed scope.

Completed production DB alignment includes:

- Event registration and QR check-in foundation.
- Event participation status model alignment.
- Phase 1A member lifecycle and CRM foundation schema.
- Program schema alignment required by the deployed admin portal.

No new migrations are created by this checkpoint.

## Event Module Live Status

Event module production status: live.

Live capabilities:

- Admin event management surfaces are available in production.
- Event registration foundation is available in production.
- QR check-in foundation is available in production.
- Team testing has started against the production deployment.

Known event items still deferred:

- Event feedback.
- Annual event playbooks.

## CRM Module Live Status

CRM module production status: foundation live.

Live capabilities:

- CRM notes schema is available in production.
- People detail CRM section is deployed.
- People detail lifecycle section is deployed.
- Lightweight next-action fields are available through the CRM notes foundation.

Important boundary:

- Production lifecycle backfill has not been run.
- Lifecycle tables exist for the production foundation, but historical production membership records have not yet been backfilled into `person_season_memberships`.

## Admin Permission Setup

UEHM admin permission setup has been completed for:

- `lieu.nguyen@hoatay.com.vn`

This account is ready for the deployed production testing scope.

## Explicit Backfill Status

Production lifecycle backfill has not been run.

Do not treat production `person_season_memberships` as complete historical lifecycle coverage until the production backfill is separately reviewed, executed, and validated.

## Known Deferred Items

Deferred after this production checkpoint:

- Production lifecycle backfill.
- Mentor profile improvements.
- Mentor recruitment scoring / interview / orientation flow.
- Event feedback.
- Annual event playbooks.
- Document repository.
- Season rollover.
- Scholarship / supporter / CEP / certification.

## Next 7-Day Priorities

Recommended priorities for the next 7 days:

1. Collect team testing feedback from Event Registration, QR Check-in, CRM notes, and People detail lifecycle sections.
2. Triage production feedback into must-fix issues, usability polish, and deferred roadmap items.
3. Validate UEHM admin access in normal operational workflows for `lieu.nguyen@hoatay.com.vn`.
4. Prepare a reviewed production lifecycle backfill plan, including read-only pre-checks, rollback posture, validation queries, and explicit go/no-go criteria.
5. Improve mentor profile workflows based on the highest-impact team testing observations.
6. Draft the mentor recruitment scoring / interview / orientation flow before implementation.
7. Define the event feedback MVP scope and data model before creating any migration.

## Release Guardrails

- No code changes are made by this checkpoint.
- No migrations are created by this checkpoint.
- Production is not touched by this checkpoint.
- Do not run production lifecycle backfill until separately approved.
- Do not use `git add .` for this checkpoint or any related release commit.
