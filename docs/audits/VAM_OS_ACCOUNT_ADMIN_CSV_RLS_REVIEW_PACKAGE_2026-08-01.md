# Account Administration, CSV Import and RLS Review Package

Status: code and SQL review only. Migration 062 and rollback were not applied.

The import accepts exactly: `email,display_name,role,program_code,season_code,intake_batch_code`. Staff roles create or reuse Supabase invitation identities and remain `invited`. `mentor` and `mentee` create/update business people and season memberships only; participant Auth is never created.

Preview reads reference catalogs and performs no write or invitation. Confirmation repeats parsing and catalog validation. It first creates sanitized batch metadata; if that table is unavailable, confirmation stops before account or membership mutation. Raw CSV, invitation tokens and passwords are never stored.

Migration 062 enables RLS and installs compatible policies in one explicit transaction. It records previous RLS flags for rollback. Program operators receive direct read access only through active `full_access`/`operations` scope matching program and optional season. Reviewer/interviewer direct people access remains denied pending assignment-scoped policy design. Import metadata is service-role only. Application writes use service-role and must retain server-side authorization because service-role bypasses RLS.

Before any staging application: owner must approve the exact staging project, synthetic identities, forward SQL, rollback SQL, and test window. Run preflight first; retain its sanitized result. Apply migration only in staging, then run structural verification and direct API isolation tests. Roll back immediately on unexpected access or application regression.

Known wider dependencies remain outside this package: `matches`, `mentee_profiles`, `mentor_profiles`, `mentoring_recaps`, and `event_participations` have previously evidenced unsafe production RLS states. Account rollout must not broaden until those paths are separately verified/remediated where authenticated users could reach them.
