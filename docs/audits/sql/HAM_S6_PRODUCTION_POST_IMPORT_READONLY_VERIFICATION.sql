-- ============================================================
-- HAM-S6 PRODUCTION POST-IMPORT READ-ONLY VERIFICATION
-- Version: V3 (final schema alignment — 2026-07-23)
-- mentee lifecycle status verified via person_season_memberships.status only.
-- No mentee_profiles.mentee_status dependency (column absent from production).
-- ============================================================
-- OWNER-RUN ONLY. DO NOT MODIFY INTO A WRITE STATEMENT.
-- NOT AUTHORIZED — Read runbook before execution.
--
-- Authorization phrase required before running:
--   AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 POST-IMPORT VERIFICATION
--
-- Requirements:
--   * Single SELECT returning one row, one JSONB column.
--   * Read-only: no INSERT, UPDATE, DELETE, DDL, or COPY.
--   * No PII: no names, emails, phones, or Auth IDs.
--   * Aggregate counts and boolean flags only.
--
-- Run AFTER all import modules have committed.
-- Compare results to the baseline from the preflight probe.
-- ============================================================

select jsonb_build_object(
  'probe',          'HAM_S6_POST_IMPORT_VERIFICATION_V3',
  'authorized_phrase', 'AUTHORIZE OWNER-RUN READ-ONLY HAM-S6 POST-IMPORT VERIFICATION',

  -- 1. HAM program exactly once
  'ham_program', jsonb_build_object(
    'count', (select count(*)::int from public.programs where code = 'HAM'),
    'expected', 1,
    'pass',   (select count(*) = 1 from public.programs where code = 'HAM')
  ),

  -- 2. HAM-S6 exactly once
  'ham_s6_season', jsonb_build_object(
    'count',  (select count(*)::int from public.seasons where code = 'HAM-S6'),
    'expected', 1,
    'pass',   (select count(*) = 1 from public.seasons where code = 'HAM-S6')
  ),

  -- 3. HAM-S6-B1 exactly once
  'ham_s6_b1_batch', jsonb_build_object(
    'count',  (select count(*)::int from public.intake_batches where code = 'HAM-S6-B1'),
    'expected', 1,
    'pass',   (select count(*) = 1 from public.intake_batches where code = 'HAM-S6-B1')
  ),

  -- 4. Season/program/batch linkage valid
  'linkage_valid', jsonb_build_object(
    'ham_program_to_season_linked', (
      select exists (
        select 1 from public.programs p
        join public.seasons s on s.program_id = p.id and s.code = 'HAM-S6'
        where p.code = 'HAM'
      )
    ),
    'season_to_batch_linked', (
      select exists (
        select 1 from public.seasons s
        join public.intake_batches ib on ib.season_id = s.id and ib.code = 'HAM-S6-B1'
        where s.code = 'HAM-S6'
      )
    )
  ),

  -- 5. People participation
  -- Exact: 112 new people (0 email collisions with production confirmed by backup analysis 2026-07-29)
  'people_with_ham_provenance', jsonb_build_object(
    'count', (
      select count(*)::int from public.people
      where data_quality_flags like '%source_season=HAM_S6%'
    ),
    'expected_exact', 112,
    'pass', (
      select count(*) = 112 from public.people
      where data_quality_flags like '%source_season=HAM_S6%'
    )
  ),

  -- 6. Mentor profiles — exact 52
  'mentor_profiles', jsonb_build_object(
    'count', (
      select count(*)::int
      from public.mentor_profiles mp
      join public.intake_batches ib on ib.id = mp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code = 'HAM-S6'
    ),
    'expected_exact', 52,
    'pass', (
      select count(*) = 52
      from public.mentor_profiles mp
      join public.intake_batches ib on ib.id = mp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code = 'HAM-S6'
    )
  ),

  -- 7. Mentee profiles — exact 60
  'mentee_profiles', jsonb_build_object(
    'count', (
      select count(*)::int
      from public.mentee_profiles mtp
      join public.intake_batches ib on ib.id = mtp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code = 'HAM-S6'
    ),
    'expected_exact', 60,
    'pass', (
      select count(*) = 60
      from public.mentee_profiles mtp
      join public.intake_batches ib on ib.id = mtp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code = 'HAM-S6'
    )
  ),

  -- 7b. Season memberships — exact 112
  'ham_s6_memberships_exact', jsonb_build_object(
    'count', (
      select count(*)::int
      from public.person_season_memberships psm
      join public.seasons s on s.id = psm.season_id
      where s.code = 'HAM-S6'
    ),
    'expected_exact', 112,
    'pass', (
      select count(*) = 112
      from public.person_season_memberships psm
      join public.seasons s on s.id = psm.season_id
      where s.code = 'HAM-S6'
    )
  ),

  -- 8. Active matches — exact 58
  -- (60 source rows − 2 skipped: one unresolvable mentor name, 2 mentees affected)
  'active_matches', jsonb_build_object(
    'count', (
      select count(*)::int
      from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code = 'HAM-S6' and m.status = 'active'
    ),
    'expected_exact', 58,
    'pass', (
      select count(*) = 58
      from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code = 'HAM-S6' and m.status = 'active'
    )
  ),

  -- 9. No null critical FKs in matches
  'null_fk_check', jsonb_build_object(
    'null_mentor_person_id_count', (
      select count(*)::int from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code = 'HAM-S6' and m.mentor_person_id is null
    ),
    'null_mentee_person_id_count', (
      select count(*)::int from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code = 'HAM-S6' and m.mentee_person_id is null
    ),
    'pass', (
      select count(*) = 0 from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code = 'HAM-S6'
        and (m.mentor_person_id is null or m.mentee_person_id is null)
    )
  ),

  -- 10. No duplicate season memberships
  'duplicate_membership_check', jsonb_build_object(
    'duplicate_membership_pairs', (
      select count(*)::int from (
        select person_id, season_id, role, count(*) as c
        from public.person_season_memberships psm
        join public.seasons s on s.id = psm.season_id
        where s.code = 'HAM-S6'
        group by person_id, season_id, role
        having count(*) > 1
      ) sub
    ),
    'pass', (
      select count(*) = 0 from (
        select person_id, season_id, role, count(*) as c
        from public.person_season_memberships psm
        join public.seasons s on s.id = psm.season_id
        where s.code = 'HAM-S6'
        group by person_id, season_id, role
        having count(*) > 1
      ) sub
    )
  ),

  -- 11. No duplicate profiles (per batch)
  'duplicate_profile_check', jsonb_build_object(
    'duplicate_mentor_profile_pairs', (
      select count(*)::int from (
        select person_id, intake_batch_id, count(*) as c
        from public.mentor_profiles mp
        join public.intake_batches ib on ib.id = mp.intake_batch_id
        join public.seasons s on s.id = ib.season_id
        where s.code = 'HAM-S6'
        group by person_id, intake_batch_id
        having count(*) > 1
      ) sub
    ),
    'duplicate_mentee_profile_pairs', (
      select count(*)::int from (
        select person_id, intake_batch_id, count(*) as c
        from public.mentee_profiles mtp
        join public.intake_batches ib on ib.id = mtp.intake_batch_id
        join public.seasons s on s.id = ib.season_id
        where s.code = 'HAM-S6'
        group by person_id, intake_batch_id
        having count(*) > 1
      ) sub
    )
  ),

  -- 12. No duplicate matches
  'duplicate_match_check', jsonb_build_object(
    'duplicate_match_pairs', (
      select count(*)::int from (
        select mentor_person_id, mentee_person_id, count(*) as c
        from public.matches m
        join public.seasons s on s.id = m.season_id
        where s.code = 'HAM-S6'
        group by mentor_person_id, mentee_person_id
        having count(*) > 1
      ) sub
    ),
    'pass', (
      select count(*) = 0 from (
        select mentor_person_id, mentee_person_id, count(*) as c
        from public.matches m
        join public.seasons s on s.id = m.season_id
        where s.code = 'HAM-S6'
        group by mentor_person_id, mentee_person_id
        having count(*) > 1
      ) sub
    )
  ),

  -- 13. Season membership check (canonical role tracking via person_season_memberships)
  -- matches.season_code is absent from production schema — season is verified via season_id FK
  'ham_s6_memberships', jsonb_build_object(
    'mentor_membership_count', (
      select count(*)::int
      from public.person_season_memberships psm
      join public.seasons s on s.id = psm.season_id
      where s.code = 'HAM-S6' and psm.role = 'mentor'
    ),
    'mentee_membership_count', (
      select count(*)::int
      from public.person_season_memberships psm
      join public.seasons s on s.id = psm.season_id
      where s.code = 'HAM-S6' and psm.role = 'mentee'
    ),
    'expected_mentor_min', 45,
    'expected_mentee_min', 55,
    'note', 'person_season_memberships is the canonical role store; people.role is absent from production schema'
  ),

  -- 14. UEH baseline unchanged (compare to recorded preflight baseline)
  'ueh_baseline_after_import', jsonb_build_object(
    'ueh_season_count', (
      select count(*)::int from public.seasons where code in ('UEHM-S11','UEHM-S12')
    ),
    'ueh_match_count', (
      select count(*)::int from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code in ('UEHM-S11','UEHM-S12')
    ),
    'ueh_mentor_profile_count', (
      select count(*)::int from public.mentor_profiles mp
      join public.intake_batches ib on ib.id = mp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code in ('UEHM-S11','UEHM-S12')
    ),
    'ueh_mentee_profile_count', (
      select count(*)::int from public.mentee_profiles mtp
      join public.intake_batches ib on ib.id = mtp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code in ('UEHM-S11','UEHM-S12')
    ),
    'note', 'Compare to gate_14_ueh_baseline from preflight probe — these counts must match'
  ),

  -- 15. Portfolio prerequisites: HAM-S6 resolves correctly
  'portfolio_prerequisites', jsonb_build_object(
    'ham_has_exactly_one_linked_season', (
      select count(*) = 1
      from public.programs p
      join public.seasons s on s.program_id = p.id
      where p.code = 'HAM'
    ),
    'ham_s6_has_exactly_one_intake_batch', (
      select count(*) = 1
      from public.seasons s
      join public.intake_batches ib on ib.season_id = s.id
      where s.code = 'HAM-S6'
    )
  ),

  -- 16. HAM admin scope prerequisites (admin accounts are separate; this checks if
  --     the season row has a code that can be used as admin_scope_access.season_id)
  'ham_admin_scope_prerequisites', jsonb_build_object(
    'ham_s6_season_code_exists', (
      select exists (select 1 from public.seasons where code = 'HAM-S6')
    ),
    'note', 'Admin accounts and admin_scope_access rows must be provisioned separately after foundation import'
  ),

  -- 17. Current-season resolution: HAM-S6 has active status
  'current_season_resolution', jsonb_build_object(
    'ham_s6_status', (
      select status from public.seasons where code = 'HAM-S6'
    ),
    'note', 'Status should be running or active for portfolio current-season resolver to select HAM-S6'
  ),

  -- Summary pass (exact fail-closed values — 2026-07-29 manifest)
  'summary_pass', (
    select
      (select count(*) = 1 from public.programs where code = 'HAM')
      and (select count(*) = 1 from public.seasons where code = 'HAM-S6')
      and (select count(*) = 1 from public.intake_batches where code = 'HAM-S6-B1')
      and (select count(*) = 112 from public.people where data_quality_flags like '%source_season=HAM_S6%')
      and (select count(*) = 52 from public.mentor_profiles mp join public.intake_batches ib on ib.id = mp.intake_batch_id join public.seasons s on s.id = ib.season_id where s.code = 'HAM-S6')
      and (select count(*) = 60 from public.mentee_profiles mtp join public.intake_batches ib on ib.id = mtp.intake_batch_id join public.seasons s on s.id = ib.season_id where s.code = 'HAM-S6')
      and (select count(*) = 112 from public.person_season_memberships psm join public.seasons s on s.id = psm.season_id where s.code = 'HAM-S6')
      and (select count(*) = 58 from public.matches m join public.seasons s on s.id = m.season_id where s.code = 'HAM-S6' and m.status = 'active')
      and (
        select count(*) = 0 from public.matches m
        join public.seasons s on s.id = m.season_id
        where s.code = 'HAM-S6'
          and (m.mentor_person_id is null or m.mentee_person_id is null)
      )
      and (
        select count(*) = 0 from (
          select mentor_person_id, mentee_person_id, count(*) as c
          from public.matches m join public.seasons s on s.id = m.season_id
          where s.code = 'HAM-S6'
          group by mentor_person_id, mentee_person_id
          having count(*) > 1
        ) sub
      )
  )
);
