# VAM OS Auth RLS and Linkage Rollback Design
## 2026-07-29

Design-only document. No production connection used. No SQL executed.

---

## Rollback Philosophy

### Principle 1: Staged rollback, reverse order

Migrations must be rolled back in reverse dependency order:
```
D (function grants) → C (participant policies) → B (people column) → A (table RLS)
```

Never roll back A before D and C — doing so could disable RLS on tables that still
have policies referencing helper functions (the policies would exist but RLS would be
disabled — data would be exposed and the policies would become dead code).

### Principle 2: Targeted rollback, not wholesale

Prefer rolling back individual sections (e.g., just mentoring_recaps RLS) rather than
the entire hardening set. The rollback SQL is organized in named sections for this reason.

### Principle 3: No data loss from RLS rollback

RLS enable/disable does NOT modify any table data. Rollback of RLS changes is purely
metadata — no row is deleted or modified.

**Exception:** Migration B (`people.auth_user_id` column). Dropping this column
destroys all linkage data for any participant accounts provisioned. Check
`SELECT count(*) FROM people WHERE auth_user_id IS NOT NULL` before dropping.

### Principle 4: Service-role behavior is unaffected by rollback

The Next.js application uses service-role for all reads and writes. Rolling back RLS
changes does NOT affect application functionality. The app will continue to work
regardless of whether RLS is enabled or disabled on any table.

---

## Rollback Triggers by Section

### When to roll back Migration D (function grants)

Roll back only if:
- RLS policies fail with "permission denied for function" after revoke was applied.
  This happens if `authenticated` role was not granted EXECUTE back correctly.

Symptom: Users see "0 rows" on pages that previously loaded data, even though the
service-role path is unchanged.

Diagnosis: Run verification query V3 from `VAM_OS_AUTH_VERIFICATION.sql` to check
EXECUTE grants.

### When to roll back Migration C (participant policies)

Roll back if:
- Participant portal (not yet built) shows unexpected data access.
- A participant can read another participant's rows.
- Admin pages show 0 rows unexpectedly (indicates a PERMISSIVE policy conflict).

Note: Since participant login does not yet exist, Migration C should not be applied
until participant login is being built. Rolling back C before participant login is
live is a no-op in terms of user impact.

### When to roll back Migration B (people.auth_user_id column)

Roll back ONLY IF:
- `SELECT count(*) FROM people WHERE auth_user_id IS NOT NULL` returns 0 (no linked accounts).
- No participant login portal exists that depends on this column.
- The column causes a schema migration conflict (unlikely for an additive change).

**DO NOT roll back** if any participant accounts have been provisioned.

### When to roll back Migration A (table RLS)

Roll back individual sections if:

| Section | Rollback trigger |
|---|---|
| A1 (mentoring_recaps RLS) | Operations Dashboard shows 0 recaps; confirmed service-role path not working |
| A2 (event_participations RLS) | Event pages show 0 participations; service-role confirmed as the issue |
| A3 (admin_audit_log RLS) | super_admin audit log page shows 0 entries |
| A4 (person_season_memberships RLS) | Membership pages show 0 rows for all admins |
| A5 (person_season_membership_log RLS) | Membership log pages broken |
| A6 (event_links/registrations RLS) | Event registration features broken |
| A7 (applications policy correction) | Applications page broken for core_team users who should have access |
| A8 (crm_notes RLS) | CRM notes page shows 0 entries |
| A9 (audit log constraint) | Audit log insert fails due to unexpected action_type value |

---

## Rollback SQL Files

All rollback SQL is in:
- `docs/audits/sql/design_only/VAM_OS_AUTH_ROLLBACK_DESIGN.sql`

Each section is commented-out SQL. To apply a rollback:
1. Open the file.
2. Copy the SQL for the specific section to roll back.
3. Execute in Supabase SQL Editor as superuser or via migration runner.
4. Run verification queries from `VAM_OS_AUTH_VERIFICATION.sql` to confirm rollback.

---

## Rollback Validation

After any rollback, confirm:

| Check | Expected state after rollback |
|---|---|
| `mentoring_recaps` RLS | If A1 rolled back: `rowsecurity = false` |
| `admin_audit_log` RLS | If A3 rolled back: `rowsecurity = false` |
| `person_season_memberships` RLS | If A4 rolled back: `rowsecurity = false` |
| Applications policy | If A7 rolled back: policy USING clause excludes `core_team` |
| EXECUTE grant on helpers | If D rolled back: anon can call `current_admin_role()` via RPC |
| Participant policies | If C rolled back: no `participant_read_*` policies in pg_policies |
| `people.auth_user_id` column | If B rolled back: column does not appear in `information_schema.columns` |
| Operations Dashboard | Must load correctly for all admin roles after any rollback |
| Admin users page | Must load for super_admin after any rollback |

---

## Rollback Sequences for Common Scenarios

### Scenario: Operations Dashboard broke after Migration A

```
1. Check if issue is in service-role path (should be unaffected by RLS).
2. Run verification query V1 (RLS status) and V2 (policy list).
3. If A1 or A2 caused the issue, roll back the specific section.
4. Monitor Operations Dashboard for restoration.
5. Investigate root cause before re-applying.
```

### Scenario: Function revoke broke RLS policies (Migration D)

```
1. Symptom: pages show 0 rows; no 500 error; server logs show "permission denied for function".
2. Roll back D immediately (restore anon EXECUTE grants).
3. Diagnosis: check that authenticated role was granted EXECUTE.
4. Re-apply D with corrected GRANT statements.
```

### Scenario: Participant login broke after participant policies applied (Migration C)

```
1. Roll back C (drop all participant_read_* policies, drop current_person_id).
2. Verify admin portal functions correctly.
3. Investigate: check that people.auth_user_id is populated for test participant.
4. Review current_person_id() function implementation.
5. Re-apply C after fix.
```

---

## What Cannot Be Rolled Back Safely

| Item | Why |
|---|---|
| `people.auth_user_id` after participant accounts provisioned | Dropping the column destroys auth linkage data for all participants |
| `admin_audit_log` constraint after non-canonical action types in log | Constraint blocks all future inserts; must backfill or exclude old values first |
| Migration 018 (original RLS — already applied to production) | Disabling RLS on all 018 tables would be a major security regression; not advisable |

---

*Design only. No production or staging connection used. No SQL executed.*
