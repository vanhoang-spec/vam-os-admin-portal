-- =============================================================================
-- VAM OS — M069 SEASON 12 APPLICATION INTAKE CONTROL — PREFLIGHT
--
-- READ-ONLY. Makes no change of any kind. Run this first, in its own session,
-- and record the emitted token. apply.sql refuses to be useful if the facts
-- asserted here are not true.
--
-- Target : PRODUCTION (vam-os-mvp / qkkroesfiazsejkzflcd) after the S12
--          release R4.2 has been applied and verified.
-- Session: set `timezone = 'UTC'` or the emitted seals are not comparable.
--
-- REFUSES on any of:
--   [ENV_NOT_PRODUCTION]     vam062_* functions exist — this is Staging
--   [SEASON_MISSING]         UEHM-S12 absent or not owned by program UEHM
--   [BATCH_MISSING]          UEHM-S12-B1 absent or not owned by UEHM-S12
--   [S11_BINDING]            the S12 intake resolves to a Season 11 season
--   [ALREADY_APPLIED]        application_form_controls already exists
--   [CONFLICTING_ROWS]       control rows exist without the table (impossible
--                            state, checked anyway)
--   [AUDIT_TABLE_MISSING]    admin_audit_log absent
--   [AUDIT_COLUMNS]          admin_audit_log is not the 13-column Production
--                            shape the release left behind
--   [AUDIT_ACTION_NOT_NULL]  action / actor_email / target_email / metadata is
--                            NOT NULL without a default, so the M069 audit
--                            INSERT would abort with 23502
--   [AUDIT_VOCAB_MISSING]    the 52-value action_type CHECK is absent — the
--                            release T1 has not been applied here
--   [AUDIT_VOCAB_UNEXPECTED] the CHECK exists but is not the 52-value list
--   [ADMIN_USERS_MISSING]    admin_users absent (updated_by FK target)
--   [FUNCTION_PRESENT]       a vam069_* function already exists
-- =============================================================================

\echo '=== M069 PREFLIGHT — READ ONLY ==='

do $m069_preflight$
declare
  v_season_id  uuid;
  v_batch_id   uuid;
  v_program    text;
  v_cols       text[];
  v_txt        text;
  v_n          integer;
  v_def        text;
  v_audit_cols constant text[] := array[
    'action','action_type','actor_admin_user_id','actor_email','after_data',
    'before_data','created_at','details','id','metadata','target_admin_user_id',
    'target_email','updated_at'
  ];
begin
  -- ══ 1. Environment ════════════════════════════════════════════════════════
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vam062\_%') then
    raise exception 'M069 PREFLIGHT REFUSED [ENV_NOT_PRODUCTION]: vam062_* functions exist — this is Staging.';
  end if;

  if to_regclass('public.admin_users') is null then
    raise exception 'M069 PREFLIGHT REFUSED [ADMIN_USERS_MISSING]: admin_users does not exist; updated_by has no FK target.';
  end if;

  -- ══ 2. Migration is unapplied ═════════════════════════════════════════════
  if to_regclass('public.application_form_controls') is not null then
    raise exception 'M069 PREFLIGHT REFUSED [ALREADY_APPLIED]: application_form_controls already exists. Run verifier.sql instead.';
  end if;

  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'vam069\_%';
  if v_n <> 0 then
    raise exception 'M069 PREFLIGHT REFUSED [FUNCTION_PRESENT]: % vam069_* function(s) already exist.', v_n;
  end if;

  -- ══ 3. Program / season / intake exist and are correctly related ══════════
  select s.id, p.code into v_season_id, v_program
  from public.seasons s
  join public.programs p on p.id = s.program_id
  where s.code = 'UEHM-S12';

  if v_season_id is null then
    raise exception 'M069 PREFLIGHT REFUSED [SEASON_MISSING]: season UEHM-S12 not found.';
  end if;
  if v_program is distinct from 'UEHM' then
    raise exception 'M069 PREFLIGHT REFUSED [SEASON_MISSING]: UEHM-S12 belongs to program %, expected UEHM.', coalesce(v_program, '<null>');
  end if;

  select b.id into v_batch_id
  from public.intake_batches b
  where b.code = 'UEHM-S12-B1' and b.season_id = v_season_id;

  if v_batch_id is null then
    raise exception 'M069 PREFLIGHT REFUSED [BATCH_MISSING]: intake batch UEHM-S12-B1 not found under season UEHM-S12.';
  end if;

  -- Explicit S11 guard. The seed joins on codes; this proves the codes do not
  -- resolve to a Season 11 row through some historical duplicate.
  if exists (
    select 1 from public.intake_batches b
    join public.seasons s on s.id = b.season_id
    where b.id = v_batch_id and s.code like '%S11%'
  ) then
    raise exception 'M069 PREFLIGHT REFUSED [S11_BINDING]: UEHM-S12-B1 resolves to a Season 11 season.';
  end if;

  -- More than one season or batch with these codes would make the seed
  -- ambiguous about which row it binds to.
  select count(*) into v_n from public.seasons where code = 'UEHM-S12';
  if v_n <> 1 then
    raise exception 'M069 PREFLIGHT REFUSED [SEASON_MISSING]: % rows with code UEHM-S12, expected exactly 1.', v_n;
  end if;
  select count(*) into v_n from public.intake_batches where code = 'UEHM-S12-B1';
  if v_n <> 1 then
    raise exception 'M069 PREFLIGHT REFUSED [BATCH_MISSING]: % rows with code UEHM-S12-B1, expected exactly 1.', v_n;
  end if;

  -- ══ 4. Audit prerequisites ════════════════════════════════════════════════
  if to_regclass('public.admin_audit_log') is null then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_TABLE_MISSING]: admin_audit_log does not exist.';
  end if;

  select array_agg(column_name order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_audit_log';
  if v_cols is distinct from v_audit_cols then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_COLUMNS]: admin_audit_log is %, expected the 13 post-release columns %.', v_cols, v_audit_cols;
  end if;

  -- The S12 release T1 dropped NOT NULL on these four legacy columns. If any
  -- of them is NOT NULL without a default here, the M069 audit INSERT aborts
  -- with 23502 — and because that INSERT shares a transaction with the state
  -- change, the toggle would fail entirely.
  select string_agg(a.attname, ', ' order by a.attname) into v_txt
  from pg_attribute a
  where a.attrelid = to_regclass('public.admin_audit_log')
    and a.attname in ('action','actor_email','target_email','metadata')
    and a.attnum > 0 and not a.attisdropped
    and a.attnotnull and a.atthasdef is false
    and a.attidentity = '' and a.attgenerated = '';
  if v_txt is not null then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_ACTION_NOT_NULL]: legacy column(s) % are NOT NULL without a default. Apply the S12 release T1 first.', v_txt;
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  if v_def is null then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_MISSING]: admin_audit_log_action_type_check is absent. The S12 release T1 has not been applied to this database.';
  end if;

  select count(distinct m[1]) into v_n
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
  where c.conrelid = to_regclass('public.admin_audit_log')
    and c.conname = 'admin_audit_log_action_type_check';

  if v_n <> 52 then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_UNEXPECTED]: the action_type CHECK holds % values, expected the 52 installed by the S12 release T1.', v_n;
  end if;

  if v_def like '%set_application_form_state%' then
    raise exception 'M069 PREFLIGHT REFUSED [AUDIT_VOCAB_UNEXPECTED]: the vocabulary already admits set_application_form_state at 52 values. Re-derive this package.';
  end if;

  -- ══ 5. No conflicting rows ════════════════════════════════════════════════
  -- The table does not exist (asserted above), so there can be no control
  -- rows. Asserted anyway so a partially-applied state cannot slip through.
  if to_regclass('public.application_form_controls') is not null then
    select count(*) into v_n from public.application_form_controls;
    if v_n <> 0 then
      raise exception 'M069 PREFLIGHT REFUSED [CONFLICTING_ROWS]: % pre-existing control row(s).', v_n;
    end if;
  end if;

  raise notice 'M069 PREFLIGHT PASSED. Season, intake, audit schema, audit vocabulary and unapplied state all matched. Record the emitted values below, then run apply.sql.';
end
$m069_preflight$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PASS TOKEN AND BASELINE SEALS
-- Expected token on the reviewed R4.2 Production baseline:
--   M069:ABSENT:52:VALIDATED:NULLABLE4:S12OK
-- ═══════════════════════════════════════════════════════════════════════════
select
  'M069:'
  || case when to_regclass('public.application_form_controls') is null then 'ABSENT' else 'PRESENT' end
  || ':' || coalesce((
       select count(distinct m[1])::text
       from pg_constraint c
       cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
       where c.conrelid = to_regclass('public.admin_audit_log')
         and c.conname = 'admin_audit_log_action_type_check'
     ), '0')
  || ':' || coalesce((
       select case when c.convalidated then 'VALIDATED' else 'NOTVALID' end
       from pg_constraint c
       where c.conrelid = to_regclass('public.admin_audit_log')
         and c.conname = 'admin_audit_log_action_type_check'
     ), 'NOCHECK')
  || ':NULLABLE' || (
       select count(*)::text from pg_attribute a
       where a.attrelid = to_regclass('public.admin_audit_log')
         and a.attname in ('action','actor_email','target_email','metadata')
         and a.attnum > 0 and not a.attisdropped and not a.attnotnull
     )
  || ':' || case when exists (
       select 1 from public.intake_batches b
       join public.seasons s on s.id = b.season_id
       join public.programs p on p.id = s.program_id
       where b.code = 'UEHM-S12-B1' and s.code = 'UEHM-S12' and p.code = 'UEHM'
     ) then 'S12OK' else 'S12BAD' end
  as preflight_token,
  md5(coalesce((
    select string_agg(column_name || ':' || data_type || ':' || is_nullable, '|' order by column_name)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_audit_log'
  ), '<none>')) as audit_column_seal,
  (select count(*) from public.admin_audit_log) as audit_rows_now,
  now() at time zone 'UTC' as captured_at_utc;
