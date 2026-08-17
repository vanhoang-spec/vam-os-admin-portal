-- =============================================================================
-- VAM OS — M071 S12 RENEWAL TRUSTED RUNTIME FOUNDATION — ROLLBACK
--
-- ONE transaction. Drops the seven functions M071 installs, and NOTHING else.
--
-- WHAT THIS ROLLBACK DOES NOT DO, AND WHY EACH OMISSION IS DELIBERATE
--
--   It does not drop M070. public.person_season_invites, its arbiters, its
--   CHECK constraints and its audit vocabulary belong to a different package
--   that is applied, verified and closed. Rolling this one back must not
--   reach into it.
--
--   It does not delete invites, applications, memberships or audit rows. A
--   renewal that actually happened is history. Dropping the code that produced
--   it does not make it not have happened, and an audit trail that can be
--   erased by a rollback is not an audit trail. The person_season_invites rows
--   these functions wrote remain exactly as they are, and every one of them is
--   still coherent: submitted_at/outcome/application_id were written together
--   under the constraints M070 enforces, so nothing here is left half-formed
--   by the absence of the code that wrote it.
--
--   It does not revoke anything from vam063. The S12 release T3/T4 surface is
--   not this package's to withdraw, and the admin console's membership
--   lifecycle actions call those functions directly.
--
-- WHAT IT COSTS, STATED PLAINLY
-- After this runs, every renewal path is dead: /renew/[token] can neither
-- accept nor decline, and an accepted renewal awaiting confirmation stays
-- unconfirmed — its application row exists with status 'submitted' and its
-- invite is claimed, which is a safe resting state but not a finished one.
-- Any deployed renewal UI must be taken down BEFORE this is run, or callers
-- receive a PostgREST 404 on the RPC rather than the uniform failure message
-- the gate is designed to produce.
--
-- NO [ENV_NOT_PRODUCTION] GUARD, deliberately, and for the same reason M070's
-- rollback carries none: a rollback that refuses to run on the environment it
-- is needed on is worse than one that runs. Its protection is state-based
-- instead — DROP … IF EXISTS on an exact seven-name inventory, so on a
-- database where M071 was never applied it drops nothing at all.
--
-- SUPABASE SQL EDITOR COMPATIBILITY: ZERO psql meta-commands.
-- =============================================================================

select 'M071 ROLLBACK — ONE TRANSACTION' as phase;

begin;

set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

-- ── 1. Report what is about to be dropped ───────────────────────────────────
-- A rollback that says nothing about what it found is a rollback nobody can
-- audit afterwards.
do $m071_rollback_pre$
declare
  v_txt text;
  v_n   integer;
begin
  select count(*), string_agg(p.proname::text, ', ' order by p.proname::text)
    into v_n, v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';

  raise notice 'M071 ROLLBACK: % vam071_* function(s) present: %.',
    v_n, coalesce(v_txt, '<none>');

  if to_regclass('public.person_season_invites') is not null then
    select count(*) into v_n from public.person_season_invites where submitted_at is not null;
    raise notice 'M071 ROLLBACK: % invite row(s) have already been answered. None is modified or deleted by this file.', v_n;
  end if;
end
$m071_rollback_pre$;

-- ── 2. Drop the seven functions, by exact signature ─────────────────────────
-- By SIGNATURE rather than by name, so an unrelated overload someone added
-- later is not swept up. IF EXISTS so a partial apply and a never-applied
-- database both roll back cleanly.
drop function if exists public.vam071_confirm_renewal_profile(uuid, uuid, jsonb, jsonb, jsonb);
drop function if exists public.vam071_submit_renewal_declined(text);
drop function if exists public.vam071_submit_renewal_accepted(text, jsonb, boolean);
drop function if exists public.vam071_revoke_renewal_invite(uuid, uuid, text);
drop function if exists public.vam071_create_renewal_invite(uuid, uuid, uuid, uuid, text, text, timestamptz);
drop function if exists public.vam071_accepted_renewal_exists(uuid, uuid, text);
drop function if exists public.vam071_renewal_identity_lock(uuid, uuid, text);

-- ── 3. Post-conditions ──────────────────────────────────────────────────────
do $m071_rollback_post$
declare
  v_txt text;
  v_n   integer;
begin
  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_txt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_txt is not null then
    raise exception 'M071 ROLLBACK ABORTED [RESIDUE]: vam071_* function(s) survive: %. An overload with a different signature exists and must be reviewed by hand.', v_txt;
  end if;

  -- M070 must be exactly as it was. This rollback drops functions; if the
  -- invite table, its arbiters or its policy posture changed while this file
  -- ran, something other than this file is running.
  if to_regclass('public.person_season_invites') is null then
    raise exception 'M071 ROLLBACK ABORTED [M070_GONE]: public.person_season_invites no longer exists. This file drops functions and never the table.';
  end if;

  select count(*) into v_n
  from pg_index i join pg_class c on c.oid = i.indexrelid
  where i.indrelid = to_regclass('public.person_season_invites')
    and c.relname = any (array['person_season_invites_token_hash_key',
                               'person_season_invites_live_key',
                               'person_season_invites_accepted_key']::text[])
    and i.indisunique and i.indisvalid and i.indisready;
  if v_n <> 3 then
    raise exception 'M071 ROLLBACK ABORTED [M070_ARBITER_LOST]: % of M070''s 3 unique arbiters remain.', v_n;
  end if;

  if exists (select 1 from pg_policies p
             where p.schemaname = 'public' and p.tablename = 'person_season_invites') then
    raise exception 'M071 ROLLBACK ABORTED [POLICY_APPEARED]: person_season_invites is RLS-on with ZERO policies by design.';
  end if;

  -- The S12 release lifecycle surface is untouched by this file and must
  -- still be here afterwards.
  select string_agg(f, ', ' order by f) into v_txt
  from unnest(array[
    'public.vam063_add_membership_role(uuid,uuid,uuid,uuid,text,text)',
    'public.vam063_opt_out_membership(uuid,uuid,text)'
  ]::text[]) f
  where to_regprocedure(f) is null;
  if v_txt is not null then
    raise exception 'M071 ROLLBACK ABORTED [LIFECYCLE_LOST]: % no longer exists. This file never drops a vam063 function.', v_txt;
  end if;

  raise notice 'M071 ROLLBACK COMPLETE: 7 functions dropped. M070, the S12 lifecycle surface, every invite row and every audit row are untouched.';
end
$m071_rollback_post$;

notify pgrst, 'reload schema';

commit;
