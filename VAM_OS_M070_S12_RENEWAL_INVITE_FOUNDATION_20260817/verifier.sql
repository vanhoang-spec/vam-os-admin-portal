-- =============================================================================
-- VAM OS — M070 RETURNING-MENTOR RENEWAL INVITE FOUNDATION — VERIFIER
--
-- READ-ONLY. Run after apply.sql, in its own session, with
-- `set timezone = 'UTC'`. EVERY check must report PASS, and M070_VERIFIED must
-- be true. Runs inside `begin; set transaction read only; … rollback;`.
--
-- WHY THIS IS NOT A NAME-AND-COUNT VERIFIER
-- A catalog name is not evidence. A CHECK with the right name and a weaker
-- expression, an index with the right name and a wider predicate, a trigger
-- with the right name pointing at a different function, an audit vocabulary
-- with the right size and a substituted value — every one of those passes a
-- name check while leaving the invariant gone. So each check below reads the
-- actual definition and pins it end to end.
--
-- HOW DEFINITIONS ARE PINNED, AND WHY BY ANCHORED REGEX RATHER THAN BY LITERAL
-- M069's verifier compares the complete `pg_get_constraintdef(oid, true)` text
-- against a hard-coded literal. That is the strongest possible test and it is
-- correct — but its expected constants were reconciled against a live
-- PostgreSQL 15.18 catalog before they were trusted, because the server's
-- rendering of parentheses and casts is not something you can derive with
-- certainty from the source text. **No database was contacted while authoring
-- M070**, so a hard-coded literal here would be a guess wearing the costume of
-- a proof, and its first FAIL would be indistinguishable from a real defect.
--
-- Each definition is therefore pinned with a WHOLE-STRING ANCHORED regex over
-- the whitespace-normalised definition: `^…$`, naming the exact column, the
-- exact operator, the exact literals and their order, and tolerating only
-- redundant parenthesisation. That still rejects every mutation M069 documents:
--     CHECK (<canonical>) OR length(role) > 0     -- extra disjunct, unanchored
--     CHECK (role <> ALL (ARRAY[...]))            -- inverted operator
--     CHECK (outcome = ANY (ARRAY[...]))          -- wrong column
-- because none of them matches a pattern anchored at both ends. What it does
-- NOT do is prove the rendering byte-for-byte, and that difference is stated
-- here rather than glossed over.
--
-- Every check emits the LIVE definition in `detail` whether it passes or fails,
-- so the reviewer reads what is actually installed rather than a verdict about
-- it, and so two environments can be diffed directly.
--
-- SUPABASE SQL EDITOR COMPATIBILITY
-- This file contains ZERO psql meta-commands. The marker below is an ordinary
-- `select … as phase` statement, not `\echo`, because the owner's execution
-- path is the Supabase SQL Editor, which is not psql and rejects a
-- backslash-leading line with `42601: syntax error at or near "\"` before
-- executing anything. A test fails the build if one ever reappears.
--
-- The check table is the LAST row-returning statement, so it is what the editor
-- displays. Read every row: `M070_VERIFIED` must be PASS and so must all 23
-- individual checks.
-- =============================================================================

select 'M070 VERIFIER — READ ONLY' as phase;

begin;
set transaction read only;

with
tbl as (
  select to_regclass('public.person_season_invites') as oid
),
cols as (
  select a.attname::text                       as col,
         format_type(a.atttypid, a.atttypmod)  as typ,
         a.attnotnull                          as notnull,
         coalesce(pg_get_expr(d.adbin, d.adrelid), '') as defexpr
  from tbl, pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = tbl.oid and a.attnum > 0 and not a.attisdropped
),
-- The complete column contract: name # type # notnull(t/f).
expected_cols(spec) as (
  select unnest(array[
    'application_id#uuid#f',
    'created_at#timestamp with time zone#t',
    'created_by#uuid#t',
    'expires_at#timestamp with time zone#t',
    'id#uuid#t',
    'outcome#text#f',
    'person_id#uuid#t',
    'program_id#uuid#t',
    'revoked_at#timestamp with time zone#f',
    'role#text#t',
    'season_id#uuid#t',
    'submitted_at#timestamp with time zone#f',
    'token_hash#text#t',
    'updated_at#timestamp with time zone#t'
  ])
),
-- Foreign keys: constrained column # referenced table.column # ON DELETE code
-- (a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL, d = SET DEFAULT).
expected_fks(spec) as (
  select unnest(array[
    'application_id#applications.id#r',
    'created_by#admin_users.id#r',
    'person_id#people.id#c',
    'program_id#programs.id#r',
    'season_id#seasons.id#r'
  ])
),
actual_fks as (
  select (select a.attname::text from pg_attribute a
           where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col,
         (select cl.relname::text from pg_class cl where cl.oid = c.confrelid) as reftbl,
         (select a.attname::text from pg_attribute a
           where a.attrelid = c.confrelid and a.attnum = c.confkey[1]) as refcol,
         c.confdeltype::text as ondel,
         array_length(c.conkey, 1) as nkeys,
         c.convalidated
  from tbl, pg_constraint c
  where c.conrelid = tbl.oid and c.contype = 'f'
),
checks_def as (
  select c.conname::text as name,
         regexp_replace(pg_get_constraintdef(c.oid, true), '\s+', ' ', 'g') as def,
         c.convalidated
  from tbl, pg_constraint c
  where c.conrelid = tbl.oid and c.contype = 'c'
),
idx_def as (
  select ci.relname::text as name,
         regexp_replace(pg_get_indexdef(i.indexrelid), '\s+', ' ', 'g') as def,
         i.indisunique, i.indisvalid, i.indisready
  from tbl, pg_index i join pg_class ci on ci.oid = i.indexrelid
  where i.indrelid = tbl.oid
),
vocab as (
  select c.conname::text as name, c.convalidated,
         pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log') and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%'
),
vocab_vals as (
  select array_agg(distinct m[1]) as vals
  from vocab, regexp_matches(vocab.def, '''([^'']*)''::text', 'g') m
),
base52(b) as (
  select array[
    'accept_registration_proof','add_event_participation','add_manual_recap','add_membership_role',
    'approve_application_as_mentee','approve_application_as_mentor','bulk_add_event_participants',
    'cancel_event','cancel_event_registration','cancel_match','cancel_membership',
    'close_event_registration','confirm_event_registration','confirm_registration_payment',
    'create_action_item','create_admin_user','create_event','create_event_checkin_link',
    'create_event_registration_link','create_manual_match','create_membership','create_mentee_profile',
    'create_mentor_profile','deactivate_admin_user','edit_recap','import_participant_membership',
    'link_person_auth','open_event_registration','opt_out_membership','pause_membership',
    'reactivate_admin_user','reactivate_membership','reconcile_person_auth','reject_event_registration',
    'reject_registration_payment','reject_registration_proof','remove_admin_access',
    'remove_event_participation','remove_membership_role','soft_delete_recap','sync_auth','unknown',
    'update_action_item','update_admin_user','update_admin_user_access','update_event','update_event_participation',
    'update_mentee_profile','update_mentor_profile','update_registration_review_note',
    'waitlist_event_registration','withdraw_membership'
  ]::text[]
),
results(check_id, check_name, status, detail) as (

  -- V01 ─ the table exists and is an ordinary table
  select 'V01', 'table_present',
    case when exists (select 1 from pg_class where oid = (select oid from tbl) and relkind = 'r')
         then 'PASS' else 'FAIL' end,
    coalesce((select relkind::text from pg_class where oid = (select oid from tbl)), '<absent>')

  -- V02 ─ the COMPLETE column contract: 14 columns, exact types, exact nullability
  union all
  select 'V02', 'column_contract',
    case when not exists (
      select 1 from expected_cols e
      left join cols c on c.col = split_part(e.spec, '#', 1)
      where c.col is null
         or c.typ <> split_part(e.spec, '#', 2)
         or (case when c.notnull then 't' else 'f' end) <> split_part(e.spec, '#', 3)
    ) and not exists (
      select 1 from cols c
      where c.col <> all (select split_part(spec, '#', 1) from expected_cols)
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(c.col || ' ' || c.typ || case when c.notnull then ' NOT NULL' else '' end, ', ' order by c.col) from cols c), '<none>')

  -- V03 ─ primary key on id, with a uuid-generating default
  union all
  select 'V03', 'primary_key_and_default',
    case when exists (
      select 1 from pg_constraint c
      where c.conrelid = (select oid from tbl) and c.contype = 'p'
        and c.conkey = array[(select a.attnum from pg_attribute a
                              where a.attrelid = (select oid from tbl) and a.attname = 'id')]
    ) and (select defexpr from cols where col = 'id') ~ '^(public\.)?gen_random_uuid\(\)$'
    then 'PASS' else 'FAIL' end,
    'pk=' || coalesce((select c.conname::text from pg_constraint c
                       where c.conrelid = (select oid from tbl) and c.contype = 'p'), '<none>')
      || ' id_default=' || coalesce(nullif((select defexpr from cols where col = 'id'), ''), '<none>')

  -- V04 ─ the five foreign keys, each with its EXACT referential action.
  -- ON DELETE is the whole point of this check: person CASCADE, program /
  -- season / created_by / application RESTRICT. A SET NULL on application_id
  -- would silently break person_season_invites_application_binding_check.
  union all
  select 'V04', 'foreign_key_contract',
    case when not exists (
      select 1 from expected_fks e
      left join actual_fks a on a.col = split_part(e.spec, '#', 1)
      where a.col is null
         or a.reftbl || '.' || a.refcol <> split_part(e.spec, '#', 2)
         or a.ondel <> split_part(e.spec, '#', 3)
         or a.nkeys <> 1
         or not a.convalidated
    ) and (select count(*) from actual_fks) = 5
    then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(a.col || '->' || a.reftbl || '.' || a.refcol || ' ondelete=' || a.ondel, ', ' order by a.col) from actual_fks a), '<none>')

  -- V05..V10 ─ the six CHECK constraints, each pinned end to end
  union all
  select 'V05', 'check_role',
    case when (select def from checks_def where name = 'person_season_invites_role_check')
              ~ '^CHECK \(+role = ANY \(\(?ARRAY\[''mentor''::text, ''mentee''::text\]\)?\)\)+$'
         and (select convalidated from checks_def where name = 'person_season_invites_role_check')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from checks_def where name = 'person_season_invites_role_check'), '<absent>')

  union all
  select 'V06', 'check_outcome_vocabulary',
    case when (select def from checks_def where name = 'person_season_invites_outcome_check')
              ~ '^CHECK \(+\(?outcome IS NULL\)? OR \(?outcome = ANY \(\(?ARRAY\[''accepted''::text, ''declined''::text\]\)?\)\)?\)+$'
         and (select convalidated from checks_def where name = 'person_season_invites_outcome_check')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from checks_def where name = 'person_season_invites_outcome_check'), '<absent>')

  -- The structural proof that no raw token is stored. If this constraint is
  -- weakened, a 43-character base64url bearer secret becomes storable in
  -- token_hash and nothing else in the system would notice.
  union all
  select 'V07', 'check_token_hash_is_sha256_hex',
    case when (select def from checks_def where name = 'person_season_invites_token_hash_format_check')
              ~ '^CHECK \(+token_hash ~ ''\^\[0-9a-f\]\{64\}\$''::text\)+$'
         and (select convalidated from checks_def where name = 'person_season_invites_token_hash_format_check')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from checks_def where name = 'person_season_invites_token_hash_format_check'), '<absent>')

  union all
  select 'V08', 'check_submitted_outcome_paired',
    case when (select def from checks_def where name = 'person_season_invites_outcome_binding_check')
              ~ '^CHECK \(+\(?submitted_at IS NULL\)? = \(?outcome IS NULL\)?\)+$'
         and (select convalidated from checks_def where name = 'person_season_invites_outcome_binding_check')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from checks_def where name = 'person_season_invites_outcome_binding_check'), '<absent>')

  -- accepted ⇔ exactly one applications row; declined ⇒ none. Both halves of
  -- the locked decline contract live in this one predicate.
  union all
  select 'V09', 'check_accepted_iff_application',
    case when (select def from checks_def where name = 'person_season_invites_application_binding_check')
              ~ '^CHECK \(+\(?NOT \(?outcome IS DISTINCT FROM ''accepted''::text\)?\)? = \(?application_id IS NOT NULL\)?\)+$'
         and (select convalidated from checks_def where name = 'person_season_invites_application_binding_check')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from checks_def where name = 'person_season_invites_application_binding_check'), '<absent>')

  union all
  select 'V10', 'check_not_born_expired',
    case when (select def from checks_def where name = 'person_season_invites_expiry_check')
              ~ '^CHECK \(+expires_at > created_at\)+$'
         and (select convalidated from checks_def where name = 'person_season_invites_expiry_check')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from checks_def where name = 'person_season_invites_expiry_check'), '<absent>')

  -- V11 ─ exactly six CHECK constraints. A seventh one nobody reviewed is as
  -- much a change to this table's contract as a missing one.
  union all
  select 'V11', 'check_constraint_inventory',
    case when (select count(*) from checks_def) = 6
         and not exists (
           select 1 from checks_def
           where name <> all (array[
             'person_season_invites_role_check',
             'person_season_invites_outcome_check',
             'person_season_invites_token_hash_format_check',
             'person_season_invites_outcome_binding_check',
             'person_season_invites_application_binding_check',
             'person_season_invites_expiry_check'])
         )
    then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(name, ', ' order by name) from checks_def), '<none>')

  -- V12 ─ the global token arbiter
  union all
  select 'V12', 'index_token_hash_unique',
    case when (select def from idx_def where name = 'person_season_invites_token_hash_key')
              ~ '^CREATE UNIQUE INDEX person_season_invites_token_hash_key ON public\.person_season_invites USING btree \(token_hash\)$'
         and (select indisvalid and indisready from idx_def where name = 'person_season_invites_token_hash_key')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from idx_def where name = 'person_season_invites_token_hash_key'), '<absent>')

  -- V13 ─ THE LIVE-INVITE ARBITER. The predicate is the decision: it must be
  -- `revoked_at IS NULL AND submitted_at IS NULL`. A predicate of merely
  -- `revoked_at IS NULL` is the rejected alternative — it pins a completed
  -- invite in the slot forever and makes re-invitation after a decline
  -- impossible without rewriting history. Anchoring catches that substitution.
  union all
  select 'V13', 'index_live_invite_arbiter',
    case when (select def from idx_def where name = 'person_season_invites_live_key')
              ~ '^CREATE UNIQUE INDEX person_season_invites_live_key ON public\.person_season_invites USING btree \(person_id, season_id, role\) WHERE \(+\(?revoked_at IS NULL\)? AND \(?submitted_at IS NULL\)?\)+$'
         and (select indisvalid and indisready from idx_def where name = 'person_season_invites_live_key')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from idx_def where name = 'person_season_invites_live_key'), '<absent>')

  -- V14 ─ at most one ACCEPTED invite per person+season+role, forever. This is
  -- the invariant that stops one human producing two renewal applications and
  -- two canonical-profile refreshes for one season.
  union all
  select 'V14', 'index_accepted_once_arbiter',
    case when (select def from idx_def where name = 'person_season_invites_accepted_key')
              ~ '^CREATE UNIQUE INDEX person_season_invites_accepted_key ON public\.person_season_invites USING btree \(person_id, season_id, role\) WHERE \(+outcome = ''accepted''::text\)+$'
         and (select indisvalid and indisready from idx_def where name = 'person_season_invites_accepted_key')
    then 'PASS' else 'FAIL' end,
    coalesce((select def from idx_def where name = 'person_season_invites_accepted_key'), '<absent>')

  -- V15 ─ the two operational indexes, and no unreviewed extra
  union all
  select 'V15', 'index_inventory',
    case when (select count(*) from idx_def) = 6
         and not exists (
           select 1 from idx_def
           where name <> all (array[
             'person_season_invites_pkey',
             'person_season_invites_token_hash_key',
             'person_season_invites_live_key',
             'person_season_invites_accepted_key',
             'person_season_invites_season_role_idx',
             'person_season_invites_application_id_idx'])
         )
    then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(name, ', ' order by name) from idx_def), '<none>')

  -- V16 ─ updated_at reuses the shared function; it does not have its own
  union all
  select 'V16', 'updated_at_trigger_reuses_shared_fn',
    case when exists (
      select 1 from pg_trigger t
      where t.tgrelid = (select oid from tbl)
        and t.tgname = 'person_season_invites_set_updated_at'
        and not t.tgisinternal
        and t.tgfoid = to_regprocedure('public.set_updated_at()')
        and t.tgtype & 2 = 2      -- BEFORE
        and t.tgtype & 1 = 1      -- FOR EACH ROW
        and t.tgtype & 16 = 16    -- UPDATE
        and t.tgenabled = 'O'
    ) and (select count(*) from pg_trigger where tgrelid = (select oid from tbl) and not tgisinternal) = 1
    then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(t.tgname || '->' || p.proname || ' tgtype=' || t.tgtype || ' enabled=' || t.tgenabled, ', ' order by t.tgname)
              from pg_trigger t join pg_proc p on p.oid = t.tgfoid
              where t.tgrelid = (select oid from tbl) and not t.tgisinternal), '<none>')

  -- V17 ─ RLS on, FORCE off, zero policies. All three together are the posture;
  -- any one of them alone is not.
  union all
  select 'V17', 'rls_enabled_not_forced_zero_policies',
    case when (select relrowsecurity from pg_class where oid = (select oid from tbl))
         and not (select relforcerowsecurity from pg_class where oid = (select oid from tbl))
         and not exists (select 1 from pg_policies
                         where schemaname = 'public' and tablename = 'person_season_invites')
    then 'PASS' else 'FAIL' end,
    'rls=' || coalesce((select relrowsecurity::text from pg_class where oid = (select oid from tbl)), '?')
      || ' force=' || coalesce((select relforcerowsecurity::text from pg_class where oid = (select oid from tbl)), '?')
      || ' policies=' || coalesce((select string_agg(policyname, ', ' order by policyname)
                                   from pg_policies where schemaname = 'public'
                                     and tablename = 'person_season_invites'), '<none>')

  -- V18 ─ no privilege for the web roles, read from role_table_grants so a
  -- privilege held via PUBLIC is visible too
  union all
  select 'V18', 'no_web_role_grants',
    case when not exists (
      select 1 from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = 'person_season_invites'
        and g.grantee in ('anon', 'authenticated', 'PUBLIC')
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(g.grantee || '/' || g.privilege_type, ', ' order by g.grantee, g.privilege_type)
              from information_schema.role_table_grants g
              where g.table_schema = 'public' and g.table_name = 'person_season_invites'
                and g.grantee in ('anon', 'authenticated', 'PUBLIC')), '<none>')

  -- V19 ─ service_role keeps full access, or every trusted path is dead
  union all
  select 'V19', 'service_role_retains_access',
    case when has_table_privilege('service_role', 'public.person_season_invites', 'SELECT')
          and has_table_privilege('service_role', 'public.person_season_invites', 'INSERT')
          and has_table_privilege('service_role', 'public.person_season_invites', 'UPDATE')
          and has_table_privilege('service_role', 'public.person_season_invites', 'DELETE')
    then 'PASS' else 'FAIL' end,
    'select=' || has_table_privilege('service_role', 'public.person_season_invites', 'SELECT')::text
      || ' insert=' || has_table_privilege('service_role', 'public.person_season_invites', 'INSERT')::text
      || ' update=' || has_table_privilege('service_role', 'public.person_season_invites', 'UPDATE')::text
      || ' delete=' || has_table_privilege('service_role', 'public.person_season_invites', 'DELETE')::text

  -- V20 ─ the audit vocabulary now admits the three M070 values AND still
  -- admits every one of the canonical 52. Stated as a superset test, not a set
  -- equality, because BASE53 (M069 applied) is an equally legitimate baseline
  -- and the apply preserves whatever it found.
  union all
  select 'V20', 'audit_vocabulary_extended_nothing_lost',
    case when (select count(*) from vocab) = 1
         and (select convalidated from vocab)
         and not exists (
           select 1 from base52, unnest(b) x
           where x <> all (coalesce((select vals from vocab_vals), array[]::text[]))
         )
         and not exists (
           select 1 from unnest(array['confirm_renewal','create_renewal_invite','revoke_renewal_invite']) x
           where x <> all (coalesce((select vals from vocab_vals), array[]::text[]))
         )
    then 'PASS' else 'FAIL' end,
    'size=' || coalesce((select array_length(vals, 1) from vocab_vals), 0)::text
      || ' validated=' || coalesce((select convalidated::text from vocab), '?')
      || ' base52_missing=' || coalesce((select array_to_string(array_agg(x order by x), ', ')
                                         from base52, unnest(b) x
                                         where x <> all (coalesce((select vals from vocab_vals), array[]::text[]))), '<none>')
      || ' m070_missing=' || coalesce((select array_to_string(array_agg(x order by x), ', ')
                                       from unnest(array['confirm_renewal','create_renewal_invite','revoke_renewal_invite']) x
                                       where x <> all (coalesce((select vals from vocab_vals), array[]::text[]))), '<none>')

  -- V21 ─ nothing that looks like a raw token is stored. Re-proves at the DATA
  -- level what V07 proves at the constraint level, so a constraint added NOT
  -- VALID after the fact cannot hide existing rows.
  union all
  select 'V21', 'no_row_holds_a_non_sha256_token_hash',
    case when not exists (
      select 1 from public.person_season_invites where token_hash !~ '^[0-9a-f]{64}$'
    ) then 'PASS' else 'FAIL' end,
    (select count(*) from public.person_season_invites where token_hash !~ '^[0-9a-f]{64}$')::text || ' offending row(s)'

  -- V22 ─ the locked invariants, re-proved against the DATA
  union all
  select 'V22', 'row_level_invariants_hold',
    case when not exists (
      select 1 from public.person_season_invites
      where (submitted_at is null) <> (outcome is null)
         or (outcome is not distinct from 'accepted') <> (application_id is not null)
         or expires_at <= created_at
    ) then 'PASS' else 'FAIL' end,
    (select count(*) from public.person_season_invites)::text || ' invite row(s) total'

  -- V23 ─ Season 11 is never addressed by a renewal invite
  union all
  select 'V23', 's11_untouched',
    case when not exists (
      select 1 from public.person_season_invites i
      join public.seasons s on s.id = i.season_id
      where s.code like '%S11%'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(distinct s.code, ', ')
              from public.person_season_invites i join public.seasons s on s.id = i.season_id), '<no invites>')
)
select check_id, check_name, status, detail from results
union all
select 'V**', 'M070_VERIFIED',
       case when exists (select 1 from results where status <> 'PASS') then 'FAIL' else 'PASS' end,
       'failing=' || coalesce((select string_agg(check_id || ' ' || check_name, ', ' order by check_id)
                               from results where status <> 'PASS'), '<none>')
order by 1;

rollback;
