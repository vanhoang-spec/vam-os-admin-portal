-- =============================================================================
-- VAM OS — M073 S12 RENEWAL DECLINE FEEDBACK — ROLLBACK
--
-- Target : STAGING (ljfneyuvpxrmejpxsmpz) ONLY.
--
-- ONE transaction. Restores the exact M071 baseline: the one-argument decline
-- function with its original body and grants, and person_season_invites without
-- decline_feedback or its binding constraint.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DATA LOSS — READ BEFORE RUNNING
-- Dropping the column destroys every decline comment collected since apply.
-- There is nowhere else to put it: the whole point of M073 is that no other
-- table may carry it. CAPTURE IT FIRST if any exists:
--
--   select id, person_id, season_id, submitted_at, decline_feedback
--   from public.person_season_invites
--   where decline_feedback is not null
--   order by submitted_at;
--
-- Section 0 REFUSES if any feedback exists, so this cannot happen by accident.
-- Set the guard variable below to 'yes' only after the rows are captured.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- NO [ENV_NOT_STAGING] GUARD, deliberately, and for the same reason M070's and
-- M071's rollbacks carry none: a rollback must remain runnable on whatever
-- database is currently wrong, including one where the environment marker is
-- itself part of what went wrong. The refusals below are about the OBJECTS this
-- file restores, not about where it is run.
--
-- Safe to run when M073 is partially applied: every step is IF EXISTS or
-- guarded, so a half-applied transaction (which cannot happen — apply.sql is
-- one transaction — but could arise from manual surgery) still converges.
-- =============================================================================

begin;

-- ── 0. Refuse to silently destroy collected feedback ────────────────────────
do $m073_rb_guard$
declare
  -- Change to 'yes' ONLY after the rows above have been captured.
  v_accept_feedback_loss constant text := 'no';
  v_n integer;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'person_season_invites'
               and column_name = 'decline_feedback') then
    select count(*) into v_n
    from public.person_season_invites where decline_feedback is not null;

    if v_n > 0 and v_accept_feedback_loss <> 'yes' then
      raise exception
        'M073 ROLLBACK REFUSED [FEEDBACK_PRESENT]: % invites carry decline_feedback that this rollback would destroy. Capture them (see the header query), then set v_accept_feedback_loss to ''yes'' in this file.', v_n;
    end if;
    if v_n > 0 then
      raise notice 'M073 ROLLBACK: destroying % captured decline_feedback values by explicit operator consent.', v_n;
    end if;
  end if;
end
$m073_rb_guard$;

-- ── 1. Remove the M073 decline signature ────────────────────────────────────
drop function if exists public.vam071_submit_renewal_declined(text, text);

-- ── 2. Restore the M071 one-argument predecessor, byte-for-byte ─────────────
-- This is the body from supabase_migrations/071_renewal_trusted_runtime.sql
-- with nothing added and nothing removed.
drop function if exists public.vam071_submit_renewal_declined(text);

create function public.vam071_submit_renewal_declined(
  p_token_hash text
) returns table (
  outcome_status     text,
  invite_id          uuid,
  membership_outcome text,
  membership_id      uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_api_role   text;
  v_inv        record;
  v_mem        record;
  v_now        timestamptz;
  v_rows       integer;
  v_mem_out    text;
  v_mem_id     uuid;
begin
  select r.api_role into v_api_role from public.vam063_trusted_api_role() r;
  if coalesce(v_api_role, '') <> 'service_role' then
    raise exception 'VAM071 trusted server context required' using errcode = '42501';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise log 'VAM071 decline refused [TOKEN_MALFORMED]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  select i.* into v_inv
  from public.person_season_invites i
  where i.token_hash = p_token_hash
  for update;

  if v_inv.id is null then
    raise log 'VAM071 decline refused [TOKEN_NOT_FOUND]';
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  if v_inv.role is distinct from 'mentor' then
    raise log 'VAM071 decline refused [ROLE_NOT_MENTOR] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  perform public.vam071_renewal_identity_lock(v_inv.person_id, v_inv.season_id, v_inv.role);

  if v_inv.revoked_at is not null then
    raise log 'VAM071 decline refused [INVITE_REVOKED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;
  if v_inv.expires_at <= now() then
    raise log 'VAM071 decline refused [INVITE_EXPIRED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;
  if v_inv.submitted_at is not null then
    raise log 'VAM071 decline refused [ALREADY_SUBMITTED] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- P0-RT-2. Refuses BOTH the decline record AND the membership mutation,
  -- because it refuses before either is attempted.
  if public.vam071_accepted_renewal_exists(v_inv.person_id, v_inv.season_id, v_inv.role) then
    raise log 'VAM071 decline refused [ACCEPTED_RENEWAL_EXISTS] invite=%', v_inv.id;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  v_now := now();

  -- The same single-winner claim the accept path uses. application_id stays
  -- NULL, which person_season_invites_application_binding_check requires for
  -- a declined outcome and would refuse for any other combination.
  update public.person_season_invites i
     set submitted_at = v_now,
         outcome      = 'declined'
   where i.id = v_inv.id
     and i.submitted_at is null;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise log 'VAM071 decline refused [CLAIM_LOST] invite=% rows=%', v_inv.id, v_rows;
    raise exception 'VAM071 renewal submission refused' using errcode = '42501';
  end if;

  -- The membership half. Resolved strictly by the INVITE's season, so Season
  -- 11 is unreachable from here by construction rather than by a filter that
  -- could be edited out.
  select m.id, m.status into v_mem
  from public.person_season_memberships m
  where m.person_id = v_inv.person_id
    and m.season_id = v_inv.season_id
    and m.role      = v_inv.role
  for update;

  if v_mem.id is null then
    v_mem_out := 'no_membership';
    v_mem_id  := null;
  elsif v_mem.status = 'opted_out' then
    -- Already where a decline would put it. vam063 would return noop; not
    -- calling it at all avoids a second identical log entry.
    v_mem_out := 'already_opted_out';
    v_mem_id  := v_mem.id;
  elsif v_mem.status <> all (array['active', 'paused', 'invited']) then
    -- withdrawn / completed / graduated / cancelled. vam063_opt_out_membership
    -- admits none of these as a source state and would raise, taking the
    -- decline down with it. A terminal membership is left exactly as it is.
    v_mem_out := 'not_eligible';
    v_mem_id  := v_mem.id;
  elsif not exists (
      select 1 from public.admin_users u
      where u.id = v_inv.created_by and u.status = 'active'
    )
    or not public.vam063_authorized_for_scope(v_inv.created_by, v_inv.program_id, v_inv.season_id)
  then
    v_mem_out := 'deferred_actor_unauthorized';
    v_mem_id  := v_mem.id;
    raise log 'VAM071 decline recorded, membership opt-out deferred [ACTOR_UNAUTHORIZED] invite=% membership=% created_by=%',
      v_inv.id, v_mem.id, v_inv.created_by;
  else
    perform public.vam063_opt_out_membership(
      v_inv.created_by,
      v_mem.id,
      'Season 12 renewal declined by the mentor through renewal invite ' || v_inv.id::text
    );
    v_mem_out := 'opted_out';
    v_mem_id  := v_mem.id;
  end if;

  -- vam063 writes its own audited opt_out_membership row under a value the
  -- vocabulary already admits. Nothing further is written here: no new
  -- lifecycle status, no new action_type, and no admin_audit_log row for an
  -- action no admin performed.
  return query select 'declined'::text, v_inv.id, v_mem_out, v_mem_id;
end
$$;

-- ── 3. Restore the M071 grants for the restored signature ───────────────────
revoke all on function
  public.vam071_submit_renewal_declined(text)
from public, anon, authenticated, service_role;

grant execute on function
  public.vam071_submit_renewal_declined(text)
to service_role;

-- ── 4. Remove the schema change ─────────────────────────────────────────────
alter table public.person_season_invites
  drop constraint if exists person_season_invites_decline_feedback_binding_check;

alter table public.person_season_invites
  drop column if exists decline_feedback;

-- ── 5. Post-conditions ──────────────────────────────────────────────────────
do $m073_rb_post$
declare
  v_n   integer;
  v_nargs     integer;
  v_ndefaults integer;
  v_argtypes  oidvector;
  v_argnames  text[];
  v_types     text;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';
  if v_n <> 1 then
    raise exception 'M073 ROLLBACK FAILED [OVERLOAD]: % decline signatures exist, expected 1.', v_n;
  end if;

  -- Catalog identity, NOT a rendered string.
  -- pg_get_function_identity_arguments() renders PARAMETER NAMES as well as
  -- types ("p_token_hash text"), so comparing it against a bare type list
  -- refuses a perfectly correct database — which is exactly what the first
  -- Staging preflight hit. pronargs / proargtypes / pronargdefaults are the
  -- catalog's own notion of a signature and carry no formatting whatsoever.
  select p.pronargs, p.pronargdefaults, p.proargtypes, p.proargnames
    into v_nargs, v_ndefaults, v_argtypes, v_argnames
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam071_submit_renewal_declined';

  v_types := coalesce((select string_agg(format_type(t, null), ', ' order by ord)
                       from unnest(v_argtypes::oid[]) with ordinality u(t, ord)), '<none>');
  if v_nargs <> 1
     or v_argtypes[0] is distinct from 'pg_catalog.text'::regtype::oid
     or v_ndefaults <> 0
  then
    raise exception 'M073 ROLLBACK FAILED [PREDECESSOR_SIGNATURE]: expected exactly one text argument with no default; found % argument(s) [%] and % default(s).',
      v_nargs, v_types, v_ndefaults;
  end if;

  -- The parameter NAME is part of the contract, asserted separately from type
  -- identity so a failure says which of the two moved: PostgREST resolves this
  -- RPC by NAMED argument, so a rename breaks the runtime while leaving the
  -- type identity untouched.
  if v_argnames is null or v_argnames[1] is distinct from 'p_token_hash' then
    raise exception 'M073 ROLLBACK FAILED [PREDECESSOR_PARAM_NAME]: expected the first parameter to be named p_token_hash, found %.',
      coalesce(v_argnames[1], '<unnamed>');
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'person_season_invites'
               and column_name = 'decline_feedback') then
    raise exception 'M073 ROLLBACK FAILED [COLUMN]: decline_feedback still exists.';
  end if;

  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam071\_%';
  if v_n <> 7 then
    raise exception 'M073 ROLLBACK FAILED [OBJECT_COUNT]: expected 7 vam071_* functions, found %.', v_n;
  end if;

  raise notice 'M073 ROLLBACK: complete; M071 baseline restored.';
end
$m073_rb_post$;

notify pgrst, 'reload schema';

commit;

-- REMEMBER: the application code must be rolled back to the pre-M073 commit as
-- well. A deployed runtime calling the two-argument signature will fail against
-- the restored one-argument function — loudly, at the RPC boundary, which is
-- the correct direction for this failure but is still an outage until the
-- deployment is reverted.
