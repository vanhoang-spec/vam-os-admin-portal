# VAM OS Auth Owner Decisions
## 2026-07-29

Design-only document. No production connection used. No SQL executed.

Each item below requires an explicit owner decision before the related migration
can be applied. Items are grouped by migration. Items marked **BLOCKING** must be
resolved before the migration is authorized. Items marked **ADVISORY** can be
deferred without blocking the migration.

---

## Migration A — Admin & Business Table RLS Hardening

### A1: Re-enabling mentoring_recaps and event_participations RLS

**Context:** Migrations 023 and 025 explicitly disabled RLS on these tables.
The Operations Dashboard, recap edit workflows, and event attendance workflows
currently function via service-role — they will be unaffected by re-enabling RLS.

**Question:** Is there any workflow or integration that reads `mentoring_recaps`
or `event_participations` via a **direct Supabase anon or bearer JWT client**
(not through the Next.js server)?

**Options:**
- [ ] YES — there is a direct API reader (e.g., a Python script, external tool, reporting tool). Identify and migrate it to service-role before applying A1/A2.
- [ ] NO — all reads go through the Next.js server with service-role. Apply A1 and A2.

**Classification:** BLOCKING for A1 and A2.

---

### A9: admin_audit_log action_type constraint

**Context:** The proposed constraint allows only:
`create_admin_user, update_admin_user, remove_admin_access, reactivate_admin_user, deactivate_admin_user, sync_auth`

**Question:** Before applying A9, run:
```sql
SELECT DISTINCT action_type, count(*) FROM public.admin_audit_log GROUP BY action_type;
```

If any non-canonical value appears, decide:
- [ ] Backfill non-canonical values to canonical equivalents, then apply A9.
- [ ] Add the non-canonical value to the constraint allowlist, then apply A9.
- [ ] Skip A9 for now; apply later after backfill.

**Classification:** BLOCKING for A9 only. A1–A8 can proceed without A9.

---

## Migration D — Function Grant Hardening

### D1: Role of `admin` in user management

**Context:** `lib/permissions.ts` defines `canManageUsers` to include `admin` role,
but all server actions in `lib/admin-users.ts` gate on `requireSuperAdmin()`.
This means `admin` role cannot actually mutate admin users even though permissions.ts
suggests they can.

**Question:** Should `admin` role be able to manage users?

**Options:**
- [ ] **No — keep current behavior.** Only `super_admin` can mutate admin users. Update `canManageUsers` to exclude `admin` to match actual behavior.
- [ ] **Yes — extend to `admin` role with constraints.** An `admin` can create/update users below their own role level (cannot assign `super_admin`; cannot modify other admins). Requires server action changes.

**Classification:** ADVISORY. Does not block any migration. Affects permissions.ts and server action design.

---

### D2: Add `core_team` and `support_team` to `current_admin_context()` and `admin_can_access_season()`

**Context:** These functions only recognize `viewer, reviewer, admin, super_admin`.
The roles `core_team` and `support_team` were added in migration 047 but were never
added to these RPC functions. `core_team` admins using direct RPC calls are rejected.

**Question:** Should `core_team` and `support_team` be recognized by these functions?

**Options:**
- [ ] **Yes — add both roles.** Safe and consistent with app-layer permissions. Requires a migration to UPDATE the function bodies.
- [ ] **No — leave as-is.** Accept that `core_team`/`support_team` cannot use direct RPC calls. App layer (service-role) is unaffected.

**Classification:** ADVISORY for current sprint. Required before any participant-facing
or external RPC usage with `core_team` accounts.

---

## Migration B — people.auth_user_id Linkage

### B1: Auth user deletion behavior

**Context:** There is no FK from `people.auth_user_id` to `auth.users`. When a
Supabase Auth user is deleted, `people.auth_user_id` becomes stale (points to a
non-existent user). The application layer must null out `people.auth_user_id` before
or after deleting the auth user.

**Question:** What is the intended behavior when a participant's auth account is deleted?

**Options:**
- [ ] **Null out linkage then delete auth user.** Application code: (1) `UPDATE people SET auth_user_id = NULL`, then (2) `auth.admin.deleteUser()`. Order: linkage nulled first so no stale pointer.
- [ ] **Delete auth user, then null out linkage.** Reverse order. Stale pointer exists briefly. Lower risk if step 2 fails (person row still points to deleted user; next login attempt fails gracefully).
- [ ] **Never delete auth users — only suspend.** Supabase doesn't have a "suspend" on auth users directly, but you can ban them via user_metadata or app-layer check. Simplest for data integrity.

**Classification:** BLOCKING for participant login implementation. Not blocking for column addition (Migration B itself).

---

## Migration C — Participant RLS Policies

### P1: Mentor profile update fields

**Context:** The participant RLS matrix proposes allowing mentors to UPDATE their
own `mentor_profiles` row. The policy as designed allows UPDATE but no field restriction
at the RLS level (RLS cannot restrict individual columns).

**Question:** Which fields can mentors update via the participant portal?

**Options:**
- [ ] **Allow full row update.** Application layer enforces field restrictions (server action controls which fields are sent to the DB).
- [ ] **Allow update only for specific fields.** Application layer always sends only the allowed fields. No column-level RLS needed.
- [ ] **Defer participant profile editing.** Launch with read-only participant portal; editing added in a future sprint.

**Classification:** BLOCKING for Migration C application.

### P2: Mentee profile update fields

Same question as P1 but for mentees. Which fields can mentees update?

**Classification:** BLOCKING for Migration C application.

### P3: Match data visibility

**Context:** A participant can see their match. The `matches` table may contain
a `notes` field or internal scoring fields that should not be visible to participants.

**Question:** Should participants see the FULL `matches` row, or a limited projection?

**Options:**
- [ ] **Full row.** Simplest implementation.
- [ ] **Limited projection.** Application layer always queries specific columns; internal columns (notes, scores) excluded from participant queries.

**Classification:** ADVISORY for policy design. Affects participant portal page implementation.

### P4: Cross-participant visibility within a match

**Context:** In a mentor–mentee match, should each participant be able to see the
OTHER participant's profile?

**Question:** Can a mentor read their matched mentee's `people` row and `mentee_profiles`? Vice versa?

**Options:**
- [ ] **Yes — within-match cross-read.** Requires additional policies allowing each participant to read the other's profile if they share an active match.
- [ ] **No — own row only.** Simpler policies; participant only sees their own profile. Match details shown by displaying the matched person's public name only (included in the matches row).

**Classification:** BLOCKING for cross-participant policy design. Own-row-only is the safe default.

### P5: Event visibility scope for participants

**Question:** Can a participant read ALL events in their season, or only events they
are registered for (`event_registrations` has their record)?

**Options:**
- [ ] **All events in their season.** Broader access; simpler policy.
- [ ] **Only registered events.** More restrictive; requires join through `event_registrations` in policy.

**Classification:** ADVISORY. Own-registration-only is the safe default.

### P6: Event links visibility

**Context:** `event_links` contains registration tokens (QR codes etc). Should
participants see their own event link token?

**Options:**
- [ ] **Yes.** Participant can retrieve their own QR code / attendance link. Policy scoped to their own `event_registrations`.
- [ ] **No.** Admin-only. Participants see their registration status but not the token itself.

**Classification:** ADVISORY.

---

## Summary of Blocking Items

| Decision | Migration affected | Must resolve before |
|---|---|---|
| A1: Any non-app direct readers of mentoring_recaps/event_participations? | Migration A | Applying A1/A2 |
| A9: Non-canonical action_types in audit log? | Migration A (section 9 only) | Applying A9 |
| B1: Auth user deletion behavior | Migration C (participant login) | Building participant auth admin tools |
| P1: Mentor profile update fields | Migration C | Applying Migration C |
| P2: Mentee profile update fields | Migration C | Applying Migration C |
| P4: Cross-participant visibility | Migration C | Applying Migration C |

---

*Design only. No production or staging connection used. No SQL executed.*
