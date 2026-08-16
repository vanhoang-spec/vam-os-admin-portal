-- =============================================================================
-- VAM OS — WP1-A2 STAFF SCOPE CONVERGENCE — EMERGENCY ROLLBACK
--
-- ONE TRANSACTION. A deliberate emergency reversal to the EXACT pre-A2 state
-- recorded by the final Production preflight of 16 Aug 2026.
--
-- THIS IS NOT A ROUTINE UNDO. Run it only when verifier.sql has returned
-- A2_VERIFIED = false and the owner has decided to reverse, per README §14.
-- If apply.sql aborted before COMMIT, nothing was written and NO rollback is
-- needed — running this file in that situation aborts at [NOT_APPLIED].
--
-- WHAT IT REFUSES TO DO
--   It reverses A2 and only A2. It aborts rather than act if it cannot prove
--   the database is still exactly the state A2 left behind:
--     * an extra or missing scope row  -> [ORGANIC_CHANGE]
--     * any of the 12 rows holding a value A2 did not write -> [ORGANIC_CHANGE]
--     * a platform role or account status that has moved since -> [ORGANIC_CHANGE]
--     * the A2 constraints already gone -> [NOT_APPLIED]
--   Later legitimate operational work is worth more than a clean reversal, so
--   the guard fails closed in every one of those cases. If it aborts, the state
--   must be reconciled by hand from the evidence, not forced by this file.
--
--   It deletes exactly six rows: the six A2 created, addressed by the exact ids
--   authored in apply.sql, each additionally guarded on the exact values A2
--   wrote. It never deletes a row it cannot prove A2 created. No inventoried
--   row is deleted in any branch.
--
--   It drops exactly six database objects: the five CHECK constraints and the
--   one unique index A2 added, by exact name. It touches no other constraint,
--   no index, no column type, no function, no RLS policy and no grant.
--
--   IT DOES NOT REMOVE THE AUDIT TRAIL. Nothing in the live audit contract
--   treats admin_audit_log rows as reversible: the application only ever
--   inserts and reads them, migration 062 revokes DELETE from `authenticated`,
--   and no code path anywhere deletes one. The A2 audit rows therefore stay,
--   and this file APPENDS its own rows recording the reversal. An audit trail
--   that can be rewound is not an audit trail.
--
-- RESTORED PRE-A2 STATE (6 rows: 5 active, 1 inactive)
--   68fe466c…  UEH shared Admin  "UEH Mentoring" / "UEHM-S11" / full_access / active
--   17a86485…  Lieu              "UEHM"          / NULL       / "admin"     / active
--   60ef3d0b…  Hoang             "VAM"           / "UEHM-S11" / operations  / active
--   1e58beb9…  Toan              "VAM"           / "UEHM-S11" / operations  / active
--   487a7562…  demo account      "VAM"           / "UEHM-S11" / operations  / active
--   eaa60d5c…  historical admin  "VAM"           / "UEHM-S11" / full_access / inactive
--   plus public.admin_users: viewer.vam.test  viewer -> reviewer (status untouched)
--
-- RESTORING "admin" IS A DELIBERATE RESTORATION OF A LEGACY VALUE. It is only
-- representable because the role CHECK is dropped first, in this same
-- transaction. Note what it re-creates: Lieu regains authority ONLY through the
-- base code's coercion of "admin" to `read`, so after a rollback WP1-A1 must
-- NOT be deployed — A1 drops that level at read time and would leave her with
-- nothing. That ordering constraint is the reason A2 exists.
-- =============================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '300s';

-- #############################################################################
-- STEP 1 — LOCKS AND ROLLBACK-ELIGIBILITY GUARDS
-- #############################################################################

do $wp1a2_rollback_preconditions$
declare
  c_program constant text := '61701ee8-64a6-4673-b261-ba12ce9a3ee3';
  c_s11     constant text := '710f4ec9-1cf7-461e-98d4-f33799047add';
  c_s12     constant text := '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1';

  c_src_ueh   constant uuid := '68fe466c-b37d-4812-baeb-eb5fe4ea24ec';
  c_src_lieu  constant uuid := '17a86485-c241-4cff-9bd5-60efe75b802a';
  c_src_hoang constant uuid := '60ef3d0b-8f41-4c76-aad7-dc91f26a470a';
  c_src_toan  constant uuid := '1e58beb9-b7ce-4392-ac81-429743f61534';
  c_src_demo  constant uuid := '487a7562-bb40-4c5c-9dc1-0fe363f1158a';
  c_src_hist  constant uuid := 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028';

  c_new_ueh_s12   constant uuid := 'a2000001-0000-4a20-8a20-000000000001';
  c_new_lieu_s11  constant uuid := 'a2000002-0000-4a20-8a20-000000000002';
  c_new_lieu_s12  constant uuid := 'a2000003-0000-4a20-8a20-000000000003';
  c_new_hoang_s12 constant uuid := 'a2000004-0000-4a20-8a20-000000000004';
  c_new_toan_s12  constant uuid := 'a2000005-0000-4a20-8a20-000000000005';
  c_new_demo_s12  constant uuid := 'a2000006-0000-4a20-8a20-000000000006';

  v_n   integer;
  v_txt text;
begin
  -- ── [NOT_APPLIED] there must be something to reverse ─────────────────────
  select count(*) into v_n
  from public.admin_scope_access
  where id in (c_new_ueh_s12, c_new_lieu_s11, c_new_lieu_s12, c_new_hoang_s12, c_new_toan_s12, c_new_demo_s12);
  if v_n = 0 then
    raise exception 'WP1A2 ROLLBACK ABORT [NOT_APPLIED]: none of the 6 rows apply.sql creates exist. Either the apply aborted before COMMIT — in which case nothing was written and no rollback is needed — or this database was already rolled back.';
  end if;
  if v_n <> 6 then
    raise exception 'WP1A2 ROLLBACK ABORT [ORGANIC_CHANGE]: only % of the 6 A2-created rows exist. Some were removed by something other than this file, and a partial reversal is not a reversal. Reconcile by hand from the evidence.', v_n;
  end if;

  select count(*) into v_n
  from pg_constraint c
  where c.conrelid = 'public.admin_scope_access'::regclass and c.contype = 'c'
    and c.conname in ('admin_scope_access_program_id_not_null','admin_scope_access_program_id_canonical_check',
                      'admin_scope_access_season_id_canonical_check','admin_scope_access_role_check',
                      'admin_scope_access_status_check');
  if v_n <> 5 then
    raise exception 'WP1A2 ROLLBACK ABORT [NOT_APPLIED]: % of the 5 A2 CHECK constraints are present. This file drops exactly the objects A2 added, by name, and will not guess at a partial installation.', v_n;
  end if;

  select count(*) into v_n
  from pg_class r join pg_index i on i.indexrelid = r.oid
  where r.relname = 'admin_scope_access_active_scope_key' and i.indrelid = 'public.admin_scope_access'::regclass;
  if v_n <> 1 then
    raise exception 'WP1A2 ROLLBACK ABORT [NOT_APPLIED]: the A2 active-scope unique index is not present.';
  end if;

  -- ── LOCK all twelve scope rows and all six accounts ──────────────────────
  perform 1 from public.admin_scope_access
  where id in (c_src_ueh, c_src_lieu, c_src_hoang, c_src_toan, c_src_demo, c_src_hist,
               c_new_ueh_s12, c_new_lieu_s11, c_new_lieu_s12, c_new_hoang_s12, c_new_toan_s12, c_new_demo_s12)
  for update;

  perform 1 from public.admin_users
  where lower(btrim(email)) in (
    'uehmentoring@gmail.com','lieu.nguyen@hoatay.com.vn','hoang.nguyen@embassy.edu.vn',
    'lyductoan@gmail.com','viewer.vam.test@redsquarevietnam.com','admin.vam.test@redsquarevietnam.com')
  for update;

  -- ── [ORGANIC_CHANGE] the table is still exactly what A2 left ─────────────
  -- A thirteenth row means someone did legitimate work after the convergence.
  -- Reversing under it would either destroy that work or leave it stranded on a
  -- schema that no longer exists, so the run stops instead.
  select count(*) into v_n from public.admin_scope_access;
  if v_n <> 12 then
    raise exception 'WP1A2 ROLLBACK ABORT [ORGANIC_CHANGE]: the table holds % rows, not the 12 A2 left. Later operational change is not reversible by this file and must not be destroyed by it.', v_n;
  end if;

  select count(*) into v_n
  from public.admin_scope_access s
  where s.id not in (c_src_ueh, c_src_lieu, c_src_hoang, c_src_toan, c_src_demo, c_src_hist,
                     c_new_ueh_s12, c_new_lieu_s11, c_new_lieu_s12, c_new_hoang_s12, c_new_toan_s12, c_new_demo_s12);
  if v_n <> 0 then
    raise exception 'WP1A2 ROLLBACK ABORT [ORGANIC_CHANGE]: % row(s) exist that neither the owner inventory nor A2 accounts for.', v_n;
  end if;

  -- ── [ORGANIC_CHANGE] every one of the twelve still holds what A2 wrote ───
  select count(*) into v_n
  from (values
    (c_src_ueh,       c_program, c_s11, 'full_access'::text, 'active'::text),
    (c_src_lieu,      c_program, null,  'full_access',       'inactive'),
    (c_src_hoang,     c_program, c_s11, 'full_access',       'active'),
    (c_src_toan,      c_program, c_s11, 'full_access',       'active'),
    (c_src_demo,      c_program, c_s11, 'operations',        'inactive'),
    (c_src_hist,      c_program, c_s11, 'full_access',       'inactive'),
    (c_new_ueh_s12,   c_program, c_s12, 'full_access',       'active'),
    (c_new_lieu_s11,  c_program, c_s11, 'full_access',       'active'),
    (c_new_lieu_s12,  c_program, c_s12, 'full_access',       'active'),
    (c_new_hoang_s12, c_program, c_s12, 'full_access',       'active'),
    (c_new_toan_s12,  c_program, c_s12, 'full_access',       'active'),
    (c_new_demo_s12,  c_program, c_s12, 'read',              'active')
  ) as w(id, program_id, season_id, scope_role, scope_status)
  join public.admin_scope_access s on s.id = w.id
  where s.program_id is not distinct from w.program_id
    and s.season_id  is not distinct from w.season_id
    and s.role       is not distinct from w.scope_role
    and s.status     is not distinct from w.scope_status;
  if v_n <> 12 then
    raise exception 'WP1A2 ROLLBACK ABORT [ORGANIC_CHANGE]: only % of 12 rows still hold exactly the values A2 wrote. A row edited since the convergence cannot be reversed to a pre-image this file did not record.', v_n;
  end if;

  -- ── [ORGANIC_CHANGE] the six accounts are still in their post-A2 state ───
  select count(*) into v_n
  from (values
    ('uehmentoring@gmail.com'::text,               'admin'::text,   'active'::text),
    ('lieu.nguyen@hoatay.com.vn',                  'admin',         'active'),
    ('hoang.nguyen@embassy.edu.vn',                'admin',         'active'),
    ('lyductoan@gmail.com',                        'admin',         'active'),
    ('viewer.vam.test@redsquarevietnam.com',       'viewer',        'active'),
    ('admin.vam.test@redsquarevietnam.com',        'admin',         'inactive')
  ) as w(email, account_role, account_status)
  join public.admin_users u on lower(btrim(u.email)) = w.email
  where u.role = w.account_role and u.status = w.account_status and u.auth_user_id is not null;
  if v_n <> 6 then
    raise exception 'WP1A2 ROLLBACK ABORT [ORGANIC_CHANGE]: only % of 6 accounts are still in the exact state A2 left them in. The one platform-role change this file reverses (viewer -> reviewer) applies to no other state.', v_n;
  end if;

  -- ── [ORGANIC_CHANGE] every row still belongs to the account that owns it ─
  select count(*) into v_n
  from (values
    (c_src_ueh, 'uehmentoring@gmail.com'::text),        (c_new_ueh_s12,   'uehmentoring@gmail.com'),
    (c_src_lieu, 'lieu.nguyen@hoatay.com.vn'),          (c_new_lieu_s11,  'lieu.nguyen@hoatay.com.vn'),
    (c_new_lieu_s12, 'lieu.nguyen@hoatay.com.vn'),
    (c_src_hoang, 'hoang.nguyen@embassy.edu.vn'),       (c_new_hoang_s12, 'hoang.nguyen@embassy.edu.vn'),
    (c_src_toan, 'lyductoan@gmail.com'),                (c_new_toan_s12,  'lyductoan@gmail.com'),
    (c_src_demo, 'viewer.vam.test@redsquarevietnam.com'), (c_new_demo_s12, 'viewer.vam.test@redsquarevietnam.com'),
    (c_src_hist, 'admin.vam.test@redsquarevietnam.com')
  ) as w(id, email)
  join public.admin_scope_access s on s.id = w.id
  join public.admin_users u        on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = w.email;
  if v_n <> 12 then
    raise exception 'WP1A2 ROLLBACK ABORT [ORGANIC_CHANGE]: only % of 12 rows still belong to the account A2 wrote them for.', v_n;
  end if;

  -- ── The A2 audit rows must still be there; this file adds to them ────────
  if to_regclass('public.admin_audit_log') is null then
    raise exception 'WP1A2 ROLLBACK ABORT [AUDIT_CONTRACT]: public.admin_audit_log does not exist; a reversal of live authority will not be performed unrecorded.';
  end if;

  select count(*) into v_n
  from public.admin_audit_log
  where before_data->>'source' = 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql';
  if v_n <> 6 then
    raise exception 'WP1A2 ROLLBACK ABORT [AUDIT_CONTRACT]: expected the 6 audit rows apply.sql wrote, found %. The audit trail is the only surviving record of the legacy scope level "admin", and this file restores that value from it.', v_n;
  end if;

  select pg_get_constraintdef(c.oid) into v_txt
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%'
  limit 1;
  if v_txt is not null and v_txt not ilike '%update_admin_user%' then
    raise exception 'WP1A2 ROLLBACK ABORT [AUDIT_CONTRACT]: the live action_type CHECK does not admit ''update_admin_user'' (%).', v_txt;
  end if;

  raise notice 'WP1A2 rollback guards PASS: 12 rows locked and exactly as A2 left them, 6 accounts unchanged since, A2 constraints present, A2 audit trail intact.';
end
$wp1a2_rollback_preconditions$;

-- #############################################################################
-- STEP 2 — AUDIT THE REVERSAL, BEFORE ANY ROW IS TOUCHED
--
-- Same mechanism, same vocabulary, same shape as apply.sql. before_data is the
-- live post-A2 state; after_data is the pre-A2 state being restored. STEP 6
-- aborts the transaction unless the committed result equals it.
-- #############################################################################

insert into public.admin_audit_log (actor_admin_user_id, action_type, target_admin_user_id, before_data, after_data)
select
  null::uuid,
  'update_admin_user',
  u.id,
  jsonb_build_object(
    'source', 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/rollback.sql',
    'work_package', 'WP1-A2',
    'event', 'emergency_rollback_of_wp1a2_convergence',
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
  ('uehmentoring@gmail.com'::text, jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/rollback.sql","work_package":"WP1-A2","event":"emergency_rollback_of_wp1a2_convergence",
     "user":{"role":"admin","status":"active","platform_role_change":"none"},
     "scopes":[
       {"id":"68fe466c-b37d-4812-baeb-eb5fe4ea24ec","action":"RESTORE_IN_PLACE","program_id":"UEH Mentoring","season_id":"UEHM-S11","role":"full_access","status":"active"},
       {"id":"a2000001-0000-4a20-8a20-000000000001","action":"DELETE_A2_CREATED_ROW"}]}'),

  ('lieu.nguyen@hoatay.com.vn', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/rollback.sql","work_package":"WP1-A2","event":"emergency_rollback_of_wp1a2_convergence",
     "user":{"role":"admin","status":"active","platform_role_change":"none"},
     "restores_legacy_value":{"scope_id":"17a86485-c241-4cff-9bd5-60efe75b802a","field":"role","from":"full_access","to":"admin",
       "why":"the pre-A2 truth recorded in the apply audit row; representable again only because the role CHECK is dropped in this same transaction",
       "consequence":"authority returns solely through the base code coercion of admin to read, so WP1-A1 must NOT be deployed after a rollback"},
     "scopes":[
       {"id":"17a86485-c241-4cff-9bd5-60efe75b802a","action":"RESTORE_IN_PLACE","program_id":"UEHM","season_id":null,"role":"admin","status":"active"},
       {"id":"a2000002-0000-4a20-8a20-000000000002","action":"DELETE_A2_CREATED_ROW"},
       {"id":"a2000003-0000-4a20-8a20-000000000003","action":"DELETE_A2_CREATED_ROW"}]}'),

  ('hoang.nguyen@embassy.edu.vn', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/rollback.sql","work_package":"WP1-A2","event":"emergency_rollback_of_wp1a2_convergence",
     "user":{"role":"admin","status":"active","platform_role_change":"none"},
     "scopes":[
       {"id":"60ef3d0b-8f41-4c76-aad7-dc91f26a470a","action":"RESTORE_IN_PLACE","program_id":"VAM","season_id":"UEHM-S11","role":"operations","status":"active"},
       {"id":"a2000004-0000-4a20-8a20-000000000004","action":"DELETE_A2_CREATED_ROW"}]}'),

  ('lyductoan@gmail.com', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/rollback.sql","work_package":"WP1-A2","event":"emergency_rollback_of_wp1a2_convergence",
     "user":{"role":"admin","status":"active","platform_role_change":"none"},
     "scopes":[
       {"id":"1e58beb9-b7ce-4392-ac81-429743f61534","action":"RESTORE_IN_PLACE","program_id":"VAM","season_id":"UEHM-S11","role":"operations","status":"active"},
       {"id":"a2000005-0000-4a20-8a20-000000000005","action":"DELETE_A2_CREATED_ROW"}]}'),

  -- Reversing the demo account restores REVIEWER authority to a shared login.
  -- The reviewer PII gap on /matches is open, so the credentials must not be in
  -- anyone's hands when this runs.
  ('viewer.vam.test@redsquarevietnam.com', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/rollback.sql","work_package":"WP1-A2","event":"emergency_rollback_of_wp1a2_convergence",
     "user":{"role":"reviewer","status":"active","platform_role_change":"viewer_to_reviewer"},
     "warning":"restores reviewer platform role and active S11 operations scope to a SHARED credential while the reviewer PII gap on /matches is still open",
     "scopes":[
       {"id":"487a7562-bb40-4c5c-9dc1-0fe363f1158a","action":"RESTORE_IN_PLACE","program_id":"VAM","season_id":"UEHM-S11","role":"operations","status":"active"},
       {"id":"a2000006-0000-4a20-8a20-000000000006","action":"DELETE_A2_CREATED_ROW"}]}'),

  ('admin.vam.test@redsquarevietnam.com', jsonb '{
     "source":"VAM_OS_WP1A_CANONICAL_SCOPE_20260816/rollback.sql","work_package":"WP1-A2","event":"emergency_rollback_of_wp1a2_convergence",
     "user":{"role":"admin","status":"inactive","platform_role_change":"none"},
     "scopes":[
       {"id":"eaa60d5c-66eb-4ef8-a8c0-0db0bc701028","action":"RESTORE_IN_PLACE","program_id":"VAM","season_id":"UEHM-S11","role":"full_access","status":"inactive"}]}')
) as p(email, after_data)
join public.admin_users u on lower(btrim(u.email)) = p.email;

-- #############################################################################
-- STEP 3 — DROP EXACTLY THE SIX OBJECTS A2 ADDED
--
-- First, because the restored pre-A2 values are deliberately non-canonical:
-- "UEH Mentoring" and "VAM" are not UUID strings and "admin" is not a canonical
-- scope level. Without dropping these, STEP 5 would fail.
--
-- Named exactly. No IF EXISTS: STEP 1 has already proved all six are present,
-- and an IF EXISTS here would silently tolerate a state this file refuses.
-- #############################################################################

drop index public.admin_scope_access_active_scope_key;

alter table public.admin_scope_access drop constraint admin_scope_access_status_check;
alter table public.admin_scope_access drop constraint admin_scope_access_role_check;
alter table public.admin_scope_access drop constraint admin_scope_access_season_id_canonical_check;
alter table public.admin_scope_access drop constraint admin_scope_access_program_id_canonical_check;
alter table public.admin_scope_access drop constraint admin_scope_access_program_id_not_null;

-- #############################################################################
-- STEP 4 — REMOVE ONLY THE SIX ROWS A2 CREATED
--
-- The only DELETE in the entire package. Addressed by the exact ids authored in
-- apply.sql AND guarded on the exact values A2 wrote, so a row that has been
-- edited since is not silently destroyed — it fails the guard, the delete
-- affects fewer rows than expected, and STEP 6 aborts the transaction.
--
-- No inventoried row is deleted here or anywhere. Those are restored in place.
-- #############################################################################

delete from public.admin_scope_access s
using (values
  ('a2000001-0000-4a20-8a20-000000000001'::uuid, '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::text, 'full_access'::text),
  ('a2000002-0000-4a20-8a20-000000000002', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access'),
  ('a2000003-0000-4a20-8a20-000000000003', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access'),
  ('a2000004-0000-4a20-8a20-000000000004', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access'),
  ('a2000005-0000-4a20-8a20-000000000005', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access'),
  ('a2000006-0000-4a20-8a20-000000000006', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'read')
) as g(id, season_id, scope_role)
where s.id = g.id
  and s.program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3'
  and s.season_id  = g.season_id
  and s.role       = g.scope_role
  and s.status     = 'active';

-- #############################################################################
-- STEP 5 — RESTORE THE SIX INVENTORIED ROWS IN PLACE
--
-- Exact primary key, plus the exact post-A2 values in the WHERE clause, so each
-- statement can only ever reverse the row A2 actually wrote. id and created_at
-- are never assigned and survive both directions of the round trip.
-- #############################################################################

-- 5.1 UEH shared Admin: back to the program NAME and season CODE it stored.
update public.admin_scope_access
   set program_id = 'UEH Mentoring',
       season_id  = 'UEHM-S11',
       role       = 'full_access',
       status     = 'active'
 where id = '68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid
   and program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3'
   and season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add'
   and role = 'full_access' and status = 'active';

-- 5.2 Lieu: back to the ACTIVE program-wide legacy row, including the legacy
--     scope level "admin". Representable only because STEP 3 dropped the role
--     CHECK. This is the value the apply audit row preserved.
update public.admin_scope_access
   set program_id = 'UEHM',
       season_id  = null,
       role       = 'admin',
       status     = 'active'
 where id = '17a86485-c241-4cff-9bd5-60efe75b802a'::uuid
   and program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3'
   and season_id is null
   and role = 'full_access' and status = 'inactive';

-- 5.3 Hoang: back to "VAM" / "UEHM-S11" / operations / active.
update public.admin_scope_access
   set program_id = 'VAM',
       season_id  = 'UEHM-S11',
       role       = 'operations',
       status     = 'active'
 where id = '60ef3d0b-8f41-4c76-aad7-dc91f26a470a'::uuid
   and program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3'
   and season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add'
   and role = 'full_access' and status = 'active';

-- 5.4 Toan: identical shape.
update public.admin_scope_access
   set program_id = 'VAM',
       season_id  = 'UEHM-S11',
       role       = 'operations',
       status     = 'active'
 where id = '1e58beb9-b7ce-4392-ac81-429743f61534'::uuid
   and program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3'
   and season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add'
   and role = 'full_access' and status = 'active';

-- 5.5 Demo account: its S11 operations grant becomes ACTIVE again.
update public.admin_scope_access
   set program_id = 'VAM',
       season_id  = 'UEHM-S11',
       role       = 'operations',
       status     = 'active'
 where id = '487a7562-bb40-4c5c-9dc1-0fe363f1158a'::uuid
   and program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3'
   and season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add'
   and role = 'operations' and status = 'inactive';

-- 5.6 Historical inactive admin test: identifiers only, still inactive in both
--     directions. Its status is never written to anything but 'inactive'.
update public.admin_scope_access
   set program_id = 'VAM',
       season_id  = 'UEHM-S11',
       role       = 'full_access',
       status     = 'inactive'
 where id = 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028'::uuid
   and program_id = '61701ee8-64a6-4673-b261-ba12ce9a3ee3'
   and season_id  = '710f4ec9-1cf7-461e-98d4-f33799047add'
   and role = 'full_access' and status = 'inactive';

-- 5.7 The demo account's platform role, back to reviewer. `status` is again
--     absent from the SET list: A2 never changed it and neither does this.
update public.admin_users
   set role = 'reviewer'
 where lower(btrim(email)) = 'viewer.vam.test@redsquarevietnam.com'
   and role = 'viewer' and status = 'active';

-- #############################################################################
-- STEP 6 — POSTCONDITIONS: THE EXACT PRE-A2 STATE
-- #############################################################################

do $wp1a2_rollback_postconditions$
declare
  v_n integer;
begin
  select count(*) into v_n from public.admin_scope_access;
  if v_n <> 6 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_ROWCOUNT]: expected the 6 inventoried rows, found %.', v_n;
  end if;

  select count(*) into v_n from public.admin_scope_access where status = 'active';
  if v_n <> 5 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_ACTIVE]: expected 5 active grants in the pre-A2 baseline, found %.', v_n;
  end if;

  -- The six rows, field for field, exactly as the owner inventoried them.
  select count(*) into v_n
  from (values
    ('68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid, 'uehmentoring@gmail.com'::text,          'UEH Mentoring'::text, 'UEHM-S11'::text, 'full_access'::text, 'active'::text),
    ('17a86485-c241-4cff-9bd5-60efe75b802a',       'lieu.nguyen@hoatay.com.vn',             'UEHM',                null,             'admin',             'active'),
    ('60ef3d0b-8f41-4c76-aad7-dc91f26a470a',       'hoang.nguyen@embassy.edu.vn',           'VAM',                 'UEHM-S11',       'operations',        'active'),
    ('1e58beb9-b7ce-4392-ac81-429743f61534',       'lyductoan@gmail.com',                   'VAM',                 'UEHM-S11',       'operations',        'active'),
    ('487a7562-bb40-4c5c-9dc1-0fe363f1158a',       'viewer.vam.test@redsquarevietnam.com',  'VAM',                 'UEHM-S11',       'operations',        'active'),
    ('eaa60d5c-66eb-4ef8-a8c0-0db0bc701028',       'admin.vam.test@redsquarevietnam.com',   'VAM',                 'UEHM-S11',       'full_access',       'inactive')
  ) as w(id, email, program_id, season_id, scope_role, scope_status)
  join public.admin_scope_access s on s.id = w.id
  join public.admin_users u        on u.auth_user_id = s.user_id
  where lower(btrim(u.email)) = w.email
    and s.program_id is not distinct from w.program_id
    and s.season_id  is not distinct from w.season_id
    and s.role       is not distinct from w.scope_role
    and s.status     is not distinct from w.scope_status;
  if v_n <> 6 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_BASELINE]: only % of 6 rows were restored to their exact pre-A2 values, owned by their original account.', v_n;
  end if;

  -- The six A2-created rows are gone, and nothing else was removed.
  select count(*) into v_n
  from public.admin_scope_access
  where id in ('a2000001-0000-4a20-8a20-000000000001'::uuid, 'a2000002-0000-4a20-8a20-000000000002',
               'a2000003-0000-4a20-8a20-000000000003', 'a2000004-0000-4a20-8a20-000000000004',
               'a2000005-0000-4a20-8a20-000000000005', 'a2000006-0000-4a20-8a20-000000000006');
  if v_n <> 0 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_CREATED]: % A2-created row(s) survive.', v_n;
  end if;

  -- The platform roles are back where they were.
  select count(*) into v_n
  from (values
    ('uehmentoring@gmail.com'::text,               'admin'::text,    'active'::text),
    ('lieu.nguyen@hoatay.com.vn',                  'admin',          'active'),
    ('hoang.nguyen@embassy.edu.vn',                'admin',          'active'),
    ('lyductoan@gmail.com',                        'admin',          'active'),
    ('viewer.vam.test@redsquarevietnam.com',       'reviewer',       'active'),
    ('admin.vam.test@redsquarevietnam.com',        'admin',          'inactive')
  ) as w(email, account_role, account_status)
  join public.admin_users u on lower(btrim(u.email)) = w.email
  where u.role = w.account_role and u.status = w.account_status;
  if v_n <> 6 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_ACCOUNTS]: only % of 6 accounts hold their exact pre-A2 platform role and status.', v_n;
  end if;

  -- Every A2 database object is gone, and no other constraint was collateral.
  select count(*) into v_n
  from pg_constraint c
  where c.conrelid = 'public.admin_scope_access'::regclass
    and c.conname in ('admin_scope_access_program_id_not_null','admin_scope_access_program_id_canonical_check',
                      'admin_scope_access_season_id_canonical_check','admin_scope_access_role_check',
                      'admin_scope_access_status_check');
  if v_n <> 0 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_CONSTRAINTS]: % A2 constraint(s) survive.', v_n;
  end if;

  select count(*) into v_n
  from pg_class r join pg_index i on i.indexrelid = r.oid
  where r.relname = 'admin_scope_access_active_scope_key' and i.indrelid = 'public.admin_scope_access'::regclass;
  if v_n <> 0 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_INDEX]: the A2 active-scope unique index survives.';
  end if;

  select count(*) into v_n
  from pg_constraint c
  where c.conrelid = 'public.admin_scope_access'::regclass and c.contype = 'p';
  if v_n <> 1 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_PRIMARY_KEY]: the table''s primary key is not intact (found % pk constraints). This file drops only the six objects A2 added.', v_n;
  end if;

  -- THE AUDIT TRAIL IS RETAINED. The apply's rows are still there, untouched,
  -- and this reversal appended its own.
  select count(*) into v_n
  from public.admin_audit_log
  where before_data->>'source' = 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/apply.sql';
  if v_n <> 6 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_AUDIT]: the 6 apply audit rows are no longer intact (found %). This package never deletes an audit row.', v_n;
  end if;

  select count(*) into v_n
  from public.admin_audit_log
  where created_at >= transaction_timestamp()
    and before_data->>'source' = 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/rollback.sql';
  if v_n <> 6 then
    raise exception 'WP1A2 ROLLBACK ABORT [POST_AUDIT]: expected 6 rollback audit rows written by this transaction, found %.', v_n;
  end if;

  raise notice 'WP1A2 rollback postconditions PASS: exact pre-A2 baseline restored (6 rows, 5 active / 1 inactive), 6 A2-created rows removed, 6 A2 objects dropped, audit trail retained and extended. Do NOT deploy WP1-A1 in this state.';
end
$wp1a2_rollback_postconditions$;

select
  (select count(*) from public.admin_scope_access)                           as scope_rows,
  (select count(*) from public.admin_scope_access where status = 'active')   as active_grants,
  (select count(*) from public.admin_audit_log
    where before_data->>'source' like 'VAM_OS_WP1A_CANONICAL_SCOPE_20260816/%') as audit_rows_retained,
  'RE-RUN preflight_v2.sql to confirm the pre-A2 baseline; DO NOT deploy WP1-A1' as next_step;

commit;
