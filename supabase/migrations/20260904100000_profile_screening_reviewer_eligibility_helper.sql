-- Additive migration to fix vam084_participant_for_stage profile screening policy split-brain

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
  select case p_review_stage
    when 'profile_screening' then (
      select exists (
        select 1
        from public.admin_users au
        where au.id = p_admin_user_id
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
      )
    )
    when 'interview' then (
      select exists (
        select 1
        from public.admin_users au
        join public.people p
          on lower(btrim(p.email_primary)) = lower(btrim(au.email))
        join public.person_season_memberships psm
          on psm.person_id = p.id
         and psm.season_id = p_season_id
         and psm.status = 'active'
         and psm.role = 'interviewer'
        where au.id = p_admin_user_id
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
      )
    )
    else false
  end;
$function$;

-- Preserve permissions
REVOKE ALL ON FUNCTION public.vam084_participant_for_stage(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vam084_participant_for_stage(uuid, uuid, text) TO service_role;
