# Phase 1B Auth + Roles + RLS Implementation Plan

This document plans the implementation of Supabase Auth, internal roles, and read-only RLS for VAM OS Admin Portal.

Current state:

- Next.js app deployed to Vercel Preview.
- Supabase production data is connected.
- App is read-only.
- Temporary password gate uses `VAM_OS_ADMIN_PASSWORD`.
- No Supabase Auth yet.
- No RLS yet.
- Public mentor/mentee login is not in scope for this phase.

Primary goal:

- Replace temporary URL/password protection with proper internal login, role-based access, and database-enforced read protection.

## 1. Recommended Supabase Auth Approach

### Option A: Email Magic Link

Pros:

- Low friction for core team.
- No password management burden.
- Good fit for small internal team.
- Reduces risk of weak/reused passwords.

Cons:

- Requires email delivery to work reliably.
- Login depends on email inbox access.
- Magic links can be forwarded if users are careless.

### Option B: Email/Password

Pros:

- Familiar login model.
- Works even if email delivery is delayed after account setup.
- Easier for some users to understand.

Cons:

- Requires password reset flow.
- Users may choose weak or reused passwords.
- More operational overhead.

### Recommendation for VAM Core Team

Use Supabase Auth with email magic link first.

Rationale:

- The initial user group is small and internal.
- It avoids managing passwords during the early admin phase.
- It is sufficient for founder/admin/core team/reviewer/viewer access.

Optional later:

- Add Google OAuth if VAM uses a controlled Google Workspace.
- Add email/password only if the team explicitly prefers it.

## 2. Roles

Use explicit internal roles.

### `super_admin`

Capabilities:

- Full admin access.
- Manage user roles.
- Access all internal read views.
- Future: approve destructive or sensitive operations.

Recommended users:

- Founder/system owner.
- One backup technical admin.

### `admin`

Capabilities:

- Internal operations access.
- Read all current admin data.
- Future: edit profiles, resolve issues, review applications.

Recommended users:

- VAM core operations members.

### `reviewer`

Capabilities:

- Read application, profile, match, and data issue information.
- Future: add application review notes and recommendations.
- No role management.

Recommended users:

- Application reviewers.
- Matching reviewers.

### `viewer`

Capabilities:

- Read-only access.
- No edit actions.
- No role management.

Recommended users:

- Stakeholders who need visibility but should not change data.

## 3. Proposed Tables

### `user_profiles`

Stores internal user profile metadata linked to Supabase Auth.

Suggested schema:

```sql
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Notes:

- `id` should match `auth.users.id`.
- `status` can be `active`, `disabled`, or `invited`.

### `user_roles`

Stores role assignments.

Suggested schema:

```sql
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin', 'reviewer', 'viewer')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (user_id, role)
);
```

Notes:

- A user may have multiple roles.
- Role lookup should be done through SQL helper functions for RLS.

### `audit_logs`

Prepare now, even if writes are not enabled yet.

Suggested schema:

```sql
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_table text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

Initial use:

- Role assignment audit.
- Login/session-sensitive events if needed.

Future use:

- Profile edits.
- Application review changes.
- Data issue resolution.

## 4. RLS Policy Design for Read-Only MVP

Phase 1B should enforce:

- Authenticated users only.
- Internal role required.
- No public anonymous read access.
- No write access to operational tables yet.

### Helper Functions

Recommended SQL helpers:

```sql
create or replace function public.current_user_has_role(required_role text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.user_profiles up on up.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = required_role
      and up.status = 'active'
  );
$$;
```

```sql
create or replace function public.current_user_has_any_role(required_roles text[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.user_profiles up on up.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = any(required_roles)
      and up.status = 'active'
  );
$$;
```

### Read Policy Pattern

For existing operational tables:

- `people`
- `person_roles`
- `mentor_profiles`
- `mentee_profiles`
- `applications`
- `application_answers`
- `matches`
- `seasons`
- `data_issues`

Suggested read policy:

```sql
create policy "internal users can read table_name"
on public.table_name
for select
to authenticated
using (
  public.current_user_has_any_role(array['super_admin', 'admin', 'reviewer', 'viewer'])
);
```

### Write Policy Pattern

For Phase 1B:

- Do not create broad write policies for operational tables.
- Keep writes disabled unless specifically needed for `user_profiles`, `user_roles`, or `audit_logs`.

Suggested:

- `super_admin` can manage `user_roles`.
- Users can read their own `user_profiles`.
- Internal users can read active user profile names/emails if needed by admin UI.

## 5. Migrating from Temporary Password Gate to Supabase Auth

Recommended transition:

1. Keep `VAM_OS_ADMIN_PASSWORD` enabled while building Supabase Auth.
2. Add Supabase login flow behind the password gate.
3. Create first `super_admin` user.
4. Add route/session protection for all admin routes.
5. Verify authenticated access in Preview.
6. Enable RLS in a staging Supabase project first.
7. Test all pages against RLS.
8. Enable RLS in production when policies are verified.
9. Remove or disable `VAM_OS_ADMIN_PASSWORD` only after Supabase Auth + RLS is stable.

Do not remove the password gate before database-level protection is active.

## 6. Required Environment Variables

Existing:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
VAM_OS_ADMIN_PASSWORD=
```

For Supabase Auth using client-side auth helpers, the existing public Supabase URL and anon key are sufficient.

Optional future server-side variables:

```bash
SUPABASE_SERVICE_ROLE_KEY=
```

Warning:

- Do not add `SUPABASE_SERVICE_ROLE_KEY` to frontend/client code.
- Only use service role in protected server-only scripts or admin backend tasks if absolutely necessary.
- Phase 1B should not require service role in the Next.js app.

## 7. Required Supabase Settings

In Supabase Dashboard:

1. Enable Auth.
2. Configure Site URL:
   - Vercel Preview URL during testing.
   - Production URL later.
3. Configure Redirect URLs:
   - `https://<preview-domain>/auth/callback`
   - `https://<production-domain>/auth/callback`
   - `http://localhost:3000/auth/callback`
4. Configure email templates if using magic link.
5. Invite or create initial internal users.
6. Confirm anon key is safe to use with RLS policies.

## 8. Implementation Steps in Safe Order

### Step 1: Create Auth Tables and Helpers

- Create `user_profiles`.
- Create `user_roles`.
- Create `audit_logs`.
- Create role helper functions.
- Seed first `super_admin`.

### Step 2: Add App Login Flow

- Add `/login`.
- Add `/auth/callback`.
- Add logout action.
- Add session check in server components/middleware.
- Keep temporary password gate active.

### Step 3: Add Role Checks in App

- Fetch current user profile/roles.
- Redirect unauthenticated users to login.
- Show clear message for users without an approved role.
- Keep app read-only.

### Step 4: Test Without RLS First

- Verify all pages still work after login.
- Verify role-based route access.
- Verify logout.
- Verify magic link flow.

### Step 5: Enable RLS in Staging

- Apply read policies to staging.
- Test every page in QA checklist.
- Confirm anonymous requests fail.
- Confirm authenticated role users can read.

### Step 6: Enable RLS in Production

- Schedule a short deployment window.
- Apply policies.
- Test immediately with `viewer`, `reviewer`, `admin`, and `super_admin`.
- Keep rollback SQL ready.

### Step 7: Remove Temporary Gate Later

- Remove or disable `VAM_OS_ADMIN_PASSWORD` only when:
  - Auth is stable.
  - RLS is enabled.
  - Role policies are tested.
  - Core team confirms access works.

## 9. Rollback Plan

If app access breaks:

1. Re-enable or keep `VAM_OS_ADMIN_PASSWORD`.
2. Temporarily disable new auth middleware in app deployment if needed.
3. Roll back Vercel deployment to previous working Preview.
4. If RLS blocks reads unexpectedly, disable RLS temporarily only if absolutely necessary and only for internal emergency recovery.
5. Prefer fixing policies rather than leaving RLS disabled.

Recommended SQL rollback preparation:

- Save scripts to drop or disable new policies.
- Save scripts to inspect current user roles.
- Keep one `super_admin` user verified before enabling RLS.

## 10. QA Checklist

### Auth Flow

- [ ] Unauthenticated user is redirected to login.
- [ ] Magic link email is received.
- [ ] Auth callback creates a session.
- [ ] Logout clears session.
- [ ] User without role cannot access portal.
- [ ] Active `viewer` can access read-only pages.
- [ ] Disabled user cannot access portal.

### Role Behavior

- [ ] `super_admin` can access all read-only pages.
- [ ] `admin` can access all read-only pages.
- [ ] `reviewer` can access review pages.
- [ ] `viewer` can access intended read-only pages.
- [ ] No write/edit buttons appear for any role in Phase 1B.

### RLS Behavior

- [ ] Anonymous Supabase reads fail.
- [ ] Authenticated users without roles cannot read operational tables.
- [ ] Authenticated internal roles can read:
  - [ ] people
  - [ ] mentor_profiles
  - [ ] mentee_profiles
  - [ ] applications
  - [ ] application_answers
  - [ ] matches
  - [ ] seasons
- [ ] Dashboard counts load correctly.
- [ ] Application detail loads only one application’s answers.
- [ ] Data Issues does not fetch `application_answers`.

### Regression

- [ ] Dashboard opens.
- [ ] People opens.
- [ ] Mentors opens.
- [ ] Mentees opens.
- [ ] Applications opens.
- [ ] Application detail opens.
- [ ] Matches opens.
- [ ] Match detail opens.
- [ ] Data Issues opens.

## 11. Risks and Precautions

Risks:

- Enabling RLS without correct policies can break the whole portal.
- Role helper functions can accidentally allow too much access if written incorrectly.
- Magic link redirect URLs must be configured exactly.
- A user with no role may be authenticated but blocked.
- Service role key exposure would be a serious security incident.

Precautions:

- Test RLS in staging first.
- Keep Preview password gate during transition.
- Seed and verify at least one `super_admin`.
- Keep SQL rollback scripts ready.
- Never expose service role key in frontend.
- Do not add write policies until edit workflows are designed.

## 12. Recommendation: Keep Password Gate During Transition?

Yes. Keep the temporary password gate during Phase 1B implementation.

Recommended sequence:

1. Keep `VAM_OS_ADMIN_PASSWORD` active on Vercel Preview.
2. Build Supabase Auth login behind it.
3. Add roles.
4. Test thoroughly.
5. Enable RLS in staging.
6. Enable RLS in production.
7. Only then remove the temporary password gate.

Reason:

- The password gate reduces accidental exposure while auth/RLS is under construction.
- Supabase Auth without RLS is not sufficient database protection.
- RLS without verified auth/role setup can cause outages.

Final recommendation:

Implement Supabase Auth + role tables next, but do not remove `VAM_OS_ADMIN_PASSWORD` until read-only RLS is live and verified.
