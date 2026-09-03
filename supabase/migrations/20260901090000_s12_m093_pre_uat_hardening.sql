-- VAM OS S12 M093 — Pre-UAT hardening: returning-mentor collision guard
-- (approval side) and the bulk-review-assignment enum hotfix.
--
-- Two independent, pre-existing defects closed here, both additive
-- (CREATE OR REPLACE against an already-deployed function's exact
-- signature) rather than edits to the historical migrations that first
-- shipped them:
--
--   1. M092's OPEN FOLLOW-UP (see 20260831120000_s12_m092_bulk_official_
--      approval.sql's file header and the "documents the M093
--      renewal-collision follow-up" test): a returning mentor who
--      re-submitted through the ORDINARY new-mentor application form
--      (source = 'vam_os_form', no person_season_invites row bound to that
--      application) carries neither marker M092's renewal exclusion checks
--      for, so that row is processed as an ordinary new application by
--      vam092_bulk_official_approve_applications. This file adds a shared
--      predicate, public.vam093_returning_mentor_collision(), and calls it
--      from inside the already-deployed RPC (CREATE OR REPLACE, identical
--      signature and result contract) to refuse that specific case as
--      'manual_required' instead of silently approving it. The equivalent
--      guard for the single-application approval path
--      (lib/application-approvals.ts) and the new-application submission
--      path (lib/applications-create.ts) live in application code and call
--      lib/mentor-renewal-collision.ts, which this SQL predicate mirrors —
--      keep both definitions in sync if "collision" is ever redefined.
--
--   2. Independent M092.1 review finding: public.vam090_bulk_assign_
--      application_reviews (created by the already-applied
--      20260830221000_s12_m091_ops_bulk_limit.sql) contains three
--      occurrences of the enum-unsafe `lower(coalesce(a.role_applied, ''))`
--      construct. On a Staging-shaped schema, applications.role_applied is
--      public.role_type (an enum), and an unqualified coalesce(enum, '')
--      deterministically raises "invalid input value for enum role_type:
--      \"\"" before a single candidate row can be evaluated — the exact
--      defect M092.1 fixed in vam084_application_decision_eligibility and
--      in vam092_bulk_official_approve_applications itself. M092 never
--      calls this function, so it was not already fixed; bulk reviewer
--      assignment is a core pre-UAT operation, so it is fixed here, via a
--      NEW corrective migration against the exact deployed 10-arg
--      signature, never by editing the already-applied migration file.
--
-- Both replacements preserve: signature, result contract, authorization
-- (current_user = 'service_role' checks, revoke/grant boundaries),
-- deterministic ordering, skip counters, N-limit behavior, and reviewer
-- isolation. M092.2's gender/role_applied fixes and every other M092
-- guarantee are untouched — nothing in this file redefines
-- vam084_application_decision_eligibility, vam090_finalize_recruitment_
-- approval, or any people/mentor_profiles/mentee_profiles write path other
-- than the new refusal branch described above.

begin;

-- ---------------------------------------------------------------------------
-- 0. Prerequisites. This migration extends two already-deployed functions and
--    reads two already-deployed tables; refuse cleanly if any of them are not
--    the shapes this file assumes, rather than raising a confusing error
--    mid-CREATE OR REPLACE.
-- ---------------------------------------------------------------------------

do $m093_pre$
declare
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array[
    'mentor_profiles', 'person_season_invites', 'applications',
    'admin_users', 'admin_audit_log'
  ]) t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'M093 ABORTED [PREREQ_TABLE_MISSING]: %.', v_missing;
  end if;

  if to_regprocedure('public.vam092_bulk_official_approve_applications(uuid[],uuid)') is null then
    raise exception 'M093 ABORTED [PREREQ_FUNCTION_MISSING]: public.vam092_bulk_official_approve_applications(uuid[],uuid) is absent. Apply 20260831120000_s12_m092_bulk_official_approval.sql first.';
  end if;

  if to_regprocedure(
    'public.vam090_bulk_assign_application_reviews(uuid,text,text[],uuid[],text,timestamptz,boolean,text,uuid,integer)'
  ) is null then
    raise exception 'M093 ABORTED [PREREQ_FUNCTION_MISSING]: the 10-arg public.vam090_bulk_assign_application_reviews is absent. Apply 20260830221000_s12_m091_ops_bulk_limit.sql first.';
  end if;
end
$m093_pre$;

-- ---------------------------------------------------------------------------
-- 1. The shared returning-mentor collision predicate.
--
-- True when the canonical person already carries a mentor_profiles record
-- (a prior season, or an already-accepted renewal), OR a person_season_
-- invites row for this exact season + the mentor role that is either still
-- renewable (not revoked, not yet submitted, not expired — the same
-- "renewable" state lib/renewal-invite-token.ts's evaluateRenewalInviteGate
-- would report) or already accepted.
--
-- Deliberately does NOT call public.vam071_accepted_renewal_exists(): that
-- function has EXECUTE revoked from every role including service_role by
-- design (M071 Section 8 — "reached only from the definer functions above").
-- The accepted-outcome check is instead re-stated directly, in the same
-- shape, so this predicate can be granted to service_role and called from
-- vam092's SECURITY INVOKER context without widening vam071's lockdown.
--
-- A declined or expired-unsubmitted invite is NOT a collision — the person
-- is free to be treated as an ordinary applicant again.
-- ---------------------------------------------------------------------------

create or replace function public.vam093_returning_mentor_collision(
  p_person_id uuid,
  p_season_id uuid
) returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    exists (
      select 1 from public.mentor_profiles mp where mp.person_id = p_person_id
    )
    or exists (
      select 1 from public.person_season_invites psi
      where psi.person_id = p_person_id
        and psi.season_id = p_season_id
        and psi.role = 'mentor'
        and psi.revoked_at is null
        and (
          (psi.submitted_at is null and psi.expires_at > now())
          or (psi.submitted_at is not null and psi.outcome = 'accepted')
        )
    )
$fn$;

revoke all on function public.vam093_returning_mentor_collision(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vam093_returning_mentor_collision(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. vam092_bulk_official_approve_applications — add the collided-row guard.
--
-- Identical to the deployed function (20260831120000) in every respect
-- except one new branch, inserted after identity resolution and profile-step
-- serialization (the advisory lock on the resolved person is already held at
-- this point) and before the mentor-profile 0/1/>1 resolution: when the
-- target role is mentor and the resolved person collides per the predicate
-- above, the row is reported 'manual_required' / 'returning_mentor_renewal_
-- path_required' and no person/profile/application write happens for it —
-- the same shape every other manual_required branch in this function
-- already uses. Mentee approvals are unaffected; they have no renewal
-- contract and are not in scope for this guard.
-- ---------------------------------------------------------------------------

create or replace function public.vam092_bulk_official_approve_applications(
  p_application_ids uuid[],
  p_actor uuid
) returns table (
  application_id uuid,
  target_role text,
  outcome text,
  reason_code text,
  person_id uuid,
  person_created boolean,
  profile_id uuid,
  profile_created boolean
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ids uuid[];
  v_actor_name text;
  v_id uuid;
  v_app public.applications%rowtype;
  v_target_role text;
  v_new_status text;
  v_gate record;
  v_is_renewal boolean;
  v_email text;
  v_gender public.people.gender%type;
  v_person_id uuid;
  v_person_created boolean;
  v_person_count integer;
  v_profile_id uuid;
  v_profile_created boolean;
  v_profile_count integer;
  v_finalized boolean;
  v_sqlstate text;
  v_diag_message text;
  v_diag_context text;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted server context required';
  end if;

  -- Reject empty/oversized/malformed requests at the mutation boundary —
  -- never trust the caller (server action) to have already enforced this.
  if p_application_ids is null
     or cardinality(p_application_ids) < 1
     or cardinality(p_application_ids) > 100 then
    raise exception 'Bulk official approval requires 1-100 application IDs';
  end if;

  select coalesce(nullif(btrim(au.full_name), ''), au.email) into v_actor_name
  from public.admin_users au
  where au.id = p_actor and au.status = 'active';
  if v_actor_name is null then raise exception 'Approval actor not found'; end if;

  -- Deterministic de-duplication, preserving first-occurrence order, so a
  -- caller that (accidentally or via double-submit) sends the same ID twice
  -- gets exactly one row result for it, not two.
  select array_agg(x.id order by x.first_ord)
    into v_ids
  from (
    select id, min(ord) as first_ord
    from unnest(p_application_ids) with ordinality as t(id, ord)
    group by id
  ) x;

  -- Lock every distinct requested row up front, before any row is
  -- processed. Two concurrent bulk-approval calls touching overlapping
  -- selections serialize on this instead of racing to create duplicate
  -- people/profiles or duplicate approvals.
  perform a.id
  from public.applications a
  where a.id = any(v_ids)
  order by a.id
  for update;

  foreach v_id in array v_ids loop
    v_target_role := null;
    v_new_status := null;
    v_person_id := null;
    v_person_created := false;
    v_profile_id := null;
    v_profile_created := false;

    begin
      -- Everything from here to the end of this block runs under an
      -- implicit SAVEPOINT (PL/pgSQL creates one for any block with an
      -- EXCEPTION clause): a raise anywhere below rolls back only this
      -- application's writes and falls through to the handler, which
      -- reports outcome := 'failed' and continues the loop.

      select a.* into v_app from public.applications a where a.id = v_id;
      if v_app.id is null then
        application_id := v_id; target_role := null; outcome := 'failed';
        reason_code := 'application_not_found';
        person_id := null; person_created := null; profile_id := null; profile_created := null;
        return next;
        continue;
      end if;

      if not public.vam084_operator_for_season(p_actor, v_app.season_id) then
        application_id := v_id; target_role := null; outcome := 'skipped';
        reason_code := 'scope_denied';
        person_id := null; person_created := null; profile_id := null; profile_created := null;
        return next;
        continue;
      end if;

      -- M092.1: role_applied is public.role_type (enum) on Staging, not
      -- text. Normalizing through ::text first makes this comparison work
      -- identically whether the column is the enum or plain text.
      v_target_role := lower(btrim(coalesce(v_app.role_applied::text, '')));
      if v_target_role not in ('mentor', 'mentee') then
        application_id := v_id; target_role := v_target_role; outcome := 'skipped';
        reason_code := 'unsupported_role';
        person_id := null; person_created := null; profile_id := null; profile_created := null;
        return next;
        continue;
      end if;
      v_new_status := case when v_target_role = 'mentor' then 'approved_as_mentor' else 'approved_as_mentee' end;

      -- Idempotent re-run: this application is already at the target
      -- status (e.g. a retried batch that partly succeeded before). Report
      -- it as a safe skip, not a failure, and touch nothing.
      if v_app.status = v_new_status then
        application_id := v_id; target_role := v_target_role; outcome := 'skipped';
        reason_code := 'already_approved';
        person_id := v_app.person_id; person_created := false; profile_id := null; profile_created := false;
        return next;
        continue;
      end if;

      -- Renewal/continuation applications carry their own durable
      -- confirmation + membership contract (see
      -- vam084_grant_recruitment_participation callers / M071 renewal
      -- runtime) and must never be finalized through this generic bulk
      -- path — route the operator to the dedicated renewal flow instead.
      select exists (
        select 1 from public.person_season_invites psi
        where psi.application_id = v_id
      ) into v_is_renewal;
      if v_app.source = 's12_mentor_renewal' or v_is_renewal then
        application_id := v_id; target_role := v_target_role; outcome := 'skipped';
        reason_code := 'renewal_requires_individual_path';
        person_id := null; person_created := null; profile_id := null; profile_created := null;
        return next;
        continue;
      end if;

      -- Re-evaluate the same lifecycle/review-minimum eligibility gate the
      -- individual approval path uses. Never weakened, never bypassed.
      select * into v_gate
      from public.vam084_application_decision_eligibility(v_id, v_new_status);
      if not coalesce(v_gate.eligible, false) then
        application_id := v_id; target_role := v_target_role; outcome := 'skipped';
        reason_code := coalesce(v_gate.reason, 'ineligible');
        person_id := null; person_created := null; profile_id := null; profile_created := null;
        return next;
        continue;
      end if;

      -- ---------------- identity resolution (server-derived only) --------
      -- Every identity input below is read from the locked application row
      -- itself (full_name / email_primary / phone_primary / gender —
      -- native S12 form columns), never from the caller's request.

      if v_app.person_id is not null then
        if not exists (select 1 from public.people p where p.id = v_app.person_id) then
          application_id := v_id; target_role := v_target_role; outcome := 'manual_required';
          reason_code := 'linked_person_not_found';
          person_id := null; person_created := null; profile_id := null; profile_created := null;
          return next;
          continue;
        end if;
        -- An existing linkage is authoritative unless the application's own
        -- (non-blank) email visibly disagrees with the linked person — that
        -- disagreement is exactly the "conflicting person_id" case that
        -- must never be silently resolved by a bulk operation.
        if v_app.email_primary is not null and btrim(v_app.email_primary) <> '' then
          if not exists (
            select 1 from public.people p
            where p.id = v_app.person_id
              and lower(btrim(p.email_primary)) = lower(btrim(v_app.email_primary))
          ) then
            application_id := v_id; target_role := v_target_role; outcome := 'manual_required';
            reason_code := 'person_link_identity_conflict';
            person_id := null; person_created := null; profile_id := null; profile_created := null;
            return next;
            continue;
          end if;
        end if;
        v_person_id := v_app.person_id;
      else
        if v_app.email_primary is null or btrim(v_app.email_primary) = '' then
          application_id := v_id; target_role := v_target_role; outcome := 'manual_required';
          reason_code := 'blank_email';
          person_id := null; person_created := null; profile_id := null; profile_created := null;
          return next;
          continue;
        end if;
        v_email := lower(btrim(v_app.email_primary));

        -- M092.1: serialize on the canonical identity (email, since no
        -- person exists yet to key on) BEFORE the count-then-decide lookup
        -- below, so two applications for the same new applicant running in
        -- concurrent bulk-approval calls cannot both observe "0 people" and
        -- both insert a person row. Same pg_advisory_xact_lock('NS|key')
        -- convention as vam063_* / vam084_grant_recruitment_participation.
        -- An xact lock releases only at COMMIT/ROLLBACK, not at a savepoint
        -- rollback, so it stays held for the rest of this call's
        -- transaction — safe (and reentrant for this same session) since
        -- everything else in this function runs single-threaded per call.
        perform pg_advisory_xact_lock(hashtext('VAM092_PERSON_EMAIL|' || v_email));

        select count(*) into v_person_count
        from public.people p
        where lower(btrim(p.email_primary)) = v_email;

        if v_person_count > 1 then
          -- Ambiguous identity — never guess.
          application_id := v_id; target_role := v_target_role; outcome := 'manual_required';
          reason_code := 'ambiguous_identity';
          person_id := null; person_created := null; profile_id := null; profile_created := null;
          return next;
          continue;
        elsif v_person_count = 1 then
          select p.id into v_person_id from public.people p
          where lower(btrim(p.email_primary)) = v_email;
        else
          if v_app.full_name is null or btrim(v_app.full_name) = '' then
            application_id := v_id; target_role := v_target_role; outcome := 'manual_required';
            reason_code := 'blank_full_name';
            person_id := null; person_created := null; profile_id := null; profile_created := null;
            return next;
            continue;
          end if;
          -- M092.2: assign the mapped value to a `people.gender%type`
          -- variable rather than casting an inline text expression to a
          -- hardcoded type name — this makes the write type-agnostic,
          -- correct whether people.gender is `text` (confirmed on Staging)
          -- or a user-defined enum, without ever naming a type that might
          -- not exist. Vocabulary matches lib/application-approvals.ts's
          -- normalizeGenderForPeople(): male | female | other | undisclosed,
          -- with unmapped/blank values omitted (null) rather than written
          -- as an invalid value.
          v_gender := (case lower(btrim(coalesce(v_app.gender, '')))
            when 'male' then 'male'
            when 'female' then 'female'
            when 'other' then 'other'
            when 'prefer_not_say' then 'undisclosed'
            when 'undisclosed' then 'undisclosed'
            else null
          end);
          insert into public.people (
            full_name, email_primary, phone_primary, gender, source_sheets
          ) values (
            btrim(v_app.full_name),
            v_email,
            nullif(btrim(v_app.phone_primary), ''),
            v_gender,
            's12_native_application'
          ) returning id into v_person_id;
          v_person_created := true;
        end if;
      end if;

      -- ---------------- profile resolution (create or reuse) -------------
      -- M092.1: serialize on the now-resolved canonical person identity
      -- BEFORE the profile 0/1/>1 check below, regardless of which branch
      -- above resolved v_person_id (pre-linked application_id.person_id,
      -- email match, or newly created) — this is what makes two different
      -- applications that resolve to the SAME person, approved in
      -- concurrent bulk-approval calls, serialize on the profile step
      -- instead of both observing "0 profiles" and both inserting one.
      perform pg_advisory_xact_lock(hashtext('VAM092_PERSON|' || v_person_id::text));

      -- M093 — collided-row approval guard (see file header). A returning
      -- mentor who applied through the ordinary new-mentor form carries
      -- neither `source = 's12_mentor_renewal'` nor an application-bound
      -- person_season_invites row, so the renewal exclusion above does not
      -- catch it. Refuse here, while still holding the per-person advisory
      -- lock, rather than silently reusing (or, via a future refresh,
      -- overwriting) the canonical mentor_profiles row.
      if v_target_role = 'mentor'
         and public.vam093_returning_mentor_collision(v_person_id, v_app.season_id) then
        application_id := v_id; target_role := v_target_role; outcome := 'manual_required';
        reason_code := 'returning_mentor_renewal_path_required';
        person_id := v_person_id; person_created := v_person_created; profile_id := null; profile_created := null;
        return next;
        continue;
      end if;

      if v_target_role = 'mentor' then
        select count(*) into v_profile_count from public.mentor_profiles mp where mp.person_id = v_person_id;
        if v_profile_count > 1 then
          -- Never choose an arbitrary profile among several candidates.
          application_id := v_id; target_role := v_target_role; outcome := 'manual_required';
          reason_code := 'ambiguous_profile';
          person_id := v_person_id; person_created := v_person_created; profile_id := null; profile_created := null;
          return next;
          continue;
        elsif v_profile_count = 1 then
          select mp.id into v_profile_id from public.mentor_profiles mp where mp.person_id = v_person_id;
        else
          insert into public.mentor_profiles (
            person_id, mentor_code, source_application_id, intake_batch_id,
            company_current, title_current, function_area, industry,
            years_experience_text, first_vam_season, capacity_target, years_experience_min
          ) values (
            v_person_id, null, v_id, v_app.intake_batch_id,
            nullif(btrim(v_app.raw_payload->>'company_current'), ''),
            nullif(btrim(v_app.raw_payload->>'title_current'), ''),
            nullif(btrim(v_app.raw_payload->>'function_primary'), ''),
            nullif(btrim(v_app.raw_payload->>'industry_primary'), ''),
            nullif(btrim(v_app.raw_payload->>'years_of_experience'), ''),
            nullif(btrim(v_app.raw_payload->>'first_vam_season'), ''),
            public.vam092_safe_nonneg_int(v_app.raw_payload->>'mentoring_capacity_total'),
            public.vam092_safe_nonneg_int(v_app.raw_payload->>'mentor_total_work_years')
          ) returning id into v_profile_id;
          v_profile_created := true;
        end if;
      else
        select count(*) into v_profile_count from public.mentee_profiles mp where mp.person_id = v_person_id;
        if v_profile_count > 1 then
          application_id := v_id; target_role := v_target_role; outcome := 'manual_required';
          reason_code := 'ambiguous_profile';
          person_id := v_person_id; person_created := v_person_created; profile_id := null; profile_created := null;
          return next;
          continue;
        elsif v_profile_count = 1 then
          select mp.id into v_profile_id from public.mentee_profiles mp where mp.person_id = v_person_id;
        else
          insert into public.mentee_profiles (
            person_id, mentee_code, source_application_id, intake_batch_id
          ) values (
            v_person_id, null, v_id, v_app.intake_batch_id
          ) returning id into v_profile_id;
          v_profile_created := true;
        end if;
      end if;

      -- ---------------- finalize: the same trusted, atomic primitive the
      -- individual approval path uses. Sets applications.status +
      -- person_id together and writes the per-row application_decisions
      -- audit row; raises if the expected-status optimistic-concurrency
      -- check or the eligibility gate no longer holds (unreachable here in
      -- practice since we already hold the row lock, but defense in depth
      -- costs nothing).

      v_finalized := public.vam090_finalize_recruitment_approval(
        v_id, v_new_status, p_actor, v_person_id, v_app.status,
        format(
          'Bulk official approval as %s. person_id=%s profile_id=%s person_created=%s profile_created=%s',
          v_target_role, v_person_id, v_profile_id, v_person_created, v_profile_created
        )
      );
      if not v_finalized then
        raise exception 'Finalization did not confirm success';
      end if;

      insert into public.admin_audit_log (
        actor_admin_user_id, action_type, target_admin_user_id, before_data, after_data, details
      ) values (
        p_actor,
        format('approve_application_as_%s', v_target_role),
        null,
        null,
        jsonb_build_object(
          'application_id', v_id,
          'person_id', v_person_id,
          'profile_id', v_profile_id,
          'person_created', v_person_created,
          'profile_created', v_profile_created,
          'new_status', v_new_status
        ),
        jsonb_build_object('bulk', true, 'source', 'vam092_bulk_official_approve_applications')
      );

      application_id := v_id; target_role := v_target_role; outcome := 'approved';
      reason_code := 'approved';
      person_id := v_person_id; person_created := v_person_created;
      profile_id := v_profile_id; profile_created := v_profile_created;
      return next;
    exception when others then
      -- M092.1: capture diagnostics server-side before the generic,
      -- PII-free row failure is reported to the caller. DETAIL/HINT are
      -- deliberately NOT captured — a constraint-violation DETAIL can echo
      -- back the offending applicant-submitted value (e.g. an email in a
      -- "Key (email_primary)=(...) already exists" message). SQLSTATE,
      -- MESSAGE_TEXT (Postgres/PL/pgSQL's own generated wording, not
      -- applicant data) and PG_EXCEPTION_CONTEXT (call-stack/line info) are
      -- safe. Anything unexpected above (constraint violation, finalize
      -- raising, etc.) rolls back to this row's savepoint — no orphan
      -- person, profile, application mutation or audit row survives from
      -- this attempt.
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_diag_message = message_text,
        v_diag_context = pg_exception_context;
      raise warning 'vam092_bulk_official_approve_applications: row failed application_id=% target_role=% sqlstate=% message=% context=%',
        v_id, v_target_role, v_sqlstate, v_diag_message, v_diag_context;

      application_id := v_id; target_role := v_target_role; outcome := 'failed';
      reason_code := 'internal_error';
      person_id := null; person_created := null; profile_id := null; profile_created := null;
      return next;
    end;
  end loop;
end;
$fn$;

revoke all on function public.vam092_bulk_official_approve_applications(uuid[],uuid) from public, anon, authenticated;
grant execute on function public.vam092_bulk_official_approve_applications(uuid[],uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. vam090_bulk_assign_application_reviews — the enum hotfix.
--
-- Identical to the deployed function (20260830221000, 10-arg signature) in
-- every respect except the three occurrences of the enum-unsafe
-- `lower(coalesce(a.role_applied, ''))`, each normalized through `::text`
-- first — the same fix M092.1 already applied to
-- vam084_application_decision_eligibility and to this RPC's own
-- v_target_role assignment. p_role_applied (the caller-supplied filter) was
-- always text and needed no change.
-- ---------------------------------------------------------------------------

create or replace function public.vam090_bulk_assign_application_reviews(
  p_intake_batch_id uuid,
  p_role_applied text,
  p_statuses text[],
  p_reviewer_ids uuid[],
  p_review_round text,
  p_due_at timestamptz,
  p_exclude_already_assigned boolean,
  p_assignment_note text,
  p_actor uuid,
  p_limit integer default null
) returns table (
  batch_id uuid,
  applications_assigned integer,
  reviewers_count integer,
  min_per_reviewer integer,
  max_per_reviewer integer,
  skipped_already_assigned integer,
  skipped_limit_reached integer
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_season_id uuid;
  v_application_ids uuid[];
  v_reviewer_ids uuid[];
  v_batch_id uuid;
  v_application_id uuid;
  v_reviewer_id uuid;
  v_candidate_count integer;
  v_assigned integer := 0;
  -- Kept distinct: a candidate excluded because it already has an active
  -- assignment is a materially different outcome from one that was simply
  -- never reached because the batch was capped at p_limit. Collapsing them
  -- into one counter would misrepresent a limit-truncated application as
  -- "already assigned" to the caller.
  v_skipped_already_assigned integer := 0;
  v_skipped_limit_reached integer := 0;
  v_app_index integer;
  v_offset integer;
  v_reviewer_count integer;
  v_selected boolean;
  v_min integer;
  v_max integer;
  v_actual_reviewers integer;
  v_profile_statuses constant text[] := array[
    'submitted','under_data_check','ready_for_screening','screening_assigned','needs_more_review'
  ];
  v_interview_statuses constant text[] := array[
    'invited_to_interview','interview_scheduled','interview_in_progress','needs_more_review'
  ];
begin
  if current_user <> 'service_role' then raise exception 'Trusted server context required'; end if;
  if p_intake_batch_id is null then raise exception 'Intake batch is required'; end if;
  -- p_limit must be rejected outright when out of range, not silently treated
  -- as "no limit": a caller passing 0 or a negative number almost certainly
  -- made a mistake and expects an error, not an unbounded assignment. 500 is
  -- a generous ceiling for a single UEHM one-wave batch while still bounding
  -- pathological input at the mutation boundary, not only in the UI.
  if p_limit is not null and (p_limit < 1 or p_limit > 500) then
    raise exception 'Assignment limit must be between 1 and 500';
  end if;
  if p_review_round not in ('profile_screening','interview') then raise exception 'Invalid review round'; end if;
  if lower(btrim(coalesce(p_role_applied, ''))) not in ('mentor','mentee') then raise exception 'Invalid applied role'; end if;
  if coalesce(cardinality(p_statuses), 0) < 1
     or coalesce(cardinality(p_reviewer_ids), 0) < 1
     or cardinality(p_reviewer_ids) > 100
     or (select count(distinct value) from unnest(p_reviewer_ids) requested(value)) <> cardinality(p_reviewer_ids)
     or (select count(distinct value) from unnest(p_statuses) requested(value)) <> cardinality(p_statuses) then
    raise exception 'Assignment filters and reviewers must be non-empty and unique';
  end if;
  if (p_review_round = 'profile_screening' and not p_statuses <@ v_profile_statuses)
     or (p_review_round = 'interview' and not p_statuses <@ v_interview_statuses) then
    raise exception 'Assignment status filter is invalid for the review round';
  end if;

  select ib.season_id into v_season_id
  from public.intake_batches ib
  where ib.id = p_intake_batch_id;
  if v_season_id is null or not public.vam084_operator_for_season(p_actor, v_season_id) then
    raise exception 'Assignment batch scope denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_intake_batch_id::text || ':' || p_review_round, 0));

  select array_agg(au.id order by coalesce(workload.active_count, 0), coalesce(au.email, ''), au.id)
    into v_reviewer_ids
  from unnest(p_reviewer_ids) requested(id)
  join public.admin_users au on au.id = requested.id and au.status = 'active'
  left join lateral (
    select count(*)::integer as active_count
    from public.application_reviews ar
    where ar.reviewer_admin_user_id = au.id
      and ar.review_round = p_review_round
      and ar.status <> 'cancelled'
  ) workload on true;
  if cardinality(v_reviewer_ids) <> cardinality(p_reviewer_ids) then
    raise exception 'One or more reviewers are not active';
  end if;
  foreach v_reviewer_id in array v_reviewer_ids loop
    if not public.vam084_participant_for_stage(v_reviewer_id, v_season_id, p_review_round) then
      raise exception 'Reviewer is not an active participant for this season and stage';
    end if;
  end loop;

  -- M093: role_applied is public.role_type (enum) on Staging, not text — the
  -- same defect M092.1 fixed elsewhere. Normalizing through ::text first
  -- makes this comparison, and the two identical ones below, work
  -- identically whether the column is the enum or plain text.
  select count(*)::integer into v_candidate_count
  from public.applications a
  where a.intake_batch_id = p_intake_batch_id
    and lower(coalesce(a.role_applied::text, '')) = lower(btrim(p_role_applied))
    and a.status = any(p_statuses)
    and (
      a.status <> 'needs_more_review'
      or (p_review_round = 'profile_screening' and not exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
      or (p_review_round = 'interview' and exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
    );

  perform a.id
  from public.applications a
  where a.intake_batch_id = p_intake_batch_id
    and lower(coalesce(a.role_applied::text, '')) = lower(btrim(p_role_applied))
    and a.status = any(p_statuses)
    and (
      a.status <> 'needs_more_review'
      or (p_review_round = 'profile_screening' and not exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
      or (p_review_round = 'interview' and exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
    )
  order by a.submitted_at nulls last, a.id
  for update;

  select array_agg(a.id order by a.submitted_at nulls last, a.id)
    into v_application_ids
  from public.applications a
  where a.intake_batch_id = p_intake_batch_id
    and lower(coalesce(a.role_applied::text, '')) = lower(btrim(p_role_applied))
    and a.status = any(p_statuses)
    and (
      a.status <> 'needs_more_review'
      or (p_review_round = 'profile_screening' and not exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
      or (p_review_round = 'interview' and exists (
        select 1 from public.application_reviews stage_ar
        where stage_ar.application_id = a.id and stage_ar.review_round = 'interview'
      ))
    )
    and (
      not p_exclude_already_assigned
      or not exists (
        select 1 from public.application_reviews ar
        where ar.application_id = a.id
          and ar.review_round = p_review_round
          and ar.status <> 'cancelled'
      )
    );

  v_skipped_already_assigned := v_candidate_count - coalesce(cardinality(v_application_ids), 0);

  -- Handle limit restriction. p_limit is already validated to be between
  -- 1 and 500 (or null) above. Truncation here is a separate reason from
  -- "already assigned" above — track it in its own counter.
  if p_limit is not null and coalesce(cardinality(v_application_ids), 0) > p_limit then
    v_skipped_limit_reached := cardinality(v_application_ids) - p_limit;
    v_application_ids := v_application_ids[1:p_limit];
  end if;

  if coalesce(cardinality(v_application_ids), 0) = 0 then
    raise exception 'No applications matched the assignment filters';
  end if;

  insert into public.review_assignment_batches (
    intake_batch_id, review_round, created_by, due_at,
    assignment_note, application_count, reviewer_count
  ) values (
    p_intake_batch_id, p_review_round, p_actor, p_due_at,
    nullif(btrim(p_assignment_note), ''), 0, 0
  ) returning id into v_batch_id;

  v_reviewer_count := cardinality(v_reviewer_ids);
  for v_app_index in 1..cardinality(v_application_ids) loop
    v_application_id := v_application_ids[v_app_index];
    v_selected := false;
    for v_offset in 0..(v_reviewer_count - 1) loop
      v_reviewer_id := v_reviewer_ids[1 + mod(v_app_index - 1 + v_offset, v_reviewer_count)];
      if not exists (
        select 1 from public.application_reviews ar
        where ar.application_id = v_application_id
          and ar.reviewer_admin_user_id = v_reviewer_id
          and ar.review_round = p_review_round
          and ar.status <> 'cancelled'
      ) then
        insert into public.application_reviews (
          application_id, review_round, reviewer_admin_user_id, assigned_by,
          assigned_at, due_at, status, assignment_batch_id
        ) values (
          v_application_id, p_review_round, v_reviewer_id, p_actor,
          now(), p_due_at, 'assigned', v_batch_id
        );
        perform public.vam084_recompute_application_review_status(v_application_id, p_review_round);
        v_assigned := v_assigned + 1;
        v_selected := true;
        exit;
      end if;
    end loop;
    if not v_selected then v_skipped_already_assigned := v_skipped_already_assigned + 1; end if;
  end loop;
  if v_assigned = 0 then raise exception 'No non-duplicate assignments could be created'; end if;

  select count(distinct ar.reviewer_admin_user_id)::integer,
         min(per_reviewer.assignment_count)::integer,
         max(per_reviewer.assignment_count)::integer
    into v_actual_reviewers, v_min, v_max
  from public.application_reviews ar
  join lateral (
    select count(*)::integer as assignment_count
    from public.application_reviews counted
    where counted.assignment_batch_id = v_batch_id
      and counted.reviewer_admin_user_id = ar.reviewer_admin_user_id
  ) per_reviewer on true
  where ar.assignment_batch_id = v_batch_id;

  update public.review_assignment_batches
  set application_count = v_assigned, reviewer_count = v_actual_reviewers
  where id = v_batch_id;

  return query select v_batch_id, v_assigned, v_actual_reviewers, v_min, v_max,
    v_skipped_already_assigned, v_skipped_limit_reached;
end;
$fn$;

revoke all on function public.vam090_bulk_assign_application_reviews(uuid,text,text[],uuid[],text,timestamptz,boolean,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.vam090_bulk_assign_application_reviews(uuid,text,text[],uuid[],text,timestamptz,boolean,text,uuid,integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Post-conditions.
-- ---------------------------------------------------------------------------

do $m093_post$
begin
  if to_regprocedure('public.vam093_returning_mentor_collision(uuid,uuid)') is null then
    raise exception 'M093 ABORTED [POST_FUNCTION_MISSING]: public.vam093_returning_mentor_collision(uuid,uuid) did not install.';
  end if;
  if not has_function_privilege('service_role', 'public.vam093_returning_mentor_collision(uuid,uuid)', 'execute') then
    raise exception 'M093 ABORTED [POST_GRANT_MISSING]: service_role cannot execute public.vam093_returning_mentor_collision(uuid,uuid).';
  end if;
  if not has_function_privilege('service_role', 'public.vam092_bulk_official_approve_applications(uuid[],uuid)', 'execute') then
    raise exception 'M093 ABORTED [POST_GRANT_MISSING]: service_role cannot execute public.vam092_bulk_official_approve_applications(uuid[],uuid).';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.vam090_bulk_assign_application_reviews(uuid,text,text[],uuid[],text,timestamptz,boolean,text,uuid,integer)',
    'execute'
  ) then
    raise exception 'M093 ABORTED [POST_GRANT_MISSING]: service_role cannot execute the 10-arg public.vam090_bulk_assign_application_reviews.';
  end if;
end
$m093_post$;

notify pgrst, 'reload schema';
commit;
