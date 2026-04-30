# Production QA Checklist

Date baseline: 2026-04-30.

## Before QA

- Confirm production env points to Supabase project ref `qkkroesfiazsejkzflcd`.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is configured only as a server-side env var.
- Apply `supabase_migrations/026_production_schema_sync_admin_audit.sql`.
- Redeploy the app after env or migration changes.

## Route Checks

### `/login`

- Page loads without blank screen.
- Supabase diagnostics show host/project/key type only, no secrets.
- Invalid login shows a safe form error.
- Valid active admin login redirects to the requested internal route or `/operations`.

### `/admin/debug-auth`

- In production, anonymous access returns 404.
- Authenticated admin access shows non-secret diagnostics.
- Project ref is `qkkroesfiazsejkzflcd`.
- Operations probe reports `ok` or visible ErrorBox rows, not a crash.

### `/admin/users`

- Non-super-admin access returns 404.
- Super admin can load the page.
- Missing/blocked `admin_scope_access` or `admin_audit_log` shows ErrorBox and logs server-side.
- Create/update/status/sync actions return a safe success/error message.
- Admin audit insert failure does not crash the mutation.

### `/`

- Dashboard loads.
- KPI cards render even if some queries fail.
- Query failures appear as ErrorBox messages and are logged server-side with `[data]`.

### `/operations`

- Operations dashboard loads.
- Month selector works.
- Query/RPC failures appear as ErrorBox messages and are logged server-side with `[data]`.
- If workflow `action_items` is not deployed yet, workflow-specific routes must stay optional and not block `/operations`.

## Pass Criteria

- No route shows a blank white crash screen.
- No ErrorBox contains credentials, tokens, service role keys, or raw env values.
- Server logs contain enough table/function context to diagnose schema mismatch.
- Production and staging both include the admin sync migration in their migration history.
