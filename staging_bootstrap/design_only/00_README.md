# Staging baseline design modules

**STAGING ONLY — DESIGN ONLY — NOT AUTHORIZED — NOT EXECUTED — MUST NEVER RUN ON PRODUCTION.**

These modules live outside `supabase_migrations/`. Deterministic objects are rendered from the owner-provided, offline production inventory; unresolved objects remain explicit blockers. The modules have not been executed and are not an execution runbook. Migration 061 is explicitly excluded and remains separately unauthorized.

Current blocking condition: `matches.match_confidence` lacks authoritative numeric precision/scale metadata. Consequently `matches`, its dependent foreign keys/indexes, functions, triggers, RLS, and grants are not ready. Owner security decisions and staging recovery/disposability confirmation are also outstanding.

Order: extensions, types, sequences, tables, constraints, indexes, functions, triggers, views, RLS/policies, grants, verification.
