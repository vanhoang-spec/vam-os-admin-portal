# Account Administration, CSV Import and RLS Review Package

Status: code and SQL review only. Migration 062 and rollback were not applied.

The import accepts exactly: `email,display_name,role,program_code,season_code,intake_batch_code`. Staff roles create or reuse Supabase invitation identities and remain `invited`. `mentor` and `mentee` create/update business people and season memberships only; participant Auth is never created.

Preview reads reference catalogs and performs no database write or invitation. Valid input is held only in a bounded server-memory store for ten minutes. The browser receives a random, actor-bound integrity reference rather than raw CSV. Confirmation consumes the reference once and repeats parsing and catalog validation. Expiry, tampering, replay, or server-instance loss fails closed. Raw CSV is never stored in a database, file, log, URL, hidden field, or browser persistence.

Migration 062 V2 uses one explicit transaction and refuses package-name collisions or unexpected pre-existing policies before material DDL. It creates only `vam062_*` functions/policies and package-owned tables, captures prior RLS enabled/forced flags, and never replaces an existing helper or policy. Program operators receive direct read access only through active `full_access`/`operations` scope matching program and optional season. Reviewer/interviewer direct people access remains denied. Import metadata and mutation RPCs are service-role-only; service-role bypass remains an explicit application-security dependency.

Participant person/membership/outcome/audit writes occur inside one PostgreSQL RPC transaction. Staff flows span Supabase Auth and PostgreSQL and cannot be atomic: existing Auth is never deleted; a newly invited Auth identity is deleted if the database RPC fails; compensation failure returns `reconciliation_required` and records only a SHA-256 identifier where the reconciliation RPC is available. Rows are never reported created before the database mutation, scope, outcome and mandatory audit commit together.

Rollback is deterministic because the forward migration rejects all package-name conflicts and does not alter existing policies, functions, or grants. It removes only package-specific objects and restores captured RLS enabled/forced flags. It does not delete legitimate business rows created before rollback; those require a separately reviewed reconciliation plan.

Before any staging application: perform a new static review, then obtain authorization for the expanded read-only V2 preflight. Application requires a separate later authorization. The executable isolation harness accepts a local config path containing externally supplied synthetic credentials, never prints them, fails closed if any identity is absent, and emits sanitized JSON results only. It has not been run remotely.

Known wider dependencies remain outside this package: `matches`, `mentee_profiles`, `mentor_profiles`, `mentoring_recaps`, and `event_participations` have previously evidenced unsafe production RLS states. Account rollout must not broaden until those paths are separately verified/remediated where authenticated users could reach them.
