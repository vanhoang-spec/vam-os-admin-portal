-- =============================================================================
-- VAM OS — WP1-A2 STAFF SCOPE CONVERGENCE — APPLY
--
-- ONE TRANSACTION. Run ONCE, by the owner, against Production, ONLY after
-- preflight_v2.sql has returned SAFE_TO_APPLY_V2 = true on that same database.
--
-- Run it with ON_ERROR_STOP enabled (`psql -v ON_ERROR_STOP=1`, or the Supabase
-- SQL editor, which stops on the first error). Even without it nothing partial
-- can commit: every guard below raises, and a COMMIT issued inside an aborted
-- transaction is executed by PostgreSQL as a ROLLBACK. There is no application
-- retry, no savepoint, and no branch that adapts to what it finds. Drift aborts.
--
-- WHAT IT DOES, IN ORDER
--   1. locks the exact six admin_scope_access rows and the exact six
--      admin_users rows the manifest names, by primary key / exact email;
--   2. re-proves, inside the transaction, every value the owner inventoried,
--      the catalog identities, the absence of unknown rows, the absence of
--      target collisions, and the audit contract it is about to write into;
--   3. writes one admin_audit_log pre-image row per affected account BEFORE any
--      row is modified;
--   4. converts / retires the six source rows in place, by exact id;
--   5. inserts the six new grants at the deterministic ids listed below;
--   6. adds the five planned CHECK constraints and the active-scope unique
--      index, once every row already complies;
--   7. re-proves the exact post-state and aborts if any invariant fails.
--
-- WHAT IT DOES NOT DO
--   * no DELETE, anywhere, in any branch — history is retired, never removed;
--   * no rule keyed on a stored legacy string. In particular there is no
--     "VAM -> UEHM" mapping: three rows store "VAM" and this file converts two
--     of them UP to Admin authority, retires the third, and canonicalizes a
--     fourth without touching its status, because the owner named those exact
--     scope_ids. A string rule would hand a shared demo login real authority;
--   * no change to public.vam063_authorized_for_scope or any other function;
--   * no RLS change, no GRANT/REVOKE, no column type change, no migration
--     replay, no program-wide (season_id IS NULL) ACTIVE grant (that is WP1-A3);
--   * no platform-role change other than viewer.vam.test -> viewer.
--
-- RERUN BEHAVIOUR
--   This package is intended to run exactly once. A second run aborts at
--   [ALREADY_APPLIED] rather than mutating anything back towards the target.
--   "Already applied" is an explicit, loud stop, so operational history stays
--   readable; it is never a silent no-op and never a partial re-convergence.
--
-- THE SIX ROWS THIS FILE CREATES, at deterministic ids authored here so the
-- verifier can prove them and the rollback can remove exactly them:
--   a2000001-0000-4a20-8a20-000000000001  UEH shared Admin  UEHM/S12 full_access
--   a2000002-0000-4a20-8a20-000000000002  Lieu              UEHM/S11 full_access
--   a2000003-0000-4a20-8a20-000000000003  Lieu              UEHM/S12 full_access
--   a2000004-0000-4a20-8a20-000000000004  Hoang             UEHM/S12 full_access
--   a2000005-0000-4a20-8a20-000000000005  Toan              UEHM/S12 full_access
--   a2000006-0000-4a20-8a20-000000000006  demo viewer       UEHM/S12 read
--
-- EXPECTED POST-STATE
--   12 rows total: 9 active, 3 inactive. 1 platform-role change. 0 deletions.
-- =============================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '300s';

-- #############################################################################
-- STEP 1 — LOCKS AND PRECONDITIONS
--
-- Everything this block proves was already proved by preflight_v2.sql at read
-- time. It is proved again here, under row locks, because the preflight and the
-- apply are two different transactions and only this one is holding the rows it
-- is about to write. The first mismatch aborts the run.
--
-- The block also captures the pre-image of the six source rows into a temporary
-- table so STEP 6 can PROVE that `id` and `created_at` survived, rather than
-- asserting it from the fact that no statement mentions them.
-- #############################################################################

do $wp1a2_preconditions$
declare
  -- ── Canonical catalog identities (owner-approved) ──────────────────────────
  c_program constant text := '61701ee8-64a6-4673-b261-ba12ce9a3ee3';  -- UEHM
  c_s11     constant text := '710f4ec9-1cf7-461e-98d4-f33799047add';  -- UEHM-S11
  c_s12     constant text := '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1';  -- UEHM-S12

  -- ── The exact six source rows (owner inventory of 16 Aug 2026) ────────────
  c_src_ueh   constant uuid := '68fe466c-b37d-4812-baeb-eb5fe4ea24ec';
  c_src_lieu  constant uuid := '17a86485-c241-4cff-9bd5-60efe75b802a';
  c_src_hoang constant uuid := '60ef3d0b-8f41-4c76-aad7-dc91f26a470a';
  c_src_toan  constant uuid := '1e58beb9-b7ce-4392-ac81-429743f61534';
  c_src_demo  constant uuid := '487a7562-bb40-4c5c-9dc1-0fe363f1158a';
  c_src_hist  constant uuid := 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028';

  -- ── The six rows this package creates ─────────────────────────────────────
  c_new_ueh_s12   constant uuid := 'a2000001-0000-4a20-8a20-000000000001';
  c_new_lieu_s11  constant uuid := 'a2000002-0000-4a20-8a20-000000000002';
  c_new_lieu_s12  constant uuid := 'a2000003-0000-4a20-8a20-000000000003';
  c_new_hoang_s12 constant uuid := 'a2000004-0000-4a20-8a20-000000000004';
  c_new_toan_s12  constant uuid := 'a2000005-0000-4a20-8a20-000000000005';
  c_new_demo_s12  constant uuid := 'a2000006-0000-4a20-8a20-000000000006';

  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  v_n   integer;
  v_txt text;
begin
  -- ── [PGVERSION] the planned unique index needs NULLS NOT DISTINCT ─────────
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'WP1A2 ABORT [PGVERSION]: server_version_num % is below 150000; the planned active-scope index requires NULLS NOT DISTINCT (PG15+).',
      current_setting('server_version_num');
  end if;

  -- ── [SHAPE] the table is the shape this package was designed against ──────
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_scope_access'
    and ((column_name = 'id'         and data_type = 'uuid')
      or (column_name = 'user_id'    and data_type = 'uuid')
      or (column_name in ('program_id','season_id','role','status') and data_type in ('text','character varying'))
      or (column_name = 'created_at'));
  if v_n <> 7 then
    raise exception 'WP1A2 ABORT [SHAPE]: admin_scope_access does not carry the expected 7 columns in the expected types (matched %).', v_n;
  end if;

  -- ── [ALREADY_APPLIED] refuse a second run, loudly ─────────────────────────
  -- The package is single-shot. If its own rows or its own constraint names are
  -- already present, this is a rerun after a successful commit (or a partially
  -- hand-applied state), and the correct response is to stop and let a human
  -- read the verifier output — never to mutate towards the target again.
  select count(*) into v_n
  from public.admin_scope_access
  where id in (c_new_ueh_s12, c_new_lieu_s11, c_new_lieu_s12, c_new_hoang_s12, c_new_toan_s12, c_new_demo_s12);
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [ALREADY_APPLIED]: % of the 6 rows this package creates already exist. Run verifier.sql; do not re-run apply.sql.', v_n;
  end if;

  select count(*) into v_n
  from (values
    ('admin_scope_access_program_id_not_null'),
    ('admin_scope_access_program_id_canonical_check'),
    ('admin_scope_access_season_id_canonical_check'),
    ('admin_scope_access_role_check'),
    ('admin_scope_access_status_check'),
    ('admin_scope_access_active_scope_key')
  ) as n(object_name)
  where exists (select 1 from pg_constraint c where c.conname = n.object_name)
     or exists (select 1 from pg_class r where r.relname = n.object_name and r.relkind = 'i');
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [ALREADY_APPLIED]: % of the 6 planned constraint/index names are already taken. preflight_v2 proved them free; something changed since.', v_n;
  end if;

  -- ── LOCK the exact six scope rows ─────────────────────────────────────────
  -- By primary key, never by a program_id pattern. lock_timeout is 5s, so a
  -- contended row fails the run instead of blocking Production.
  perform 1
  from public.admin_scope_access
  where id in (c_src_ueh, c_src_lieu, c_src_hoang, c_src_toan, c_src_demo, c_src_hist)
  for update;

  select count(*) into v_n
  from public.admin_scope_access
  where id in (c_src_ueh, c_src_lieu, c_src_hoang, c_src_toan, c_src_demo, c_src_hist);
  if v_n <> 6 then
    raise exception 'WP1A2 ABORT [SOURCE_ROW]: expected the 6 manifest scope rows, locked %.', v_n;
  end if;

  -- ── LOCK the exact six admin_users rows ───────────────────────────────────
  perform 1
  from public.admin_users
  where lower(btrim(email)) in (
    'uehmentoring@gmail.com', 'lieu.nguyen@hoatay.com.vn', 'hoang.nguyen@embassy.edu.vn',
    'lyductoan@gmail.com', 'viewer.vam.test@redsquarevietnam.com', 'admin.vam.test@redsquarevietnam.com')
  for update;

  select count(*) into v_n
  from public.admin_users
  where lower(btrim(email)) in (
    'uehmentoring@gmail.com', 'lieu.nguyen@hoatay.com.vn', 'hoang.nguyen@embassy.edu.vn',
    'lyductoan@gmail.com', 'viewer.vam.test@redsquarevietnam.com', 'admin.vam.test@redsquarevietnam.com');
  if v_n <> 6 then
    raise exception 'WP1A2 ABORT [STAFF_IDENTITY]: expected exactly 6 admin_users rows for the 6 manifest emails, found %.', v_n;
  end if;

  -- ── [UNKNOWN_ROW] the manifest accounts for every row in the table ────────
  -- A row nobody inventoried is a row nobody decided about, and nothing in this
  -- package can classify it: the manifest converts scope_ids, not patterns.
  select count(*) into v_n
  from public.admin_scope_access s
  where s.id not in (c_src_ueh, c_src_lieu, c_src_hoang, c_src_toan, c_src_demo, c_src_hist);
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [UNKNOWN_ROW]: % row(s) exist that the owner inventory does not name. Re-cut the manifest from a fresh inventory; do not widen this package.', v_n;
  end if;

  -- ── [SOURCE_DRIFT] + [STAFF_LINKAGE] every stored value is still exact ────
  -- One comparison covers both requirements: the row must hold the inventoried
  -- values AND belong to the account the manifest names for it.
  select count(*) into v_n
  from (values
    (c_src_ueh,   'uehmentoring@gmail.com'::text,               'UEH Mentoring'::text, 'UEHM-S11'::text, 'full_access'::text, 'active'::text),
    (c_src_lieu,  'lieu.nguyen@hoatay.com.vn',                  'UEHM',                null,             'admin',             'active'),
    (c_src_hoang, 'hoang.nguyen@embassy.edu.vn',                'VAM',                 'UEHM-S11',       'operations',        'active'),
    (c_src_toan,  'lyductoan@gmail.com',                        'VAM',                 'UEHM-S11',       'operations',        'active'),
    (c_src_demo,  'viewer.vam.test@redsquarevietnam.com',       'VAM',                 'UEHM-S11',       'operations',        'active'),
    (c_src_hist,  'admin.vam.test@redsquarevietnam.com',        'VAM',                 'UEHM-S11',       'full_access',       'inactive')
  ) as m(scope_id, email, program_id, season_id, role, status)
  join public.admin_scope_access s on s.id = m.scope_id
  join public.admin_users u        on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = m.email
    and s.program_id is not distinct from m.program_id
    and s.season_id  is not distinct from m.season_id
    and s.role       is not distinct from m.role
    and s.status     is not distinct from m.status;
  if v_n <> 6 then
    raise exception 'WP1A2 ABORT [SOURCE_DRIFT]: only % of 6 source rows still match the owner inventory exactly (value drift, or a row now belongs to a different account). The manifest is stale — re-cut it, never adapt the target.', v_n;
  end if;

  -- ── [STAFF_IDENTITY] the four real Admins are admin/active and usable ─────
  select count(*) into v_n
  from public.admin_users u
  where lower(btrim(u.email)) in ('uehmentoring@gmail.com','lieu.nguyen@hoatay.com.vn','hoang.nguyen@embassy.edu.vn','lyductoan@gmail.com')
    and u.role = 'admin' and u.status = 'active' and u.auth_user_id is not null;
  if v_n <> 4 then
    raise exception 'WP1A2 ABORT [STAFF_IDENTITY]: % of 4 real Admin accounts are admin/active with a linked auth identity.', v_n;
  end if;

  -- ── [DEMO_VIEWER] the demo account is still reviewer/active ───────────────
  -- Proved BEFORE its intended role change, so the one platform-role change in
  -- this package acts on exactly the account state the owner approved.
  select count(*) into v_n
  from public.admin_users u
  where lower(btrim(u.email)) = 'viewer.vam.test@redsquarevietnam.com'
    and u.role = 'reviewer' and u.status = 'active' and u.auth_user_id is not null;
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [DEMO_VIEWER_ROLE]: the demo account is not reviewer/active with a linked auth identity; its approved downgrade does not apply to any other state.';
  end if;

  -- ── [NO_REACTIVATION] the inactive identities are still inactive ──────────
  select count(*) into v_n
  from public.admin_users u
  where lower(btrim(u.email)) = 'admin.vam.test@redsquarevietnam.com' and u.status = 'inactive';
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [HISTORICAL_INACTIVE]: the historical admin test account is no longer inactive. This package never restores authority to it.';
  end if;

  select count(*) into v_n
  from public.admin_scope_access s
  where s.id = c_src_hist and s.status = 'inactive';
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [HISTORICAL_INACTIVE]: the historical scope row is no longer inactive.';
  end if;

  -- ── [PROGRAM] / [SEASON_S11] / [SEASON_S12] catalog identity is exact ─────
  select count(*) into v_n
  from public.programs p
  where p.id::text = c_program and upper(btrim(p.code)) = 'UEHM' and lower(btrim(p.name)) = lower('UEH Mentoring');
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [PROGRAM]: UEHM does not resolve exactly once at %.', c_program;
  end if;

  select count(*) into v_n
  from public.seasons s
  where s.id::text = c_s11 and upper(btrim(s.code)) = 'UEHM-S11' and s.program_id::text = c_program;
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [SEASON_S11]: UEHM-S11 does not resolve exactly once at %, owned by UEHM.', c_s11;
  end if;

  select count(*) into v_n
  from public.seasons s
  where s.id::text = c_s12 and upper(btrim(s.code)) = 'UEHM-S12' and s.program_id::text = c_program;
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [SEASON_S12]: UEHM-S12 does not resolve exactly once at %, owned by UEHM.', c_s12;
  end if;

  -- Season code uniqueness, so "UEHM-S12" cannot mean two things in the catalog.
  select count(*) into v_n from public.seasons s where upper(btrim(s.code)) in ('UEHM-S11','UEHM-S12');
  if v_n <> 2 then
    raise exception 'WP1A2 ABORT [SEASON_S11]/[SEASON_S12]: the two season codes resolve to % rows, not 2.', v_n;
  end if;

  -- ── [TARGET_COLLISION] the canonical target keys are still free ───────────
  -- Counted over ACTIVE rows other than the manifest's own six, because the six
  -- are the rows this transaction is about to rewrite.
  select count(*) into v_n
  from public.admin_scope_access s
  join public.admin_users u on u.auth_user_id = s.user_id
  where s.status = 'active'
    and s.id not in (c_src_ueh, c_src_lieu, c_src_hoang, c_src_toan, c_src_demo, c_src_hist)
    and s.program_id = c_program
    and s.season_id in (c_s11, c_s12)
    and lower(btrim(u.email)) in (
      'uehmentoring@gmail.com','lieu.nguyen@hoatay.com.vn','hoang.nguyen@embassy.edu.vn',
      'lyductoan@gmail.com','viewer.vam.test@redsquarevietnam.com','admin.vam.test@redsquarevietnam.com');
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [TARGET_COLLISION]: % active row(s) already hold a canonical target key for a manifest account.', v_n;
  end if;

  -- ── [AUDIT_CONTRACT] the existing audit mechanism can carry this record ───
  -- The package writes into public.admin_audit_log using the vocabulary the
  -- application already uses. It does NOT invent an event type and does NOT
  -- weaken any audit constraint. If the live contract cannot represent the
  -- write, the run stops here and reports, rather than guessing.
  if to_regclass('public.admin_audit_log') is null then
    raise exception 'WP1A2 ABORT [AUDIT_CONTRACT]: public.admin_audit_log does not exist. The pre-image of the legacy scope levels cannot be recorded, and this package refuses to rewrite them unrecorded.';
  end if;

  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_audit_log'
    and column_name in ('actor_admin_user_id','action_type','target_admin_user_id','before_data','after_data');
  if v_n <> 5 then
    raise exception 'WP1A2 ABORT [AUDIT_CONTRACT]: admin_audit_log is missing one of the five columns this package writes (matched of 5: %).', v_n;
  end if;

  -- `update_admin_user` is the value lib/admin-users.ts writes when an account's
  -- role and/or scope change together, and it is present in BOTH the legacy
  -- vocabulary and the VAM062 superset, so it is safe whichever of the two the
  -- live constraint currently carries. If a CHECK on action_type exists and does
  -- not admit it, stop: widening that constraint is not in this package's scope.
  select pg_get_constraintdef(c.oid) into v_txt
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%'
  limit 1;
  if v_txt is not null and v_txt not ilike '%update_admin_user%' then
    raise exception 'WP1A2 ABORT [AUDIT_CONTRACT]: the live action_type CHECK does not admit ''update_admin_user'' (%). This package will not invent an event vocabulary and will not weaken an audit constraint.', v_txt;
  end if;

  -- The audit FK points at admin_users.id; every affected account must resolve.
  select count(*) into v_n
  from public.admin_users u
  where lower(btrim(u.email)) in (
    'uehmentoring@gmail.com','lieu.nguyen@hoatay.com.vn','hoang.nguyen@embassy.edu.vn',
    'lyductoan@gmail.com','viewer.vam.test@redsquarevietnam.com','admin.vam.test@redsquarevietnam.com')
    and u.id is not null;
  if v_n <> 6 then
    raise exception 'WP1A2 ABORT [AUDIT_CONTRACT]: only % of 6 accounts resolve to an admin_users.id for admin_audit_log.target_admin_user_id.', v_n;
  end if;

  -- ── [CONSTRAINT_ROW] nothing outside the manifest would block the DDL ─────
  -- The planned constraints are table-wide. The six manifest rows are made
  -- compliant by this transaction; every other row must already comply, and
  -- [UNKNOWN_ROW] above has already proved there are none.
  select count(*) into v_n
  from public.admin_scope_access s
  where s.id not in (c_src_ueh, c_src_lieu, c_src_hoang, c_src_toan, c_src_demo, c_src_hist)
    and (s.program_id is null
      or s.program_id !~* c_uuid_re
      or (s.season_id is not null and s.season_id !~* c_uuid_re)
      or s.role is null   or s.role   not in ('full_access','operations','review','read')
      or s.status is null or s.status not in ('active','inactive'));
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [CONSTRAINT_ROW]: % row(s) outside the manifest would violate a planned constraint.', v_n;
  end if;

  -- ── [RPC_COMPAT] the live RPC accepts the planned grants, unchanged ───────
  -- Read from the catalog, never invoked. A2 changes no function; this proves
  -- the targets it writes are the shape the live function already accepts.
  select regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g') into v_txt
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_authorized_for_scope';
  if v_txt is null then
    raise exception 'WP1A2 ABORT [RPC_COMPAT]: public.vam063_authorized_for_scope does not exist.';
  end if;
  if v_txt !~* 'role\s+in\s*\([^)]*full_access' or v_txt !~* 'season_id\s*=\s*p_season_id' then
    raise exception 'WP1A2 ABORT [RPC_COMPAT]: the live RPC no longer matches the predicates this plan targets (season-bearing, full_access/operations, active).';
  end if;

  -- ── Capture the pre-image so STEP 6 can PROVE id/created_at survived ──────
  -- Dropped automatically at COMMIT. It exists only inside this transaction.
  create temporary table wp1a2_source_preimage on commit drop as
  select s.id, s.user_id, s.program_id, s.season_id, s.role, s.status, s.created_at
  from public.admin_scope_access s
  where s.id in (c_src_ueh, c_src_lieu, c_src_hoang, c_src_toan, c_src_demo, c_src_hist);

  raise notice 'WP1A2 preconditions PASS: 6 source rows locked, 6 accounts locked, catalog exact, no unknown rows, no target collisions, audit contract compatible.';
end
$wp1a2_preconditions$;

-- #############################################################################
-- STEP 2 — AUDIT PRE-IMAGE, WRITTEN BEFORE ANY ROW IS MODIFIED
--
-- One row per affected account, in the shape lib/admin-users.ts already writes:
-- action_type `update_admin_user`, target_admin_user_id = admin_users.id,
-- before_data / after_data = {user, scopes}. No new event vocabulary, no new
-- table, no schema change.
--
-- actor_admin_user_id is NULL, deliberately and honestly: this convergence is
-- executed by the owner as a migration, not by an admin acting through the
-- console, and the column is nullable precisely for writes with no interactive
-- actor. Attributing it to a person's admin_users row would be a fiction.
--
-- before_data is read live, before the writes below. after_data is the PLAN —
-- the same literals STEP 3/4 write — and STEP 6 aborts the transaction unless
-- the committed state equals it exactly. So an audit row can never survive
-- describing something that did not happen.
--
-- The account snapshot is deliberately NARROWER than the application's
-- (id, auth_user_id, email, role, status): admin_audit_log is readable by
-- super_admins, and this record needs no additional personal data to be a
-- complete account of the authority change.
-- #############################################################################

insert into public.admin_audit_log (actor_admin_user_id, action_type, target_admin_user_id, before_data, after_data)
select
  null::uuid,
  'update_admin_user',
  u.id,
  jsonb_build_object(
    'source', 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql',
    'work_package', 'WP1-A2',
    'user', jsonb_build_object('id', u.id, 'auth_user_id', u.auth_user_id, 'email', u.email, 'role', u.role, 'status', u.status),
    'scopes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'program_id', s.program_id, 'season_id', s.season_id,
               'role', s.role, 'status', s.status) order by s.id)
      from public.admin_scope_access s
      where s.user_id = u.auth_user_id), '[]'::jsonb)
  ),
  p.after_data
from (values
  -- UEH shared Admin: S11 canonicalized in place, S12 added.
  ('uehmentoring@gmail.com'::text, jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql","work_package":"WP1-A2",
     "user":{"role":"admin","status":"active","platform_role_change":"none"},
     "scopes":[
       {"id":"68fe466c-b37d-4812-baeb-eb5fe4ea24ec","action":"UPDATE_IN_PLACE","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"710f4ec9-1cf7-461e-98d4-f33799047add","role":"full_access","status":"active"},
       {"id":"a2000001-0000-4a20-8a20-000000000001","action":"INSERT","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"32fbfc86-1d67-4158-b9d4-1e6bff48b2c1","role":"full_access","status":"active"}]}'),

  -- Lieu: the ONLY row whose stored scope level cannot be preserved. "admin" is
  -- not a canonical level and the planned role CHECK is table-wide, so the
  -- retired row records full_access — the authority the owner says the account
  -- was meant to hold — and the pre-image above is the record of what it really
  -- stored. The row is retired, never rewritten into a season grant it never was.
  ('lieu.nguyen@hoatay.com.vn', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql","work_package":"WP1-A2",
     "user":{"role":"admin","status":"active","platform_role_change":"none"},
     "history_rewrite":{"scope_id":"17a86485-c241-4cff-9bd5-60efe75b802a","field":"role","from":"admin","to":"full_access",
       "why":"the table-wide role CHECK makes the literal admin unrepresentable on any row, retired or not; the pre-image in before_data is the record of what was actually stored"},
     "scopes":[
       {"id":"17a86485-c241-4cff-9bd5-60efe75b802a","action":"RETIRE_IN_PLACE","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":null,"role":"full_access","status":"inactive"},
       {"id":"a2000002-0000-4a20-8a20-000000000002","action":"INSERT","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"710f4ec9-1cf7-461e-98d4-f33799047add","role":"full_access","status":"active"},
       {"id":"a2000003-0000-4a20-8a20-000000000003","action":"INSERT","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"32fbfc86-1d67-4158-b9d4-1e6bff48b2c1","role":"full_access","status":"active"}]}'),

  ('hoang.nguyen@embassy.edu.vn', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql","work_package":"WP1-A2",
     "user":{"role":"admin","status":"active","platform_role_change":"none"},
     "scopes":[
       {"id":"60ef3d0b-8f41-4c76-aad7-dc91f26a470a","action":"UPDATE_IN_PLACE","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"710f4ec9-1cf7-461e-98d4-f33799047add","role":"full_access","status":"active"},
       {"id":"a2000004-0000-4a20-8a20-000000000004","action":"INSERT","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"32fbfc86-1d67-4158-b9d4-1e6bff48b2c1","role":"full_access","status":"active"}]}'),

  ('lyductoan@gmail.com', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql","work_package":"WP1-A2",
     "user":{"role":"admin","status":"active","platform_role_change":"none"},
     "scopes":[
       {"id":"1e58beb9-b7ce-4392-ac81-429743f61534","action":"UPDATE_IN_PLACE","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"710f4ec9-1cf7-461e-98d4-f33799047add","role":"full_access","status":"active"},
       {"id":"a2000005-0000-4a20-8a20-000000000005","action":"INSERT","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"32fbfc86-1d67-4158-b9d4-1e6bff48b2c1","role":"full_access","status":"active"}]}'),

  -- The controlled demo viewer: the only platform-role change in WP1-A2. Its
  -- S11 operations grant is RETIRED (its meaning is replaced, not respelled) and
  -- its entire post-plan authority is one read-only Season 12 grant.
  ('viewer.vam.test@redsquarevietnam.com', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql","work_package":"WP1-A2",
     "user":{"role":"viewer","status":"active","platform_role_change":"reviewer_to_viewer"},
     "scopes":[
       {"id":"487a7562-bb40-4c5c-9dc1-0fe363f1158a","action":"RETIRE_IN_PLACE","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"710f4ec9-1cf7-461e-98d4-f33799047add","role":"operations","status":"inactive"},
       {"id":"a2000006-0000-4a20-8a20-000000000006","action":"INSERT","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"32fbfc86-1d67-4158-b9d4-1e6bff48b2c1","role":"read","status":"active"}]}'),

  -- Historical inactive admin test: identifiers only. No status change, no new
  -- grant, no reactivation.
  ('admin.vam.test@redsquarevietnam.com', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql","work_package":"WP1-A2",
     "user":{"role":"admin","status":"inactive","platform_role_change":"none"},
     "scopes":[
       {"id":"eaa60d5c-66eb-4ef8-a8c0-0db0bc701028","action":"UPDATE_IN_PLACE","program_id":"61701ee8-64a6-4673-b261-ba12ce9a3ee3","season_id":"710f4ec9-1cf7-461e-98d4-f33799047add","role":"full_access","status":"inactive"}]}')
) as p(email, after_data)
join public.admin_users u on lower(btrim(u.email)) = p.email;

-- #############################################################################
-- STEP 3 — THE SIX IN-PLACE CONVERSIONS
--
-- Every statement is addressed by an exact primary key AND carries the owner
-- inventory in its WHERE clause, so each one is independently exact: it can
-- only ever touch the single row whose stored values are still the ones the
-- owner approved converting. Nothing is keyed on a program_id pattern, and no
-- statement can reach a row the manifest does not name.
--
-- id and created_at are never assigned, so they survive by construction — and
-- STEP 6 proves it against the pre-image captured in STEP 1.
-- #############################################################################

-- 3.1 UEH shared Admin — same account, same season, same authority; only the
--     identifiers change, so the row's meaning stays true and is updated in place.
update public.admin_scope_access
   set program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3',
       season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add',
       role       = 'full_access',
       status     = 'active'
 where id = '68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid
   and program_id = 'UEH Mentoring' and season_id = 'UEHM-S11'
   and role = 'full_access' and status = 'active';

-- 3.2 Lieu — RETIRED IN PLACE, never deleted and never rewritten into a season
--     grant. It was a program-wide claim; converting it in place would make the
--     audit record describe something that never happened. season_id stays NULL
--     so the row keeps saying what it was, and status inactive means the partial
--     unique index and every read path (all keyed on status = 'active') stop
--     seeing it. The level moves admin -> full_access because the table-wide
--     role CHECK makes "admin" unrepresentable; STEP 2 recorded the pre-image.
update public.admin_scope_access
   set program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3',
       season_id  = null,
       role       = 'full_access',
       status     = 'inactive'
 where id = '17a86485-c241-4cff-9bd5-60efe75b802a'::uuid
   and program_id = 'UEHM' and season_id is null
   and role = 'admin' and status = 'active';

-- 3.3 Hoang — the row already claims Season 11 for this account; the owner
--     decision raises its level and gives it a canonical program identity.
update public.admin_scope_access
   set program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3',
       season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add',
       role       = 'full_access',
       status     = 'active'
 where id = '60ef3d0b-8f41-4c76-aad7-dc91f26a470a'::uuid
   and program_id = 'VAM' and season_id = 'UEHM-S11'
   and role = 'operations' and status = 'active';

-- 3.4 Toan — identical reasoning, decided per account rather than per stored
--     string. The shared value "VAM" authorizes nothing; the scope_id does.
update public.admin_scope_access
   set program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3',
       season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add',
       role       = 'full_access',
       status     = 'active'
 where id = '1e58beb9-b7ce-4392-ac81-429743f61534'::uuid
   and program_id = 'VAM' and season_id = 'UEHM-S11'
   and role = 'operations' and status = 'active';

-- 3.5 Controlled demo viewer — the same stored values as 3.3 and 3.4, and the
--     OPPOSITE outcome. This row means "Season 11 operations authority"; the
--     account will hold Season 12 read authority instead. That is a replacement
--     of meaning, not a spelling correction, so the row is retired in place and
--     the new authority is a new row (3.5 does not become the S12 grant). Its
--     level `operations` is PRESERVED — unlike Lieu's `admin` it is already
--     canonical — so the history keeps saying exactly what the account held.
update public.admin_scope_access
   set program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3',
       season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add',
       role       = 'operations',
       status     = 'inactive'
 where id = '487a7562-bb40-4c5c-9dc1-0fe363f1158a'::uuid
   and program_id = 'VAM' and season_id = 'UEHM-S11'
   and role = 'operations' and status = 'active';

-- 3.6 Historical inactive admin test — identifiers only, because the planned
--     constraints are table-wide. status is written as 'inactive', which is the
--     value it already holds and which the WHERE clause requires: changing a
--     stored identifier is not the same act as restoring authority.
update public.admin_scope_access
   set program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3',
       season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add',
       role       = 'full_access',
       status     = 'inactive'
 where id = 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028'::uuid
   and program_id = 'VAM' and season_id = 'UEHM-S11'
   and role = 'full_access' and status = 'inactive';

-- 3.7 The one platform-role change in the whole of WP1-A2. Keyed on the exact
--     email, and `status` is deliberately absent from the SET list — the
--     account stays active. The four real Admins keep `admin`.
update public.admin_users
   set role = 'viewer'
 where lower(btrim(email)) = 'viewer.vam.test@redsquarevietnam.com'
   and role = 'reviewer' and status = 'active';

-- #############################################################################
-- STEP 4 — THE SIX NEW GRANTS
--
-- Explicit, deterministic ids authored into this package (not gen_random_uuid),
-- so the verifier can prove exactly these rows and the rollback can remove
-- exactly these rows rather than "any row that looks like this".
--
-- Deliberately NOT an UPSERT. The guard is a narrow NOT EXISTS on the canonical
-- active key: if anything unexpected already holds that key the row is simply
-- not inserted, and STEP 6 then aborts the whole transaction. Unexpected state
-- stops the run; it never gets absorbed.
--
-- The join to admin_users requires status = 'active' and a linked auth identity,
-- so no active grant can be issued to a non-active account.
-- #############################################################################

insert into public.admin_scope_access (id, user_id, program_id, season_id, role, status, created_at)
select g.new_id, u.auth_user_id, g.program_id, g.season_id, g.scope_role, 'active', now()
from (values
  ('a2000001-0000-4a20-8a20-000000000001'::uuid, 'uehmentoring@gmail.com'::text,
   '61701ee8-64a6-4673-b261-ba12ce9a3ee3'::text, '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::text, 'full_access'::text),
  ('a2000002-0000-4a20-8a20-000000000002', 'lieu.nguyen@hoatay.com.vn',
   '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access'),
  ('a2000003-0000-4a20-8a20-000000000003', 'lieu.nguyen@hoatay.com.vn',
   '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access'),
  ('a2000004-0000-4a20-8a20-000000000004', 'hoang.nguyen@embassy.edu.vn',
   '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access'),
  ('a2000005-0000-4a20-8a20-000000000005', 'lyductoan@gmail.com',
   '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access'),
  -- The demo viewer's ENTIRE post-plan authority: one season, read only.
  ('a2000006-0000-4a20-8a20-000000000006', 'viewer.vam.test@redsquarevietnam.com',
   '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'read')
) as g(new_id, email, program_id, season_id, scope_role)
join public.admin_users u
  on lower(btrim(u.email)) = g.email
 and u.status = 'active'
 and u.auth_user_id is not null
where not exists (
  select 1
  from public.admin_scope_access s
  where s.user_id = u.auth_user_id
    and s.status = 'active'
    and s.program_id = g.program_id
    and s.season_id is not distinct from g.season_id
);

-- #############################################################################
-- STEP 5 — THE PLANNED CONSTRAINTS, ADDED LAST
--
-- Only now that every row is canonical. The six names were proved free by
-- preflight_v2 [NAME_COLLISION] and re-proved by STEP 1 [ALREADY_APPLIED].
--
-- NOT NULL is expressed as named CHECK constraints rather than as column
-- attributes. Two reasons, both operational: the six names above are the six
-- the preflight proved free, and a named constraint is exactly droppable by
-- name — so rollback.sql can remove precisely what A2 added without having to
-- know whether some column attribute predated this package. The enforcement is
-- identical for every write.
--
-- Scope level is NOT part of the uniqueness key. Migration 020 keys its
-- equivalent index on (user_id, program_id, season_id, role), which permits an
-- active `read` grant and an active `full_access` grant on the identical scope,
-- resolving silently to the stronger one. That index was never applied to
-- Production and is not carried forward.
--
-- The regexes are case-insensitive (~*), exactly as preflight_v2's post-plan
-- projection was, so no row the preflight passed can fail the constraint.
-- No column type is changed: program_id and season_id stay TEXT in A2.
-- #############################################################################

alter table public.admin_scope_access
  add constraint admin_scope_access_program_id_not_null
    check (program_id is not null);

alter table public.admin_scope_access
  add constraint admin_scope_access_program_id_canonical_check
    check (program_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.admin_scope_access
  add constraint admin_scope_access_season_id_canonical_check
    check (season_id is null or season_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.admin_scope_access
  add constraint admin_scope_access_role_check
    check (role is not null and role in ('full_access', 'operations', 'review', 'read'));

alter table public.admin_scope_access
  add constraint admin_scope_access_status_check
    check (status is not null and status in ('active', 'inactive'));

create unique index admin_scope_access_active_scope_key
  on public.admin_scope_access (user_id, program_id, season_id)
  nulls not distinct
  where status = 'active';

comment on constraint admin_scope_access_program_id_not_null on public.admin_scope_access is
  'WP1-A2: every scope grant names a program. Expressed as a named CHECK so it is exactly reversible by the WP1-A2 rollback package.';
comment on index public.admin_scope_access_active_scope_key is
  'WP1-A2: one ACTIVE grant per (user, program, season). Scope level is deliberately excluded from the key, so a read grant and a full_access grant cannot both be active on one scope. NULLS NOT DISTINCT makes two program-wide grants for one user collide.';

-- #############################################################################
-- STEP 6 — POSTCONDITIONS
--
-- The exact post-state, proved before COMMIT. Any failure raises, and the whole
-- transaction — writes, DDL and audit rows alike — is rolled back.
-- #############################################################################

do $wp1a2_postconditions$
declare
  c_program constant text := '61701ee8-64a6-4673-b261-ba12ce9a3ee3';
  c_s11     constant text := '710f4ec9-1cf7-461e-98d4-f33799047add';
  c_s12     constant text := '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1';
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_n integer;
begin
  -- ── Exact row and status counts ───────────────────────────────────────────
  select count(*) into v_n from public.admin_scope_access;
  if v_n <> 12 then
    raise exception 'WP1A2 ABORT [POST_ROWCOUNT]: expected 12 scope rows (6 converted + 6 created), found %.', v_n;
  end if;

  select count(*) into v_n from public.admin_scope_access where status = 'active';
  if v_n <> 9 then
    raise exception 'WP1A2 ABORT [POST_ACTIVE]: expected 9 active grants, found %.', v_n;
  end if;

  select count(*) into v_n from public.admin_scope_access where status = 'inactive';
  if v_n <> 3 then
    raise exception 'WP1A2 ABORT [POST_INACTIVE]: expected 3 inactive grants, found %.', v_n;
  end if;

  -- ── The six converted rows hold exactly their targets ─────────────────────
  select count(*) into v_n
  from (values
    ('68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid, c_program, c_s11,      'full_access'::text, 'active'::text),
    ('17a86485-c241-4cff-9bd5-60efe75b802a',       c_program, null,       'full_access',       'inactive'),
    ('60ef3d0b-8f41-4c76-aad7-dc91f26a470a',       c_program, c_s11,      'full_access',       'active'),
    ('1e58beb9-b7ce-4392-ac81-429743f61534',       c_program, c_s11,      'full_access',       'active'),
    ('487a7562-bb40-4c5c-9dc1-0fe363f1158a',       c_program, c_s11,      'operations',        'inactive'),
    ('eaa60d5c-66eb-4ef8-a8c0-0db0bc701028',       c_program, c_s11,      'full_access',       'inactive')
  ) as w(id, program_id, season_id, role, status)
  join public.admin_scope_access s on s.id = w.id
  where s.program_id is not distinct from w.program_id
    and s.season_id  is not distinct from w.season_id
    and s.role       is not distinct from w.role
    and s.status     is not distinct from w.status;
  if v_n <> 6 then
    raise exception 'WP1A2 ABORT [POST_CONVERTED]: only % of 6 converted rows hold their exact target values.', v_n;
  end if;

  -- ── id and created_at survived every in-place conversion ─────────────────
  -- Proved against the pre-image captured under lock in STEP 1, not assumed
  -- from the absence of an assignment.
  select count(*) into v_n
  from wp1a2_source_preimage p
  join public.admin_scope_access s on s.id = p.id
  where s.created_at = p.created_at and s.user_id = p.user_id;
  if v_n <> 6 then
    raise exception 'WP1A2 ABORT [POST_HISTORY]: only % of 6 converted rows preserved id, user_id and created_at.', v_n;
  end if;

  -- ── The six created rows exist, at their authored ids, owned correctly ────
  select count(*) into v_n
  from (values
    ('a2000001-0000-4a20-8a20-000000000001'::uuid, 'uehmentoring@gmail.com'::text,          c_s12, 'full_access'::text),
    ('a2000002-0000-4a20-8a20-000000000002',       'lieu.nguyen@hoatay.com.vn',             c_s11, 'full_access'),
    ('a2000003-0000-4a20-8a20-000000000003',       'lieu.nguyen@hoatay.com.vn',             c_s12, 'full_access'),
    ('a2000004-0000-4a20-8a20-000000000004',       'hoang.nguyen@embassy.edu.vn',           c_s12, 'full_access'),
    ('a2000005-0000-4a20-8a20-000000000005',       'lyductoan@gmail.com',                   c_s12, 'full_access'),
    ('a2000006-0000-4a20-8a20-000000000006',       'viewer.vam.test@redsquarevietnam.com',  c_s12, 'read')
  ) as w(id, email, season_id, role)
  join public.admin_scope_access s on s.id = w.id
  join public.admin_users u        on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = w.email
    and s.program_id = c_program
    and s.season_id  = w.season_id
    and s.role       = w.role
    and s.status     = 'active';
  if v_n <> 6 then
    raise exception 'WP1A2 ABORT [POST_CREATED]: only % of 6 created rows exist at their authored ids with the exact owner, scope and level.', v_n;
  end if;

  -- ── The four real Admins: platform role unchanged ─────────────────────────
  select count(*) into v_n
  from public.admin_users u
  where lower(btrim(u.email)) in ('uehmentoring@gmail.com','lieu.nguyen@hoatay.com.vn','hoang.nguyen@embassy.edu.vn','lyductoan@gmail.com')
    and u.role = 'admin' and u.status = 'active';
  if v_n <> 4 then
    raise exception 'WP1A2 ABORT [POST_STAFF_IDENTITY]: % of 4 real Admin accounts are still admin/active.', v_n;
  end if;

  -- ── Each real Admin holds exactly S11 + S12 full_access active, and no more ─
  select count(*) into v_n
  from public.admin_users u
  where lower(btrim(u.email)) in ('uehmentoring@gmail.com','lieu.nguyen@hoatay.com.vn','hoang.nguyen@embassy.edu.vn','lyductoan@gmail.com')
    and (select count(*) from public.admin_scope_access s
          where s.user_id = u.auth_user_id and s.status = 'active') = 2
    and (select count(*) from public.admin_scope_access s
          where s.user_id = u.auth_user_id and s.status = 'active'
            and s.program_id = c_program and s.season_id = c_s11 and s.role = 'full_access') = 1
    and (select count(*) from public.admin_scope_access s
          where s.user_id = u.auth_user_id and s.status = 'active'
            and s.program_id = c_program and s.season_id = c_s12 and s.role = 'full_access') = 1;
  if v_n <> 4 then
    raise exception 'WP1A2 ABORT [POST_ADMIN_GRANTS]: only % of 4 real Admins hold exactly {S11 full_access active, S12 full_access active} and nothing else.', v_n;
  end if;

  -- ── Lieu's legacy row is retired, preserved, and grants nothing ───────────
  select count(*) into v_n
  from public.admin_scope_access s
  where s.id = '17a86485-c241-4cff-9bd5-60efe75b802a'::uuid
    and s.status = 'inactive' and s.season_id is null and s.program_id = c_program;
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [POST_LIEU_LEGACY]: the legacy program-wide row is not retired in place as history.';
  end if;

  -- ── No ACTIVE program-wide grant survives anywhere (that is WP1-A3) ───────
  select count(*) into v_n from public.admin_scope_access where status = 'active' and season_id is null;
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [POST_PROGRAM_WIDE]: % active program-wide grant(s) exist. The live RPC refuses them and A2 creates none.', v_n;
  end if;

  -- ── The controlled demo viewer, proved five ways ──────────────────────────
  select count(*) into v_n
  from public.admin_users u
  where lower(btrim(u.email)) = 'viewer.vam.test@redsquarevietnam.com'
    and u.role = 'viewer' and u.status = 'active';
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [POST_DEMO_ROLE]: the demo account is not viewer/active.';
  end if;

  select count(*) into v_n
  from public.admin_scope_access s
  join public.admin_users u on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = 'viewer.vam.test@redsquarevietnam.com' and s.status = 'active';
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [POST_DEMO_SCOPE]: the demo account holds % active grants; it must hold exactly one.', v_n;
  end if;

  select count(*) into v_n
  from public.admin_scope_access s
  join public.admin_users u on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = 'viewer.vam.test@redsquarevietnam.com'
    and s.status = 'active' and s.program_id = c_program and s.season_id = c_s12 and s.role = 'read';
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [POST_DEMO_SCOPE]: the demo account''s single active grant is not UEHM/S12 read.';
  end if;

  select count(*) into v_n
  from public.admin_scope_access s
  join public.admin_users u on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = 'viewer.vam.test@redsquarevietnam.com'
    and s.status = 'active' and s.season_id = c_s11;
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [POST_DEMO_S11]: the demo account retains % active Season 11 grant(s).', v_n;
  end if;

  select count(*) into v_n
  from public.admin_scope_access s
  join public.admin_users u on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = 'viewer.vam.test@redsquarevietnam.com'
    and s.status = 'active' and s.role in ('full_access','operations','review');
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [POST_DEMO_MUTATION]: the demo account retains % active mutation/review-capable grant(s).', v_n;
  end if;

  -- ── The historical identity is untouched authority-wise ──────────────────
  select count(*) into v_n
  from public.admin_users u
  where lower(btrim(u.email)) = 'admin.vam.test@redsquarevietnam.com' and u.role = 'admin' and u.status = 'inactive';
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [POST_HISTORICAL]: the historical admin test account is not admin/inactive.';
  end if;

  select count(*) into v_n
  from public.admin_scope_access s
  join public.admin_users u on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = 'admin.vam.test@redsquarevietnam.com' and s.status = 'active';
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [POST_HISTORICAL]: the historical admin test account holds % active grant(s); it must hold none.', v_n;
  end if;

  -- ── Every row satisfies the new constraints, and they are installed ──────
  select count(*) into v_n
  from public.admin_scope_access s
  where s.program_id is null
     or s.program_id !~* c_uuid_re
     or (s.season_id is not null and s.season_id !~* c_uuid_re)
     or s.role is null   or s.role   not in ('full_access','operations','review','read')
     or s.status is null or s.status not in ('active','inactive');
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [POST_CONSTRAINT_ROW]: % row(s) violate a planned constraint.', v_n;
  end if;

  select count(*) into v_n
  from pg_constraint c
  where c.conrelid = 'public.admin_scope_access'::regclass
    and c.contype = 'c'
    and c.conname in ('admin_scope_access_program_id_not_null','admin_scope_access_program_id_canonical_check',
                      'admin_scope_access_season_id_canonical_check','admin_scope_access_role_check',
                      'admin_scope_access_status_check')
    and c.convalidated;
  if v_n <> 5 then
    raise exception 'WP1A2 ABORT [POST_CONSTRAINTS]: % of 5 planned CHECK constraints are installed and validated.', v_n;
  end if;

  select count(*) into v_n
  from pg_index i
  join pg_class r on r.oid = i.indexrelid
  where i.indrelid = 'public.admin_scope_access'::regclass
    and r.relname = 'admin_scope_access_active_scope_key'
    and i.indisunique and i.indnullsnotdistinct and i.indpred is not null;
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [POST_INDEX]: the partial NULLS NOT DISTINCT active-scope unique index is not installed as specified.';
  end if;

  -- ── Zero duplicate active scope keys, level excluded from the key ────────
  select count(*) into v_n
  from (select user_id, program_id, coalesce(season_id, '<program-wide>') as season_key
        from public.admin_scope_access where status = 'active'
        group by 1, 2, 3 having count(*) > 1) d;
  if v_n <> 0 then
    raise exception 'WP1A2 ABORT [POST_ACTIVE_KEY_UNIQUE]: % duplicate active scope key(s).', v_n;
  end if;

  -- ── The audit trail exists, and carries Lieu's unrepresentable pre-image ──
  select count(*) into v_n
  from public.admin_audit_log
  where created_at >= transaction_timestamp()
    and action_type = 'update_admin_user'
    and before_data->>'source' = 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql';
  if v_n <> 6 then
    raise exception 'WP1A2 ABORT [POST_AUDIT]: expected 6 audit rows written by this transaction, found %.', v_n;
  end if;

  select count(*) into v_n
  from public.admin_audit_log a,
       lateral jsonb_array_elements(a.before_data->'scopes') as e
  where a.created_at >= transaction_timestamp()
    and a.before_data->>'source' = 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql'
    and e->>'id' = '17a86485-c241-4cff-9bd5-60efe75b802a'
    and e->>'role' = 'admin'
    and e->>'program_id' = 'UEHM'
    and e->>'status' = 'active'
    and e->>'season_id' is null;
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [POST_AUDIT]: the pre-image of the legacy program-wide row (UEHM / NULL / admin / active) was not recorded exactly once.';
  end if;

  -- ── The live RPC is byte-for-byte untouched by this package ──────────────
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_authorized_for_scope';
  if v_n <> 1 then
    raise exception 'WP1A2 ABORT [POST_RPC]: vam063_authorized_for_scope is not present exactly once. A2 must not touch it.';
  end if;

  raise notice 'WP1A2 postconditions PASS: 12 rows (9 active / 3 inactive), 4 Admins at S11+S12 full_access, demo viewer at UEHM/S12 read only, 3 historical rows retired, 6 constraints installed, 6 audit rows written, 0 deletions.';
end
$wp1a2_postconditions$;

-- A last read-only summary for the operator's record. Copy it into the runbook
-- alongside the preflight output before running verifier.sql.
select
  (select count(*) from public.admin_scope_access)                          as scope_rows,
  (select count(*) from public.admin_scope_access where status = 'active')  as active_grants,
  (select count(*) from public.admin_scope_access where status = 'inactive') as inactive_grants,
  (select count(*) from public.admin_scope_access
    where id in ('a2000001-0000-4a20-8a20-000000000001','a2000002-0000-4a20-8a20-000000000002',
                 'a2000003-0000-4a20-8a20-000000000003','a2000004-0000-4a20-8a20-000000000004',
                 'a2000005-0000-4a20-8a20-000000000005','a2000006-0000-4a20-8a20-000000000006')) as rows_created_by_a2,
  (select count(*) from public.admin_audit_log
    where created_at >= transaction_timestamp()
      and before_data->>'source' = 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql') as audit_rows_written,
  'RUN verifier.sql NEXT — A2_VERIFIED must be true'                        as next_step;

commit;
