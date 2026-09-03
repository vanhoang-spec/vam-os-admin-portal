-- VAM OS S12 M092 — Bulk Official Approval
--
-- A dedicated, trusted approval boundary for turning eligible mentor/mentee
-- applications into officially approved participants in bulk. This is
-- deliberately NOT built on top of vam084_apply_application_decisions: that
-- generic decision layer only ever flips applications.status and writes an
-- audit row — it has no concept of people/profile linkage, so routing
-- approved_as_mentor / approved_as_mentee through it can leave an
-- application marked "approved" with no corresponding person or profile.
--
-- Model:
--   * PARTIAL SUCCESS AT BATCH LEVEL — a 100-row batch may return a mix of
--     approved / skipped / manual_required / failed rows.
--   * ATOMICITY AT EACH APPLICATION ROW — the nested `begin ... exception
--     when others` block below is a PL/pgSQL implicit SAVEPOINT: if any
--     step for one application raises, only that row's writes (person
--     insert, profile insert, application update, decision audit) roll
--     back. Every other row's already-`return next`-ed result, and the
--     outer transaction itself, are unaffected.
--
-- Reuses vam084_operator_for_season (scope), vam084_application_decision_
-- eligibility (lifecycle gate) and vam090_finalize_recruitment_approval
-- (the same atomic status+person_id+audit primitive the single-application
-- approval path already uses) instead of re-implementing any of that logic.
--
-- M092.1 remediation (this file was never applied to Staging/Production, so
-- fixes land here rather than in a follow-up migration):
--   1. applications.role_applied is public.role_type (enum) on Staging, not
--      text. Every unqualified coalesce() over that raw column — including
--      the one inherited by the already-deployed vam084_application_
--      decision_eligibility — raised before a single row could be
--      evaluated. Fixed by normalizing through `v_app.role_applied::text`
--      first, which is a no-op when the column really is text and a safe
--      read when it is the enum.
--   2. people.gender's real type could not be confirmed before this file was
--      first written, and was assumed to be public.gender_type (enum) —
--      wrong: a direct read-only preflight against Staging (M092.2) found
--      people.gender is plain `text` there, and public.gender_type does not
--      exist at all. A hardcoded `::public.gender_type` cast would have
--      failed outright on Staging. Fixed type-agnostically: the mapped
--      value is assigned to a `people.gender%type`-declared plpgsql
--      variable before the insert, instead of cast inline in the VALUES
--      list. PL/pgSQL variable assignment coerces via the target's I/O
--      functions (unlike a plain SQL INSERT's assignment-cast rules), so
--      this same code compiles and runs correctly whether the resolved
--      column type is `text` or a user-defined enum — proven against both
--      shapes in a throwaway PostgreSQL 16 container (M092.2).
--   3. mentor_profiles.person_id / mentee_profiles.person_id carry no
--      uniqueness guarantee, and a plain `select ... into` silently keeps
--      only the first of several matching rows with no error — the exact
--      "never choose an arbitrary profile" failure mode. Profile resolution
--      now explicitly counts 0 / 1 / >1 and treats >1 as manual_required.
--      Two different applications concurrently resolving to the same person
--      are additionally serialized with a pg_advisory_xact_lock keyed on
--      the canonical person identity (email while creating a new person,
--      then the resolved person_id before profile resolution) — the same
--      convention vam063 (person+season+role) and vam084_grant_recruitment_
--      participation (person+season+role) already use for this repo.
--   4. The per-row exception handler now captures GET STACKED DIAGNOSTICS
--      (SQLSTATE + message + context — no exception DETAIL, which can carry
--      applicant-submitted values) and emits a server-side RAISE WARNING
--      before converting the row to a generic 'failed'/'internal_error'
--      result. Nothing beyond that generic pair ever reaches the caller.
--
-- OPEN FOLLOW-UP (tracked for M093, not solved here): a returning mentor
-- who re-submitted through the ordinary NEW-mentor application form (not
-- the renewal flow) carries neither `source = 's12_mentor_renewal'` nor a
-- person_season_invites row, so M092's renewal exclusion does not catch
-- it — that application is processed as an ordinary new application by
-- this RPC. The profile-concurrency hardening in this file prevents that
-- from ever creating a *second* mentor_profiles row (email-based person
-- reuse still applies), but it does not detect or refuse the underlying
-- duplicate-application scenario itself. M093 closes that path before real
-- team UAT.

begin;

-- ---------------------------------------------------------------------------
-- 0. M092.1 — fix the inherited role_applied enum defect in the shared
--    lifecycle eligibility gate (originally created in migration
--    20260830070430_s12_recruitment_operational_remediation.sql). Same
--    signature, same semantics, only the two role_applied comparisons are
--    normalized through ::text first. M092's RPC depends on this gate for
--    the approved_as_mentor/approved_as_mentee branch, so this fix is a
--    hard prerequisite for M092 working at all on a Staging-shaped schema.
-- ---------------------------------------------------------------------------

create or replace function public.vam084_application_decision_eligibility(
  p_application_id uuid,
  p_new_status text
) returns table (eligible boolean, reason text)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_app public.applications%rowtype;
  v_profile_required integer;
  v_interview_required integer;
  v_profile_submitted integer;
  v_interview_submitted integer;
  v_latest_more_review_at timestamptz;
begin
  select a.* into v_app from public.applications a where a.id = p_application_id;
  if v_app.id is null then return query select false, 'application_not_found'; return; end if;

  select r.minimum_submitted_reviews into v_profile_required
  from public.recruitment_stage_requirements r
  where r.season_id = v_app.season_id and r.review_stage = 'profile_screening';
  select r.minimum_submitted_reviews into v_interview_required
  from public.recruitment_stage_requirements r
  where r.season_id = v_app.season_id and r.review_stage = 'interview';
  if v_profile_required is null or v_interview_required is null then
    return query select false, 'stage_requirement_missing'; return;
  end if;

  select
    count(distinct ar.reviewer_admin_user_id) filter (
      where ar.review_round = 'profile_screening' and ar.status = 'submitted'
    ),
    count(distinct ar.reviewer_admin_user_id) filter (
      where ar.review_round = 'interview' and ar.status = 'submitted'
    )
  into v_profile_submitted, v_interview_submitted
  from public.application_reviews ar
  where ar.application_id = p_application_id;

  select max(ad.created_at) into v_latest_more_review_at
  from public.application_decisions ad
  where ad.application_id = p_application_id
    and ad.new_status = 'needs_more_review';

  if p_new_status = 'under_data_check' then
    return query select v_app.status in ('submitted','ready_for_screening'),
      case when v_app.status in ('submitted','ready_for_screening') then 'eligible' else 'invalid_transition' end;
  elsif p_new_status = 'screening_passed' then
    return query select
      v_app.status in ('screening_completed','needs_admin_review','needs_more_review')
        and v_profile_submitted >= v_profile_required
        and (v_app.status <> 'needs_more_review' or v_interview_submitted = 0)
        and (
          v_app.status <> 'needs_more_review'
          or exists (
            select 1 from public.application_reviews ar
            where ar.application_id = p_application_id
              and ar.review_round = 'profile_screening'
              and ar.status = 'submitted'
              and ar.submitted_at > v_latest_more_review_at
          )
        ),
      case when v_profile_submitted < v_profile_required then 'profile_review_minimum_not_met'
           when v_app.status = 'needs_more_review' and not exists (
             select 1 from public.application_reviews ar
             where ar.application_id = p_application_id
               and ar.review_round = 'profile_screening'
               and ar.status = 'submitted'
               and ar.submitted_at > v_latest_more_review_at
           ) then 'additional_review_not_submitted'
           when v_app.status not in ('screening_completed','needs_admin_review','needs_more_review')
             or (v_app.status = 'needs_more_review' and v_interview_submitted > 0) then 'invalid_transition'
           else 'eligible' end;
  elsif p_new_status = 'invited_to_interview' then
    return query select
      v_app.status = 'screening_passed' and v_profile_submitted >= v_profile_required,
      case when v_profile_submitted < v_profile_required then 'profile_review_minimum_not_met'
           when v_app.status <> 'screening_passed' then 'invalid_transition'
           else 'eligible' end;
  elsif p_new_status = 'interview_scheduled' then
    return query select v_app.status = 'invited_to_interview',
      case when v_app.status = 'invited_to_interview' then 'eligible' else 'invalid_transition' end;
  elsif p_new_status = 'interview_passed' then
    return query select
      v_app.status in ('ready_for_final_decision','needs_more_review')
        and v_interview_submitted >= v_interview_required
        and (
          v_app.status <> 'needs_more_review'
          or exists (
            select 1 from public.application_reviews ar
            where ar.application_id = p_application_id
              and ar.review_round = 'interview'
              and ar.status = 'submitted'
              and ar.submitted_at > v_latest_more_review_at
          )
        ),
      case when v_interview_submitted < v_interview_required then 'interview_review_minimum_not_met'
           when v_app.status = 'needs_more_review' and not exists (
             select 1 from public.application_reviews ar
             where ar.application_id = p_application_id
               and ar.review_round = 'interview'
               and ar.status = 'submitted'
               and ar.submitted_at > v_latest_more_review_at
           ) then 'additional_review_not_submitted'
           when v_app.status not in ('ready_for_final_decision','needs_more_review') then 'invalid_transition'
           else 'eligible' end;
  elsif p_new_status in ('approved_as_mentor','approved_as_mentee') then
    -- M092.1: role_applied is an enum (role_type) on Staging — normalize
    -- through ::text before coalesce/lower, exactly like the M092 RPC does.
    return query select
      v_app.status = 'interview_passed'
        and v_interview_submitted >= v_interview_required
        and lower(coalesce(v_app.role_applied::text, '')) =
          case when p_new_status = 'approved_as_mentor' then 'mentor' else 'mentee' end,
      case when v_interview_submitted < v_interview_required then 'interview_review_minimum_not_met'
           when v_app.status <> 'interview_passed' then 'invalid_transition'
           when lower(coalesce(v_app.role_applied::text, '')) <>
             case when p_new_status = 'approved_as_mentor' then 'mentor' else 'mentee' end
             then 'application_role_mismatch'
           else 'eligible' end;
  elsif p_new_status in ('waitlisted','rejected_or_not_fit','needs_more_review') then
    if v_app.status in ('interview_scheduled','interview_in_progress','interview_completed','ready_for_final_decision','interview_passed') then
      return query select v_interview_submitted >= v_interview_required,
        case when v_interview_submitted >= v_interview_required then 'eligible' else 'interview_review_minimum_not_met' end;
    else
      return query select
        v_app.status in ('screening_completed','screening_passed','needs_admin_review')
          and v_profile_submitted >= v_profile_required,
        case when v_profile_submitted < v_profile_required then 'profile_review_minimum_not_met'
             when v_app.status not in ('screening_completed','screening_passed','needs_admin_review') then 'invalid_transition'
             else 'eligible' end;
    end if;
  elsif p_new_status = 'withdrawn' then
    return query select
      v_app.status not in ('approved_as_mentor','approved_as_mentee','rejected_or_not_fit','withdrawn'),
      case when v_app.status not in ('approved_as_mentor','approved_as_mentee','rejected_or_not_fit','withdrawn')
        then 'eligible' else 'terminal_status' end;
  else
    return query select false, 'unsupported_decision';
  end if;
end;
$fn$;

revoke all on function public.vam084_application_decision_eligibility(uuid,text) from public, anon, authenticated;
grant execute on function public.vam084_application_decision_eligibility(uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- 1. Small helper: parse a raw_payload text field as a non-negative integer,
--    returning null instead of raising for garbage input. Mirrors
--    lib/application-approvals.ts's nonNegativeInteger() so a malformed
--    applicant-submitted numeric string degrades to "field omitted", not a
--    row failure.
-- ---------------------------------------------------------------------------

create or replace function public.vam092_safe_nonneg_int(p_value text) returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case when p_value ~ '^[0-9]+$' then p_value::integer else null end
$fn$;

revoke all on function public.vam092_safe_nonneg_int(text) from public, anon, authenticated;
grant execute on function public.vam092_safe_nonneg_int(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The bulk official approval RPC.
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
      -- OPEN FOLLOW-UP (M093): a returning mentor who applied through the
      -- ordinary new-mentor form carries neither marker below and is not
      -- caught here; see the file-header note.
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

notify pgrst, 'reload schema';
commit;
