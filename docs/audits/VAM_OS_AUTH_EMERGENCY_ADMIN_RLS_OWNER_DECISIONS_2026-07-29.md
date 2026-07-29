# VAM OS Emergency Admin RLS Owner Decisions

Package: `auth-emergency-admin-rls-staging-package`
Date: 2026-07-29
Status: PENDING OWNER DECISION

---

## Context

Production confirms `admin_users` has RLS disabled with no policies. Any Supabase Auth user
with a valid JWT can query the production Supabase REST API and enumerate all admin accounts,
roles, and `auth_user_id` values directly — bypassing the application entirely.

This emergency package addresses only the admin-management tables (admin_users,
admin_audit_log) and unnecessary anon function grants. It does NOT include participant
login, people.auth_user_id, or the broader Auth_A business table hardening.

---

## Decision D1 — Program Admin visibility into other admin accounts

**Question:** Should a Program Admin (role = `admin`) be permitted to read other admin_users rows
in their assigned programs via the Supabase REST API?

**Current emergency package policy:**

```
own row (via auth.uid() = auth_user_id)
OR super_admin (via current_admin_role() = 'super_admin')
```

Under this policy, a Program Admin can read ONLY their own row via direct API. They cannot
enumerate other admins via the REST API. They CAN still see other admins through the application
(which uses service-role) when the Users Management UI is built, with filtering applied server-side.

**Recommended default:** Program Admin sees only own row via direct API. Application layer can
expose relevant staff listings with server-controlled filters when needed. This avoids building
cross-admin visibility into the DB policy, which would require program_id FK or subquery on
admin_scope_access — complex and not yet proven at this stage.

**Impact if deferred:** Policy remains as designed above. Program Admins cannot enumerate
other admins via direct REST API (no change from intended post-RLS behavior). Application
behavior is unaffected (service-role reads all).

**Action required:** YES — must choose before staging migration is applied.

Options:
1. **Own row only for non-super_admin** (recommended): use the policy as written in the emergency package.
2. **All active admins visible to any active admin**: change USING to `public.is_active_admin()`. Simpler but more permissive.
3. **Program-scoped**: allow `admin` role to see admins in shared programs. Requires JOIN on admin_scope_access — deferred to Auth_A full rollout.

---

## Decision D2 — admin_audit_log visibility for non-super_admin

**Question:** Should Program Admin or other reviewer-tier roles be allowed to read
`admin_audit_log` for actions within their assigned programs?

**Current emergency package policy:**

```
super_admin only
```

This is the most restrictive option. admin_audit_log contains before/after JSONB blobs
that include email, auth_user_id, role, and status of all admin changes. Exposing this to
Program Admins reveals information about admin accounts they do not manage.

**Recommended default:** Super_admin only. Audit log is a privileged record intended for
root-level accountability, not for Program Admin reporting.

**Impact if deferred:** Policy remains super_admin only. No impact on application — audit log
reads in the application are gated by `requireSuperAdmin()` at the server action layer anyway.

**Action required:** ADVISORY — the recommended default is safe. Only raise if Program Admin
must see audit events for their own scope.

---

## Decision D3 — All admin_users writes must be server-only service-role actions

**Question:** Should it be enforced at the database layer that no authenticated JWT holder
can INSERT, UPDATE, or DELETE rows in admin_users directly?

**Current state:** With RLS enabled and no INSERT/UPDATE/DELETE policy, fail-closed behavior
already denies direct writes by authenticated users. Service-role writes (all application
mutations in lib/admin-users.ts) continue unaffected.

**Recommended default:** Keep fail-closed (no write policies). This is already the behavior
after the emergency migration. No additional action required.

The application writes are all protected by `requireSuperAdmin()` at the server action layer
(app/admin/users/actions.ts). DB-level write policies would be redundant but not harmful.

**Action required:** ADVISORY — no action needed; fail-closed is already enforced.

---

## Decision D4 — Staging continuity account for lockout testing

**Question:** Which staging admin account will be used to verify that login still works
after RLS is enabled on admin_users?

This is required for the preflight check to pass: the migration aborts if no active
super_admin has an auth_user_id set in admin_users. The owner must confirm:

1. The staging super_admin account (email address) that will be used to log in after migration.
2. That this account has `auth_user_id` populated in the staging admin_users table.
3. That this account can log in to the staging Supabase Auth (password or invite accepted).

**Recommended default:** Use the same account that owns the production project. Confirm
`auth_user_id IS NOT NULL` in staging admin_users before running the migration.

**Action required:** YES — blocking. The preflight will fail and abort the migration if this
is not set up first. Owner must verify or set auth_user_id on staging before running the
migration SQL.

**Verification query (read-only, owner-run in Supabase SQL Editor on staging):**

```sql
select email, role, status, auth_user_id is not null as has_auth_link
from public.admin_users
where role = 'super_admin'
  and status = 'active'
order by created_at;
```

Expected: at least one row with `has_auth_link = true`.

---

## Decision D5 — action_type constraint validation

**Question:** Should the `admin_audit_log_action_type_check` constraint be validated
against existing rows (run `VALIDATE CONSTRAINT` as a separate step)?

The emergency migration adds the constraint as `NOT VALID`, meaning it applies only to
future inserts/updates and does not scan existing rows. This is safe for staging where
the table may have unexpected values from testing.

To make the constraint enforce all rows (for production hardening), run separately:

```sql
-- STAGING ONLY / DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
-- alter table public.admin_audit_log
--   validate constraint admin_audit_log_action_type_check;
```

Before running this, verify existing values:

```sql
-- Read-only verification:
-- select distinct action_type from public.admin_audit_log order by 1;
```

If any unexpected action_type values appear, either:
- Add them to the constraint definition before validating, OR
- Update the rows to a canonical value first

**Action required:** DEFERRED — run as a separate step after verifying existing data.

---

## Summary Table

| Decision | Required before staging | Recommended default | Blocking? |
|---|---|---|---|
| D1 — Program Admin visibility | YES | Own row only (policy as written) | YES — must confirm |
| D2 — audit_log visibility | ADVISORY | Super_admin only | NO |
| D3 — Write policy enforcement | ADVISORY | Fail-closed (no action) | NO |
| D4 — Staging continuity account | YES | Use project owner account | YES — preflight aborts if not set |
| D5 — Constraint validation | DEFERRED | Run as separate step after data check | NO |

---

*Design only. No production or staging connection used. No SQL executed.*
