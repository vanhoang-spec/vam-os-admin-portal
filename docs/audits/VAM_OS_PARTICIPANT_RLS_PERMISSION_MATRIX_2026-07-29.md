# VAM OS Participant RLS Permission Matrix
## 2026-07-29

Design-only document. No production connection used. No SQL executed.

---

## Purpose

Define the complete access matrix for participant callers (mentor and mentee) when
participant login is eventually implemented. This matrix informs the RLS policies
that must be written for `VAM_OS_AUTH_C_PARTICIPANT_RLS.sql` (Phase 7).

Participant login does not currently exist. This matrix is forward-looking design
to ensure the eventual RLS policies are correct and do not require destructive
schema changes once participants can log in.

---

## Principal Definition

A participant caller is a Supabase Auth `authenticated` user whose `auth.uid()` is
stored in `public.people.auth_user_id`. They are NOT in `admin_users`.

- **Mentor participant**: `people.auth_user_id = auth.uid()` AND a `mentor_profiles` row exists.
- **Mentee participant**: `people.auth_user_id = auth.uid()` AND a `mentee_profiles` row exists.

Identity resolution: `SELECT id FROM public.people WHERE auth_user_id = auth.uid()`

---

## Participant Access Bootstrapping Problem

For participant policies on related tables (e.g., `mentoring_recaps`), the policy
must verify: "does this row belong to a person whose `auth_user_id = auth.uid()`?"

This requires a subquery join through `people`. The subquery is called within a
SECURITY DEFINER helper or inlined in the USING clause. Since the participant SELECT
policy on `people` is also in place, the SECURITY DEFINER function for participant
identity can safely query `people` as a SECURITY DEFINER without triggering a policy loop.

**Canonical helper function to define:**
```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
create or replace function public.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.people
  where auth_user_id = auth.uid()
  limit 1
$$;
```

This function returns NULL for admin callers who are not in `people`, and returns
the participant's `people.id` for authenticated participant callers.

---

## Permission Matrix

Legend:
- ✅ ALLOW — should be permitted
- ❌ DENY — should be blocked
- N/A — no operation to define (e.g., inserts done by service-role only)
- 🔑 Requires `people.auth_user_id` linkage (migration 062)

| Table | SELECT | INSERT | UPDATE | DELETE | Participant scope |
|---|---|---|---|---|---|
| `people` | ✅ Own row | ❌ | ✅ Limited fields | ❌ | `auth_user_id = auth.uid()` |
| `mentor_profiles` | ✅ Own row | ❌ | ✅ Profile fields only | ❌ | `person_id = current_person_id()` |
| `mentee_profiles` | ✅ Own row | ❌ | ✅ Profile fields only | ❌ | `person_id = current_person_id()` |
| `matches` | ✅ Own match | ❌ | ❌ | ❌ | `mentor_profile_id → person_id` OR `mentee_profile_id → person_id` |
| `mentoring_recaps` | ✅ Own match recaps | ❌ | ❌ | ❌ | `match_id` belongs to participant's match |
| `event_participations` | ✅ Own participations | ❌ | ❌ | ❌ | `person_id = current_person_id()` |
| `applications` | ✅ Own application | ❌ | ❌ | ❌ | `person_id = current_person_id()` |
| `programs` | ✅ All active | ❌ | ❌ | ❌ | Reference data; any active participant |
| `seasons` | ✅ All active | ❌ | ❌ | ❌ | Reference data |
| `events` | ✅ All relevant | ❌ | ❌ | ❌ | Events in their season |
| `person_season_memberships` | ✅ Own memberships | ❌ | ❌ | ❌ | `person_id = current_person_id()` |
| `admin_users` | ❌ | ❌ | ❌ | ❌ | Participants must not see admin identity |
| `admin_scope_access` | ❌ | ❌ | ❌ | ❌ | Admin internal |
| `admin_audit_log` | ❌ | ❌ | ❌ | ❌ | Admin internal |
| `mentor_program_participations` | ✅ Own row | ❌ | ❌ | ❌ | `person_id = current_person_id()` |
| `activity_correction_log` | ❌ | ❌ | ❌ | ❌ | Admin-only correction log |
| `operational_team_assignments` | ❌ | ❌ | ❌ | ❌ | Admin-internal data |
| `intake_batches` | ❌ | ❌ | ❌ | ❌ | Admin-internal |
| `application_reviews` | ❌ | ❌ | ❌ | ❌ | Reviewer-internal |
| `application_decisions` | ❌ | ❌ | ❌ | ❌ | Reviewer-internal |
| `review_assignment_batches` | ❌ | ❌ | ❌ | ❌ | Reviewer-internal |
| `event_links` | ✅ If own event | ❌ | ❌ | ❌ | Attendee links for their own events only |
| `event_registrations` | ✅ Own registration | ❌ | ❌ | ❌ | `person_id = current_person_id()` |
| `industries` | ✅ All | ❌ | ❌ | ❌ | Reference/taxonomy; read-only |
| `function_areas` | ✅ All | ❌ | ❌ | ❌ | Reference/taxonomy; read-only |
| `mentor_industries` | ✅ Own row | ❌ | ❌ | ❌ | Participant sees their own taxonomy |
| `mentor_function_areas` | ✅ Own row | ❌ | ❌ | ❌ | Participant sees their own taxonomy |
| `crm_notes` | ❌ | ❌ | ❌ | ❌ | CRM is admin-internal |

---

## Role-Specific Restrictions

### Mentor participants

- Can read their own `mentor_profiles` row.
- Can UPDATE select profile fields: `bio_url`, `company_current`, `title_current`,
  `years_experience_min`, `years_experience_text`. Cannot UPDATE `person_id`,
  `source_application_id`, `intake_batch_id`, or `mentor_code`.
- Can read their own `matches` row (as mentor_profile participant).
- Can read `mentoring_recaps` for matches they are in.
- Cannot read another mentor's profile.
- Cannot read any mentee profile.

### Mentee participants

- Can read their own `mentee_profiles` row.
- Can UPDATE select profile fields: `school_raw`, `major`, `class_cohort`. Cannot
  UPDATE `mentee_code`, `mssv`, `person_id`, `source_application_id`, `intake_batch_id`.
- Can read their own `matches` row (as mentee_profile participant).
- Can read `mentoring_recaps` for matches they are in.
- Cannot read any mentor's private data beyond the match context.

---

## Policy Design Notes

### `people` self-read

```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
-- Policy allowing participant to read their own people row
create policy "participant_read_own_person"
on public.people
for select
using (
  -- Admin read (existing policy covers this branch)
  public.is_admin_role(array['viewer','reviewer','admin','super_admin'])
  -- Participant self-read (new)
  or (auth.uid() is not null and auth_user_id = auth.uid())
);
```

Note: this policy REPLACES or MERGES WITH `read_people_internal_roles` from 018.
In practice, create as a SEPARATE permissive policy named `participant_read_own_person_row`
so both the admin policy and the participant policy are PERMISSIVE and either can grant access.

### `matches` participant-read

Matches link a `mentor_profile_id` and `mentee_profile_id`. To determine ownership,
join through profiles → people:

```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
create policy "participant_read_own_match"
on public.matches
for select
using (
  public.is_admin_role(array['viewer','reviewer','admin','super_admin'])
  or (
    auth.uid() is not null
    and (
      exists (
        select 1 from public.mentor_profiles mp
        join public.people p on p.id = mp.person_id
        where mp.id = matches.mentor_profile_id
          and p.auth_user_id = auth.uid()
      )
      or exists (
        select 1 from public.mentee_profiles me
        join public.people p on p.id = me.person_id
        where me.id = matches.mentee_profile_id
          and p.auth_user_id = auth.uid()
      )
    )
  )
);
```

This is a nested subquery in the USING clause. Performance implication: evaluated
for every row in a SELECT. Must have index on `mentor_profiles.person_id`,
`mentee_profiles.person_id`, and `people.auth_user_id`. Check that these indexes exist
before enabling this policy.

For the initial implementation, consider using `current_person_id()` helper:

```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
create policy "participant_read_own_match"
on public.matches
for select
using (
  public.is_admin_role(array['viewer','reviewer','admin','super_admin'])
  or (
    public.current_person_id() is not null
    and (
      mentor_profile_id in (
        select id from public.mentor_profiles where person_id = public.current_person_id()
      )
      or mentee_profile_id in (
        select id from public.mentee_profiles where person_id = public.current_person_id()
      )
    )
  )
);
```

### `mentoring_recaps` participant-read

```sql
-- DESIGN ONLY / NOT AUTHORIZED / DO NOT EXECUTE
create policy "participant_read_own_recaps"
on public.mentoring_recaps
for select
using (
  public.is_admin_role(array['viewer','reviewer','admin','super_admin'])
  or (
    public.current_person_id() is not null
    and match_id in (
      select id from public.matches
      where mentor_profile_id in (
        select id from public.mentor_profiles where person_id = public.current_person_id()
      )
      or mentee_profile_id in (
        select id from public.mentee_profiles where person_id = public.current_person_id()
      )
    )
  )
);
```

---

## Items That Require Owner Decision Before Participant Policies Are Written

| Item | Question |
|---|---|
| P1 | Should mentors be able to UPDATE their own `mentor_profiles` row? If yes, which fields are allowed? |
| P2 | Should mentees be able to UPDATE their `mentee_profiles` row? Which fields? |
| P3 | Can participants view the full `matches` row or only a limited projection? (e.g., should `notes` field be hidden?) |
| P4 | Should participants see each other's profiles within a match (mentor sees mentee's name/email and vice versa)? |
| P5 | Can participants see ALL events in their season, or only events they are registered for? |
| P6 | Should `event_links` (attendance QR/tokens) be visible to the participant themselves, or admin-only? |

These decisions do not block the admin-side hardening work (Phases 7–12). They only
need to be resolved before participant login is built.

---

## Pre-Requisites for Participant RLS

Before any participant RLS policy can be applied:

| Pre-requisite | Migration | Status |
|---|---|---|
| `people.auth_user_id uuid null` column | 062 | NOT YET WRITTEN |
| Unique partial index on `people.auth_user_id` | 062 | NOT YET WRITTEN |
| `current_person_id()` SECURITY DEFINER function | New (to be in Auth_C migration) | NOT YET WRITTEN |
| `mentoring_recaps` RLS re-enabled | Auth_A migration | Pending Phase 7 design |
| `event_participations` RLS re-enabled | Auth_A migration | Pending Phase 7 design |
| Indexes on `mentor_profiles.person_id`, `mentee_profiles.person_id` | Pre-existing (from 018 table creation) | Verify before enabling join policies |

---

*Design only. No production or staging connection used. No SQL executed.*
