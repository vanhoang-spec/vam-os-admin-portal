-- VAM OS — UAT fixture STAGING schema preflight (READ ONLY).
--
-- Purpose
--   A REST dry-run of create-uat-fixtures.mjs proves the plan and the live data
--   lookups. It cannot prove live column types, check constraints, unique
--   indexes or foreign-key delete behaviour, because PostgREST never exposes
--   them. Those are exactly the things the fixture scripts depend on, so this
--   file verifies them directly and emits explicit PASS / FAIL / INFO rows.
--
--   This file performs NO writes. It opens a read-only transaction, runs only
--   SELECTs, and ends with ROLLBACK. It contains no DDL and no DML, and it must
--   never be turned into a migration.
--
-- Execution mechanism (for the operator or the connected-review agent)
--   PostgREST cannot run this: it is multi-statement SQL against catalog tables,
--   and there is deliberately no RPC wrapper for it — adding one would create a
--   service-role-callable SQL surface, which is a larger risk than running the
--   file by hand. Run it through a direct Postgres session instead:
--
--     psql "$STAGING_DIRECT_CONNECTION_URI" \
--       -v ON_ERROR_STOP=1 \
--       -v run_id=20260805-01 \
--       -f scripts/uat-fixture-staging-preflight.sql
--
--   or paste it into the Supabase SQL editor after replacing :'run_id' with the
--   quoted run id. The `run_id` variable is REQUIRED; without -v run_id=... psql
--   aborts on the unbound variable rather than checking the wrong identity.
--
-- Interpreting the result
--   One result set with columns: sort_key, check_name, status, detail.
--   Any FAIL row blocks apply. INFO rows require a human decision and are never
--   sufficient on their own. An empty result set means the file did not run.

BEGIN;

SET TRANSACTION READ ONLY;

WITH
run_id AS (
  SELECT :'run_id'::text AS value
),
account_emails AS (
  SELECT unnest(ARRAY[
    'uat.admin+20260805@example.com',
    'uat.reviewer+20260805@example.com',
    'uat.support+20260805@example.com',
    'uat.viewer+20260805@example.com',
    'uat.nonadmin+20260805@example.com',
    'uat.inactive+20260805@example.com'
  ]) AS address
),
person_identity AS (
  SELECT
    'uat.person+' || r.value || '@example.com' AS address,
    'VAM-UAT-' || r.value || ' Person'         AS full_name,
    'vam_uat_person_run:' || r.value           AS active_marker,
    'vam_uat_person_run:' || r.value || ':retained' AS retained_marker
  FROM run_id r
),
expected_columns(table_name, column_name, expected_type, expected_nullable) AS (
  VALUES
    ('admin_users',               'id',              'uuid', NULL),
    ('admin_users',               'auth_user_id',    'uuid', 'YES'),
    ('admin_users',               'email',           'text', 'NO'),
    ('admin_users',               'full_name',       'text', 'YES'),
    ('admin_users',               'role',            'text', 'NO'),
    ('admin_users',               'status',          'text', 'NO'),
    ('admin_users',               'notes',           'text', 'YES'),
    ('admin_scope_access',        'id',              'uuid', 'NO'),
    ('admin_scope_access',        'user_id',         'uuid', 'NO'),
    ('admin_scope_access',        'program_id',      'text', NULL),
    ('admin_scope_access',        'season_id',       'text', NULL),
    ('admin_scope_access',        'role',            'text', 'NO'),
    ('admin_scope_access',        'status',          'text', 'NO'),
    ('people',                    'id',              'uuid', 'NO'),
    ('people',                    'full_name',       'text', NULL),
    ('people',                    'email_primary',   'text', NULL),
    ('people',                    'source_sheets',   'text', NULL),
    ('people',                    'data_quality_flags', 'text', NULL),
    ('person_season_memberships', 'id',              'uuid', 'NO'),
    ('person_season_memberships', 'person_id',       'uuid', 'NO'),
    ('person_season_memberships', 'program_id',      'uuid', 'NO'),
    ('person_season_memberships', 'season_id',       'uuid', 'NO'),
    ('person_season_memberships', 'intake_batch_id', 'uuid', 'YES'),
    ('person_season_memberships', 'role',            'text', 'NO'),
    ('person_season_memberships', 'status',          'text', 'NO'),
    ('person_season_memberships', 'source',          'text', 'NO'),
    ('person_season_memberships', 'notes',           'text', 'YES'),
    ('person_season_memberships', 'created_by',      'uuid', 'YES'),
    ('admin_audit_log',           'actor_admin_user_id',  'uuid', NULL),
    ('admin_audit_log',           'target_admin_user_id', 'uuid', NULL),
    ('person_season_membership_log', 'membership_id', 'uuid', 'NO'),
    ('person_season_membership_log', 'person_id',     'uuid', 'NO')
),
actual_columns AS (
  SELECT c.table_name::text AS table_name,
         c.column_name::text AS column_name,
         c.data_type::text AS data_type,
         c.is_nullable::text AS is_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
),
season_row AS (
  SELECT s.id, s.code, s.program_id
  FROM public.seasons s
  WHERE s.code = 'UEHM-S12'
),
program_row AS (
  SELECT p.id, p.code, p.is_active
  FROM public.programs p
  WHERE p.id = (SELECT program_id FROM season_row)
),
batch_row AS (
  SELECT b.id, b.code, b.season_id
  FROM public.intake_batches b
  WHERE b.code = 'UEHM-S12-B1'
),
checks AS (

  -- 1. Environment identity -------------------------------------------------
  SELECT 10 AS sort_key,
         'environment.database' AS check_name,
         'INFO' AS status,
         'current_database=' || current_database()::text ||
         ' — confirm out of band that this session targets VAM OS staging, not production' AS detail

  UNION ALL
  SELECT 11,
         'environment.run_id',
         CASE WHEN (SELECT value FROM run_id) ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                   AND length((SELECT value FROM run_id)) BETWEEN 3 AND 32
              THEN 'PASS' ELSE 'FAIL' END,
         'supplied run_id=' || coalesce((SELECT value FROM run_id), '<null>')

  -- 2. Migration 062 applied state -----------------------------------------
  UNION ALL
  SELECT 20,
         'migration_062.applied',
         CASE WHEN to_regprocedure('public.vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text)') IS NOT NULL
                   AND to_regclass('public.account_import_batches') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         'vam062_upsert_scope_atomic=' ||
           coalesce(to_regprocedure('public.vam062_upsert_scope_atomic(uuid,uuid,uuid,text,text)')::text, 'missing') ||
         ', account_import_batches=' ||
           coalesce(to_regclass('public.account_import_batches')::text, 'missing')

  -- 3. admin_users lifecycle vocabulary (DEC-04) ----------------------------
  UNION ALL
  SELECT 21,
         'admin_users.status_vocabulary',
         CASE
           WHEN c.oid IS NULL THEN 'FAIL'
           WHEN pg_get_constraintdef(c.oid) ILIKE '%''invited''%' THEN 'FAIL'
           WHEN pg_get_constraintdef(c.oid) ILIKE '%''suspended''%' THEN 'FAIL'
           WHEN pg_get_constraintdef(c.oid) ILIKE '%''active''%'
                AND pg_get_constraintdef(c.oid) ILIKE '%''inactive''%' THEN 'PASS'
           ELSE 'FAIL'
         END,
         coalesce(pg_get_constraintdef(c.oid), 'admin_users status check constraint not found') ||
         ' — fixtures provision active/inactive only'
  FROM (SELECT 1 AS one) anchor
  LEFT JOIN pg_constraint c
    ON c.conrelid = 'public.admin_users'::regclass
   AND c.contype = 'c'
   AND pg_get_constraintdef(c.oid) ILIKE '%status%'

  -- 4. admin_users role vocabulary ------------------------------------------
  UNION ALL
  SELECT 22,
         'admin_users.role_vocabulary',
         CASE WHEN bool_or(pg_get_constraintdef(c.oid) ILIKE '%''support_team''%'
                           AND pg_get_constraintdef(c.oid) ILIKE '%''reviewer''%'
                           AND pg_get_constraintdef(c.oid) ILIKE '%''viewer''%'
                           AND pg_get_constraintdef(c.oid) ILIKE '%''admin''%')
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(pg_get_constraintdef(c.oid), ' | '), 'no role check constraint found')
  FROM pg_constraint c
  WHERE c.conrelid = 'public.admin_users'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%role%'

  -- 5. admin_scope_access vocabulary ----------------------------------------
  UNION ALL
  SELECT 23,
         'admin_scope_access.role_vocabulary',
         CASE WHEN bool_or(pg_get_constraintdef(c.oid) ILIKE '%''full_access''%'
                           AND pg_get_constraintdef(c.oid) ILIKE '%''operations''%'
                           AND pg_get_constraintdef(c.oid) ILIKE '%''review''%'
                           AND pg_get_constraintdef(c.oid) ILIKE '%''read''%')
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(pg_get_constraintdef(c.oid), ' | '), 'no scope role check constraint found')
  FROM pg_constraint c
  WHERE c.conrelid = 'public.admin_scope_access'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%role%'

  -- 6. membership vocabulary -------------------------------------------------
  UNION ALL
  SELECT 24,
         'person_season_memberships.vocabulary',
         CASE WHEN bool_or(pg_get_constraintdef(c.oid) ILIKE '%''mentor''%')
                   AND bool_or(pg_get_constraintdef(c.oid) ILIKE '%''active''%'
                               AND pg_get_constraintdef(c.oid) ILIKE '%''cancelled''%')
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(pg_get_constraintdef(c.oid), ' | '), 'no membership check constraints found')
  FROM pg_constraint c
  WHERE c.conrelid = 'public.person_season_memberships'::regclass
    AND c.contype = 'c'

  -- 7. Column shape and types ------------------------------------------------
  UNION ALL
  SELECT 30,
         'column:' || e.table_name || '.' || e.column_name,
         CASE
           WHEN a.column_name IS NULL THEN 'FAIL'
           WHEN a.data_type <> e.expected_type THEN 'FAIL'
           WHEN e.expected_nullable IS NOT NULL AND a.is_nullable <> e.expected_nullable THEN 'FAIL'
           ELSE 'PASS'
         END,
         coalesce('actual type=' || a.data_type || ' nullable=' || a.is_nullable, 'column missing') ||
         ' / expected type=' || e.expected_type ||
         ' nullable=' || coalesce(e.expected_nullable, 'any')
  FROM expected_columns e
  LEFT JOIN actual_columns a
    ON a.table_name = e.table_name AND a.column_name = e.column_name

  -- 7b. admin_users.id specific validation -----------------------------------
  UNION ALL
  SELECT 31,
         'admin_users.id_default',
         CASE WHEN coalesce(c.column_default, '') ILIKE '%uuid_generate%' OR coalesce(c.column_default, '') ILIKE '%gen_random_uuid%' THEN 'PASS' ELSE 'FAIL' END,
         'admin_users.id default=' || coalesce(c.column_default, '<none>')
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'admin_users' AND c.column_name = 'id'

  UNION ALL
  SELECT 32,
         'admin_users.id_nullability',
         CASE WHEN c.is_nullable = 'NO' THEN 'PASS' ELSE 'INFO' END,
         'admin_users.id nullable=' || c.is_nullable || ' — should be NO (schema divergence backlog)'
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'admin_users' AND c.column_name = 'id'

  UNION ALL
  SELECT 33,
         'admin_users.id_data_nulls',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         'admin_users rows with id IS NULL: ' || count(*)::text
  FROM public.admin_users WHERE id IS NULL

  UNION ALL
  SELECT 34,
         'admin_users.id_data_dupes',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         'admin_users duplicate non-null ids: ' || count(*)::text
  FROM (SELECT id FROM public.admin_users WHERE id IS NOT NULL GROUP BY id HAVING count(*) > 1) d

  UNION ALL
  SELECT 35,
         'admin_users.pk_shape',
         'INFO',
         'admin_users primary key is on ' || coalesce(string_agg(a.attname, ', '), '<none>')
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'public.admin_users'::regclass AND i.indisprimary

  -- 8. Unique constraints the exact-recovery queries rely on -----------------
  UNION ALL
  SELECT 40,
         'unique.admin_users_email',
         CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END,
         'unique indexes on admin_users(email): ' || count(*)::text ||
         ' — the malformed-response recovery query assumes at most one row per email'
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = ANY (i.indkey)
  WHERE t.relname = 'admin_users' AND i.indisunique AND att.attname = 'email' AND i.indnkeyatts = 1

  UNION ALL
  SELECT 41,
         'unique.people_email_primary',
         CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'INFO' END,
         'unique indexes on people(email_primary): ' || count(*)::text ||
         ' — without one, the person recovery query relies on data hygiene alone'
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = ANY (i.indkey)
  WHERE t.relname = 'people' AND i.indisunique AND att.attname = 'email_primary' AND i.indnkeyatts = 1

  UNION ALL
  SELECT 44,
         'unique.admin_users_id',
         CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END,
         'unique indexes on admin_users(id): ' || count(*)::text ||
         ' — unique id support required by current code and FKs'
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = ANY (i.indkey)
  WHERE t.relname = 'admin_users' AND i.indisunique AND att.attname = 'id' AND i.indnkeyatts = 1

  UNION ALL
  SELECT 42,
         'unique.membership_person_season_role',
         CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END,
         'unique constraints on person_season_memberships(person_id, season_id, role): ' || count(*)::text
  FROM pg_constraint c
  WHERE c.conrelid = 'public.person_season_memberships'::regclass
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) = 'UNIQUE (person_id, season_id, role)'

  UNION ALL
  SELECT 43,
         'unique.admin_scope_access_active_scope',
         CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'INFO' END,
         'partial unique indexes on admin_scope_access where status=active: ' || count(*)::text
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  WHERE t.relname = 'admin_scope_access' AND i.indisunique AND i.indpred IS NOT NULL

  -- 9. Foreign-key delete behaviour cleanup depends on -----------------------
  UNION ALL
  SELECT 50,
         'fk.subject_pinning.' || c.conname::text,
         CASE WHEN c.confdeltype IN ('a', 'r') THEN 'PASS' ELSE 'FAIL' END,
         'confdeltype=' || c.confdeltype::text ||
         ' (a=no action, r=restrict — both pin the parent row, which cleanup relies on)'
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f'
    AND c.confrelid IN ('public.admin_users'::regclass, 'public.person_season_memberships'::regclass, 'public.people'::regclass)
    AND c.conrelid IN ('public.admin_audit_log'::regclass, 'public.person_season_membership_log'::regclass)
    AND a.attname <> 'changed_by'

  UNION ALL
  SELECT 53,
         'fk.actor_attribution.' || c.conname::text,
         CASE WHEN c.confdeltype = 'n' THEN 'PASS' ELSE 'FAIL' END,
         'confdeltype=' || c.confdeltype::text ||
         ' (n=set null — acceptable for actor attribution, authoritative from migration 052)'
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f'
    AND c.conrelid = 'public.person_season_membership_log'::regclass
    AND a.attname = 'changed_by'

  UNION ALL
  SELECT 54,
         'fk.actor_attribution.trigger_interaction.' || c.conname::text,
         'INFO',
         'actor-attribution FK ' || c.conname::text || ' with confdeltype=' || c.confdeltype::text ||
         ' interacts with append-only trigger — attempting to cascade SET NULL may be rejected'
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f'
    AND c.conrelid = 'public.person_season_membership_log'::regclass
    AND a.attname = 'changed_by'

  UNION ALL
  SELECT 51,
         'fk.admin_users_auth_user_id_absent',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'INFO' END,
         'foreign keys on admin_users.auth_user_id: ' || count(*)::text ||
         ' — teardown nulls this column and then deletes the Auth user; a FK here would change that ordering'
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.admin_users'::regclass
    AND c.contype = 'f'
    AND a.attname = 'auth_user_id'

  -- 10. Append-only protection on the lifecycle log --------------------------
  UNION ALL
  SELECT 52,
         'trigger.person_season_membership_log_append_only',
         CASE WHEN count(*) >= 2 THEN 'PASS' ELSE 'FAIL' END,
         'row-level triggers guarding the log: ' || count(*)::text || ' (expected update and delete guards)'
  FROM pg_trigger tg
  WHERE tg.tgrelid = 'public.person_season_membership_log'::regclass
    AND NOT tg.tgisinternal

  -- 11. Program / season / batch --------------------------------------------
  UNION ALL
  SELECT 60,
         'scope.season_UEHM-S12',
         CASE WHEN (SELECT count(*) FROM season_row) = 1 THEN 'PASS' ELSE 'FAIL' END,
         'seasons rows with code UEHM-S12: ' || (SELECT count(*) FROM season_row)::text

  UNION ALL
  SELECT 61,
         'scope.program_active',
         CASE WHEN (SELECT bool_and(is_active) FROM program_row) THEN 'PASS' ELSE 'FAIL' END,
         'program code=' || coalesce((SELECT code FROM program_row), '<none>') ||
         ' is_active=' || coalesce((SELECT is_active FROM program_row)::text, '<none>')

  UNION ALL
  SELECT 62,
         'scope.batch_UEHM-S12-B1',
         CASE
           WHEN (SELECT count(*) FROM batch_row) = 0 THEN 'INFO'
           WHEN (SELECT count(*) FROM batch_row) = 1
                AND (SELECT season_id FROM batch_row) = (SELECT id FROM season_row) THEN 'PASS'
           ELSE 'FAIL'
         END,
         'intake_batches rows with code UEHM-S12-B1: ' || (SELECT count(*) FROM batch_row)::text ||
         ' — the membership intake_batch_id is nullable, so absence is tolerated'

  -- 12. Stable account identity collisions -----------------------------------
  UNION ALL
  SELECT 70,
         'collision.admin_users_accounts',
         CASE
           WHEN count(au.email) FILTER (WHERE au.notes IS DISTINCT FROM 'VAM UAT fixture 20260805') > 0 THEN 'FAIL'
           ELSE 'PASS'
         END,
         'matched admin_users rows on fixture account emails: ' || count(au.email)::text ||
         ', of which carrying a foreign or missing marker: ' ||
         count(au.email) FILTER (WHERE au.notes IS DISTINCT FROM 'VAM UAT fixture 20260805')::text
  FROM account_emails ae
  LEFT JOIN public.admin_users au ON au.email = ae.address

  UNION ALL
  SELECT 71,
         'ambiguity.admin_users_accounts',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         'fixture account emails matching more than one admin_users row: ' || count(*)::text
  FROM (
    SELECT au.email
    FROM public.admin_users au
    JOIN account_emails ae ON ae.address = au.email
    GROUP BY au.email
    HAVING count(*) > 1
  ) dupes

  -- 13. Per-run person identity ----------------------------------------------
  UNION ALL
  SELECT 80,
         'run_identity.person',
         CASE
           WHEN count(*) = 0 THEN 'PASS'
           WHEN count(*) > 1 THEN 'FAIL'
           WHEN bool_and(p.data_quality_flags = (SELECT active_marker FROM person_identity)
                         AND p.full_name = (SELECT full_name FROM person_identity)) THEN 'INFO'
           ELSE 'FAIL'
         END,
         'people rows on this run''s person email: ' || count(*)::text ||
         ', markers: ' || coalesce(string_agg(coalesce(p.data_quality_flags, '<null>'), ', '), '<none>') ||
         ' — 0 means a fresh run; exactly one active marker means a resumable run;' ||
         ' a retained marker means this run id is spent and a new one is required'
  FROM public.people p
  WHERE p.email_primary = (SELECT address FROM person_identity)

  -- 14. Auth identity (best effort; auth schema may not be readable) ---------
  UNION ALL
  SELECT 90,
         'auth.users_visibility',
         CASE WHEN to_regclass('auth.users') IS NULL THEN 'INFO' ELSE 'PASS' END,
         CASE WHEN to_regclass('auth.users') IS NULL
              THEN 'auth.users is not visible to this session — verify Auth-side collisions via the Admin API instead'
              ELSE 'auth.users is readable; see auth.account_collision row' END

  UNION ALL
  SELECT 91,
         'auth.account_collision',
         CASE
           WHEN to_regclass('auth.users') IS NULL THEN 'INFO'
           ELSE 'INFO'
         END,
         'checked out of band — list Auth users for the six fixture emails and this run''s person email,' ||
         ' and confirm every existing one carries user_metadata.vam_uat_fixture = 20260805'
)
SELECT sort_key, check_name, status, detail
FROM checks
ORDER BY (status = 'FAIL') DESC, (status = 'INFO') DESC, sort_key, check_name;

ROLLBACK;
