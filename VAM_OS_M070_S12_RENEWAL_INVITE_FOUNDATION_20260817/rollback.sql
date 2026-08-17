-- =============================================================================
-- VAM OS — M070 RETURNING-MENTOR RENEWAL INVITE FOUNDATION — ROLLBACK
--
-- Removes everything apply.sql created and narrows the audit vocabulary back by
-- exactly the three values M070 added. One transaction, `set timezone = 'UTC'`,
-- run with ON_ERROR_STOP.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- READ THIS BEFORE RUNNING
--
-- Rolling M070 back DESTROYS the invitation record. Every token hash, every
-- expiry, every submitted_at / outcome, every "who invited whom" — gone with
-- the table. It also invalidates every renewal link already in a mentor's
-- inbox, because the gate resolves a token by looking the hash up in this
-- table and finds nothing.
--
-- IT THEREFORE REFUSES WHILE THE TABLE HOLDS ANY ROW AT ALL. This is stricter
-- than M069's "refuses while a form is open", on purpose: a form's state is
-- re-creatable, an invitation history is not. To roll back deliberately:
--   1. revoke every live invite through the admin path, so the revocation is
--      audited under revoke_renewal_invite and mentors are told;
--   2. export public.person_season_invites in full and keep the export with
--      the release evidence;
--   3. delete the rows deliberately, as a separate, recorded act;
--   4. then run this file.
-- Steps 2 and 3 are NOT performed here. This file will not delete a single
-- invite row on the operator's behalf.
--
-- WHAT THIS FILE MAY REMOVE, AND WHAT IT MAY NOT
-- Only what migration 070 OWNS:
--   public.person_season_invites (with its trigger, indexes and constraints)
--   and the three M070 audit values, conditionally.
--
-- public.set_updated_at() is NOT dropped. It is shared infrastructure — 17
-- triggers on other tables call it in Production — and M070 only attached to
-- it. Dropping it would take those tables' updated_at maintenance with it.
--
-- NO AUDIT ROW IS EVER DELETED. If any admin_audit_log row already uses an
-- M070 action type, the vocabulary is left as it is and the reason is printed:
-- narrowing a CHECK to a set that existing rows violate would either fail or,
-- worse, tempt someone to delete the rows that stand in the way. An audit trail
-- that can be rewound is not an audit trail.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

-- ── Guards ──────────────────────────────────────────────────────────────────
do $m070_rb_guard$
declare
  v_total     integer;
  v_live      integer;
  v_submitted integer;
  v_revoked   integer;
begin
  if to_regclass('public.person_season_invites') is null then
    raise notice 'M070 ROLLBACK: public.person_season_invites already absent; only the audit vocabulary will be considered.';
  else
    select count(*),
           count(*) filter (where revoked_at is null and submitted_at is null),
           count(*) filter (where submitted_at is not null),
           count(*) filter (where revoked_at is not null)
      into v_total, v_live, v_submitted, v_revoked
    from public.person_season_invites;

    if v_total > 0 then
      raise exception 'M070 ROLLBACK REFUSED [INVITES_PRESENT]: public.person_season_invites holds % row(s) — % live (usable token), % submitted (renewal history), % revoked. Dropping the table destroys all of it and breaks every link already sent. Revoke the live invites through the admin path, export the table, delete the rows deliberately, then re-run.',
        v_total, v_live, v_submitted, v_revoked;
    end if;
  end if;
end
$m070_rb_guard$;

-- ── Drop the M070 objects, by exact identity ────────────────────────────────
-- The trigger, the five secondary indexes, the primary key and the six CHECK
-- constraints all belong to this table and go with it.
--
-- `IF EXISTS` is REQUIRED here, and the reason is a defect the independent
-- review found in the previous revision. The guard above has a deliberate
-- table-absent branch: it emits a NOTICE saying "already absent; only the audit
-- vocabulary will be considered" and lets the run continue, which is the
-- correct behaviour after a partially-completed rollback or a hand-repaired
-- database. An unconditional DROP then raised 42P01 on exactly that path, so
-- the file aborted before reaching the vocabulary block it had just promised to
-- run — and the promise in the NOTICE was unreachable in practice.
--
-- This is NOT a relaxation of the exact-identity rule. The statement still
-- names one table by its full identity; it is not a prefix match, not a
-- CASCADE, and not a loop over a catalog scan. What `IF EXISTS` tolerates is
-- precisely the one state the guard has already inspected and explicitly
-- decided to proceed from. Every state this file refuses to reason about is
-- still refused ABOVE, by the guard, before this line is reached.
drop table if exists public.person_season_invites;

-- ── Narrow the audit vocabulary, conditionally ──────────────────────────────
-- Symmetric with the apply: the replacement is built by SUBTRACTING exactly the
-- three M070 values from the live admitted set, never from a hard-coded list.
-- Anything else the vocabulary has gained since the apply is preserved.
do $m070_rb_vocab$
declare
  v_conname constant text := 'admin_audit_log_action_type_check';
  v_def      text;
  v_actual   text[];
  v_new      text[];
  v_post     text[];
  v_used     text;
  v_literals text;
  v_raw_n    integer;
  v_quote_n  integer;
  v_m070 constant text[] := array[
    'confirm_renewal', 'create_renewal_invite', 'revoke_renewal_invite'
  ];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log') and c.conname = v_conname;

  if v_def is null then
    raise notice 'M070 ROLLBACK: no % present; nothing to narrow.', v_conname;
    return;
  end if;

  -- Audit history wins over a tidy constraint.
  select string_agg(a.action_type || '=' || a.n::text, ', ' order by a.action_type)
    into v_used
  from (
    select action_type, count(*) as n
    from public.admin_audit_log
    where action_type = any (v_m070)
    group by action_type
  ) a;
  if v_used is not null then
    raise notice 'M070 ROLLBACK: audit vocabulary LEFT AS IS — admin_audit_log already holds row(s) using M070 action type(s): %. No audit row is ever deleted to satisfy a constraint, and narrowing the CHECK would invalidate them.', v_used;
    return;
  end if;

  select count(*) into v_raw_n from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;
  select array_agg(distinct m[1]) into v_actual from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;
  v_quote_n := length(v_def) - length(replace(v_def, '''', ''));

  if v_def not ilike '%= ANY (ARRAY[%' or v_quote_n <> 2 * v_raw_n
     or v_raw_n <> coalesce(array_length(v_actual, 1), 0) then
    raise exception 'M070 ROLLBACK ABORTED [AUDIT_VOCAB_SHAPE]: % is not a parseable, duplicate-free ANY(ARRAY[...]) list, so subtracting from it would not be safe: %.', v_conname, v_def;
  end if;

  if not exists (select 1 from unnest(v_m070) x where x = any (v_actual)) then
    raise notice 'M070 ROLLBACK: the vocabulary admits none of the M070 values; nothing to narrow.';
    return;
  end if;

  select array_agg(distinct x order by x) into v_new
  from unnest(v_actual) x where x <> all (v_m070);

  if coalesce(array_length(v_new, 1), 0) = 0 then
    raise exception 'M070 ROLLBACK ABORTED [AUDIT_VOCAB_EMPTY]: subtracting the M070 values would leave an empty vocabulary. Refusing.';
  end if;

  select string_agg(quote_literal(x) || '::text', ', ' order by x) into v_literals
  from unnest(v_new) x;

  execute format('alter table public.admin_audit_log drop constraint %I', v_conname);
  execute format(
    'alter table public.admin_audit_log add constraint %I check (action_type = any (array[%s]))',
    v_conname, v_literals
  );

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log') and c.conname = v_conname;
  select array_agg(distinct m[1]) into v_post from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

  if exists (select 1 from unnest(v_m070) x where x = any (v_post))
     or exists (select 1 from unnest(v_new) x where x <> all (coalesce(v_post, array[]::text[])))
     or coalesce(array_length(v_post, 1), 0) <> coalesce(array_length(v_new, 1), 0) then
    raise exception 'M070 ROLLBACK ABORTED [AUDIT_VOCAB_POST]: the narrowed vocabulary is not the pre-rollback set minus exactly the three M070 values.';
  end if;

  raise notice 'M070 ROLLBACK: audit vocabulary narrowed to % values (removed confirm_renewal, create_renewal_invite, revoke_renewal_invite).', array_length(v_post, 1);
end
$m070_rb_vocab$;

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $m070_rb_post$
declare v_txt text;
begin
  if to_regclass('public.person_season_invites') is not null then
    raise exception 'M070 ROLLBACK FAILED: public.person_season_invites still exists.';
  end if;

  select string_agg(obj, ', ' order by obj) into v_txt from (
    select 'relation ' || c.relname as obj
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'person\_season\_invites%'
    union all
    select 'trigger ' || t.tgname from pg_trigger t
    where not t.tgisinternal and t.tgname like 'person\_season\_invites%'
    union all
    select 'constraint ' || c.conname from pg_constraint c
    where c.conname like 'person\_season\_invites%'
  ) s;
  if v_txt is not null then
    raise exception 'M070 ROLLBACK FAILED: M070-owned object(s) survive: %.', v_txt;
  end if;

  -- The shared function must SURVIVE. Asserting this positively is the point:
  -- a rollback that tidied it away would break 17 unrelated triggers.
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'M070 ROLLBACK FAILED: public.set_updated_at() is gone. It is shared infrastructure and this file must never drop it.';
  end if;
end
$m070_rb_post$;

notify pgrst, 'reload schema';

commit;
