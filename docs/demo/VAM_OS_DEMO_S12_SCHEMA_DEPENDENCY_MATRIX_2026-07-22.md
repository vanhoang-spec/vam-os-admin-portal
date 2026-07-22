# VAM OS DEMO-S12 Schema Dependency Matrix — 2026-07-22

Decision: **FIXTURE STILL SCHEMA-BLOCKED**. The current seed uses the pre-061 data model and does not insert recruitment-campaign rows.

| Seed object | Required table | Required columns | Constraint dependency | Baseline status |
|---|---|---|---|---|
| Season | `seasons` | `id`, `code`, `name`, `status` | PK, code unique, status enum | Deterministic |
| Intake batch | `intake_batches` | `id`, `season_id`, `code`, `name`, `is_active` | season FK, unique | Deterministic |
| People | `people` | `id`, names/email/phone, `source_sheets` | PK, email unique/citext | Deterministic; synthetic values only |
| Mentor profiles | `mentor_profiles` | `id`, `person_id`, batch, code/status/taxonomy fields | people/batch FKs | Deterministic |
| Mentee profiles | `mentee_profiles` | `id`, `person_id`, batch, code/education/status fields | people/batch FKs | Deterministic |
| Applications | `applications` | person/season/batch, role/status/source | people/season/batch FKs, enums/checks | Deterministic |
| Matches | `matches` | season, mentor/mentee person IDs, status/type/source | people/profile/season FKs and checks | **BLOCKED: exact table DDL unresolved** |
| Event | `events` | season/batch, event configuration, fee fields | season/batch FKs; numeric(10,2) later alterations | Deterministic |
| Registrations | `event_registrations` | event/person/contact/status/payment/attendance fields | event/person FKs and checks | Deterministic |
| Check-ins | `event_registrations` / `event_participations` | attendance/check-in timestamps | event/person dependencies | Deterministic |
| Cleanup | all above | DEMO-S12 season and `DEMO_SEED` source marker | ordered FK-safe deletion | Blocked until full baseline exists |

- Pre-061 baseline required: **YES**.
- Migration 061 required by this seed: **NO**.
- Supabase Auth users required for fixture rows: **NO**.
- Auth users/admin_users required for operator login and UAT: **YES, separately owner-created and linked**.
- Synthetic account linking part of seed: **NO**.

Do not run the seed. It can become `FIXTURE READY AFTER BASELINE` only after deterministic `matches` DDL, approved/applied baseline, staging verification, and separate owner fixture authorization.
