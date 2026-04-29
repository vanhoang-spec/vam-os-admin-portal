-- VAM OS Sprint 1B preview prep: seed admin_scope_access for UEHM-S11.
-- Idempotent. Does not delete, update, or reset existing access rows.

do $$
declare
  v_season_scope text := 'UEHM-S11';
  v_program_scope text;
begin
  select p.code
    into v_program_scope
  from public.seasons s
  left join public.programs p on p.id = s.program_id
  where s.code = v_season_scope
  limit 1;

  if not found then
    select p.code
      into v_program_scope
    from public.programs p
    where p.code in ('VAM', 'VAM_OS', 'VIETNAM_ALUMNI_MENTORING')
    order by p.code
    limit 1;
  end if;

  if not exists (
    select 1
    from public.seasons s
    where s.code = v_season_scope
  ) then
    raise exception 'Cannot seed admin_scope_access: season code % was not found.', v_season_scope
      using errcode = 'P0001';
  end if;

  if v_program_scope is null then
    select p.id::text
      into v_program_scope
    from public.seasons s
    join public.programs p on p.id = s.program_id
    where s.code = v_season_scope
    limit 1;
  end if;

  insert into public.admin_scope_access (
    user_id,
    program_id,
    season_id,
    role,
    status
  )
  select
    au.auth_user_id,
    v_program_scope,
    v_season_scope,
    case au.role
      when 'super_admin' then 'full_access'
      when 'admin' then 'operations'
      when 'reviewer' then 'review'
      else 'read'
    end,
    'active'
  from public.admin_users au
  where au.status = 'active'
    and au.auth_user_id is not null
    and not exists (
      select 1
      from public.admin_scope_access asa
      where asa.user_id = au.auth_user_id
        and asa.program_id is not distinct from v_program_scope
        and asa.season_id is not distinct from v_season_scope
        and asa.role = case au.role
          when 'super_admin' then 'full_access'
          when 'admin' then 'operations'
          when 'reviewer' then 'review'
          else 'read'
        end
        and asa.status = 'active'
    );
end;
$$;

-- Verification after applying:
-- select au.email, au.role as admin_role, asa.role as scope_role, asa.status, asa.program_id, asa.season_id
-- from public.admin_scope_access asa
-- join public.admin_users au on au.auth_user_id = asa.user_id
-- where asa.status = 'active'
-- order by au.role, au.email;
