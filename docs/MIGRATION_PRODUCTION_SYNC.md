# Migration Production Sync

Goal: make all manual production schema fixes official, repeatable, and safe for staging/production parity.

## Official Migration

New migration:

- `supabase_migrations/026_production_schema_sync_admin_audit.sql`

It covers:

- `admin_scope_access.status`
- `admin_scope_access.updated_at`
- `admin_audit_log`
- `admin_audit_log.actor_admin_user_id`
- `admin_audit_log.target_admin_user_id`
- `admin_audit_log.action_type`
- `admin_audit_log.before_data`
- `admin_audit_log.after_data`
- `admin_audit_log.details`
- `admin_audit_log.updated_at`

## Apply Order

Recommended order for a fresh environment:

1. Apply all base migrations through `025_founder_intelligence_dashboard.sql`.
2. Apply `026_production_schema_sync_admin_audit.sql`.
3. Reload PostgREST schema if Supabase does not pick up the schema change immediately.
4. Rerun the schema probe from `docs/SCHEMA_AUDIT.md` or open `/admin/debug-auth`.

For production where some hotfixes already exist:

1. Apply `026_production_schema_sync_admin_audit.sql` directly.
2. Confirm it completes without destructive changes.
3. Verify `/admin/users` loads and audit inserts still work.

## Rollback Guidance

This migration is additive and should not need rollback. Do not drop columns in production as a rollback. If an issue appears:

- Keep the columns.
- Disable only newly added triggers if they are the suspected issue.
- Restore service by using the app's safe fallbacks while investigating logs.

## Production QA Checklist

After applying the migration:

- `/login` loads and does not expose service role keys.
- `/admin/debug-auth` shows the expected production ref and no secret values.
- `/admin/users` loads for `super_admin`.
- Creating/updating/deactivating an admin user writes or attempts to write `admin_audit_log`.
- If `admin_audit_log` insert fails, the mutation result still returns safely and server logs contain `[admin-users] admin_audit_log insert failed`.
- `/` loads with dashboard KPIs or ErrorBox fallbacks.
- `/operations` loads with dashboard KPIs or ErrorBox fallbacks.

## Known Optional Gap

`action_items` was missing from production schema cache during the 2026-04-30 probe. This is expected only if Phase 4 workflow is not deployed to production yet. Keep workflow surfaces guarded until that migration is applied.
