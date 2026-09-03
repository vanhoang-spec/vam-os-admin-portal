-- ===========================================================================
-- M092 — Bulk Official Approval: minimal Production backend package.
--
-- PROVENANCE
--   Every function body below was read verbatim from the FINAL Staging
--   catalog (project ljfneyuvpxrmejpxsmpz) via pg_get_functiondef() on
--   2026-09-04, after the Owner's Staging browser UAT passed. It is NOT a
--   replay of the historical migrations 20260831120000 (M092) or
--   20260901090000 (M093): the latter also redefines
--   vam090_bulk_assign_application_reviews, which Production already has from
--   the P0 restore and which is out of scope for this release. Only the three
--   functions M092 actually needs are shipped here.
--
-- WHY THE DEPLOYED CATALOG AND NOT THE HISTORICAL FILES
--   Staging received M092 and then the M093 hardening on top, which replaced
--   vam092_bulk_official_approve_applications in place. The deployed result --
--   not either file on its own -- is what the Owner UAT'd, so the deployed
--   result is what ships.
--
-- PRODUCTION PREFLIGHT (read-only, 2026-09-04)
--   Shared dependencies are byte-identical between Staging and Production
--   (pg_get_functiondef md5 match):
--     vam084_application_decision_eligibility  7355 bytes  b1590779...
--     vam084_operator_for_season                777 bytes  1a50b6b9...
--     vam090_finalize_recruitment_approval     2084 bytes  5f059b4d...
--   So the eligibility gate, the season-scope check and the finalization
--   primitive behave on Production exactly as they did under UAT.
--
--   Two Production/Staging TYPE divergences were found and are safe here:
--     people.gender        Production gender_type ENUM, Staging text.
--       vam092 declares its variable as public.people.gender%type and maps to
--       male|female|other|undisclosed (else NULL). Production's gender_type
--       labels are exactly ('male','female','other','undisclosed'), so the
--       write is valid without naming the type.
--     people.email_primary Production citext, Staging text.
--       vam092 only ever compares lower(btrim(...)) and inserts a text value,
--       both of which are well-defined for citext.
--   Every column vam092 writes (people, mentor_profiles, mentee_profiles,
--   admin_audit_log) was confirmed present on Production. Production also has
--   people_canonical_email_key, so the ambiguous_identity branch is equally
--   unreachable there -- identical behaviour, not a new risk.
--
-- SCOPE
--   Additive only: three CREATE OR REPLACE FUNCTIONs plus their execute ACL.
--   No table, column, type, index or policy is created or altered. No
--   membership, match or notification behaviour. No application-lifecycle
--   semantics outside M092.
--
-- BEHAVIOUR PRESERVED EXACTLY AS UAT'd
--   returning mentor  -> manual_required / returning_mentor_renewal_path_required
--   renewal           -> skipped / renewal_requires_individual_path
--   per-row atomicity (one savepoint per application), partial success,
--   idempotent retry (already_approved), max 100 IDs, server-side de-dup.
--
-- TRUST BOUNDARY
--   All three are SECURITY INVOKER with SET search_path = '' and are executable
--   by service_role only; vam092 additionally refuses any caller whose
--   current_user is not service_role. anon and authenticated are revoked.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. vam092_safe_nonneg_int - defensive integer parse for raw_payload values.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vam092_safe_nonneg_int(p_value text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_value ~ '^[0-9]+$' then p_value::integer else null end
$function$;

revoke all on function public.vam092_safe_nonneg_int(text) from public, anon, authenticated;
grant execute on function public.vam092_safe_nonneg_int(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. vam093_returning_mentor_collision - returning-mentor predicate. Called
--    only from inside vam092 (SQL/transitive dependency, never by app code).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vam093_returning_mentor_collision(p_person_id uuid, p_season_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function public.vam093_returning_mentor_collision(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vam093_returning_mentor_collision(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. vam092_bulk_official_approve_applications - the FINAL hardened contract.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vam092_bulk_official_approve_applications(p_application_ids uuid[], p_actor uuid)
 RETURNS TABLE(application_id uuid, target_role text, outcome text, reason_code text, person_id uuid, person_created boolean, profile_id uuid, profile_created boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function public.vam092_bulk_official_approve_applications(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.vam092_bulk_official_approve_applications(uuid[], uuid) to service_role;
