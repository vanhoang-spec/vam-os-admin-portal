-- ===========================================================================
-- P0.1 — profile-screening reviewer eligibility policy.
--
-- WHY
--   After the P0 restore, Giao Review loaded but the reviewer dropdown was
--   empty. The restored vam084_list_recruitment_participants required, for BOTH
--   stages:
--       admin_users -> public.people (matched by email) -> person_season_memberships
--   UEHM-S12 has 0 active 'reviewer' and 0 active 'interviewer' memberships, so
--   the function correctly returned nothing — but that made profile-screening
--   eligibility depend on participant identity/lifecycle data, which is not the
--   Owner's policy.
--
-- OWNER POLICY (profile screening only)
--   A selectable profile-screening reviewer is an ADMIN ACCOUNT that is
--   active, holds one of reviewer / core_team / admin / super_admin, and is
--   either super_admin (globally eligible) or has active admin_scope_access for
--   the target season with role review / operations / full_access.
--
--   It does NOT require a public.people row, and it does NOT require a
--   person_season_memberships row of any kind.
--
-- INTERVIEW IS DELIBERATELY UNCHANGED
--   The interview branch keeps the existing explicit interviewer participation
--   semantics — same people join, same person_season_memberships requirement,
--   same role filter. Interview eligibility is NOT broadened here. Changing it
--   needs its own Owner decision.
--
-- WHY A FUNCTION CHANGE AND NOT UI FILTERING
--   This RPC is the single eligibility boundary: lib/data.ts
--   getReviewEligibleReviewers() populates the dropdown from it, and
--   lib/reviewer-eligibility.ts validateReviewEligibleReviewers() re-checks
--   individual AND bulk assignment against the very same call. Fixing the
--   function keeps those three in agreement by construction; filtering in the
--   UI would let a rejected account still fail validation, or worse, diverge.
--
-- SCOPE
--   Additive and narrow: CREATE OR REPLACE of exactly one function. It does not
--   modify the already-applied 20260903180000 migration, creates no table,
--   writes no participant data, and creates no membership rows.
--
-- CONTRACT PRESERVED
--   Same name, same arguments, same RETURNS TABLE(id, email, full_name, role,
--   participation_role) — the deployed application needs no change. The
--   current_user = 'service_role' guard, SET search_path TO '' and the
--   service_role-only execute ACL are all retained.
--
--   For profile screening, participation_role is returned as the semantic label
--   'reviewer'. It is a label describing the stage, NOT a membership row: no
--   person_season_memberships row is read or created for it.
--
--   An unrecognised p_review_stage matches neither branch and returns no rows,
--   so the function fails closed exactly as before.
-- ===========================================================================

create or replace function public.vam084_list_recruitment_participants(
  p_season_id uuid,
  p_review_stage text
)
returns table(id uuid, email text, full_name text, role text, participation_role text)
language sql
stable
set search_path to ''
as $function$
  -- ---- profile screening: admin-account policy, no participant join --------
  select
    au.id,
    au.email,
    au.full_name,
    au.role,
    'reviewer'::text as participation_role
  from public.admin_users au
  where current_user = 'service_role'
    and p_review_stage = 'profile_screening'
    and au.status = 'active'
    and au.role in ('reviewer', 'core_team', 'admin', 'super_admin')
    and (
      au.role = 'super_admin'
      or exists (
        select 1
        from public.admin_scope_access asa
        where asa.user_id = au.auth_user_id
          and asa.status = 'active'
          and asa.season_id = p_season_id::text
          and asa.role in ('review', 'operations', 'full_access')
      )
    )

  union all

  -- ---- interview: existing participation semantics, unchanged -------------
  select distinct
    au.id,
    au.email,
    au.full_name,
    au.role,
    psm.role
  from public.admin_users au
  join public.people p
    on lower(btrim(p.email_primary)) = lower(btrim(au.email))
  join public.person_season_memberships psm
    on psm.person_id = p.id
   and psm.season_id = p_season_id
   and psm.status = 'active'
   and psm.role = 'interviewer'
  where current_user = 'service_role'
    and p_review_stage = 'interview'
    and au.status = 'active'
    and au.role in ('reviewer', 'core_team', 'admin', 'super_admin')
    and (
      au.role = 'super_admin'
      or exists (
        select 1
        from public.admin_scope_access asa
        where asa.user_id = au.auth_user_id
          and asa.status = 'active'
          and asa.season_id = p_season_id::text
          and asa.role in ('review', 'operations', 'full_access')
      )
    )

  order by 2;
$function$;

-- Re-assert the execute ACL. CREATE OR REPLACE keeps existing privileges, so
-- this is belt-and-braces: these are trusted RPCs and anon/authenticated must
-- never execute them.
revoke all on function public.vam084_list_recruitment_participants(p_season_id uuid, p_review_stage text) from public;
revoke all on function public.vam084_list_recruitment_participants(p_season_id uuid, p_review_stage text) from anon, authenticated;
grant execute on function public.vam084_list_recruitment_participants(p_season_id uuid, p_review_stage text) to service_role;
