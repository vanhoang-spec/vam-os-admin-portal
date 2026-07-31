-- V2 deterministic rollback. Run only after separately authorized staging application.
begin;
do $$ begin
 if to_regclass('public.account_rls_package_state') is null then raise exception 'VAM062 rollback state missing'; end if;
 if (select count(*) from public.account_rls_package_state where package_version='VAM062_V3')<>5 or exists(select 1 from public.account_rls_package_state where table_name not in ('admin_users','admin_scope_access','admin_audit_log','people','person_season_memberships') or state_checksum<>encode(digest('VAM062_V3|'||table_name||'|'||rls_was_enabled||'|'||rls_was_forced,'sha256'),'hex')) then raise exception 'VAM062 rollback state incomplete or checksum invalid'; end if;
 if (select array_agg(table_name order by table_name) from public.account_rls_package_state)<>array['admin_audit_log','admin_scope_access','admin_users','people','person_season_memberships'] then raise exception 'VAM062 rollback object set mismatch'; end if;
 if to_regclass('public.account_rls_package_manifest') is null or to_regclass('public.account_import_batches') is null or to_regclass('public.account_import_outcomes') is null or to_regclass('public.account_auth_reconciliation') is null or to_regclass('public.account_import_previews') is null then raise exception 'VAM062 package objects inconsistent'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('account_rls_package_state','account_rls_package_manifest','account_import_batches','account_import_outcomes','account_auth_reconciliation','account_import_previews') and pg_get_userbyid(c.relowner)<>current_user) then raise exception 'VAM062 package ownership mismatch'; end if;
 if exists(
   select 1 from (values
    ('account_import_batches',7),('account_import_outcomes',7),('account_auth_reconciliation',8),('account_import_previews',8),('account_rls_package_state',6),('account_rls_package_manifest',5)
   ) expected(table_name,column_count)
   left join lateral (select count(*)::integer n from information_schema.columns c where c.table_schema='public' and c.table_name=expected.table_name) actual on true
   left join pg_class pc on pc.oid=to_regclass('public.'||expected.table_name)
   where pc.oid is null or actual.n<>expected.column_count or pc.relkind<>'r' or not pc.relrowsecurity and expected.table_name in ('account_import_batches','account_import_outcomes','account_auth_reconciliation','account_import_previews')
 ) then raise exception 'VAM062 authenticated table manifest mismatch'; end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename in ('account_import_batches','account_import_outcomes','account_auth_reconciliation','account_import_previews','account_rls_package_state','account_rls_package_manifest')) then raise exception 'VAM062 package table policy mismatch'; end if;
 if exists(select 1 from (values('account_import_batches'),('account_import_outcomes'),('account_auth_reconciliation'),('account_import_previews')) v(t) where has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'VAM062 package table grants mismatch'; end if; if to_regprocedure('public.vam062_current_admin_id()') is null then raise exception 'VAM062 helper missing'; end if;
 if (select count(*) from public.account_rls_package_manifest)<>13 then raise exception 'VAM062 manifest object set mismatch'; end if;
 if exists(select 1 from public.account_rls_package_manifest m left join pg_proc p on m.object_kind='function' and p.proname=m.object_name left join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' where m.object_kind='function' and (p.oid is null or m.owner_name<>pg_get_userbyid(p.proowner) or m.definition_hash<>md5(regexp_replace(pg_get_functiondef(p.oid),'\s+',' ','g')))) then raise exception 'VAM062 function provenance mismatch'; end if;
 if exists(select 1 from public.account_rls_package_manifest m left join pg_policies p on m.object_kind='policy' and p.schemaname='public' and p.tablename=m.table_name and p.policyname=m.object_name where m.object_kind='policy' and (p.policyname is null or m.definition_hash<>md5(concat_ws('|',p.tablename,p.policyname,p.permissive,array_to_string(p.roles,','),p.cmd,coalesce(p.qual,''),coalesce(p.with_check,''))))) then raise exception 'VAM062 policy provenance mismatch'; end if;
end $$;
drop policy if exists vam062_admin_users_self_or_super on public.admin_users;
drop policy if exists vam062_scope_self_or_super on public.admin_scope_access;
drop policy if exists vam062_audit_actor_or_super on public.admin_audit_log;
drop policy if exists vam062_people_program_ops on public.people;
drop policy if exists vam062_membership_program_ops on public.person_season_memberships;
drop function public.vam062_upsert_staff_account_atomic(uuid,uuid,integer,uuid,text,text,text,uuid,uuid,text);
drop function public.vam062_admin_mutation_atomic(uuid,text,uuid,jsonb);
drop function public.vam062_import_participant_membership_atomic(uuid,uuid,integer,text,text,text,uuid,uuid,uuid);
drop function public.vam062_record_reconciliation(uuid,uuid,integer,text);
drop function public.vam062_record_auth_reconciliation(uuid,uuid,text,text,text,text,jsonb);
drop function public.vam062_create_account_preview(uuid,uuid,text,text,text,text,timestamptz,integer);
drop function public.vam062_consume_account_preview(uuid,uuid,text);
drop function public.vam062_current_admin_id();
drop table public.account_import_previews;
drop table public.account_auth_reconciliation;
drop table public.account_import_outcomes;
drop table public.account_import_batches;
drop table public.account_rls_package_manifest;
do $$ declare r record; begin
 for r in select * from public.account_rls_package_state where package_version='VAM062_V3' loop
   execute format('alter table public.%I %s row level security',r.table_name,case when r.rls_was_enabled then 'enable' else 'disable' end);
   execute format('alter table public.%I %s force row level security',r.table_name,case when r.rls_was_forced then '' else 'no' end);
 end loop;
end $$;
drop table public.account_rls_package_state;
commit;

-- Guarantee: only package-specific policies/functions/tables are removed; prior RLS enabled/forced flags are restored.
-- Limitation: rows written through the package before rollback are business data and are intentionally not deleted automatically.
