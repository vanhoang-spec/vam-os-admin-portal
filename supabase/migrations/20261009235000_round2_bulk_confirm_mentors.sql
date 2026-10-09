-- Duyệt nhóm hàng loạt cho mentor. Toàn bộ danh sách cùng một giao dịch:
-- một dòng đã đổi/không đủ quyền thì không dòng nào được ghi nhận.
create or replace function public.vam115_confirm_mentor_groups(p_actor uuid,p_season uuid,p_rows jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  r jsonb;
  a public.matching_industry_assignments%rowtype;
  n integer := 0;
begin
  if not public.vam114_round2_group_editor_for_season(p_actor,p_season) then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_ROWS'; end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'INVALID_ROWS'; end if;
  if (select count(distinct lower(x->>'assignmentId')) from jsonb_array_elements(p_rows) x)
     <> jsonb_array_length(p_rows) then raise exception 'INVALID_ROWS'; end if;
  perform pg_advisory_xact_lock(hashtextextended('VAM104_MATCH|' || p_season::text,0));
  for r in select value from jsonb_array_elements(p_rows) order by value->>'assignmentId'
  loop
    if jsonb_typeof(r->'expectedGroup') is distinct from 'number'
       or (r->>'expectedGroup')::numeric not between 1 and 9
       or (r->>'expectedGroup')::numeric <> trunc((r->>'expectedGroup')::numeric)
       or not (r ? 'expectedDrift') then raise exception 'INVALID_ROWS'; end if;
    if r->'expectedDrift' <> 'null'::jsonb and (
         jsonb_typeof(r->'expectedDrift') is distinct from 'number'
         or (r->>'expectedDrift')::numeric not between 1 and 9
         or (r->>'expectedDrift')::numeric <> trunc((r->>'expectedDrift')::numeric)
       ) then raise exception 'INVALID_ROWS'; end if;
    select * into a from public.matching_industry_assignments
      where id=(r->>'assignmentId')::uuid for update;
    if a.id is null or a.season_id <> p_season or a.role <> 'mentor' then raise exception 'NOT_FOUND'; end if;
    if a.source <> 'auto' or a.group_code is distinct from (r->>'expectedGroup')::smallint
       or a.drift_group is distinct from (r->>'expectedDrift')::smallint then raise exception 'STALE_GROUP'; end if;
    if not exists (select 1 from public.applications ap where ap.person_id=a.person_id
        and ap.season_id=p_season and ap.status='approved_as_mentor')
       or exists (select 1 from public.person_season_memberships m
         where m.person_id=a.person_id and m.season_id=p_season and m.role='mentor'
           and m.status in ('withdrawn','opted_out')) then raise exception 'NOT_APPROVED'; end if;
    perform public.vam112_set_industry_group(p_actor,a.id,a.group_code,a.group_code,
      'BTC đã rà soát hồ sơ và xác nhận nhóm qua duyệt hàng loạt.');
    n := n+1;
  end loop;
  return jsonb_build_object('ok',true,'approved',n);
end;
$$;
revoke all on function public.vam115_confirm_mentor_groups(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.vam115_confirm_mentor_groups(uuid,uuid,jsonb) to service_role;
do $$
begin
  if to_regprocedure('public.vam115_confirm_mentor_groups(uuid,uuid,jsonb)') is null
     or has_function_privilege('anon','public.vam115_confirm_mentor_groups(uuid,uuid,jsonb)','execute')
     or has_function_privilege('authenticated','public.vam115_confirm_mentor_groups(uuid,uuid,jsonb)','execute')
     or exists (select 1 from pg_proc where oid='public.vam115_confirm_mentor_groups(uuid,uuid,jsonb)'::regprocedure and prosecdef)
  then raise exception 'SCHEMA_CONTRACT_VIOLATION: bulk confirm permissions'; end if;
end $$;
notify pgrst,'reload schema';
