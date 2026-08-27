-- M083 ISOLATED-ENVIRONMENT ROLLBACK/RECOVERY ONLY.
-- Domain B rollback deletes outstanding encrypted previews.
-- Domain A rollback reopens duplicate-write races. Stop writers first.

-- DOMAIN B rollback
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

revoke all on function
  public.vam083_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer),
  public.vam083_consume_legacy_mentor_preview(uuid,uuid,text)
from public, anon, authenticated, service_role;

drop function public.vam083_consume_legacy_mentor_preview(uuid,uuid,text);
drop function public.vam083_create_legacy_mentor_preview(uuid,uuid,text,text,text,text,timestamptz,integer);
drop table public.legacy_mentor_import_previews;
commit;

-- DOMAIN A rollback
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop index public.mentor_profiles_canonical_mentor_code_key;
drop index public.applications_season_role_person_key;
drop index public.applications_season_role_canonical_email_key;
drop index public.people_canonical_email_key;
commit;

notify pgrst, 'reload schema';

