# VAM OS SECURITY DEFINER Function Review
## 2026-07-29

Read-only review. No production connection used. No SQL executed.

---

## What SECURITY DEFINER Means

A `SECURITY DEFINER` function executes with the privileges of the function owner
(typically the Postgres superuser), not the calling role. In Supabase RLS policies,
this is used so a policy can query `admin_users` to resolve the caller's role without
the caller needing direct read access to `admin_users`.

**Security risk of SECURITY DEFINER:** If a SECURITY DEFINER function is callable
by `anon` or `public`, an unauthenticated caller can invoke it via Supabase RPC.
The function itself may be safe (returning null/false for unrecognized callers), but:
- The function body executes as superuser — any bugs could be exploited.
- The function reveals existence of the API endpoint.
- Timing side-channels could be used to enumerate admin roles.
- Future edits to the function body may inadvertently expose data.

**Prevention:** REVOKE EXECUTE from `anon` and `public`; GRANT to `authenticated` only.

**search_path requirement:** Every SECURITY DEFINER function must set
`search_path = public` to prevent a malicious schema (placed earlier in the search_path)
from intercepting calls to `admin_users` or other tables.

---

## Function Inventory

### SECURITY DEFINER functions — VAM OS public schema

| Function | Defined in | search_path | anon EXECUTE blocked? | Intended caller | Scope enforcement | Decision |
|---|---|---|---|---|---|---|
| `current_admin_role()` | 018 (first def), 020 (redef) | `public` ✅ | ❌ NOT REVOKED | RLS policies; auth gate | Returns own role or NULL for anon | REVOKE in Auth_D |
| `is_admin_role(text[])` | 018 | `public` ✅ | ❌ NOT REVOKED | RLS policies | Delegates to `current_admin_role()`; returns false for anon | REVOKE in Auth_D |
| `is_active_admin()` | 018 (first def), 020 (redef) | `public` ✅ | ❌ NOT REVOKED | RLS policies | Returns false for anon/inactive | REVOKE in Auth_D |
| `current_admin_context()` | 023 | `public` ✅ | ✅ REVOKED (migration 023) | RPC calls from lib/data.ts | Returns null for inactive/non-admin; limits roles to viewer/reviewer/admin/super_admin | Already protected |
| `admin_can_access_season(text)` | 023 | `public` ✅ | ✅ REVOKED (migration 023) | RPC internal to 023 functions | Returns false if caller not active admin or no scope | Already protected |
| `get_operations_dashboard_data(text)` | 019 (first def), 022 (redef) | `public` ✅ | ✅ REVOKED (migration 022) | App dashboard page | Internal admin check via `current_admin_context()` | Already protected |
| `get_founder_intelligence_dashboard(text)` | 029 (first def), 030 (redef) | `public` ✅ | ✅ REVOKED (migrations 029, 030) | App intelligence page | Internal admin check | Already protected |
| `current_person_id()` | Auth_C (design only) | `public` ✅ | NOT YET EXISTS — revoke in Auth_D | RLS participant policies | Returns NULL for anon/admin callers | REVOKE in Auth_D after Auth_C applied |

### NOT SECURITY DEFINER

| Function | Type | Notes |
|---|---|---|
| `intel_norm(text)` | Pure SQL | No privilege elevation; safe |
| `intel_experience_band(int)` | Pure SQL | No privilege elevation; safe |
| `intel_vam_seniority_band(int)` | Pure SQL | No privilege elevation; safe |
| `set_updated_at()` | Trigger function | Called by trigger mechanism, not via RPC; SECURITY DEFINER not needed for triggers |

---

## Gap Analysis

### G1. `current_admin_role()`, `is_admin_role()`, `is_active_admin()` — NOT REVOKED from anon

These three functions are callable by unauthenticated clients via Supabase RPC.

**What can an anon caller learn?**
- `current_admin_role()`: returns NULL (no `auth.uid()` for anon) — minimal leak
- `is_admin_role(['super_admin'])`: returns FALSE for anon — minimal leak
- `is_active_admin()`: returns FALSE for anon — minimal leak

**Why revoke anyway:**
1. Defense-in-depth: these functions query `admin_users` as superuser. Any bug in the
   function body (e.g., a future `raise notice` that leaks row data) would be exposed.
2. Consistency: all other RPC functions in the codebase are already revoked from anon.
3. Principle of least privilege: anon callers have no legitimate use for these functions.

**Fix:** `VAM_OS_AUTH_D_GRANTS_FUNCTION_HARDENING.sql` (design only — not applied).

---

### G2. `current_admin_context()` — excludes `core_team` and `support_team` roles

`current_admin_context()` (migration 023) filters:
```sql
and au.role in ('viewer', 'reviewer', 'admin', 'super_admin')
```

The roles `core_team` and `support_team` (added in migration 047) are NOT in this list.
Any internal function or RPC that calls `current_admin_context()` will return NULL for
`core_team` and `support_team` callers — they will be treated as unauthenticated.

**Impact assessment:**
- The `get_operations_dashboard_data` and related operations functions check
  `current_admin_context()` for auth. `core_team` admins calling these RPCs will
  be rejected ("Không có quyền truy cập").
- The app doesn't use these RPCs directly for `core_team` — page data loads via
  `dataClient()` (service-role). The RPC gate is a secondary check.
- `canDecide()` and `canManageMatches()` allow `core_team` in app-layer permissions.
  RPC-level scope enforcement via `current_admin_context()` is inconsistent.

**Recommendation:** Update `current_admin_context()` to include `core_team` and `support_team`.
This is a low-risk migration (adding roles to a list in a STABLE function).

```sql
-- DESIGN ONLY
create or replace function public.current_admin_context()
returns table(admin_user_id uuid, auth_user_id uuid, role text, full_name text, email text)
language sql stable security definer set search_path = public
as $$
  select au.id, au.auth_user_id, au.role, au.full_name, au.email
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.status = 'active'
    and au.role in ('viewer', 'reviewer', 'core_team', 'support_team', 'admin', 'super_admin')
  limit 1
$$;
```

**Owner decision required.** See `VAM_OS_AUTH_OWNER_DECISIONS_2026-07-29.md`, item D2.

---

### G3. `admin_can_access_season()` also excludes `core_team` and `support_team`

Same root cause as G2. `admin_can_access_season()` checks:
```sql
and au.role in ('viewer', 'reviewer', 'admin', 'super_admin')
```

A `core_team` admin will get `false` from this function, blocking them from
season-scoped RPCs that use this guard.

**Same recommendation:** add `core_team` and `support_team` to the allowlist.

---

## search_path Verification

All SECURITY DEFINER functions in the VAM OS public schema set `search_path = public`:

| Function | `set search_path = public`? |
|---|---|
| `current_admin_role()` | ✅ YES |
| `is_admin_role(text[])` | ✅ YES |
| `is_active_admin()` | ✅ YES |
| `current_admin_context()` | ✅ YES |
| `admin_can_access_season(text)` | ✅ YES |
| `get_operations_dashboard_data(text)` | ✅ YES |
| `get_founder_intelligence_dashboard(text)` | ✅ YES |

**No search_path injection risk found.** All functions are hardened against schema
manipulation via `search_path`.

---

## Compatibility of Hardening Actions

| Action | Risk of regression | Mitigation |
|---|---|---|
| REVOKE anon EXECUTE on `current_admin_role()`, `is_admin_role()`, `is_active_admin()` | LOW — anon callers have no legitimate use | None needed |
| Add `core_team`/`support_team` to `current_admin_context()` | LOW — additive role change | Test operations dashboard with core_team session |
| Add `core_team`/`support_team` to `admin_can_access_season()` | LOW — additive | Same as above |

---

## Summary of Required Actions

| Priority | Action | Status |
|---|---|---|
| HIGH | REVOKE anon EXECUTE on `current_admin_role`, `is_admin_role`, `is_active_admin` | Designed — Auth_D |
| MEDIUM | Add `core_team`, `support_team` to `current_admin_context()` role list | Owner decision needed |
| MEDIUM | Add `core_team`, `support_team` to `admin_can_access_season()` role list | Owner decision needed |
| DEFERRED | REVOKE anon EXECUTE on `current_person_id()` | Auth_C not yet applied |

---

*Review only. No production connection used. No SQL executed.*
