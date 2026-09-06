-- Applied AFTER the migrations, deliberately.
--
-- These three helpers reach into Supabase-specific authorization state that a
-- disposable cluster has no way to reproduce. Replacing them keeps every call
-- site under test unchanged while letting a test say "this actor is not scoped
-- for this season" through a connection setting. Nothing else is overridden:
-- every function the candidates actually change runs its real body.

create or replace function public.vam063_trusted_api_role()
returns table(api_role text) language sql stable as $fn$
  select api_role from public.vam063_trusted_api_role_result limit 1;
$fn$;

create or replace function public.vam084_operator_for_season(p_actor uuid, p_season_id uuid)
returns boolean language sql stable as $fn$
  select exists (
    select 1 from public.admin_users au
    where au.id = p_actor
      and au.status = 'active'
      and au.role in ('super_admin','admin','core_team')
  )
  and coalesce(current_setting('vam.denied_season', true), '') is distinct from p_season_id::text;
$fn$;

create or replace function public.vam084_participant_for_stage(
  p_admin_user_id uuid, p_season_id uuid, p_review_stage text
) returns boolean language sql stable as $fn$
  select exists (
    select 1 from public.admin_users au
    where au.id = p_admin_user_id and au.status = 'active'
  );
$fn$;

create or replace function public.vam071_renewal_identity_lock(
  p_person_id uuid, p_season_id uuid, p_role text
) returns void language plpgsql as $fn$
begin
  perform pg_advisory_xact_lock(hashtext('lock|' || coalesce(p_person_id::text, '')));
end;
$fn$;

create or replace function public.vam071_accepted_renewal_exists(
  p_person_id uuid, p_season_id uuid, p_role text
) returns boolean language sql stable as $fn$ select false; $fn$;
