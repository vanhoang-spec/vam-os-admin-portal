-- V2 deterministic rollback. Run only after separately authorized staging application.
begin;
do $$ begin
 if to_regclass('public.account_rls_package_state') is null then raise exception 'VAM062 rollback state missing'; end if;
 if (select count(*) from public.account_rls_package_state where package_version='VAM062_V2')<>5 then raise exception 'VAM062 rollback state incomplete'; end if;
 if to_regclass('public.account_import_batches') is null or to_regclass('public.account_import_outcomes') is null then raise exception 'VAM062 package objects inconsistent'; end if;
 if to_regprocedure('public.vam062_current_admin_id()') is null then raise exception 'VAM062 helper missing'; end if;
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
drop function public.vam062_current_admin_id();
drop table public.account_import_outcomes;
drop table public.account_import_batches;
do $$ declare r record; begin
 for r in select * from public.account_rls_package_state where package_version='VAM062_V2' loop
   execute format('alter table public.%I %s row level security',r.table_name,case when r.rls_was_enabled then 'enable' else 'disable' end);
   execute format('alter table public.%I %s force row level security',r.table_name,case when r.rls_was_forced then '' else 'no' end);
 end loop;
end $$;
drop table public.account_rls_package_state;
commit;

-- Guarantee: only package-specific policies/functions/tables are removed; prior RLS enabled/forced flags are restored.
-- Limitation: rows written through the package before rollback are business data and are intentionally not deleted automatically.
