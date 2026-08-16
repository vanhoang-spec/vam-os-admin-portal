-- =============================================================================
-- VAM OS — WP1-A2 STAFF SCOPE CONVERGENCE — PREFLIGHT V2
--
-- READ-ONLY. No INSERT, UPDATE, DELETE, MERGE, TRUNCATE, COPY, DDL, GRANT or
-- function definition. The executable body is SELECT statements only, and each
-- of the three blocks runs inside `begin; set transaction read only; ... rollback;`
-- so the session refuses a write with SQLSTATE 25006 even if this file is ever
-- edited carelessly. No function is INVOKED either: BLOCK 3 reads the source of
-- vam063_authorized_for_scope from the catalog, it never calls it.
--
-- Target : PRODUCTION (vam-os-admin-portal).
-- Run    : as the owner, before any WP1-A2 migration is authored or applied.
--          Blocks are independent. Run them separately if the SQL client returns
--          only the last result set, which most do.
-- Session: `set timezone = 'UTC';` first.
--
-- WHAT CHANGED FROM preflight.sql (V1), AND WHY V1 IS KEPT
--
--   V1 was written when the known convergence was one row: the UEH shared Admin
--   grant. It classifies every row by RESOLVING ITS STORED STRINGS through the
--   catalog — "UEHM-S11" resolves to the S11 uuid, "UEH Mentoring" resolves to
--   the UEHM uuid — and a row converts if its strings resolve unambiguously.
--
--   That model cannot express the owner-approved staff manifest, because the
--   manifest is not a function of the stored strings. THREE active rows store
--   the program identity "VAM". Two of them (Hoang, Toan) converge to UEHM
--   Season 11 full_access because the owner named those exact scope_ids. The
--   third (a synthetic reviewer test account) converges to NOTHING, and blocks
--   the migration until the owner disposes of it. A rule keyed on the string
--   "VAM" would convert all three and would silently grant a synthetic account
--   real authority in Production.
--
--   V2 is therefore MANIFEST-DRIVEN, not string-driven. Every conversion is
--   keyed on an exact (scope_id, email) pair from staff_scope_manifest_v2.json,
--   which is reproduced verbatim in the `manifest` CTE of each block. A row the
--   manifest does not name is never converted by anything in this package; it is
--   reported as an unknown row and it fails the run.
--
--   V1 is preserved unchanged. It is the evidence baseline that established the
--   table's shape, its lack of constraints, and the UEH Admin conversion. V2
--   does not supersede those findings, it extends them to the full staff set.
--
-- WHAT THIS DOES NOT DO
--   * It does not apply, author, or imply any migration. There is no apply.sql,
--     verifier.sql or rollback.sql in this package, deliberately.
--   * It does not create a program-wide (season_id IS NULL) grant. That is
--     WP1-A3 and requires a change to vam063_authorized_for_scope.
--   * It does not modify vam063_authorized_for_scope or any other function.
--   * It does not change any platform role on admin_users. All four staff
--     accounts stay `admin` by explicit owner decision.
--   * It does not dispose of the synthetic reviewer test row. It refuses to
--     proceed while that row is undisposed, which is a different thing.
--
-- PRIVACY
--   The six email addresses below are the owner-supplied manifest keys and are
--   already recorded in staff_scope_manifest_v2.json; the manifest cannot be
--   proven against Production without them. Nothing else about any person is
--   emitted: no full name, no phone, no membership data. Rows outside the
--   manifest are reported by admin_scope_access.id and counts only.
--
-- REFUSAL VOCABULARY (a FAIL on any of these means SAFE_TO_APPLY_V2 = false)
--   [SHAPE]                  admin_scope_access is not the shape A2 assumes
--   [PGVERSION]              server predates the NULLS NOT DISTINCT unique index
--   [NAME_COLLISION]         a planned constraint/index name is already taken
--   [UNKNOWN_ROW]            a row exists that the manifest does not account for
--   [STAFF_IDENTITY]         an account does not resolve to exactly one usable row
--   [STAFF_LINKAGE]          a scope row does not belong to its manifest account
--   [SOURCE_ROW]             a manifest scope_id is missing from Production
--   [SOURCE_DRIFT]           a stored value no longer matches the owner inventory
--   [PROGRAM] [SEASON_S11] [SEASON_S12]   catalog identity is not exact
--   [TARGET_COLLISION]       a canonical target key already exists more than once
--   [TARGET_DUPLICATE]       two manifest sources land on one active target key
--   [ACTIVE_KEY_UNIQUE]      the post-plan table would violate active uniqueness
--   [LIEU_LEGACY]            the program-wide legacy row is not in its known shape,
--                            or the plan would leave an active program-wide row
--   [VAM_LEGACY]             an unmanaged active row carries a legacy identity
--   [SYNTHETIC_DISPOSITION]  the active synthetic row has no owner disposition
--   [HISTORICAL_INACTIVE]    a historical row or account is not inactive
--   [NO_REACTIVATION]        the plan would activate something inactive
--   [CONSTRAINT_ROW]         a row of ANY status would violate a planned constraint
--   [RPC_COMPAT]             the live RPC would not accept the planned targets
--
-- THE ONE OWNER SWITCH IN THIS FILE
--   `synthetic_disposition_authorized` in BLOCK 3 is false. While it is false,
--   [SYNTHETIC_DISPOSITION] fails and SAFE_TO_APPLY_V2 is false. That is the
--   intended outcome of this run. Flipping it is not sufficient on its own — see
--   the note on that check — and it is an explicit owner act, never a side
--   effect of running this file.
-- =============================================================================


-- #############################################################################
-- BLOCK 1 — EXACT STAFF IDENTITY AND EXACT SOURCE ROWS
--
-- Proves requirement A (staff identity) and requirement B (current scope rows)
-- of the WP1-A2 preflight contract, one manifest entry per output row.
--
-- Identification is EXACT in both directions: the account is found by email and
-- must resolve to exactly one admin_users row, and the scope row is found by
-- primary key and every one of its stored values is compared to the owner
-- inventory. There is no fuzzy matching anywhere in this block. A stored value
-- that has changed since the inventory was taken is DRIFT, and drift fails the
-- run rather than being absorbed — the manifest would be describing a row that
-- no longer exists as described.
-- #############################################################################

begin;
set transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

with
-- The owner-approved manifest, verbatim from staff_scope_manifest_v2.json.
-- Labels are ASCII here so the report is legible under any client encoding; the
-- accented names live in the JSON manifest and the README.
manifest(manifest_key, email, label, want_platform_role, want_account_status,
         want_auth_user_id, scope_id, cur_program, cur_season, cur_level,
         cur_status, classification) as (
  values
    ('ueh_shared_admin'::text, 'uehmentoring@gmail.com'::text, 'UEH shared Admin'::text,
     'admin'::text, 'active'::text, '0cbe980a-6027-4645-828d-d994a1a38869'::text,
     '68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid,
     'UEH Mentoring'::text, 'UEHM-S11'::text, 'full_access'::text, 'active'::text,
     'KEEP_CONVERT_S11'::text),

    ('lieu', 'lieu.nguyen@hoatay.com.vn', 'Lieu',
     'admin', 'active', null,
     '17a86485-c241-4cff-9bd5-60efe75b802a',
     'UEHM', null, 'admin', 'active',
     'RETIRE_LEGACY_PROGRAM_WIDE'),

    ('hoang', 'hoang.nguyen@embassy.edu.vn', 'Hoang',
     'admin', 'active', null,
     '60ef3d0b-8f41-4c76-aad7-dc91f26a470a',
     'VAM', 'UEHM-S11', 'operations', 'active',
     'KEEP_CONVERT_S11'),

    ('toan', 'lyductoan@gmail.com', 'Ly Duc Toan',
     'admin', 'active', null,
     '1e58beb9-b7ce-4392-ac81-429743f61534',
     'VAM', 'UEHM-S11', 'operations', 'active',
     'KEEP_CONVERT_S11'),

    ('synthetic_viewer_test', 'viewer.vam.test@redsquarevietnam.com', 'VAM viewer test (synthetic)',
     'reviewer', 'active', null,
     '487a7562-bb40-4c5c-9dc1-0fe363f1158a',
     'VAM', 'UEHM-S11', 'operations', 'active',
     'SYNTHETIC_REQUIRES_OWNER_DECISION'),

    ('historical_admin_test', 'admin.vam.test@redsquarevietnam.com', 'VAM admin test (historical)',
     'admin', 'inactive', null,
     'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028',
     'VAM', 'UEHM-S11', 'full_access', 'inactive',
     'HISTORICAL_CANONICALIZE_ONLY')
),
-- Account resolution by email. min() is safe only because a row_count other
-- than 1 is itself reported and fails the run.
accounts as (
  select
    m.manifest_key,
    (select count(*)                from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as account_rows,
    (select min(a.id::text)         from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as admin_user_id,
    (select min(a.auth_user_id::text) from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as auth_user_id,
    (select min(a.role)             from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as account_role,
    (select min(a.status)           from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as account_status
  from manifest m
),
-- Scope row resolution by PRIMARY KEY. At most one row can match, which is the
-- point: the manifest addresses rows, not patterns.
source_rows as (
  select
    m.manifest_key,
    (select count(*)   from public.admin_scope_access s where s.id = m.scope_id) as scope_rows,
    (select s.user_id::text from public.admin_scope_access s where s.id = m.scope_id) as row_user_id,
    (select s.program_id    from public.admin_scope_access s where s.id = m.scope_id) as got_program,
    (select s.season_id     from public.admin_scope_access s where s.id = m.scope_id) as got_season,
    (select s.role          from public.admin_scope_access s where s.id = m.scope_id) as got_level,
    (select s.status        from public.admin_scope_access s where s.id = m.scope_id) as got_status
  from manifest m
),
compared as (
  select
    m.manifest_key,
    m.label,
    m.email,
    m.classification,
    m.scope_id,
    a.account_rows,
    a.admin_user_id,
    a.auth_user_id,
    a.account_role,
    a.account_status,
    m.want_platform_role,
    m.want_account_status,
    m.want_auth_user_id,
    sr.scope_rows,
    sr.row_user_id,
    sr.got_program, m.cur_program,
    sr.got_season,  m.cur_season,
    sr.got_level,   m.cur_level,
    sr.got_status,  m.cur_status,
    -- Per-field verdict. WHITESPACE_DRIFT is still drift and still fails; it is
    -- named separately only so the owner is not left comparing two strings that
    -- look identical in a terminal.
    case when sr.got_program is not distinct from m.cur_program then 'MATCH'
         when btrim(coalesce(sr.got_program, '')) = btrim(coalesce(m.cur_program, '')) then 'WHITESPACE_DRIFT'
         else 'DRIFT' end as program_state,
    case when sr.got_season is not distinct from m.cur_season then 'MATCH'
         when btrim(coalesce(sr.got_season, '')) = btrim(coalesce(m.cur_season, '')) then 'WHITESPACE_DRIFT'
         else 'DRIFT' end as season_state,
    case when sr.got_level is not distinct from m.cur_level then 'MATCH'
         when btrim(coalesce(sr.got_level, '')) = btrim(coalesce(m.cur_level, '')) then 'WHITESPACE_DRIFT'
         else 'DRIFT' end as level_state,
    case when sr.got_status is not distinct from m.cur_status then 'MATCH'
         when btrim(coalesce(sr.got_status, '')) = btrim(coalesce(m.cur_status, '')) then 'WHITESPACE_DRIFT'
         else 'DRIFT' end as status_state,
    case
      when a.account_rows <> 1        then 'ACCOUNT_NOT_UNIQUE'
      when a.auth_user_id is null     then 'ACCOUNT_UNLINKED'
      when sr.scope_rows <> 1         then 'ROW_MISSING'
      when sr.row_user_id is distinct from a.auth_user_id then 'ROW_NOT_OWNED_BY_ACCOUNT'
      else 'OWNED'
    end as linkage_state,
    case
      when m.want_auth_user_id is null then 'NOT_PINNED'
      when a.auth_user_id is not distinct from m.want_auth_user_id then 'MATCHES_OWNER_EVIDENCE'
      else 'CONTRADICTS_OWNER_EVIDENCE'
    end as auth_identity_state
  from manifest m
  join accounts a    on a.manifest_key  = m.manifest_key
  join source_rows sr on sr.manifest_key = m.manifest_key
)
select
  manifest_key,
  label,
  classification,
  email,
  -- Account facts
  account_rows,
  account_role  as account_platform_role,
  want_platform_role,
  account_status,
  want_account_status,
  auth_user_id,
  auth_identity_state,
  -- Scope row facts
  scope_id,
  scope_rows,
  linkage_state,
  got_program  as stored_program, cur_program as inventory_program, program_state,
  got_season   as stored_season,  cur_season  as inventory_season,  season_state,
  got_level    as stored_level,   cur_level   as inventory_level,   level_state,
  got_status   as stored_status,  cur_status  as inventory_status,  status_state,
  case
    when account_rows <> 1
      then 'BLOCKED: email does not resolve to exactly one admin_users row'
    when account_role is distinct from want_platform_role
      then 'BLOCKED: platform role is not the owner-approved role (A2 changes no platform role)'
    when account_status is distinct from want_account_status
      then 'BLOCKED: account status is not what the manifest recorded'
    when auth_user_id is null
      then 'BLOCKED: account has no auth_user_id, so no grant can be keyed to it'
    when auth_identity_state = 'CONTRADICTS_OWNER_EVIDENCE'
      then 'BLOCKED: auth_user_id contradicts the pinned owner evidence'
    when scope_rows <> 1
      then 'BLOCKED: the manifest scope_id does not exist in Production'
    when linkage_state <> 'OWNED'
      then 'BLOCKED: the scope row does not belong to this account'
    when 'DRIFT' in (program_state, season_state, level_state, status_state)
      or 'WHITESPACE_DRIFT' in (program_state, season_state, level_state, status_state)
      then 'BLOCKED: stored values have drifted from the owner inventory — re-cut the manifest'
    else 'EXACT: row matches the owner inventory in every field'
  end as verdict
from compared
order by
  case classification
    when 'KEEP_CONVERT_S11' then 0
    when 'RETIRE_LEGACY_PROGRAM_WIDE' then 1
    when 'SYNTHETIC_REQUIRES_OWNER_DECISION' then 2
    else 3
  end,
  manifest_key;

rollback;


-- #############################################################################
-- BLOCK 2 — THE TARGET PLAN AND ITS COLLISIONS
--
-- Proves requirement D (target collisions). One output row per owner-approved
-- target grant, showing what a future apply would have to do and whether the
-- table already contains something on that key.
--
-- Two different counts are reported for every target, and they answer different
-- questions:
--
--   existing_canonical_active — how many ACTIVE rows ALREADY store this exact
--     canonical identity today, ignoring the target's own source row. 0 means a
--     future apply inserts. 1 means it must reconcile idempotently rather than
--     insert a second one. More than 1 means the table already violates the
--     uniqueness the migration is about to enforce, and nothing may be applied.
--
--   post_plan_active_on_key — how many rows land on this key AFTER the whole
--     manifest is applied, counting converted rows, inserted rows and every row
--     the manifest does not touch. This is the count the planned partial unique
--     index will see. It is the one that catches two owner-approved source rows
--     canonicalizing onto the same active key, which the first count cannot see
--     because neither row holds the canonical identity yet.
-- #############################################################################

begin;
set transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

with
manifest(manifest_key, email, label, want_platform_role, want_account_status,
         want_auth_user_id, scope_id, cur_program, cur_season, cur_level,
         cur_status, classification) as (
  values
    ('ueh_shared_admin'::text, 'uehmentoring@gmail.com'::text, 'UEH shared Admin'::text,
     'admin'::text, 'active'::text, '0cbe980a-6027-4645-828d-d994a1a38869'::text,
     '68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid,
     'UEH Mentoring'::text, 'UEHM-S11'::text, 'full_access'::text, 'active'::text,
     'KEEP_CONVERT_S11'::text),
    ('lieu', 'lieu.nguyen@hoatay.com.vn', 'Lieu',
     'admin', 'active', null, '17a86485-c241-4cff-9bd5-60efe75b802a',
     'UEHM', null, 'admin', 'active', 'RETIRE_LEGACY_PROGRAM_WIDE'),
    ('hoang', 'hoang.nguyen@embassy.edu.vn', 'Hoang',
     'admin', 'active', null, '60ef3d0b-8f41-4c76-aad7-dc91f26a470a',
     'VAM', 'UEHM-S11', 'operations', 'active', 'KEEP_CONVERT_S11'),
    ('toan', 'lyductoan@gmail.com', 'Ly Duc Toan',
     'admin', 'active', null, '1e58beb9-b7ce-4392-ac81-429743f61534',
     'VAM', 'UEHM-S11', 'operations', 'active', 'KEEP_CONVERT_S11'),
    ('synthetic_viewer_test', 'viewer.vam.test@redsquarevietnam.com', 'VAM viewer test (synthetic)',
     'reviewer', 'active', null, '487a7562-bb40-4c5c-9dc1-0fe363f1158a',
     'VAM', 'UEHM-S11', 'operations', 'active', 'SYNTHETIC_REQUIRES_OWNER_DECISION'),
    ('historical_admin_test', 'admin.vam.test@redsquarevietnam.com', 'VAM admin test (historical)',
     'admin', 'inactive', null, 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028',
     'VAM', 'UEHM-S11', 'full_access', 'inactive', 'HISTORICAL_CANONICALIZE_ONLY')
),
-- The owner-approved TARGET grants, verbatim from staff_scope_manifest_v2.json.
--
-- The synthetic reviewer row has NO entry here, deliberately. Authorizing its
-- disposition therefore takes TWO deliberate edits — a target row here and the
-- flag in BLOCK 3 — and neither can be made by accident. See the note on the
-- [SYNTHETIC_DISPOSITION] check.
targets(target_key, manifest_key, classification, action, source_scope_id,
        tgt_program, tgt_season, tgt_level, tgt_status) as (
  values
    ('ueh_shared_admin/S11'::text, 'ueh_shared_admin'::text, 'KEEP_CONVERT_S11'::text,
     'UPDATE_IN_PLACE'::text, '68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3'::text, '710f4ec9-1cf7-461e-98d4-f33799047add'::text,
     'full_access'::text, 'active'::text),
    ('ueh_shared_admin/S12', 'ueh_shared_admin', 'ADD_S12', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'active'),

    -- Lieu: the legacy program-wide row is retired IN PLACE (never deleted), and
    -- her authority is re-expressed as two explicit season grants.
    ('lieu/LEGACY', 'lieu', 'RETIRE_LEGACY_PROGRAM_WIDE', 'RETIRE_IN_PLACE',
     '17a86485-c241-4cff-9bd5-60efe75b802a',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', null, 'full_access', 'inactive'),
    ('lieu/S11', 'lieu', 'ADD_S11', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'active'),
    ('lieu/S12', 'lieu', 'ADD_S12', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'active'),

    ('hoang/S11', 'hoang', 'KEEP_CONVERT_S11', 'UPDATE_IN_PLACE', '60ef3d0b-8f41-4c76-aad7-dc91f26a470a',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'active'),
    ('hoang/S12', 'hoang', 'ADD_S12', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'active'),

    ('toan/S11', 'toan', 'KEEP_CONVERT_S11', 'UPDATE_IN_PLACE', '1e58beb9-b7ce-4392-ac81-429743f61534',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'active'),
    ('toan/S12', 'toan', 'ADD_S12', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'active'),

    -- Inactive historical row: identifiers only, status untouched.
    ('historical_admin_test/CANONICALIZE', 'historical_admin_test', 'HISTORICAL_CANONICALIZE_ONLY',
     'UPDATE_IN_PLACE', 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'inactive')
),
accounts as (
  select
    m.manifest_key,
    (select min(a.auth_user_id::text) from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as auth_user_id
  from manifest m
),
-- Every row in the table as it would stand AFTER the manifest is applied, plus
-- the rows the manifest would insert. Rows the manifest does not name keep their
-- stored identity: the plan does not touch them, so neither does this
-- projection. That is what keeps the synthetic reviewer row visible below as a
-- surviving active non-canonical grant rather than an assumed-away one.
post_plan as (
  select
    s.id                                                              as scope_id,
    s.user_id::text                                                   as user_id,
    coalesce(t.tgt_program, nullif(btrim(s.program_id), ''))          as program_key,
    case when t.target_key is not null
         then t.tgt_season
         else nullif(btrim(s.season_id), '') end                      as season_key,
    coalesce(t.tgt_level,  s.role)                                    as level_key,
    coalesce(t.tgt_status, s.status)                                  as status_key,
    t.target_key                                                      as applied_target
  from public.admin_scope_access s
  left join targets t on t.source_scope_id = s.id
  union all
  select
    null::uuid, a.auth_user_id, t.tgt_program, t.tgt_season, t.tgt_level, t.tgt_status, t.target_key
  from targets t
  join accounts a on a.manifest_key = t.manifest_key
  where t.action = 'INSERT'
),
plan as (
  select
    t.*,
    a.auth_user_id,
    (select count(*) from public.admin_scope_access s
      where s.status = 'active'
        and s.user_id::text = a.auth_user_id
        and nullif(btrim(s.program_id), '') is not distinct from t.tgt_program
        and nullif(btrim(s.season_id),  '') is not distinct from t.tgt_season
        and (t.source_scope_id is null or s.id <> t.source_scope_id)) as existing_canonical_active,
    (select count(*) from post_plan p
      where p.status_key = 'active'
        and p.user_id = a.auth_user_id
        and p.program_key is not distinct from t.tgt_program
        and p.season_key  is not distinct from t.tgt_season)          as post_plan_active_on_key
  from targets t
  join accounts a on a.manifest_key = t.manifest_key
)
select
  target_key,
  manifest_key,
  classification,
  action,
  source_scope_id,
  tgt_program  as target_program_id,
  tgt_season   as target_season_id,
  tgt_level    as target_scope_level,
  tgt_status   as target_status,
  existing_canonical_active,
  post_plan_active_on_key,
  case
    when auth_user_id is null
      then 'BLOCKED: the account has no auth_user_id, so this grant cannot be keyed'
    when existing_canonical_active > 1
      then 'CONFLICT: more than one active grant already holds this canonical key — resolve before A2'
    when tgt_status = 'active' and post_plan_active_on_key > 1
      then 'CONFLICT: the plan itself would leave more than one active row on this key'
    when action = 'RETIRE_IN_PLACE'
      then 'RETIRE the source row in place: canonicalize identifiers, set status inactive, keep id and created_at'
    when action = 'UPDATE_IN_PLACE' and tgt_status = 'inactive'
      then 'CANONICALIZE the inactive source row in place: identifiers only, status untouched'
    when action = 'UPDATE_IN_PLACE' and existing_canonical_active = 1
      then 'RECONCILE: a canonical grant already exists elsewhere — the apply must converge onto one row, not two'
    when action = 'UPDATE_IN_PLACE'
      then 'UPDATE the source row in place: rewrite identifiers and level, keep id and created_at'
    when action = 'INSERT' and existing_canonical_active = 1
      then 'NO-OP: a canonical grant already exists — the apply must be idempotent and insert nothing'
    when action = 'INSERT'
      then 'INSERT a new canonical grant'
    else 'review manually'
  end as planned_action
from plan
order by manifest_key, target_key;

rollback;


-- #############################################################################
-- BLOCK 3 — NAMED CHECKS AND THE SAFE_TO_APPLY_V2 VERDICT
--
-- Every check emits seq / check_name / expected / actual / result / details.
-- result is PASS, FAIL or INFO. INFO never gates the verdict; a check is INFO
-- only where its failure could not make the planned migration fail. Everything
-- that could is a FAIL, and any FAIL sets SAFE_TO_APPLY_V2 = false.
--
-- No warning is a pass. Read the INFO rows.
-- #############################################################################

begin;
set transaction read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

with
expected as (
  select
    '61701ee8-64a6-4673-b261-ba12ce9a3ee3'::text as uehm_program_id,
    '710f4ec9-1cf7-461e-98d4-f33799047add'::text as uehm_s11_id,
    '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1'::text as uehm_s12_id,
    'UEHM'::text                                 as uehm_code,
    'UEH Mentoring'::text                        as uehm_name,
    '487a7562-bb40-4c5c-9dc1-0fe363f1158a'::uuid as synthetic_scope_id,
    'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028'::uuid as historical_scope_id,
    '17a86485-c241-4cff-9bd5-60efe75b802a'::uuid as lieu_legacy_scope_id,
    -- ─────────────────────────────────────────────────────────────────────────
    -- THE OWNER SWITCH. False until the owner explicitly decides what happens to
    -- the active synthetic reviewer grant. While it is false,
    -- [SYNTHETIC_DISPOSITION] fails and SAFE_TO_APPLY_V2 is false. That is the
    -- expected result of this run, not a defect in it.
    --
    -- Flipping this alone is NOT enough and is not meant to be: with no target
    -- row for that scope_id in BLOCK 2, the row survives the plan unchanged and
    -- [CONSTRAINT_ROW] still fails on it. Authorizing the disposition means
    -- writing the chosen target into the manifest AND into BLOCK 2 AND flipping
    -- this flag. Three deliberate acts, none of them reachable by accident.
    -- ─────────────────────────────────────────────────────────────────────────
    false                                        as synthetic_disposition_authorized,
    'PENDING_OWNER_DECISION'::text               as synthetic_disposition
),
manifest(manifest_key, email, label, want_platform_role, want_account_status,
         want_auth_user_id, scope_id, cur_program, cur_season, cur_level,
         cur_status, classification) as (
  values
    ('ueh_shared_admin'::text, 'uehmentoring@gmail.com'::text, 'UEH shared Admin'::text,
     'admin'::text, 'active'::text, '0cbe980a-6027-4645-828d-d994a1a38869'::text,
     '68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid,
     'UEH Mentoring'::text, 'UEHM-S11'::text, 'full_access'::text, 'active'::text,
     'KEEP_CONVERT_S11'::text),
    ('lieu', 'lieu.nguyen@hoatay.com.vn', 'Lieu',
     'admin', 'active', null, '17a86485-c241-4cff-9bd5-60efe75b802a',
     'UEHM', null, 'admin', 'active', 'RETIRE_LEGACY_PROGRAM_WIDE'),
    ('hoang', 'hoang.nguyen@embassy.edu.vn', 'Hoang',
     'admin', 'active', null, '60ef3d0b-8f41-4c76-aad7-dc91f26a470a',
     'VAM', 'UEHM-S11', 'operations', 'active', 'KEEP_CONVERT_S11'),
    ('toan', 'lyductoan@gmail.com', 'Ly Duc Toan',
     'admin', 'active', null, '1e58beb9-b7ce-4392-ac81-429743f61534',
     'VAM', 'UEHM-S11', 'operations', 'active', 'KEEP_CONVERT_S11'),
    ('synthetic_viewer_test', 'viewer.vam.test@redsquarevietnam.com', 'VAM viewer test (synthetic)',
     'reviewer', 'active', null, '487a7562-bb40-4c5c-9dc1-0fe363f1158a',
     'VAM', 'UEHM-S11', 'operations', 'active', 'SYNTHETIC_REQUIRES_OWNER_DECISION'),
    ('historical_admin_test', 'admin.vam.test@redsquarevietnam.com', 'VAM admin test (historical)',
     'admin', 'inactive', null, 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028',
     'VAM', 'UEHM-S11', 'full_access', 'inactive', 'HISTORICAL_CANONICALIZE_ONLY')
),
targets(target_key, manifest_key, classification, action, source_scope_id,
        tgt_program, tgt_season, tgt_level, tgt_status) as (
  values
    ('ueh_shared_admin/S11'::text, 'ueh_shared_admin'::text, 'KEEP_CONVERT_S11'::text,
     'UPDATE_IN_PLACE'::text, '68fe466c-b37d-4812-baeb-eb5fe4ea24ec'::uuid,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3'::text, '710f4ec9-1cf7-461e-98d4-f33799047add'::text,
     'full_access'::text, 'active'::text),
    ('ueh_shared_admin/S12', 'ueh_shared_admin', 'ADD_S12', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'active'),
    ('lieu/LEGACY', 'lieu', 'RETIRE_LEGACY_PROGRAM_WIDE', 'RETIRE_IN_PLACE',
     '17a86485-c241-4cff-9bd5-60efe75b802a',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', null, 'full_access', 'inactive'),
    ('lieu/S11', 'lieu', 'ADD_S11', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'active'),
    ('lieu/S12', 'lieu', 'ADD_S12', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'active'),
    ('hoang/S11', 'hoang', 'KEEP_CONVERT_S11', 'UPDATE_IN_PLACE', '60ef3d0b-8f41-4c76-aad7-dc91f26a470a',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'active'),
    ('hoang/S12', 'hoang', 'ADD_S12', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'active'),
    ('toan/S11', 'toan', 'KEEP_CONVERT_S11', 'UPDATE_IN_PLACE', '1e58beb9-b7ce-4392-ac81-429743f61534',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'active'),
    ('toan/S12', 'toan', 'ADD_S12', 'INSERT', null,
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '32fbfc86-1d67-4158-b9d4-1e6bff48b2c1', 'full_access', 'active'),
    ('historical_admin_test/CANONICALIZE', 'historical_admin_test', 'HISTORICAL_CANONICALIZE_ONLY',
     'UPDATE_IN_PLACE', 'eaa60d5c-66eb-4ef8-a8c0-0db0bc701028',
     '61701ee8-64a6-4673-b261-ba12ce9a3ee3', '710f4ec9-1cf7-461e-98d4-f33799047add', 'full_access', 'inactive')
),
accounts as (
  select
    m.manifest_key,
    m.email,
    m.want_platform_role,
    m.want_account_status,
    m.want_auth_user_id,
    (select count(*)                  from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as account_rows,
    (select min(a.auth_user_id::text) from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as auth_user_id,
    (select min(a.role)               from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as account_role,
    (select min(a.status)             from public.admin_users a where lower(btrim(a.email)) = lower(m.email)) as account_status
  from manifest m
),
source_rows as (
  select
    m.manifest_key,
    m.classification,
    m.scope_id,
    (select count(*)        from public.admin_scope_access s where s.id = m.scope_id) as scope_rows,
    (select s.user_id::text from public.admin_scope_access s where s.id = m.scope_id) as row_user_id,
    (select s.program_id    from public.admin_scope_access s where s.id = m.scope_id) as got_program,
    (select s.season_id     from public.admin_scope_access s where s.id = m.scope_id) as got_season,
    (select s.role          from public.admin_scope_access s where s.id = m.scope_id) as got_level,
    (select s.status        from public.admin_scope_access s where s.id = m.scope_id) as got_status,
    m.cur_program, m.cur_season, m.cur_level, m.cur_status
  from manifest m
),
drift as (
  select
    sr.*,
    (sr.got_program is distinct from sr.cur_program) as program_drift,
    (sr.got_season  is distinct from sr.cur_season)  as season_drift,
    (sr.got_level   is distinct from sr.cur_level)   as level_drift,
    (sr.got_status  is distinct from sr.cur_status)  as status_drift
  from source_rows sr
),
-- The whole table as it would stand after the manifest is applied, plus the
-- inserted rows. Untouched rows keep their stored identity on purpose.
post_plan as (
  select
    s.id                                                     as scope_id,
    s.user_id::text                                          as user_id,
    coalesce(t.tgt_program, nullif(btrim(s.program_id), '')) as program_key,
    case when t.target_key is not null then t.tgt_season
         else nullif(btrim(s.season_id), '') end             as season_key,
    coalesce(t.tgt_level,  s.role)                           as level_key,
    coalesce(t.tgt_status, s.status)                         as status_key,
    s.status                                                 as status_before,
    t.target_key                                             as applied_target
  from public.admin_scope_access s
  left join targets t on t.source_scope_id = s.id
  union all
  select
    null::uuid, a.auth_user_id, t.tgt_program, t.tgt_season, t.tgt_level, t.tgt_status,
    null::text, t.target_key
  from targets t
  join accounts a on a.manifest_key = t.manifest_key
  where t.action = 'INSERT'
),
-- Would this row still violate a PLANNED constraint after the manifest is
-- applied? Evaluated over EVERY row of every status, because the planned NOT
-- NULL and CHECK constraints are table-wide. Both planned CHECKs are
-- NULL-permissive by SQL semantics — a NULL level or status SATISFIES
-- `x in (...)` — so NULLs are called out separately rather than assumed caught.
post_plan_checked as (
  select
    p.*,
    (p.program_key is null) as v_program_null,
    (p.program_key is not null and p.program_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as v_program_format,
    (p.season_key  is not null and p.season_key  !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as v_season_format,
    (p.level_key  is null or p.level_key  not in ('full_access','operations','review','read')) as v_level,
    (p.status_key is null or p.status_key not in ('active','inactive'))                        as v_status
  from post_plan p
),
post_plan_violations as (
  select
    p.*,
    (p.v_program_null or p.v_program_format or p.v_season_format or p.v_level or p.v_status) as violates
  from post_plan_checked p
),
active_keys as (
  select user_id, program_key, coalesce(season_key, '<program-wide>') as season_key, count(*) as grants
  from post_plan_violations
  where status_key = 'active'
  group by 1, 2, 3
),
unknown_rows as (
  select s.id as scope_id, s.status
  from public.admin_scope_access s
  where not exists (select 1 from manifest m where m.scope_id = s.id)
),
prog_catalog as (
  select
    (select count(*)               from public.programs p, expected e where upper(btrim(p.code)) = e.uehm_code)        as code_matches,
    (select count(*)               from public.programs p, expected e where lower(btrim(p.name)) = lower(e.uehm_name)) as name_matches,
    (select min(p.id::text)        from public.programs p, expected e where upper(btrim(p.code)) = e.uehm_code)        as resolved_id,
    (select min(p.is_active::text) from public.programs p, expected e where upper(btrim(p.code)) = e.uehm_code)        as is_active
),
s11_catalog as (
  select
    (select count(*)                from public.seasons s where upper(btrim(s.code)) = 'UEHM-S11') as code_matches,
    (select min(s.id::text)         from public.seasons s where upper(btrim(s.code)) = 'UEHM-S11') as resolved_id,
    (select min(s.program_id::text) from public.seasons s where upper(btrim(s.code)) = 'UEHM-S11') as owner_program
),
s12_catalog as (
  select
    (select count(*)                from public.seasons s where upper(btrim(s.code)) = 'UEHM-S12') as code_matches,
    (select min(s.id::text)         from public.seasons s where upper(btrim(s.code)) = 'UEHM-S12') as resolved_id,
    (select min(s.program_id::text) from public.seasons s where upper(btrim(s.code)) = 'UEHM-S12') as owner_program
),
shape as (
  select
    count(*) filter (where column_name = 'id'         and data_type = 'uuid')                        as id_ok,
    count(*) filter (where column_name = 'user_id'    and data_type = 'uuid')                        as user_id_ok,
    count(*) filter (where column_name = 'program_id' and data_type in ('text','character varying')) as program_ok,
    count(*) filter (where column_name = 'season_id'  and data_type in ('text','character varying')) as season_ok,
    count(*) filter (where column_name = 'role'       and data_type in ('text','character varying')) as role_ok,
    count(*) filter (where column_name = 'status'     and data_type in ('text','character varying')) as status_ok,
    count(*) filter (where column_name = 'created_at')                                               as created_at_ok,
    count(*) filter (where column_name = 'updated_at')                                               as updated_at_ok,
    count(*)                                                                                        as column_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_scope_access'
),
planned_names as (
  select unnest(array[
    'admin_scope_access_program_id_not_null',
    'admin_scope_access_program_id_canonical_check',
    'admin_scope_access_season_id_canonical_check',
    'admin_scope_access_role_check',
    'admin_scope_access_status_check',
    'admin_scope_access_active_scope_key'
  ]) as object_name
),
name_collisions as (
  select count(*) as taken
  from planned_names n
  where exists (select 1 from pg_constraint c where c.conname = n.object_name)
     or exists (select 1 from pg_class r     where r.relname = n.object_name and r.relkind = 'i')
),
existing_integrity as (
  select
    (select count(*) from pg_constraint where conrelid = to_regclass('public.admin_scope_access')) as constraints_now,
    (select count(*) from pg_index i where i.indrelid = to_regclass('public.admin_scope_access'))  as indexes_now
),
-- The live RPC is READ from the catalog, never invoked. pg_get_functiondef is a
-- pure catalog read; calling vam063_authorized_for_scope would be a function
-- call this preflight has no business making against Production.
rpc as (
  select
    count(*)                                                                  as fn_count,
    min(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g'))           as fn_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'vam063_authorized_for_scope'
),
rpc_facts as (
  select
    r.fn_count,
    coalesce(r.fn_src ~* 'role\s+in\s*\([^)]*full_access', false)      as accepts_full_access,
    coalesce(r.fn_src ~* 'role\s+in\s*\([^)]*operations',  false)      as accepts_operations,
    coalesce(r.fn_src ~* 'season_id\s*=\s*p_season_id',    false)      as requires_season_equality,
    coalesce(r.fn_src ~* 'program_id\s*=\s*p_program_id',  false)      as requires_program_equality,
    coalesce(r.fn_src ~* 'status\s*=\s*.active.',          false)      as requires_active_grant
  from rpc r
),
target_collisions as (
  select
    t.target_key,
    t.tgt_status,
    (select count(*) from public.admin_scope_access s
      where s.status = 'active'
        and s.user_id::text = a.auth_user_id
        and nullif(btrim(s.program_id), '') is not distinct from t.tgt_program
        and nullif(btrim(s.season_id),  '') is not distinct from t.tgt_season
        and (t.source_scope_id is null or s.id <> t.source_scope_id)) as existing_canonical_active
  from targets t
  join accounts a on a.manifest_key = t.manifest_key
),
target_dupes as (
  select count(*) as colliding_keys
  from (
    select a.auth_user_id, t.tgt_program, coalesce(t.tgt_season, '<program-wide>') as season_key
    from targets t
    join accounts a on a.manifest_key = t.manifest_key
    where t.tgt_status = 'active'
    group by 1, 2, 3
    having count(*) > 1
  ) d
),
checks as (

  -- ── Section 1. Environment and table shape ────────────────────────────────
  select
    10 as seq,
    '[SHAPE] admin_scope_access column shape' as check_name,
    'id uuid, user_id uuid, program_id/season_id/role/status text' as expected,
    'id=' || sh.id_ok || ' user_id=' || sh.user_id_ok || ' program_id=' || sh.program_ok
          || ' season_id=' || sh.season_ok || ' role=' || sh.role_ok || ' status=' || sh.status_ok as actual,
    case when sh.id_ok = 1 and sh.user_id_ok = 1 and sh.program_ok = 1
              and sh.season_ok = 1 and sh.role_ok = 1 and sh.status_ok = 1
         then 'PASS' else 'FAIL' end as result,
    'Total columns: ' || sh.column_count || '. A 0 for any column means A2 would be writing into a shape it was not designed against.' as details
  from shape sh

  union all
  select
    11,
    '[PGVERSION] server supports a NULLS NOT DISTINCT unique index',
    '>= 150000',
    current_setting('server_version_num'),
    case when current_setting('server_version_num')::int >= 150000 then 'PASS' else 'FAIL' end,
    'The planned active-scope unique index uses NULLS NOT DISTINCT so two program-wide grants for one user collide as intended.'

  union all
  select
    12,
    '[NAME_COLLISION] planned constraint and index names are free',
    '0 taken',
    nc.taken || ' taken',
    case when nc.taken = 0 then 'PASS' else 'FAIL' end,
    'Constraints on the table now: ' || ei.constraints_now || ', indexes: ' || ei.indexes_now
      || '. V1 evidence expects 1 and 1 (the primary key). Anything higher means migration 020 or similar was partially applied and this baseline must be re-read.'
  from name_collisions nc, existing_integrity ei

  union all
  select
    13,
    '[INFO] history columns available to the apply',
    'created_at present; updated_at present or absent',
    'created_at=' || sh.created_at_ok || ' updated_at=' || sh.updated_at_ok,
    'INFO',
    'Every in-place conversion in the plan preserves id and created_at. If updated_at is 0 the apply must not reference it; if it is 1 it may be set explicitly or left to a trigger.'
  from shape sh

  -- ── Section 2. Manifest coverage ──────────────────────────────────────────
  union all
  select
    20,
    '[UNKNOWN_ROW] every row in the table is accounted for by the manifest',
    '0 unknown rows',
    (select count(*)::text from unknown_rows) || ' unknown ('
      || (select count(*)::text from unknown_rows where status = 'active') || ' active)',
    case when (select count(*) from unknown_rows) = 0 then 'PASS' else 'FAIL' end,
    'The manifest is exhaustive by construction: it names all six rows the owner inventoried. A row it does not name is a row nobody has decided about, and no rule in this package can classify it — the manifest converts scope_ids, not patterns. Unknown scope_ids: '
      || coalesce((select string_agg(scope_id::text, ', ' order by scope_id) from unknown_rows), '<none>')

  union all
  select
    21,
    '[INFO] table size versus the owner inventory',
    '6 rows',
    (select count(*)::text from public.admin_scope_access) || ' rows',
    'INFO',
    'Active: ' || (select count(*)::text from public.admin_scope_access where status = 'active')
      || ', inactive: ' || (select count(*)::text from public.admin_scope_access where status = 'inactive')
      || ', other/NULL status: ' || (select count(*)::text from public.admin_scope_access where status is distinct from 'active' and status is distinct from 'inactive')

  -- ── Section 3. Exact staff identity (requirement A) ───────────────────────
  union all
  select
    30,
    '[STAFF_IDENTITY] each of the four Admin emails resolves to exactly one usable admin_users row',
    '4 accounts: 1 row each, role=admin, status=active, auth_user_id not null',
    (select count(*)::text from accounts
      where manifest_key in ('ueh_shared_admin','lieu','hoang','toan')
        and account_rows = 1 and account_role = 'admin' and account_status = 'active' and auth_user_id is not null) || ' of 4 usable',
    case when (select count(*) from accounts
                where manifest_key in ('ueh_shared_admin','lieu','hoang','toan')
                  and account_rows = 1 and account_role = 'admin' and account_status = 'active' and auth_user_id is not null) = 4
         then 'PASS' else 'FAIL' end,
    'All four keep platform role `admin` by explicit owner decision; A2 changes no platform role. A role or status other than admin/active here means Production disagrees with the manifest and the manifest must be re-cut, not overridden. Detail: '
      || coalesce((select string_agg(manifest_key || '(rows=' || account_rows || ',role=' || coalesce(account_role,'<null>')
                     || ',status=' || coalesce(account_status,'<null>') || ',auth=' || case when auth_user_id is null then 'null' else 'set' end || ')', '; ' order by manifest_key)
                   from accounts where manifest_key in ('ueh_shared_admin','lieu','hoang','toan')), '<none>')

  union all
  select
    31,
    '[STAFF_IDENTITY] the two test accounts also resolve to exactly one row each',
    '2 accounts, 1 row each',
    (select count(*)::text from accounts
      where manifest_key in ('synthetic_viewer_test','historical_admin_test') and account_rows = 1) || ' of 2',
    case when (select count(*) from accounts
                where manifest_key in ('synthetic_viewer_test','historical_admin_test') and account_rows = 1) = 2
         then 'PASS' else 'FAIL' end,
    'Their identity is not needed to grant anything — it is needed to prove that the rows they own are the rows the manifest thinks they own. Observed platform roles: '
      || coalesce((select string_agg(manifest_key || '=' || coalesce(account_role,'<null>') || '/' || coalesce(account_status,'<null>'), '; ' order by manifest_key)
                   from accounts where manifest_key in ('synthetic_viewer_test','historical_admin_test')), '<none>')

  union all
  select
    32,
    '[STAFF_LINKAGE] every manifest scope row belongs to its manifest account',
    '6 of 6 owned',
    (select count(*)::text from drift d join accounts a on a.manifest_key = d.manifest_key
      where d.scope_rows = 1 and a.auth_user_id is not null and d.row_user_id = a.auth_user_id) || ' of 6 owned',
    case when (select count(*) from drift d join accounts a on a.manifest_key = d.manifest_key
                where d.scope_rows = 1 and a.auth_user_id is not null and d.row_user_id = a.auth_user_id) = 6
         then 'PASS' else 'FAIL' end,
    'admin_scope_access.user_id carries the AUTH identity (admin_users.auth_user_id), which is what vam063_authorized_for_scope joins on, and there is no foreign key enforcing it. A row owned by someone other than the account the manifest names is not a row this plan may convert.'

  union all
  select
    33,
    '[INFO] the UEH shared Admin auth identity matches the pinned owner evidence',
    '0cbe980a-6027-4645-828d-d994a1a38869',
    coalesce((select auth_user_id from accounts where manifest_key = 'ueh_shared_admin'), '<none>'),
    'INFO',
    'Pinned from the WP1-A1 evidence run. It is the only account whose auth_user_id the manifest asserts in advance; the other five are resolved from email at run time and proved by [STAFF_LINKAGE]. A mismatch here is reported as a BLOCKED row in BLOCK 1.'

  -- ── Section 4. Exact current scope rows (requirement B) ───────────────────
  union all
  select
    40,
    '[SOURCE_ROW] every manifest scope_id exists in Production, exactly once',
    '6 rows',
    (select count(*)::text from drift where scope_rows = 1) || ' of 6 found',
    case when (select count(*) from drift where scope_rows = 1) = 6 then 'PASS' else 'FAIL' end,
    'Resolution is by primary key, so "exactly once" is structural. A missing row means the inventory the manifest was cut from is stale. Missing: '
      || coalesce((select string_agg(manifest_key, ', ' order by manifest_key) from drift where scope_rows <> 1), '<none>')

  union all
  select
    41,
    '[SOURCE_DRIFT] every stored value still matches the owner inventory',
    '0 drifted rows',
    (select count(*)::text from drift where program_drift or season_drift or level_drift or status_drift) || ' drifted',
    case when (select count(*) from drift where program_drift or season_drift or level_drift or status_drift) = 0
         then 'PASS' else 'FAIL' end,
    'Drift is a FAIL, not a warning: the owner approved a conversion of specific values, and a row that has changed since is a row the owner has not approved. Re-inventory and re-cut the manifest rather than adjusting the target. Drifted: '
      || coalesce((select string_agg(manifest_key || '(' || concat_ws(',',
             case when program_drift then 'program' end, case when season_drift then 'season' end,
             case when level_drift then 'level' end,     case when status_drift then 'status' end) || ')', '; ' order by manifest_key)
           from drift where program_drift or season_drift or level_drift or status_drift), '<none>')

  -- ── Section 5. Canonical catalog identity (requirement C) ─────────────────
  union all
  select
    50,
    '[PROGRAM] UEHM resolves to exactly one active program at the expected UUID',
    '1 code match, id=' || e.uehm_program_id || ', is_active=true',
    'code_matches=' || pc.code_matches || ' id=' || coalesce(pc.resolved_id, '<none>') || ' is_active=' || coalesce(pc.is_active, '<none>'),
    case when pc.code_matches = 1 and pc.resolved_id = e.uehm_program_id and pc.is_active = 'true' then 'PASS' else 'FAIL' end,
    'Resolved from the catalog by code and only then compared to the owner-supplied UUID. The literal is never trusted alone.'
  from prog_catalog pc, expected e

  union all
  select
    51,
    '[SEASON_S11] UEHM-S11 resolves once, at the expected UUID, owned by UEHM',
    '1 match, id=' || e.uehm_s11_id || ', program=' || e.uehm_program_id,
    'matches=' || s11.code_matches || ' id=' || coalesce(s11.resolved_id, '<none>') || ' program=' || coalesce(s11.owner_program, '<none>'),
    case when s11.code_matches = 1 and s11.resolved_id = e.uehm_s11_id and s11.owner_program = e.uehm_program_id then 'PASS' else 'FAIL' end,
    'Season 11 history must stay readable to all four Admins afterwards. This is also the season whose ownership justifies the historical row canonicalization — see [HISTORICAL_INACTIVE].'
  from s11_catalog s11, expected e

  union all
  select
    52,
    '[SEASON_S12] UEHM-S12 resolves once, at the expected UUID, owned by UEHM',
    '1 match, id=' || e.uehm_s12_id || ', program=' || e.uehm_program_id,
    'matches=' || s12.code_matches || ' id=' || coalesce(s12.resolved_id, '<none>') || ' program=' || coalesce(s12.owner_program, '<none>'),
    case when s12.code_matches = 1 and s12.resolved_id = e.uehm_s12_id and s12.owner_program = e.uehm_program_id then 'PASS' else 'FAIL' end,
    'The operating season. Four new S12 grants depend on this identity being exact.'
  from s12_catalog s12, expected e

  union all
  select
    53,
    '[INFO] the program NAME "UEH Mentoring" is carried by exactly one program',
    '1',
    pc.name_matches || ' name match(es)',
    'INFO',
    'V1 needed this as a gate because it converted the UEH Admin row by resolving its stored NAME. V2 converts by scope_id, so name ambiguity no longer decides anything — it is reported only because a duplicate program name is worth knowing about.'
  from prog_catalog pc

  -- ── Section 6. Target collisions (requirement D) ──────────────────────────
  union all
  select
    60,
    '[TARGET_COLLISION] no canonical target key is already held by more than one active grant',
    '0 targets with more than one existing active grant',
    (select count(*)::text from target_collisions where existing_canonical_active > 1) || ' conflicted; '
      || (select count(*)::text from target_collisions where existing_canonical_active = 1) || ' already present (idempotent reconcile)',
    case when (select count(*) from target_collisions where existing_canonical_active > 1) = 0 then 'PASS' else 'FAIL' end,
    '0 existing means the apply inserts or converts. 1 means the apply must reconcile onto the existing row rather than create a second. More than 1 means the table already violates the uniqueness A2 is about to enforce, and that must be resolved by the owner first.'

  union all
  select
    61,
    '[ACTIVE_KEY_UNIQUE] after the plan, at most one ACTIVE grant per (user_id, program_id, season_id)',
    '0 duplicate keys',
    (select count(*)::text from active_keys where grants > 1) || ' duplicate key(s)',
    case when (select count(*) from active_keys where grants > 1) = 0 then 'PASS' else 'FAIL' end,
    'Keyed with NULLS NOT DISTINCT and computed over the POST-plan table, including rows the plan does not touch. Scope level is deliberately NOT part of the key: two active grants differing only in level would otherwise coexist and resolve silently to the stronger one, which is the defect migration 020 would have shipped.'

  union all
  select
    62,
    '[TARGET_DUPLICATE] no two owner-approved targets land on the same active key',
    '0 colliding target keys',
    (select colliding_keys::text from target_dupes) || ' colliding',
    case when (select colliding_keys from target_dupes) = 0 then 'PASS' else 'FAIL' end,
    'Distinct from [TARGET_COLLISION]: this compares the manifest against ITSELF, which is the only way to catch two owner-approved source rows converging onto one canonical key when neither of them holds that identity yet.'

  -- ── Section 7. The legacy program-wide row (requirement E) ────────────────
  union all
  select
    70,
    '[LIEU_LEGACY] the program-wide legacy row is exactly as the owner recorded it',
    'scope_id=17a86485-c241-4cff-9bd5-60efe75b802a, season_id IS NULL, scope_level=admin, status=active',
    coalesce((select 'season=' || coalesce(got_season, '<null>') || ' level=' || coalesce(got_level, '<null>')
                     || ' status=' || coalesce(got_status, '<null>') from drift where manifest_key = 'lieu'), '<row not found>'),
    case when (select count(*) from drift where manifest_key = 'lieu' and scope_rows = 1
                 and got_season is null and got_level = 'admin' and got_status = 'active') = 1
         then 'PASS' else 'FAIL' end,
    'This row CANNOT REMAIN ACTIVE after A2, for two independent reasons. (1) Its scope level "admin" is not a canonical level: WP1-A1 drops it at read time, so once A1 deploys this grant confers nothing, and the planned table-wide role CHECK makes the value unrepresentable. (2) Its season_id is NULL, and vam063_authorized_for_scope compares s.season_id = p_season_id::text — NULL = uuid yields NULL — so program-wide scope is refused by the live RPC and cannot be the shape of a working Admin grant until WP1-A3 changes that predicate.'

  union all
  select
    71,
    '[LIEU_LEGACY] the plan leaves no ACTIVE program-wide grant behind',
    '0 active rows with a NULL season after the plan',
    (select count(*)::text from post_plan_violations where status_key = 'active' and season_key is null) || ' row(s)',
    case when (select count(*) from post_plan_violations where status_key = 'active' and season_key is null) = 0
         then 'PASS' else 'FAIL' end,
    'A2 must not create program-wide scope and must not leave any behind, because such a grant reads across the program while being denied every lifecycle mutation. Program-wide semantics are WP1-A3.'

  union all
  select
    72,
    '[INFO] the disposition of the legacy row',
    'retire in place, replace with explicit S11 + S12 grants',
    'RETIRE_IN_PLACE + ADD_S11 + ADD_S12',
    'INFO',
    'The row is retired, never deleted: id and created_at survive, status becomes inactive, and the stored identifiers are canonicalized so the table-wide constraints can be applied. It is NOT converted into a season grant — it was a program-wide claim, and rewriting it into UEHM/S11 would make the audit record describe something that never happened. One value cannot be preserved: the level "admin" has no canonical equivalent, so the retired row records full_access and the apply must copy the pre-image into admin_audit_log first.'

  -- ── Section 8. Hoang and Toan (requirement F) ─────────────────────────────
  union all
  select
    80,
    '[VAM_LEGACY] no unmanaged ACTIVE grant carries a non-canonical program identity',
    '0 rows outside the manifest',
    (select count(*)::text from public.admin_scope_access s
      where s.status = 'active'
        and not exists (select 1 from manifest m where m.scope_id = s.id)
        and (s.program_id is null or btrim(s.program_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) || ' row(s)',
    case when (select count(*) from public.admin_scope_access s
                where s.status = 'active'
                  and not exists (select 1 from manifest m where m.scope_id = s.id)
                  and (s.program_id is null or btrim(s.program_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) = 0
         then 'PASS' else 'FAIL' end,
    'The convergence of Hoang and Toan is authorized by their exact scope_ids, not by the string "VAM" their rows happen to store. There is no generic VAM -> UEHM mapping anywhere in this package, and any other active row storing a legacy program identity is therefore NOT convertible by this plan.'

  union all
  select
    81,
    '[INFO] how many rows store the legacy program identity "VAM"',
    'informational',
    (select count(*)::text from public.admin_scope_access where upper(btrim(program_id)) = 'VAM') || ' row(s) store "VAM"; '
      || (select count(*)::text from manifest m join targets t on t.manifest_key = m.manifest_key
           where upper(btrim(m.cur_program)) = 'VAM' and t.source_scope_id = m.scope_id) || ' of them have an owner-approved target',
    'INFO',
    'Four rows in the inventory store "VAM", and the string itself decides nothing. Hoang and Toan converge to UEHM/S11 full_access because the owner named their exact scope_ids. The inactive historical test row is canonicalized in place without being reactivated. The synthetic reviewer row does not converge at all and blocks this run. One legacy string, three different outcomes — which is the whole argument for a manifest keyed on scope_id.'

  -- ── Section 9. The synthetic active account (requirement G) ───────────────
  union all
  select
    90,
    '[SYNTHETIC_DISPOSITION] the active synthetic test grant has an explicit owner disposition',
    'an owner-approved disposition AND a target encoded for it',
    'disposition=' || e.synthetic_disposition
      || ' authorized=' || e.synthetic_disposition_authorized
      || ' targets_encoded=' || (select count(*)::text from targets t where t.manifest_key = 'synthetic_viewer_test')
      || ' live_state=' || coalesce((select 'status=' || coalesce(got_status,'<null>') || ' program=' || coalesce(got_program,'<null>')
                                     || ' level=' || coalesce(got_level,'<null>') from drift where manifest_key = 'synthetic_viewer_test'), '<row not found>'),
    case when e.synthetic_disposition_authorized
           and (select count(*) from targets t where t.manifest_key = 'synthetic_viewer_test') > 0
         then 'PASS' else 'FAIL' end,
    'viewer.vam.test@redsquarevietnam.com holds an ACTIVE, non-canonical grant on a synthetic account whose platform role is reviewer. It is not silently mapped to a reviewer scope, and it is not silently retired: either would be an authorization decision this package has no standing to make. It is reported as its own named check rather than folded into an unconvertible count, because it is the single reason SAFE_TO_APPLY_V2 is false and it must not be readable as a rounding error. Owner options are enumerated in staff_scope_manifest_v2.json under no_target.options_for_the_owner. NOTE: if the chosen disposition is to canonicalize it as a reviewer, the reviewer PII gap on /matches is a separate, still-open blocker on activating reviewer access.'
  from expected e

  -- ── Section 10. The inactive historical account (requirement H) ───────────
  union all
  select
    100,
    '[HISTORICAL_INACTIVE] the historical test account and its grant are both inactive',
    'account inactive AND grant inactive',
    'account=' || coalesce((select account_status from accounts where manifest_key = 'historical_admin_test'), '<none>')
      || ' grant=' || coalesce((select got_status from drift where manifest_key = 'historical_admin_test'), '<none>'),
    case when (select account_status from accounts where manifest_key = 'historical_admin_test') = 'inactive'
           and (select got_status from drift where manifest_key = 'historical_admin_test') = 'inactive'
         then 'PASS' else 'FAIL' end,
    'It appears in this plan only because the planned constraints are TABLE-WIDE. The canonicalization required is exactly: program_id "VAM" -> ' || e.uehm_program_id
      || ' and season_id "UEHM-S11" -> ' || e.uehm_s11_id
      || '. The program identity is derived from the program that OWNS this row own season (proved by [SEASON_S11]), never from the string "VAM". Its level full_access is already canonical and its status is not touched.'
  from expected e

  union all
  select
    101,
    '[NO_REACTIVATION] the plan activates nothing that is inactive today',
    '0 reactivations',
    (select count(*)::text from post_plan_violations where status_before = 'inactive' and status_key = 'active')
      || ' row reactivation(s); '
      || (select count(*)::text from targets t join accounts a on a.manifest_key = t.manifest_key
           where t.tgt_status = 'active' and a.account_status is distinct from 'active') || ' active grant(s) for a non-active account',
    case when (select count(*) from post_plan_violations where status_before = 'inactive' and status_key = 'active') = 0
           and (select count(*) from targets t join accounts a on a.manifest_key = t.manifest_key
                 where t.tgt_status = 'active' and a.account_status is distinct from 'active') = 0
         then 'PASS' else 'FAIL' end,
    'Two distinct ways authority could be created by accident, both refused. The first is a status flip on an existing row; the second is a fresh ACTIVE grant issued to an account that is not active. Rewriting a stored identifier is not the same act as restoring authority, and this check is what keeps them separate.'

  union all
  select
    102,
    '[INFO] identifier canonicalization versus authority, stated explicitly',
    'identifiers change; status does not',
    'historical row target: status=' || coalesce((select tgt_status from targets where manifest_key = 'historical_admin_test'), '<none>')
      || ', source status=' || coalesce((select got_status from drift where manifest_key = 'historical_admin_test'), '<none>'),
    'INFO',
    'The row confers nothing before or after: the account is inactive, the grant is inactive, the planned unique index is partial on status = active, and every read path filters status = active. The rewrite exists solely so program_id NOT NULL and the canonical-UUID CHECK can be applied to a table that includes retired rows.'

  -- ── Section 11. Constraint compatibility (requirement I) ──────────────────
  union all
  select
    110,
    '[CONSTRAINT_ROW] no row of ANY status violates a planned constraint after the plan',
    '0 blocking rows',
    (select count(*)::text from post_plan_violations where violates) || ' blocking row(s)',
    case when (select count(*) from post_plan_violations where violates) = 0 then 'PASS' else 'FAIL' end,
    'Breakdown — null program: '     || (select count(*)::text from post_plan_violations where v_program_null)
      || ', non-canonical program: ' || (select count(*)::text from post_plan_violations where v_program_format)
      || ', non-canonical season: '  || (select count(*)::text from post_plan_violations where v_season_format)
      || ', level outside vocabulary: ' || (select count(*)::text from post_plan_violations where v_level)
      || ', status outside vocabulary: ' || (select count(*)::text from post_plan_violations where v_status)
      || '. Blocking scope_ids: ' || coalesce((select string_agg(coalesce(scope_id::text, '<new row: ' || applied_target || '>'), ', ')
                                               from post_plan_violations where violates), '<none>')
      || '. Note both planned CHECKs are NULL-permissive by SQL semantics, so a NULL level or status is counted here explicitly rather than assumed caught by the CHECK.'

  union all
  select
    111,
    '[INFO] how many rows violate those constraints TODAY, before any conversion',
    'informational baseline',
    (select count(*)::text from public.admin_scope_access s
      where s.program_id is null
         or btrim(s.program_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or (s.season_id is not null and btrim(s.season_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
         or s.role is null   or s.role   not in ('full_access','operations','review','read')
         or s.status is null or s.status not in ('active','inactive')) || ' row(s) today',
    'INFO',
    'The distance A2 has to close. Compare with check 110: what remains there is what the plan does NOT fix, which is the honest measure of what is still undecided.'

  -- ── Section 12. Live RPC compatibility (requirement J) ────────────────────
  union all
  select
    120,
    '[RPC_COMPAT] the live vam063_authorized_for_scope accepts the planned targets unchanged',
    '1 function; accepts full_access; requires program and season equality on active grants',
    'functions=' || rf.fn_count || ' full_access=' || rf.accepts_full_access || ' operations=' || rf.accepts_operations
      || ' program_eq=' || rf.requires_program_equality || ' season_eq=' || rf.requires_season_equality
      || ' active_only=' || rf.requires_active_grant,
    case when rf.fn_count = 1 and rf.accepts_full_access and rf.requires_program_equality
              and rf.requires_season_equality and rf.requires_active_grant
         then 'PASS' else 'FAIL' end,
    'Read from pg_get_functiondef; the function is never invoked by this preflight. Every planned target is (canonical program UUID as text, canonical season UUID as text, full_access, active), which satisfies all four predicates the function applies, so A2 needs no change to the RPC and this package makes none.'
  from rpc_facts rf

  union all
  select
    121,
    '[INFO] what the same RPC refuses, and why it shapes this plan',
    'informational',
    'season NULL refused; levels review/read refused for mutations',
    'INFO',
    'The RPC predicate is s.season_id = p_season_id::text, so a program-wide grant yields NULL and is refused — that is why the legacy program-wide row cannot be replaced by another one, and why WP1-A3 exists. Its level filter is role in (full_access, operations), so review and read grants read but never mutate — relevant if the owner disposes of the synthetic row by canonicalizing it as a reviewer.'
)
select seq, check_name, expected, actual, result, details from checks
union all
select
  999,
  'SAFE_TO_APPLY_V2',
  'true',
  case when exists (select 1 from checks where result = 'FAIL') then 'false' else 'true' end,
  case when exists (select 1 from checks where result = 'FAIL') then 'FAIL' else 'PASS' end,
  case
    when exists (select 1 from checks where result = 'FAIL')
      then 'BLOCKED by ' || (select count(*)::text from checks where result = 'FAIL') || ' failing check(s): '
           || (select string_agg(check_name, '; ' order by seq) from checks where result = 'FAIL')
           || '. Do not author or apply the WP1-A2 migration, and do not deploy WP1-A1, until every one is resolved. A run that fails ONLY on [SYNTHETIC_DISPOSITION] and [CONSTRAINT_ROW] is the expected outcome of this package as committed: both trace to one undisposed synthetic row, and both clear together once the owner decides.'
    else 'All gating checks passed against this baseline. The A2 apply may now be authored. INFO rows remain owner decisions and must be read before applying.'
  end
order by 1;

rollback;

-- =============================================================================
-- END. All three transactions above are READ ONLY and end in ROLLBACK. Running
-- this file changes nothing, invokes no application function, holds no lock
-- beyond the read, and leaves no trace other than its three result sets.
-- =============================================================================
