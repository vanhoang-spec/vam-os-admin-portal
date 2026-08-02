-- VAM063_V1 independent catalog verification. Expected constants are source controlled; missing/extra evidence fails.
with
expected_function(sig,internal)as(values
 ('vam063_authorized_for_scope(uuid,uuid,uuid)',true),
 ('vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)',true),
 ('vam063_pause_membership(uuid,uuid,text)',false),
 ('vam063_withdraw_membership(uuid,uuid,text)',false),
 ('vam063_opt_out_membership(uuid,uuid,text)',false),
 ('vam063_cancel_membership(uuid,uuid,text)',false),
 ('vam063_reactivate_membership(uuid,uuid,text)',false),
 ('vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',false),
 ('vam063_remove_membership_role(uuid,uuid,text)',false)
),
assertions as(
 select 'function:'||e.sig assertion,case when p.oid is not null and p.prosecdef and pg_get_userbyid(p.proowner)=current_user and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and (e.internal or has_function_privilege('service_role',p.oid,'execute')) then 'PASS' else 'FAIL' end status from expected_function e left join pg_proc p on p.oid=to_regprocedure('public.'||e.sig)
 union all select 'function_inventory',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam063_%')=(select count(*) from expected_function) then 'PASS' else 'FAIL' end
 union all select 'no_delete_in_any_function',case when not exists(
   select 1 from expected_function e join pg_proc p on p.oid=to_regprocedure('public.'||e.sig) where pg_get_functiondef(p.oid) ~* '\mdelete\s+from\s+public\.(person_season_memberships|person_season_membership_log|people)\M'
 ) then 'PASS' else 'FAIL' end
 union all select 'transitions_always_log',case when
   (select pg_get_functiondef(p.oid) from pg_proc p where p.oid=to_regprocedure('public.vam063_transition_membership_atomic(uuid,uuid,text[],text,text,text,text,boolean)')) like '%insert into public.person_season_membership_log%'
   and (select pg_get_functiondef(p.oid) from pg_proc p where p.oid=to_regprocedure('public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)')) like '%insert into public.person_season_membership_log%'
   then 'PASS' else 'FAIL' end
 union all select 'prerequisite:migration_062_v3_still_applied',case when to_regprocedure('public.vam062_current_admin_id()') is not null and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='person_season_memberships' and c.relrowsecurity) then 'PASS' else 'FAIL' end
),
summary as(select *,status<>'PASS' failed from assertions)
select jsonb_build_object('package','VAM063_V1','overall_status',case when bool_and(not failed) then 'PASS' else 'FAIL' end,'assertions',jsonb_agg(jsonb_build_object('assertion',assertion,'status',status)order by assertion),'mismatches',coalesce(jsonb_agg(assertion order by assertion)filter(where failed),'[]'::jsonb)) membership_lifecycle_post_apply_v1 from summary;
