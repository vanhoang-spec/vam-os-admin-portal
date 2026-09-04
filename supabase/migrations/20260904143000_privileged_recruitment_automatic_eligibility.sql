-- 20260904143000_privileged_recruitment_automatic_eligibility.sql
--
-- ===========================================================================
-- Privileged staff are intrinsically eligible for recruitment work, and the
-- list and the predicate stop being two policies.
-- ===========================================================================
--
-- OWNER DECISION
--   For the target season, an ACTIVE core_team / admin / super_admin account is
--   intrinsically authorised to review application profiles AND to conduct
--   interviews. Those staff must not need a "Cấp Reviewer" / "Cấp Interviewer"
--   click. The explicit participation grant remains for EXTERNAL standalone
--   reviewers and interviewers who are not privileged staff.
--
-- WHY THE STRUCTURE CHANGES, NOT JUST THE RULE
--   The recurring S12 failure was never a wrong rule. It was TWO rules.
--   `vam084_list_recruitment_participants` fills every dropdown; every
--   assignment RPC re-checks `vam084_participant_for_stage`. Migration
--   20260903193000 moved the profile-screening half of the LIST onto the
--   Owner's admin-account policy and left the PREDICATE demanding an active
--   'reviewer' membership. The two halves of one policy disagreed, the UI
--   offered reviewers the database then refused, and UEHM-S12 — which has zero
--   active 'reviewer' memberships — failed every profile-screening assignment
--   with P0001. Migration 20260904100000 re-synced them by hand, which fixed
--   that instance and left the same trap armed for the next edit.
--
--   Hand-synchronising two copies of a policy is the defect. So this migration
--   introduces ONE canonical set-returning function,
--   `vam084_recruitment_eligible_admins`, and rewrites BOTH callers as thin
--   derivations of it:
--
--     participant_for_stage(id, season, stage) := id ∈ eligible(season, stage)
--     list_recruitment_participants(season, stage) := eligible(season, stage) ⋈ admin_users
--
--   Parity is then structural. A future policy edit changes one body and both
--   halves move together; they cannot drift, because there is nothing left to
--   drift against.
--
-- THE POLICY, STATED ONCE
--   Common to every non-super_admin path — an ACTIVE account whose role may
--   participate at all, holding an ACTIVE scope for the TARGET season in
--   review / operations / full_access. super_admin is globally eligible and
--   needs no season scope.
--
--   profile_screening — the account policy alone. Unchanged from 20260903193000
--     and 20260904100000: no people row, no membership row.
--
--   interview — two disjoint sources:
--     * PRIVILEGED (core_team / admin / super_admin): intrinsic. No people row,
--       no interviewer membership, no extra scope row. This is the change.
--     * STANDALONE 'reviewer': unchanged explicit participation semantics —
--       linked people identity by normalised email, ACTIVE target-season
--       'interviewer' membership, and the same season scope. A standalone
--       reviewer does NOT become an interviewer by being a reviewer.
--
--   An unrecognised stage matches no branch and returns no rows, so both
--   callers fail closed exactly as before.
--
-- SCOPE
--   Additive. CREATE OR REPLACE of three functions, no table DDL, no data
--   backfill, no index change, nothing written to admin_scope_access or
--   person_season_memberships. The explicit grant path
--   (20260904140000_grant_participation_scope_reuse.sql) is untouched and is
--   still required for external participants.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The canonical eligibility set. Single source of truth for both callers.
-- ---------------------------------------------------------------------------
--
-- `eligibility_source` is returned for diagnosis and for the Reviewer Pool,
-- which must distinguish rights that come from a privileged ROLE (and so must
-- not be revocable through a participation button) from rights that come from
-- an explicit GRANT (and so must be).
CREATE OR REPLACE FUNCTION public.vam084_recruitment_eligible_admins(
  p_season_id uuid,
  p_review_stage text
)
RETURNS TABLE(admin_user_id uuid, eligibility_source text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with eligible_account as (
    -- The account-level gate every path shares. Season scope is matched on the
    -- EXACT target season, which is what the assignment RPCs mean by "this
    -- season" and what the active-scope indexes key on; a program-wide row
    -- (season_id is null) is deliberately not a match.
    select au.id, au.role
    from public.admin_users au
    where au.status = 'active'
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
  )

  -- PROFILE SCREENING — account policy alone.
  select ea.id, 'account'::text
  from eligible_account ea
  where p_review_stage = 'profile_screening'

  union

  -- INTERVIEW, privileged — intrinsic to the role. No membership required.
  select ea.id, 'privileged_role'::text
  from eligible_account ea
  where p_review_stage = 'interview'
    and ea.role in ('core_team', 'admin', 'super_admin')

  union

  -- INTERVIEW, standalone reviewer — explicit participation, unchanged.
  select ea.id, 'participation'::text
  from eligible_account ea
  join public.admin_users au on au.id = ea.id
  join public.people p
    on lower(btrim(p.email_primary)) = lower(btrim(au.email))
  join public.person_season_memberships psm
    on psm.person_id = p.id
   and psm.season_id = p_season_id
   and psm.status = 'active'
   and psm.role = 'interviewer'
  where p_review_stage = 'interview'
    and ea.role = 'reviewer';
$function$;

REVOKE ALL ON FUNCTION public.vam084_recruitment_eligible_admins(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vam084_recruitment_eligible_admins(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- The predicate every assignment RPC re-checks. Now a membership test.
-- ---------------------------------------------------------------------------
--
-- Same name, arguments, return type and ACL as before. No `current_user`
-- guard, matching the contract of the definition this replaces: it is called
-- from inside other trusted RPCs, and the execute ACL is what restricts it.
CREATE OR REPLACE FUNCTION public.vam084_participant_for_stage(
  p_admin_user_id uuid,
  p_season_id uuid,
  p_review_stage text
)
RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.vam084_recruitment_eligible_admins(p_season_id, p_review_stage) e
    where e.admin_user_id = p_admin_user_id
  );
$function$;

REVOKE ALL ON FUNCTION public.vam084_participant_for_stage(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vam084_participant_for_stage(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- The list that fills every dropdown. Same set, joined for display.
-- ---------------------------------------------------------------------------
--
-- Contract preserved: same name, arguments, and
-- RETURNS TABLE(id, email, full_name, role, participation_role), so no
-- application change is required to read it.
--
-- `full_name` now resolves a HUMAN NAME rather than falling back to an email
-- address: people.full_name matched on normalised email, then
-- admin_users.full_name, then the email as a last resort. Operators were
-- reading raw mailbox strings in the assignee dropdowns.
--
-- `participation_role` stays a LABEL describing the stage, not a membership
-- row — no person_season_memberships row is read or created for a privileged
-- account.
CREATE OR REPLACE FUNCTION public.vam084_list_recruitment_participants(
  p_season_id uuid,
  p_review_stage text
)
RETURNS TABLE(id uuid, email text, full_name text, role text, participation_role text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    au.id,
    au.email,
    coalesce(
      nullif(btrim(p.full_name), ''),
      nullif(btrim(au.full_name), ''),
      au.email
    ) as full_name,
    au.role,
    (case when p_review_stage = 'interview' then 'interviewer' else 'reviewer' end)::text
      as participation_role
  from public.vam084_recruitment_eligible_admins(p_season_id, p_review_stage) e
  join public.admin_users au on au.id = e.admin_user_id
  left join lateral (
    -- One people row per account, chosen deterministically so the displayed
    -- name cannot change between reads if an email is duplicated in people.
    select pp.full_name
    from public.people pp
    where lower(btrim(pp.email_primary)) = lower(btrim(au.email))
    order by pp.id
    limit 1
  ) p on true
  where current_user = 'service_role'
  order by 3, 2;
$function$;

REVOKE ALL ON FUNCTION public.vam084_list_recruitment_participants(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vam084_list_recruitment_participants(uuid, text) TO service_role;
