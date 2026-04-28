# Phase 1 Security and Intake Plan

This document plans the next phase for VAM OS after MVP v0.1 Vercel Preview deployment.

Current state:

- VAM OS Admin Portal is read-only.
- Supabase production data is live.
- No authentication is enabled.
- No RLS policies are enabled.
- Preview URL must remain private.
- The app is internal-only and must not be treated as a public mentor/mentee portal yet.

## 1. Recommended Authentication Approach

Use Supabase Auth as the system of record for user authentication.

Recommended login methods:

- Email magic link for low-friction internal admin access.
- Email/password only if the team needs persistent credentials.
- Google OAuth can be considered later if VAM core team uses a managed Google Workspace.

Recommended first implementation:

1. Enable Supabase Auth.
2. Add login/logout pages in the Admin Portal.
3. Require authenticated sessions for all admin routes.
4. Store app-specific user metadata in `user_profiles` and `user_roles`, not only in Supabase Auth metadata.

Why Supabase Auth:

- It integrates directly with Supabase RLS.
- It avoids building custom session infrastructure.
- It supports future mentor/mentee login portal phases.

Current temporary mitigation:

- VAM OS Admin Portal MVP can use `VAM_OS_ADMIN_PASSWORD` as a simple internal password gate on Vercel Preview.
- This is only a temporary layer to reduce accidental exposure.
- It must be replaced by Supabase Auth, role-based access, and RLS.

## 2. Recommended Roles

Use explicit app roles:

- `super_admin`: full system control, role assignment, sensitive configuration.
- `admin`: core team operations, can review and eventually edit records.
- `reviewer`: can review applications and data issues, limited write access later.
- `viewer`: read-only internal access.

Initial MVP behavior after auth:

- All authenticated roles can view the current read-only portal.
- Write actions should remain disabled until Phase 2 workflows are implemented.
- Role checks should still be added early so routes and future buttons are designed around access boundaries.

## 3. Proposed Tables

### `user_profiles`

Stores VAM OS user profile metadata tied to Supabase Auth users.

Suggested columns:

- `id uuid primary key references auth.users(id)`
- `email text not null`
- `full_name text`
- `status text default 'active'`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

### `user_roles`

Stores roles separately so one user can have multiple roles if needed.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid references auth.users(id)`
- `role text not null`
- `created_at timestamptz default now()`
- `created_by uuid references auth.users(id)`

Recommended constraint:

- unique `(user_id, role)`

### `audit_logs`

Required before enabling edit workflows.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `actor_user_id uuid references auth.users(id)`
- `action text not null`
- `entity_table text`
- `entity_id uuid`
- `before_data jsonb`
- `after_data jsonb`
- `metadata jsonb`
- `created_at timestamptz default now()`

Use cases:

- Track profile edits.
- Track application review decisions.
- Track data issue resolution.
- Track role assignment changes.

### `schools`

Normalizes schools beyond UEH.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `school_code text unique not null`
- `school_name text not null`
- `school_group text`
- `country text default 'VN'`
- `status text default 'active'`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Examples:

- `UEH`
- `FTU2`
- `UEL`
- `HCMUS`
- `OTHER`

### `application_review_notes`

Stores review activity without mutating raw application answers.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `application_id uuid references applications(id)`
- `reviewer_user_id uuid references auth.users(id)`
- `review_status text`
- `note text`
- `decision text`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Possible statuses:

- `needs_review`
- `in_review`
- `approved`
- `rejected`
- `waitlisted`
- `converted`

### Optional `registration_intake`

Use this table if public forms should accept raw submissions before creating official `applications`.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `source text`
- `role_applied text`
- `season_code text`
- `raw_payload jsonb not null`
- `normalized_payload jsonb`
- `intake_status text default 'new'`
- `created_person_id uuid`
- `created_application_id uuid`
- `created_at timestamptz default now()`
- `processed_at timestamptz`
- `processed_by uuid references auth.users(id)`

This table is useful when public intake needs spam protection, validation, deduplication, and review before official records are created.

## 4. Recommended RLS Strategy

RLS should be enabled only after auth and role lookup are implemented and tested.

Recommended strategy:

1. Create helper SQL functions:
   - `auth.uid()` based role lookup.
   - `has_role(role_name text)`.
   - `has_any_role(role_names text[])`.

2. Start with read policies:
   - `viewer`, `reviewer`, `admin`, `super_admin` can read admin tables needed by the portal.

3. Add write policies gradually:
   - Only `admin` and `super_admin` can update core records.
   - `reviewer` can insert review notes and update review statuses.
   - `viewer` remains read-only.

4. Add public insert-only policies for registration tables:
   - Public users can submit registration/intake records.
   - Public users cannot read all submissions.
   - Public users cannot update submitted records unless a secure token workflow is designed.

5. Test all policies in a staging Supabase project before production.

Important:

- Do not turn on RLS for production tables without verified policies.
- Do not rely only on frontend route guards.
- Frontend checks improve UX, but database policies enforce security.

## 5. Public Mentor/Mentee Application Forms

Recommended approach:

- Build public application forms as separate public routes or a separate app surface.
- Public forms should write to `registration_intake` or directly to `applications` only after validation strategy is clear.
- Use CAPTCHA or rate limiting if the form is public.
- Avoid creating official `people`, `mentor_profiles`, or `mentee_profiles` immediately from public submissions.

Preferred flow:

1. Public user submits form.
2. Submission is saved as `registration_intake` with raw payload.
3. System validates and normalizes fields.
4. Admin/reviewer reviews submission.
5. Approved submission creates or links:
   - `people`
   - `person_roles`
   - `applications`
   - `mentor_profiles` or `mentee_profiles`, if accepted

This prevents unreviewed public data from polluting official operational tables.

## 6. Application Review and Conversion Workflow

Recommended review flow:

1. Application enters `needs_review`.
2. Reviewer checks applicant identity, email, phone, school, role, answers, and duplicates.
3. Reviewer adds notes in `application_review_notes`.
4. Reviewer decides:
   - approve
   - reject
   - waitlist
   - request more information
5. On approval, an admin converts the application into official records.

Conversion should:

- Find or create `people`.
- Add or update `person_roles`.
- Create or update `mentor_profiles` or `mentee_profiles`.
- Preserve raw application answers.
- Write to `audit_logs`.
- Mark application review status as `converted`.

Avoid destructive updates:

- Do not overwrite existing profile fields without audit.
- Prefer preserving raw values and normalized values separately when possible.

## 7. Supporting New Schools Beyond UEH

Add `schools` as a normalized reference table.

Recommended model:

- `mentee_profiles.school_code` should reference `schools.school_code` eventually.
- Public forms should select from active schools.
- `OTHER` should be allowed but flagged for review.
- Store both:
  - normalized `school_code`
  - raw user-entered school text, if provided

Admin Portal should support:

- Filtering mentees by school.
- Dashboard breakdown by school.
- Data Issues section for unknown/OTHER schools.
- Adding new schools through an admin workflow in a later phase.

## 8. Security Risks If Current App Is Exposed Without Auth/RLS

Risks:

- Anyone with the URL can view personal data.
- Application answers may include sensitive personal information.
- Mentor/mentee emails, phone numbers, schools, and matching relationships are visible.
- Supabase anon key can read data if RLS is disabled.
- Search engines or shared links could expose internal pages if not protected.
- No audit trail exists for access.

Immediate mitigation:

- Keep Preview URL private.
- Use Vercel Deployment Protection or a simple password gate before broader review.
- Do not connect a public domain until auth/RLS is ready.

## 9. Phased Implementation Plan

### Phase 1A: Vercel Protection or Simple Password Gate

Goal:

- Prevent casual access to the Preview URL immediately.

Options:

- Vercel Deployment Protection.
- Vercel team login protection.
- Temporary app-level password gate.

Recommendation:

- Use Vercel Deployment Protection first when available because it requires no app data-model changes.
- If Vercel Deployment Protection is not available, use the temporary `VAM_OS_ADMIN_PASSWORD` gate until Supabase Auth is implemented.

### Phase 1B: Supabase Auth Login

Goal:

- Require authenticated users for Admin Portal.

Tasks:

- Enable Supabase Auth.
- Add login/logout pages.
- Add session handling.
- Protect all admin routes.
- Create `user_profiles`.
- Seed initial super admin.

### Phase 1C: Role-Based Access and RLS

Goal:

- Enforce access at both app and database layers.

Tasks:

- Create `user_roles`.
- Add role helper functions.
- Add frontend role guards.
- Enable RLS on staging first.
- Add read policies.
- Add write policies only when write features are introduced.

### Phase 1D: Application Review Workflow

Goal:

- Turn applications into a controlled review pipeline.

Tasks:

- Create `application_review_notes`.
- Add review status UI.
- Add notes.
- Add approve/reject/waitlist actions.
- Add audit logging.
- Add conversion workflow from application to official profile.

### Phase 1E: Public Registration Forms

Goal:

- Support new mentor/mentee applications safely.

Tasks:

- Create public registration form routes.
- Add `registration_intake` if using a staging intake table.
- Add validation, spam protection, and deduplication.
- Route submissions into review workflow.
- Support new schools via `schools`.

## 10. Clear Recommendation: What To Do First

Do first:

1. Enable Vercel Deployment Protection for the Preview deployment.
2. Keep the Preview URL private.
3. Create Supabase Auth login for internal admin access.
4. Add `user_profiles` and `user_roles`.
5. Protect all Admin Portal routes behind login.

Do not start public registration forms before internal admin auth and role boundaries exist.

Reason:

- The current app exposes sensitive operational and personal data if shared.
- Public intake increases data and abuse risk.
- Internal access control is the foundation for safe review and future write workflows.
