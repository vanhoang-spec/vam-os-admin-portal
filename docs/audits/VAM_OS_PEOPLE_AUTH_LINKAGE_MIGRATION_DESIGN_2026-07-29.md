# VAM OS People Auth Linkage Migration Design
## 2026-07-29

Design-only document. No production connection used. No SQL executed.

---

## The Gap

`public.people` has no `auth_user_id` column. The `Person` type in `lib/types.ts`
confirms this — the type has `id`, `full_name`, `email_primary`, `phone_primary`,
`gender`, `source_sheets`, `data_quality_flags` — no auth linkage.

Without this column:
- Participants (mentors, mentees) cannot log in to a participant-facing portal.
- RLS participant self-read policies cannot be written (`auth.uid() = people.auth_user_id`
  requires the column to exist).
- There is no server-side way to resolve "which person is this logged-in user?" without
  falling back to email matching (fragile when emails change).

This migration is **prerequisite to all participant login work**.

---

## Established Pattern: `admin_users.auth_user_id`

Migration 017 (`create admin_users`) defines:
```sql
auth_user_id uuid null,
```
No explicit FK to `auth.users`. An index exists on `auth_user_id`. The backfill
pattern in `lib/admin-auth.ts` updates this column at first login using service-role.

Rationale for no FK: FK from `public` to `auth` schema requires superuser privileges
and can be fragile in Supabase migration scripts. The established codebase pattern
uses implicit linkage by value. `people.auth_user_id` must follow the same pattern.

---

## Column Design

### Column definition (migration 062)

```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
alter table public.people
  add column if not exists auth_user_id uuid null;

comment on column public.people.auth_user_id is
  'Supabase Auth user id for participant login. Null until participant account is created.
   Matches auth.users(id). No FK constraint (follows admin_users pattern).';
```

### Uniqueness constraint

A participant auth account must correspond to exactly one person. Two person rows
must never share the same `auth_user_id`.

```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
create unique index if not exists people_auth_user_id_unique_idx
  on public.people(auth_user_id)
  where auth_user_id is not null;
```

Partial index (`where auth_user_id is not null`) allows multiple null rows — correct,
since most people rows will be unlinked historic records.

### Lookup index

For the participant login flow (resolving "which person?" from auth.uid()):

```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
create index if not exists people_auth_user_id_idx
  on public.people(auth_user_id)
  where auth_user_id is not null;
```

Note: the partial unique index above also serves as a lookup index. A separate
non-unique index is not needed unless query planning shows the unique index is
not used for lookups. Omit the non-unique index — PostgreSQL uses the unique
partial index for equality lookups on `auth_user_id`.

---

## Nullability Decision

| State | `auth_user_id` | Meaning |
|---|---|---|
| NULL | No auth account provisioned | Historic record; participant has never logged in |
| UUID (value) | Auth account provisioned | Participant has a Supabase Auth user; may or may not have confirmed email |

`auth_user_id` IS NOT a `status` field. It is purely an identifier. Whether the
participant has confirmed their email, logged in, or is suspended is tracked elsewhere:
- **Auth invitation state**: `auth.users.email_confirmed_at IS NULL` = invited but not confirmed.
- **Auth last login**: `auth.users.last_sign_in_at`
- **Program membership state**: `person_season_memberships.status` (already has 'invited', 'active', 'paused', 'withdrawn', etc.)
- **Account suspension**: If participant accounts need suspension, a future `people.participant_auth_status` column can be added. Not required for the linkage migration.

---

## FK Deletion Behavior: RESTRICT vs SET NULL

Because there is no FK constraint, PostgreSQL does not automatically enforce deletion
behavior. The application layer is responsible.

### Case 1: Auth user deleted → `people.auth_user_id` becomes stale

If an Auth user is deleted (e.g., by a super_admin via `auth.admin.deleteUser`), and
`people.auth_user_id` still holds that UUID, the row is "dangling":
- The next login attempt for that email will fail (no Auth user).
- RLS policies using `auth.uid() = people.auth_user_id` will never match (auth.uid()
  returns a different UUID for a new account or NULL for no auth).

**Required application behavior:**
Before or immediately after deleting an Auth user, the app must:
```typescript
// DESIGN ONLY
await client
  .from("people")
  .update({ auth_user_id: null })
  .eq("auth_user_id", authUserId);
```
This is analogous to the admin_users pattern in `lib/admin-users.ts` which nulls out
`auth_user_id` before removing admin access.

### Case 2: `people` row deleted → no automatic Auth side effect

If a `people` row is deleted:
- The Auth user pointed to by `people.auth_user_id` (if any) continues to exist.
- That Auth user can still log in but will not find a `people` row — login will fail
  at the participant resolution step.

**Required application behavior:**
Before deleting a `people` row:
1. Check if `people.auth_user_id IS NOT NULL`.
2. If so: either delete the Auth user, or null out `people.auth_user_id` first.
3. Log this action in `admin_audit_log`.

**Recommendation:** Implement as RESTRICT at the application layer (refuse to delete
a `people` row that has an `auth_user_id` without explicit confirmation). Safer than
silent SET NULL which leaves a dangling auth user.

---

## Invitation State Design

### For participants (people)

"Invited" state means: admin has provisioned an Auth account (via `inviteUserByEmail`
or `createUser`), `people.auth_user_id` has been set, but the participant has not yet
confirmed their email.

| Condition | State label |
|---|---|
| `auth_user_id IS NULL` | Not provisioned |
| `auth_user_id IS NOT NULL` AND `auth.users.email_confirmed_at IS NULL` | Invited (not yet confirmed) |
| `auth_user_id IS NOT NULL` AND `auth.users.email_confirmed_at IS NOT NULL` | Active |

The application layer reads `auth.users.email_confirmed_at` via service-role to
determine confirmation state. This does NOT require a new column on `people`.

### For program membership (`person_season_memberships.status`)

`person_season_memberships.status` already has `'invited'` as a valid value (migration 052).
This tracks the participant's role in a given program/season, independently of whether
they have an Auth account.

**Do not conflate** program membership invitation (`person_season_memberships.status = 'invited'`)
with auth account invitation. They are separate concerns:
- A person can be an `'active'` membership participant but have no auth account (historic data).
- A person can be `'invited'` in auth but `'active'` in membership (pre-provisioned).
- The linkage column (`people.auth_user_id`) is the source of truth for auth identity.

---

## Full Linkage Lifecycle

```
1. Admin creates participant account:
   a. auth.admin.inviteUserByEmail(email)
      OR auth.admin.createUser({ email, password })
   b. Record new auth_user_id from response
   c. UPDATE people SET auth_user_id = $authUserId WHERE id = $personId
   d. Verify: SELECT people WHERE auth_user_id = $authUserId returns exactly one row

2. Participant confirms email and logs in:
   a. Supabase Auth handles email confirmation
   b. Participant portal resolves person: SELECT * FROM people WHERE auth_user_id = auth.uid()
   c. If no row found: login succeeds but portal shows error (broken link — admin must fix)

3. Admin removes participant auth access:
   a. UPDATE people SET auth_user_id = NULL WHERE id = $personId
   b. auth.admin.deleteUser(authUserId) — or disable via user_metadata
   c. Log action in admin_audit_log

4. Participant email changes (future):
   a. auth.admin.updateUserById(authUserId, { email: newEmail })
   b. UPDATE people SET email_primary = newEmail WHERE id = $personId
   c. The linkage (auth_user_id) is UUID-based; email change does not break it
```

---

## Compatibility With Current Code

| Concern | Assessment |
|---|---|
| Existing `people` rows | NULL `auth_user_id` — unaffected; column is additive |
| `lib/data.ts` people queries | Use service-role; column added transparently |
| `lib/types.ts Person` type | Must be updated to include `auth_user_id?: string \| null` after migration is applied |
| RLS policies in migration 018 | `read_people_internal_roles` USING `is_admin_role(...)` — unaffected; no self-read policy yet |
| Future participant self-read policy | Will use `auth.uid() = people.auth_user_id` — requires this column |
| Unique constraint | Only `where auth_user_id is not null` — will not fail on existing NULL rows |

---

## What This Migration Does NOT Change

- No data migration. Existing people rows retain `auth_user_id = NULL`.
- No status column on `people`. Participant account status tracked via auth.users and person_season_memberships.
- No FK constraint to `auth.users`. Follows admin_users precedent.
- No application code changes in this migration. TypeScript type update (`lib/types.ts`) is a follow-up.
- No participant login routes or server actions. Those are a separate sprint deliverable.

---

## Required Code Change After Migration 062 is Applied

After the migration is applied to production, update `lib/types.ts`:

```typescript
export type Person = JsonRecord & {
  id: string;
  full_name: string | null;
  email_primary: string | null;
  phone_primary: string | null;
  gender: string | null;
  source_sheets: string | null;
  data_quality_flags: string | null;
  auth_user_id?: string | null;  // Added by migration 062
};
```

This is a non-breaking additive change — existing code using `Person` continues to
compile and run correctly.

---

*Design only. No production or staging connection used. No SQL executed.*
