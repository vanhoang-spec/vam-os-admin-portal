# VAM OS Auth RLS Security Test Plan
## 2026-07-29

Design-only document. No production connection used. No SQL executed.

---

## Test Environment

- Target: production or staging with hardening migrations A–D applied.
- Test accounts required:
  - `viewer` admin (active)
  - `reviewer` admin (active)
  - `core_team` admin (active)
  - `admin` admin (active)
  - `super_admin` (active)
  - Supabase Auth JWT user NOT in admin_users (participant JWT)
  - Unauthenticated (no JWT)
- Access method: direct Supabase REST API + Bearer JWT (bypassing Next.js middleware).

For each test case:
1. Obtain the Auth JWT for the test account via `auth.admin.generateLink()` or from a login session.
2. Make the REST call directly against Supabase PostgREST.
3. Record actual result vs expected result.

---

## Test Group 1: Admin Users Table

| TC | Role | Operation | Expected | Pass/Fail |
|---|---|---|---|---|
| 1.1 | `viewer` | SELECT * FROM admin_users | Own row ONLY | |
| 1.2 | `reviewer` | SELECT * FROM admin_users | Own row ONLY | |
| 1.3 | `admin` | SELECT * FROM admin_users | Own row ONLY | |
| 1.4 | `core_team` | SELECT * FROM admin_users | Own row ONLY | |
| 1.5 | `super_admin` | SELECT * FROM admin_users | ALL rows | |
| 1.6 | Participant JWT (not in admin_users) | SELECT * FROM admin_users | 0 rows | |
| 1.7 | Unauthenticated (anon) | SELECT * FROM admin_users | 0 rows (RLS deny) | |
| 1.8 | `viewer` | INSERT INTO admin_users(...) | Permission denied | |
| 1.9 | `super_admin` | INSERT INTO admin_users(...) | Permission denied (no write policy) | |
| 1.10 | `viewer` | UPDATE admin_users SET role = 'super_admin' | 0 rows updated (RLS deny) | |
| 1.11 | Unauthenticated | UPDATE admin_users SET role = 'super_admin' | Permission denied | |

---

## Test Group 2: Mentoring Recaps (Re-enabled RLS)

| TC | Role | Operation | Expected | Pass/Fail |
|---|---|---|---|---|
| 2.1 | `viewer` | SELECT * FROM mentoring_recaps | All rows (is_admin_role passes) | |
| 2.2 | `reviewer` | SELECT * FROM mentoring_recaps | All rows | |
| 2.3 | `core_team` | SELECT * FROM mentoring_recaps | All rows (now included in policy) | |
| 2.4 | Participant JWT (not admin) | SELECT * FROM mentoring_recaps | 0 rows (no policy match for non-admin until Auth_C applied) | |
| 2.5 | Unauthenticated | SELECT * FROM mentoring_recaps | 0 rows | |
| 2.6 | `viewer` | INSERT INTO mentoring_recaps(...) | Permission denied | |

---

## Test Group 3: Event Participations (Re-enabled RLS)

| TC | Role | Operation | Expected | Pass/Fail |
|---|---|---|---|---|
| 3.1 | `viewer` | SELECT * FROM event_participations | All rows | |
| 3.2 | `core_team` | SELECT * FROM event_participations | All rows | |
| 3.3 | Participant JWT | SELECT * FROM event_participations | 0 rows (without Auth_C) | |
| 3.4 | Unauthenticated | SELECT * FROM event_participations | 0 rows | |

---

## Test Group 4: Admin Audit Log (New RLS)

| TC | Role | Operation | Expected | Pass/Fail |
|---|---|---|---|---|
| 4.1 | `super_admin` | SELECT * FROM admin_audit_log | All rows | |
| 4.2 | `admin` | SELECT * FROM admin_audit_log | 0 rows | |
| 4.3 | `viewer` | SELECT * FROM admin_audit_log | 0 rows | |
| 4.4 | `reviewer` | SELECT * FROM admin_audit_log | 0 rows | |
| 4.5 | `core_team` | SELECT * FROM admin_audit_log | 0 rows | |
| 4.6 | Participant JWT | SELECT * FROM admin_audit_log | 0 rows | |
| 4.7 | Unauthenticated | SELECT * FROM admin_audit_log | 0 rows | |

---

## Test Group 5: Person Season Memberships (New RLS)

| TC | Role | Operation | Expected | Pass/Fail |
|---|---|---|---|---|
| 5.1 | `viewer` | SELECT * FROM person_season_memberships | All rows | |
| 5.2 | `reviewer` | SELECT * FROM person_season_memberships | All rows | |
| 5.3 | Participant JWT (without Auth_C) | SELECT * FROM person_season_memberships | 0 rows | |
| 5.4 | Unauthenticated | SELECT * FROM person_season_memberships | 0 rows | |

---

## Test Group 6: Applications Policy (core_team correction)

| TC | Role | Operation | Expected | Pass/Fail |
|---|---|---|---|---|
| 6.1 | `reviewer` | SELECT * FROM applications | All rows | |
| 6.2 | `core_team` | SELECT * FROM applications | All rows (post-correction) | |
| 6.3 | `viewer` | SELECT * FROM applications | 0 rows (excluded from policy) | |
| 6.4 | `support_team` | SELECT * FROM applications | 0 rows (excluded) | |
| 6.5 | Unauthenticated | SELECT * FROM applications | 0 rows | |

---

## Test Group 7: SECURITY DEFINER Function Grants

| TC | Caller | Call | Expected | Pass/Fail |
|---|---|---|---|---|
| 7.1 | Unauthenticated | RPC `current_admin_role()` | permission denied | |
| 7.2 | Unauthenticated | RPC `is_admin_role(['super_admin'])` | permission denied | |
| 7.3 | Unauthenticated | RPC `is_active_admin()` | permission denied | |
| 7.4 | `viewer` JWT | RPC `current_admin_role()` | `"viewer"` | |
| 7.5 | `super_admin` JWT | RPC `current_admin_role()` | `"super_admin"` | |
| 7.6 | Participant JWT (not in admin_users) | RPC `current_admin_role()` | NULL or empty | |
| 7.7 | Unauthenticated | RPC `current_admin_context()` | permission denied (already revoked) | |
| 7.8 | `viewer` JWT | RPC `is_admin_role(['super_admin'])` | false | |
| 7.9 | `super_admin` JWT | RPC `is_admin_role(['super_admin'])` | true | |

---

## Test Group 8: Application Behavior (Regression Tests)

| TC | Role | Action | Expected | Pass/Fail |
|---|---|---|---|---|
| 8.1 | Any active admin | Admin Dashboard loads | No 0-row errors; programs/seasons visible | |
| 8.2 | Any active admin | Operations Dashboard loads | Recaps and participations load normally | |
| 8.3 | `super_admin` | Admin Users page loads | All admins listed | |
| 8.4 | `super_admin` | Audit log page loads | Audit entries visible | |
| 8.5 | `reviewer` | Applications page loads | Applications visible | |
| 8.6 | `core_team` | Applications page loads | Applications visible (post-policy fix) | |
| 8.7 | `viewer` | People list loads | People visible | |
| 8.8 | `admin` | Create admin user | Succeeds (server action, service-role) | |
| 8.9 | Any active admin | Mentor profiles page loads | Mentor profiles visible | |
| 8.10 | Any active admin | Event registrations page loads | Registrations visible | |

---

## Test Group 9: people.auth_user_id (Migration B)

| TC | Operation | Expected | Pass/Fail |
|---|---|---|---|
| 9.1 | `DESCRIBE public.people` via SQL | Column `auth_user_id uuid null` exists | |
| 9.2 | `SELECT indexname FROM pg_indexes WHERE tablename = 'people'` | `people_auth_user_id_unique_idx` listed | |
| 9.3 | `INSERT INTO people(auth_user_id) VALUES(gen_random_uuid()), (same_uuid)` | Second insert fails: unique constraint violation | |
| 9.4 | `INSERT INTO people(auth_user_id) VALUES(NULL), (NULL)` | Both succeed (partial index allows multiple NULLs) | |

---

## Test Group 10: Self-Escalation Prevention

| TC | Role | Operation | Expected | Pass/Fail |
|---|---|---|---|---|
| 10.1 | `viewer` (direct API) | UPDATE admin_users SET role = 'super_admin' WHERE auth_user_id = auth.uid() | 0 rows updated (fail-closed) | |
| 10.2 | `admin` (direct API) | UPDATE admin_users SET role = 'super_admin' WHERE id = own_id | 0 rows updated (fail-closed) | |
| 10.3 | `viewer` (direct API) | INSERT INTO admin_scope_access(user_id, program_id) VALUES (own_auth_id, 'VAM') | Permission denied (fail-closed) | |
| 10.4 | Participant JWT (direct API) | INSERT INTO admin_users(email, role) VALUES ('attacker@example.com', 'super_admin') | Permission denied | |

---

## Test Execution Notes

1. Use `curl` or Supabase REST client with explicit `Authorization: Bearer <jwt>` header.
2. Service-role key must NOT be used in any test case — it bypasses all RLS.
3. For anon tests: use Supabase anon key without any `Authorization` header.
4. Record actual HTTP status and response body for each test case.
5. A 200 with `[]` (empty array) means RLS filtered all rows.
6. A 401/403 with `{code: "permission_denied"}` means RLS fail-closed (INSERT/UPDATE denied).
7. All pass/fail decisions must be reviewed by the owner before marking as complete.

---

*Test plan only. No SQL executed. No production connections used.*
