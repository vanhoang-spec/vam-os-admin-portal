-- =============================================================================
-- MIGRATION 070
-- Season 12 Returning-Mentor Renewal — person-bound invite foundation
--
-- Creates ONE table, public.person_season_invites, and extends the
-- admin_audit_log action_type vocabulary by exactly three values. Nothing
-- else. No RPC, no page, no form, no seed row, no invite is ever created by a
-- migration.
--
-- WHAT THIS TABLE IS
--   One row per person-bound renewal invitation. The raw token is NEVER
--   stored: the runtime generates randomBytes(32).toString("base64url") — 43
--   base64url characters — hands it to the mentor once inside the /renew URL,
--   and persists only sha256(token) as 64 lowercase hex characters. Lookup is
--   an equality probe on the unique token_hash index. A CHECK constraint pins
--   token_hash to ^[0-9a-f]{64}$, so a 43-character raw token is structurally
--   unrepresentable in this column — "no raw token stored" is enforced by the
--   database, not only by the code that writes to it.
--
--   person_id, program_id, season_id and role are the binding. Every
--   downstream decision — which person renewed, which season, which role —
--   derives from this row and never from anything the client supplies.
--
-- SAFETY CONTRACT
--   * S11 is never referenced, read, or written.
--   * No grant to anon or authenticated. RLS on, ZERO policies: only the
--     service-role path can see or change these rows.
--   * FORCE ROW LEVEL SECURITY is deliberately NOT set — see Section 5.
--   * The audit vocabulary is EXTENDED, never replaced by a hard-coded list:
--     the replacement is built as (live admitted set) ∪ (three new values), so
--     preserving every existing value is structural, not asserted. See
--     Section 6.
--   * Re-running is refused, not silently absorbed (Section 1).
-- =============================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout      = '10s';
set local timezone          = 'UTC';

-- ── 1. Prerequisites and unapplied proof ────────────────────────────────────
-- Every FK target, the shared updated_at function, and the complete absence of
-- anything this migration owns.
do $m070_pre$
declare
  v_txt     text;
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array['people','programs','seasons','admin_users','applications','admin_audit_log']) t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'M070 ABORTED [PREREQ_TABLE_MISSING]: %. Every one of them is a foreign-key target or the audit table.', v_missing;
  end if;

  -- The canonical updated_at trigger function. Section 4 attaches to it rather
  -- than creating a second, redundant one; if it is absent this migration must
  -- refuse instead of quietly inventing new trigger infrastructure.
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'M070 ABORTED [UPDATED_AT_FN_MISSING]: public.set_updated_at() is absent. This migration reuses the repository''s canonical trigger function and does not create one.';
  end if;

  if to_regclass('public.person_season_invites') is not null then
    raise exception 'M070 ABORTED [ALREADY_APPLIED]: public.person_season_invites already exists. Run verifier.sql instead.';
  end if;

  -- person_season_invites% is this migration's own object namespace: every
  -- catalog name the scan can match is a name this file creates. A hit means a
  -- half-applied package (an index left behind by a failed rollback, a trigger
  -- without its table), which must be reconciled before applying.
  select string_agg(obj, ', ' order by obj) into v_txt from (
    select 'relation ' || c.relname as obj
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'person\_season\_invites%'
    union all
    select 'trigger ' || t.tgname
    from pg_trigger t where not t.tgisinternal and t.tgname like 'person\_season\_invites%'
    union all
    select 'constraint ' || c.conname
    from pg_constraint c where c.conname like 'person\_season\_invites%'
  ) s;
  if v_txt is not null then
    raise exception 'M070 ABORTED [PARTIAL_M070]: pre-existing M070 object(s): %. Roll the partial state back before applying.', v_txt;
  end if;

  -- admin_users.id must carry a key, or created_by has no FK target.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.admin_users') and c.contype in ('p','u')
      and c.conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = to_regclass('public.admin_users')
                              and a.attname = 'id' and a.attnum > 0 and not a.attisdropped)]
  ) then
    raise exception 'M070 ABORTED [ADMIN_USERS_KEY]: admin_users.id carries no primary or unique key; created_by cannot reference it.';
  end if;
end
$m070_pre$;

-- ── 2. The invite table ─────────────────────────────────────────────────────
-- FK behaviour, stated per column and derived from this repository's existing
-- conventions rather than chosen freshly:
--
--   person_id     CASCADE  — matches public.crm_notes.person_id (052) and
--                            mentor_profiles/mentee_profiles.person_id. An
--                            invite is meaningless once the human it is bound
--                            to no longer exists, and leaving an orphan row
--                            would leave a live token hash bound to nothing.
--   program_id    RESTRICT — matches 052 and 061. A catalog row with live
--                            invitations hanging off it must not be deletable.
--   season_id     RESTRICT — same.
--   created_by    RESTRICT — the repository writes SET NULL for admin_users
--                            provenance columns (052, 061), but every one of
--                            those columns is NULLABLE. This one is NOT NULL
--                            by contract, so SET NULL is not representable: it
--                            would raise 23502 at delete time instead of doing
--                            anything useful. RESTRICT states the same intent
--                            honestly — who issued an invite is not erasable.
--   application_id RESTRICT — this is a DELIBERATE DIVERGENCE from the expected
--                            direction (SET NULL), and the reason is a hard
--                            conflict, not a preference. SET NULL is the
--                            repository convention for optional linkage (045a,
--                            051) and would be right if application_id were
--                            free-floating. It is not: it is one half of
--                            person_season_invites_application_binding_check,
--                            which makes "accepted ⇒ exactly one applications
--                            row" and "declined ⇒ none" structural. Under SET
--                            NULL, deleting an application fires an UPDATE that
--                            nulls application_id while outcome stays
--                            'accepted' — the constraint rejects it, so the
--                            delete fails ANYWAY, but with a check violation
--                            that names neither table. RESTRICT produces the
--                            same outcome for the same reason and says so. The
--                            alternative — weakening the binding check to one
--                            direction so SET NULL can fire — trades a
--                            load-bearing invariant for a delete path nothing
--                            in this system uses: no code anywhere deletes an
--                            applications row, and application_reviews /
--                            application_decisions already CASCADE from it.
--                            The invite's own record of the renewal
--                            (submitted_at, outcome) is what survives, and it
--                            survives because the application cannot vanish
--                            underneath it.
create table public.person_season_invites (
  id             uuid        primary key default gen_random_uuid(),
  token_hash     text        not null,
  person_id      uuid        not null references public.people(id)       on delete cascade,
  program_id     uuid        not null references public.programs(id)     on delete restrict,
  season_id      uuid        not null references public.seasons(id)      on delete restrict,
  role           text        not null,
  created_by     uuid        not null references public.admin_users(id)  on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  submitted_at   timestamptz,
  outcome        text,
  application_id uuid        references public.applications(id)          on delete restrict,

  constraint person_season_invites_role_check
    check (role = any (array['mentor', 'mentee'])),

  constraint person_season_invites_outcome_check
    check (outcome is null or outcome = any (array['accepted', 'declined'])),

  -- STRUCTURAL PROOF THAT NO RAW TOKEN IS STORED. The runtime token is 43
  -- base64url characters; a SHA-256 digest rendered lowercase-hex is exactly
  -- 64 characters from [0-9a-f]. A raw token written here by mistake — or by a
  -- future refactor that forgets to hash — violates this constraint and the
  -- write fails, rather than silently persisting a bearer secret.
  constraint person_season_invites_token_hash_format_check
    check (token_hash ~ '^[0-9a-f]{64}$'),

  -- submitted_at and outcome are one fact recorded in two columns. Neither can
  -- exist without the other, so no invite can be "submitted with no answer" or
  -- "answered without having been submitted".
  constraint person_season_invites_outcome_binding_check
    check ((submitted_at is null) = (outcome is null)),

  -- An accepted renewal ALWAYS produced exactly one applications row, and a
  -- decline NEVER does (the decline contract requires no application). This
  -- makes both halves of that contract unrepresentable when violated.
  constraint person_season_invites_application_binding_check
    check ((outcome is not distinct from 'accepted') = (application_id is not null)),

  -- An invite born already expired is a defect, not a state. created_at
  -- defaults to now(), so this is evaluated against the row's own birth.
  constraint person_season_invites_expiry_check
    check (expires_at > created_at)
);

comment on table public.person_season_invites is
  'M070. Person-bound renewal invitations. token_hash is sha256(raw token) as 64 lowercase hex characters; the raw token is never stored. person_id/program_id/season_id/role are the authoritative binding for every downstream renewal decision — nothing is ever taken from the client.';

comment on column public.person_season_invites.token_hash is
  'sha256 of a 43-character base64url token (32 random bytes), lowercase hex. Never the raw token.';
comment on column public.person_season_invites.revoked_at is
  'Administrative kill BEFORE use. Never set as a side effect of a successful or declined renewal — see the live-invite arbiter below.';
comment on column public.person_season_invites.submitted_at is
  'When the mentor answered. Set together with outcome, and never cleared.';

-- ── 3. Indexes and the live-invite arbiter ──────────────────────────────────
-- One global token arbiter. Equality on this index is the ONLY lookup path the
-- runtime uses, and uniqueness makes a hash collision across the whole table a
-- write failure rather than an ambiguous read.
create unique index person_season_invites_token_hash_key
  on public.person_season_invites (token_hash);

-- THE LIVE-INVITE ARBITER — and the one design decision in this migration that
-- had a real alternative.
--
-- The obvious formulation is `where revoked_at is null`. It is wrong, and the
-- reason is that a SUBMITTED invite stays non-revoked forever: revocation is an
-- administrative kill before use, and a mentor who has already renewed was
-- never killed. Under `where revoked_at is null` the row therefore occupies the
-- (person, season, role) slot permanently, and re-inviting the same person for
-- the same season and role — after a DECLINE most of all — becomes possible
-- only by writing revoked_at onto a completed invite. That overloads "revoked"
-- with "used", destroys the distinction between "cancelled before use" and
-- "answered", and forces an audited administrative action
-- (revoke_renewal_invite) to be emitted as a side effect of an ordinary
-- re-invitation. History would record something that did not happen.
--
-- What the arbiter actually needs to guarantee is that at most one USABLE token
-- exists for a person+season+role at a time. A submitted invite is not usable —
-- the gate refuses re-submission — so the live set is exactly
-- `revoked_at is null and submitted_at is null`, which is what this index says.
--
-- Behaviour that follows, deliberately:
--   successful renewal  the row leaves the live set when submitted_at is
--                       written; nothing is revoked and nothing is rewritten.
--   decline             identical. The person is immediately re-invitable, by
--                       plain INSERT, with the decline preserved beside it.
--   regeneration        a lost or mis-sent email is fixed by revoking the live
--                       invite (revoked_at) and inserting a new one. Exactly
--                       one live invite at any instant; both rows survive.
--   history             nothing is ever deleted or overwritten to make room.
create unique index person_season_invites_live_key
  on public.person_season_invites (person_id, season_id, role)
  where revoked_at is null and submitted_at is null;

-- The invariant the narrower live arbiter would otherwise give up. A person may
-- decline and be re-invited any number of times, but may only ever ACCEPT once
-- per season+role — that is the fact canonical membership and the canonical
-- mentor_profile refresh hang off. Without this index, an admin who issued a
-- second invite after a successful renewal could produce two accepted invites,
-- two applications rows and two canonical-profile refreshes for one human.
-- With it, the second acceptance fails at the database, and the submit gate
-- surfaces the uniform public failure.
create unique index person_season_invites_accepted_key
  on public.person_season_invites (person_id, season_id, role)
  where outcome = 'accepted';

-- Admin listing for a season's renewal cohort.
create index person_season_invites_season_role_idx
  on public.person_season_invites (season_id, role);

-- The admin confirmation orchestrator resolves the invite FROM the application
-- it is confirming, so this is a read path, not a reporting convenience.
create index person_season_invites_application_id_idx
  on public.person_season_invites (application_id)
  where application_id is not null;

-- ── 4. updated_at ───────────────────────────────────────────────────────────
-- Reuses public.set_updated_at(), the repository's canonical trigger function
-- (17 triggers already call it in Production). No new trigger infrastructure
-- is created here; Section 1 refuses if it is missing.
create trigger person_season_invites_set_updated_at
before update on public.person_season_invites
for each row
execute function public.set_updated_at();

-- ── 5. Lock the table down ──────────────────────────────────────────────────
-- RLS ENABLED with ZERO policies, and no grant of any kind to the web roles.
-- service_role is BYPASSRLS, so every trusted server path keeps working; anon
-- and authenticated see an empty table and cannot write.
--
-- FORCE ROW LEVEL SECURITY IS DELIBERATELY NOT SET, and this is the hardened
-- Production convention rather than an omission. The accepted S12 release T2
-- enables RLS on ten Day-1 tables and asserts in its own post-conditions that
-- FORCE is off on every one of them ("or the owner locks itself out"); the S12
-- release preflight refuses a database where FORCE is set; and M069 refuses to
-- apply if FORCE is set on admin_audit_log, because FORCE subjects the table
-- OWNER to policies too — so a SECURITY DEFINER function owned by postgres is
-- filtered by a policy set that is deliberately empty. The renewal runtime's
-- gate and the admin confirmation orchestrator will be exactly such functions.
-- Setting FORCE here would be inconsistent with every other table in this
-- database and would break the trusted path this table exists to serve.
alter table public.person_season_invites enable row level security;

revoke all on public.person_season_invites from public;
revoke all on public.person_season_invites from anon;
revoke all on public.person_season_invites from authenticated;

-- ── 6. Audit vocabulary ─────────────────────────────────────────────────────
-- Production's admin_audit_log_action_type_check is a CLOSED, VALIDATED list.
-- The renewal runtime writes action types it does not yet admit, and because
-- the runtime's audit write shares a transaction with the mutation it records,
-- a 23514 there would abort the mutation itself.
--
-- THE THREE VALUES ADDED, AND WHY EACH ONE EARNS ITS PLACE
--   create_renewal_invite   an admin mints a person-bound bearer token. There
--                           is no other record of who issued it to whom.
--   revoke_renewal_invite   an admin kills a live token. Same reasoning.
--   confirm_renewal         the admin confirmation step, which is the ONLY
--                           record of the field-level BEFORE/AFTER diff the
--                           admin approved before canonical profile mutation.
--                           The two mutations it drives are separately audited
--                           under existing values (add_membership_role by
--                           vam063, approve_application_as_mentor by
--                           approveApplication), and NEITHER of those rows
--                           carries the profile diff. Without this value the
--                           P0 before/after requirement has no durable
--                           evidence.
--
-- FOUR CANDIDATES WERE REVIEWED AND REFUSED — the runtime does not write them:
--   submit_renewal              the actor is an unauthenticated token holder,
--                               not an admin. Writing an admin_audit_log row
--                               with a NULL admin actor for a public action
--                               pollutes the admin audit trail and creates an
--                               anonymous write path into it. The record of a
--                               submission already exists and is stronger: the
--                               invite row's submitted_at/outcome, plus the
--                               applications row itself.
--   decline_renewal             same reasoning. Recorded by submitted_at +
--                               outcome='declined'; and where a decline reaches
--                               an existing S12 membership, vam063 writes its
--                               own audited opt_out_membership row under a
--                               value the vocabulary already admits.
--   regenerate_renewal_invite   regeneration IS revoke-then-create. It emits
--                               the two rows above, which is a truthful account
--                               of what happened. A third value would be a
--                               synonym that makes the same event queryable two
--                               incompatible ways.
--   confirm_renewal was kept and the other three dropped on one rule: add a
--   value only where the runtime genuinely writes a row that no existing value
--   can carry.
--
-- HOW THE EXISTING VALUES ARE PRESERVED
-- M069 replaces the constraint with a hard-coded list and proves by set
-- equality that the list it replaced was the expected one. That is safe but it
-- is an assertion. This migration does not hard-code the result at all: it
-- parses the LIVE definition, proves the parse is complete, and builds the
-- replacement as (live admitted set) ∪ (the three values above). Preservation
-- is therefore structural — there is no list in this file that could omit a
-- Production value — and the post-condition still proves set equality against
-- the live set captured before the drop.
--
-- The live set is additionally required to be one of the two baselines this
-- Production database can legitimately be in, because M069's status is
-- PREPARED-NOT-APPLIED and either state is possible:
--     BASE52  the canonical 52 installed by the S12 release T1
--     BASE53  those 52 plus set_application_form_state, i.e. M069 applied
-- Anything else is refused by name, so an unexplained vocabulary is a stop, not
-- a thing this migration quietly carries forward.
do $m070_vocab$
declare
  v_def          text;
  v_conname      constant text := 'admin_audit_log_action_type_check';
  v_actual       text[];
  v_new          text[];
  v_post         text[];
  v_missing      text[];
  v_unexpected   text[];
  v_raw_n        integer;
  v_quote_n      integer;
  v_n            integer;
  v_validated    boolean;
  v_literals     text;
  v_m070 constant text[] := array[
    'confirm_renewal', 'create_renewal_invite', 'revoke_renewal_invite'
  ];
  -- The canonical 52 installed by VAM_OS_PROD_S12_RELEASE_20260809 apply/T1,
  -- Section 2. __tests__/support/m069-audit-vocabulary.ts is the ONE canonical
  -- representation and a test proves this copy is set-equal to it.
  v_base52 constant text[] := array[
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
  ];
  v_m069 constant text := 'set_application_form_state';
begin
  if not exists (select 1 from pg_class
                 where oid = to_regclass('public.admin_audit_log') and relkind = 'r') then
    raise exception 'M070 ABORTED [AUDIT_TABLE_SHAPE]: admin_audit_log is not an ordinary table.';
  end if;

  -- FORCE RLS on the audit table would filter the SECURITY DEFINER audit INSERT
  -- the renewal runtime performs, even running as the owner. RLS merely being
  -- enabled is the accepted baseline and is fine.
  if exists (select 1 from pg_class
             where oid = to_regclass('public.admin_audit_log') and relforcerowsecurity) then
    raise exception 'M070 ABORTED [AUDIT_INSERT_BLOCKED]: FORCE ROW LEVEL SECURITY is set on admin_audit_log.';
  end if;

  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.admin_audit_log') and a.attname = 'action_type'
      and a.attnum > 0 and not a.attisdropped
      and format_type(a.atttypid, a.atttypmod) = 'text'
  ) then
    raise exception 'M070 ABORTED [AUDIT_COLUMN_TYPE]: admin_audit_log.action_type is not text; the vocabulary CHECK compares it to text literals.';
  end if;

  -- Locate the constraint by DEFINITION, not by name: a CHECK on action_type
  -- under any name still governs what may be written. The name is then asserted
  -- rather than assumed, because the drop below is by name.
  select count(*) into v_n
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log') and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%';

  if v_n = 0 then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_MISSING]: no CHECK governs admin_audit_log.action_type. The S12 release T1 has not been applied here.';
  end if;
  if v_n > 1 then
    select string_agg(c.conname, ', ' order by c.conname) into v_literals
    from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log') and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%action_type%';
    raise exception 'M070 ABORTED [AUDIT_VOCAB_SHAPE]: % CHECK constraints govern action_type (%), expected exactly 1.', v_n, v_literals;
  end if;

  select c.conname, c.convalidated, pg_get_constraintdef(c.oid)
    into v_literals, v_validated, v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log') and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%action_type%';

  if v_literals is distinct from v_conname then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_SHAPE]: the action_type CHECK is named %, expected %. This block drops it by name.', coalesce(v_literals, '<null>'), v_conname;
  end if;
  if v_validated is not true then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_NOT_VALIDATED]: % is NOT VALID, so existing rows are not proven to satisfy it.', v_conname;
  end if;
  if v_def not ilike '%= ANY (ARRAY[%' then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_SHAPE]: % is not a closed ANY(ARRAY[...]) list: %.', v_conname, v_def;
  end if;

  select count(*) into v_raw_n from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;
  select array_agg(distinct m[1]) into v_actual from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

  -- Quote pairing proves the parse is COMPLETE. The replacement list is built
  -- FROM this parse, so a value the regex could not read would not merely hide
  -- from a comparison — it would be silently dropped from Production.
  v_quote_n := length(v_def) - length(replace(v_def, '''', ''));
  if v_quote_n <> 2 * v_raw_n then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_SHAPE]: % contains % quote characters but only % parseable ''value''::text elements — part of the definition was not understood: %.', v_conname, v_quote_n, v_raw_n, v_def;
  end if;
  if v_raw_n <> coalesce(array_length(v_actual, 1), 0) then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_SHAPE]: % lists % elements but only % are distinct — the vocabulary contains duplicates.', v_conname, v_raw_n, coalesce(array_length(v_actual, 1), 0);
  end if;

  -- Already applied?
  select array_agg(x order by x) into v_unexpected
  from unnest(v_m070) x where x = any (v_actual);
  if v_unexpected is not null then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_M070_PRESENT]: the vocabulary already admits %. M070 has been applied here, or something else added the value(s).', array_to_string(v_unexpected, ', ');
  end if;

  -- The live set must be one of the two baselines this database can legitimately
  -- be in. BASE53 differs from BASE52 by exactly set_application_form_state.
  select array_agg(x order by x) into v_missing
  from unnest(v_base52) x where x <> all (coalesce(v_actual, array[]::text[]));
  select array_agg(x order by x) into v_unexpected
  from unnest(coalesce(v_actual, array[]::text[])) x
  where x <> all (v_base52 || v_m069);

  if v_missing is not null or v_unexpected is not null then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_UNEXPECTED]: % admits % value(s), which is neither the canonical 52 (BASE52) nor the canonical 52 + % (BASE53). MISSING (expected, not present): %. UNEXPECTED (present, in neither baseline): %.',
      v_conname,
      coalesce(array_length(v_actual, 1), 0),
      v_m069,
      coalesce(array_to_string(v_missing, ', '), '<none>'),
      coalesce(array_to_string(v_unexpected, ', '), '<none>');
  end if;

  raise notice 'M070: live audit vocabulary is % value(s) — baseline %.',
    array_length(v_actual, 1),
    case when v_m069 = any (v_actual) then 'BASE53 (M069 applied)' else 'BASE52 (M069 not applied)' end;

  -- Build the replacement as a UNION of what is live and the three new values.
  -- Nothing in this file can shorten the list.
  select array_agg(distinct x order by x) into v_new
  from unnest(v_actual || v_m070) x;

  select string_agg(quote_literal(x) || '::text', ', ' order by x) into v_literals
  from unnest(v_new) x;

  execute format('alter table public.admin_audit_log drop constraint %I', v_conname);
  execute format(
    'alter table public.admin_audit_log add constraint %I check (action_type = any (array[%s]))',
    v_conname, v_literals
  );

  -- Re-read what actually landed and prove it is the live set plus exactly the
  -- three new values: nothing lost, nothing extra, nothing substituted.
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.admin_audit_log') and c.conname = v_conname;

  select array_agg(distinct m[1]) into v_post from regexp_matches(v_def, '''([^'']*)''::text', 'g') m;

  select array_agg(x order by x) into v_missing
  from unnest(v_new) x where x <> all (coalesce(v_post, array[]::text[]));
  select array_agg(x order by x) into v_unexpected
  from unnest(coalesce(v_post, array[]::text[])) x where x <> all (v_new);

  if v_missing is not null or v_unexpected is not null
     or coalesce(array_length(v_post, 1), 0) <> coalesce(array_length(v_actual, 1), 0) + 3 then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_POST]: the installed vocabulary is not the pre-existing % value(s) plus exactly 3. Size now %. MISSING: %. UNEXPECTED: %.',
      coalesce(array_length(v_actual, 1), 0),
      coalesce(array_length(v_post, 1), 0),
      coalesce(array_to_string(v_missing, ', '), '<none>'),
      coalesce(array_to_string(v_unexpected, ', '), '<none>');
  end if;

  -- The constraint must come back VALIDATED, or existing rows are not proven to
  -- satisfy it and the next audit write is running against an unenforced list.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.admin_audit_log')
      and c.conname = v_conname and c.convalidated
  ) then
    raise exception 'M070 ABORTED [AUDIT_VOCAB_POST]: % did not come back VALIDATED.', v_conname;
  end if;

  raise notice 'M070: audit vocabulary extended to % values (added confirm_renewal, create_renewal_invite, revoke_renewal_invite).', array_length(v_post, 1);
end
$m070_vocab$;

-- ── 7. Post-conditions ──────────────────────────────────────────────────────
do $m070_post$
declare
  v_n   integer;
  v_txt text;
begin
  -- A migration never creates an invite. An invite is a live bearer token.
  select count(*) into v_n from public.person_season_invites;
  if v_n <> 0 then
    raise exception 'M070 ABORTED [ROWS_SEEDED]: % invite row(s) exist. A migration must never mint a token.', v_n;
  end if;

  if not exists (select 1 from pg_class
                 where oid = to_regclass('public.person_season_invites') and relrowsecurity) then
    raise exception 'M070 ABORTED [RLS_NOT_ENABLED]: RLS is not enabled on person_season_invites.';
  end if;
  if exists (select 1 from pg_class
             where oid = to_regclass('public.person_season_invites') and relforcerowsecurity) then
    raise exception 'M070 ABORTED [RLS_FORCED]: FORCE ROW LEVEL SECURITY is set; the trusted definer path would be filtered by an empty policy set.';
  end if;

  select string_agg(p.policyname, ', ' order by p.policyname) into v_txt
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'person_season_invites';
  if v_txt is not null then
    raise exception 'M070 ABORTED [POLICY_APPEARED]: %. This table is RLS-on with ZERO policies by design.', v_txt;
  end if;

  select string_agg(g.grantee || '/' || g.privilege_type, ', ' order by g.grantee, g.privilege_type)
    into v_txt
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.table_name = 'person_season_invites'
    and g.grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_txt is not null then
    raise exception 'M070 ABORTED [GRANTS_REMAIN]: %.', v_txt;
  end if;

  -- service_role must retain full access, or every trusted path is dead on
  -- arrival. If any of it came via PUBLIC, Section 5 just removed it.
  foreach v_txt in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.person_season_invites', v_txt) then
      raise exception 'M070 ABORTED [SERVICE_ROLE_LOST]: service_role can no longer % on public.person_season_invites.', v_txt;
    end if;
  end loop;

  -- The three unique arbiters and the updated_at trigger must all exist.
  select string_agg(x, ', ' order by x) into v_txt
  from unnest(array[
    'person_season_invites_token_hash_key',
    'person_season_invites_live_key',
    'person_season_invites_accepted_key'
  ]) x
  where not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = x and i.indisunique and i.indisvalid and i.indisready
  );
  if v_txt is not null then
    raise exception 'M070 ABORTED [ARBITER_MISSING]: %.', v_txt;
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = to_regclass('public.person_season_invites')
      and t.tgname = 'person_season_invites_set_updated_at' and not t.tgisinternal
      and t.tgfoid = to_regprocedure('public.set_updated_at()')
  ) then
    raise exception 'M070 ABORTED [UPDATED_AT_TRIGGER]: the updated_at trigger is missing or does not point at public.set_updated_at().';
  end if;
end
$m070_post$;

notify pgrst, 'reload schema';

commit;
