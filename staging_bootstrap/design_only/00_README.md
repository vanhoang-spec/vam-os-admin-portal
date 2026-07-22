# Staging baseline design modules

**STAGING ONLY — DESIGN ONLY — NOT AUTHORIZED — NOT EXECUTED — MUST NEVER RUN ON PRODUCTION.**

These modules are deliberately non-executable blocker manifests. They live outside `supabase_migrations/`. Migration 061 is explicitly excluded and remains separately unauthorized. Replace blockers with reviewed DDL only after owner-run read-only metadata collection, security approval, and a separate execution authorization.

Order: extensions, types, sequences, tables, constraints, indexes, functions, triggers, views, RLS/policies, grants, verification.
