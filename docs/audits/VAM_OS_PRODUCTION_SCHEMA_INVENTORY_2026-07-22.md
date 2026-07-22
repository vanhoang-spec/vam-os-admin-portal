# VAM OS Production Schema Inventory

Date: 2026-07-22
Source: owner-supplied, read-only single-result inventory from confirmed production `vam-os-mvp` (`qkkroesfiazsejkzflcd`).

## Target Confirmation

- Environment: PRODUCTION
- Database identity reported by probe: `postgres`
- Probe version: `vam-os-production-schema-inventory-single-result-v1`
- Input integrity and value-level safety: PASS; see the separate safety review.
- This report contains sanitized metadata only, not production rows.

## Inventory Completeness

All 18 probe sections parsed. Metadata includes relations, columns, constraints, indexes, functions, aggregates, triggers, policies, grants, extensions, estimates and safety counts. It does **not** include enum labels/order, view SQL definitions, sequence definitions/ownership, object comments for every class, or an application migration ledger. Those omissions block deterministic full baseline generation.

## Public Tables

Production has 49 ordinary public tables and 3 public views.

| Category | Objects |
|---|---|
| Core identity/program | programs, seasons, intake_batches, people, person_roles, mentor_profiles, mentee_profiles |
| Recruitment/review | applications, application_answers, application_reviews, application_decisions, review_assignment_batches |
| Matching/mentoring | matches, mentoring_recaps, mentor_program_participations, mentor_industries, mentor_function_areas, industries, function_areas |
| Events | events, event_links, event_registrations, event_participations, feedback_responses |
| Admin/operations/governance | admin_users, admin_scope_access, admin_audit_log, action_items, activity_correction_log, operational_team_assignments, communications, crm_notes, person_season_memberships, person_season_membership_log |
| Import/data-quality helpers | data_import_batches, data_issues, data_quality_issues and 11 `staging_*` import/helper tables |
| Views | v_mentee_monthly_tracking, v_monthly_activity_summary, v_season_latest_closed_month |

Core facts: `applications`, people/profiles, matches, events, recaps, programs, seasons and intake batches all exist. `recruitment_campaigns` does not exist.

## Core Table Columns

| Table | Column count | Important schema facts |
|---|---:|---|
| programs | 7 | UUID id; code/name; active flag; timestamps |
| seasons | 9 | nullable program UUID; public season_status enum; date range |
| intake_batches | 8 | season UUID; code/name; active flag |
| people | 22 | UUID; citext email; gender enum; consent and legacy/source metadata |
| person_roles | 10 | person/season UUIDs; role_type and role_status enums |
| mentor_profiles | 31 | person/source-application/batch links plus profile/taxonomy fields |
| mentee_profiles | 24 | person/source-application/batch links plus education/career fields |
| applications | 31 | legacy and S12 fields; role/application enums; raw_payload and internal JSON; no campaign/reference/consent-version columns |
| application_answers | 6 | application link, question metadata and value text |
| matches | 25 | season/person/profile/batch links; match enums and lifecycle fields |
| events | 66 | season/batch links and event configuration/lifecycle fields |
| event_registrations | 81 | event/person/link lifecycle, proof/payment/meal fields |
| event_participations | 18 | event/season/person and attendance fields |
| mentoring_recaps | 20 | season/match/person links and recap status |
| admin_users | 10 | auth UUID, email, role/status; RLS currently disabled |
| admin_scope_access | 8 | user UUID, program/season stored as text, role/status |

Column names that mention email, phone, token, password or secrets are metadata only; no values are reproduced here.

## Constraints and Relationships

Public metadata contains 193 constraints: 78 foreign keys, 57 checks, 39 primary keys and 19 unique constraints. Major dependency chains include program → season → intake batch; people → roles/profiles; season/people → applications/matches/events/recaps; events → links/registrations/participations; applications → answers/reviews/decisions. Exact definitions remain in the local raw inventory and must be rendered into a reviewed baseline artifact before execution.

## Indexes

There are 180 public indexes. The inventory includes uniqueness, validity/readiness, access method, predicates, expressions and full definitions. Import/helper tables also contribute indexes and are not automatically baseline-required. No migration-061 campaign index is present.

## Public Functions

The catalog reports 58 functions in `public` and 2 aggregate objects. Many are `citext`/regexp compatibility functions installed with the public-schema citext extension and are not VAM-owned DDL to clone manually. VAM-owned functions include admin access/context helpers, operations/founder dashboard RPCs, intelligence normalizers, `set_updated_at`, and membership immutability/scope validators. Aggregate objects were inventoried separately and never passed to `pg_get_functiondef`.

## Triggers

Twenty public triggers were observed. Most call `set_updated_at`; membership log immutability and membership scope-validation triggers are also present. No recruitment-campaign or application-campaign trigger exists.

## RLS Status

RLS is enabled on 9 public tables: action_items, activity_correction_log, admin_audit_log, admin_scope_access, application_decisions, application_reviews, programs, review_assignment_batches and seasons. It is disabled on 40 public tables, including `admin_users`, `applications`, people/profiles, matches, events, registrations and recaps.

Policies can exist on a table while RLS is disabled. Production has policies recorded for several RLS-disabled business tables; those policies are not enforcement until RLS is enabled.

## Policies

Seventeen public policies were returned. They cover admin scope, reviews/decisions, programs/seasons and read policies for core operational tables. Their presence must not be interpreted as protection on RLS-disabled tables.

## Grants

The inventory reports seven table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) for `anon`, `authenticated`, `service_role` and `postgres` across all 52 public relations. This broad exposure is a significant security observation requiring a separate remediation authorization. No grant changes are made here.

## Extensions

Observed extensions: citext 1.6 (public), pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.1 and uuid-ossp 1.1. Baseline design may request only necessary extension names; it must not clone extension-managed internals/functions.

## Migration Provenance

Catalog-only detection found `auth.schema_migrations`, `realtime.schema_migrations` and `storage.migrations`. These are Supabase-managed component ledgers, not the VAM OS application migration ledger. No application ledger rows were evaluated or inferred.

## Table Estimates

Estimates include applications 888, people 1,331, mentor profiles 449, mentee profiles 655, matches 637, events 7, registrations 51 and recaps 2,447. Exact aggregate safety counts at probe time were applications 902, people 1,335, mentor profiles 450, mentee profiles 656, matches 638, events 13, registrations 54 and application answers 15,207. Any estimate of `-1` means unavailable/stale statistics, not zero.

## Security Observations

- Core business tables and admin_users have RLS disabled.
- Broad anon/authenticated grants are present.
- Some disabled-RLS tables retain policies that are not enforcing access.
- No actual secret/PII values were present in the inventory.
- This audit records facts only; remediation is outside authorization.

## Limitations

Enum labels/order, view definitions and sequence definitions/ownership are absent. Metadata does not prove runtime authorization paths, storage bucket requirements or application ledger history. The public schema therefore cannot yet be recreated deterministically from this inventory alone.
