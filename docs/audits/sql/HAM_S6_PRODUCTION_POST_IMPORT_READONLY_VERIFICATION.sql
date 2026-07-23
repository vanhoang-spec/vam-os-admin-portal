-- ============================================================
-- HAM-S6 PRODUCTION POST-IMPORT READ-ONLY VERIFICATION
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
  'probe',          'HAM_S6_POST_IMPORT_VERIFICATION_V1',
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
  'people_with_ham_provenance', jsonb_build_object(
    'count', (
      select count(*)::int from public.people
      where data_quality_flags like '%source_season=HAM_S6%'
    ),
    'expected_min', 104,
    'expected_max', 108
  ),

  -- 6. Mentor profiles
  'mentor_profiles', jsonb_build_object(
    'count', (
      select count(*)::int
      from public.mentor_profiles mp
      join public.intake_batches ib on ib.id = mp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code = 'HAM-S6'
    ),
    'expected_min', 45,
    'expected_max', 52
  ),

  -- 7. Mentee profiles
  'mentee_profiles', jsonb_build_object(
    'count', (
      select count(*)::int
      from public.mentee_profiles mtp
      join public.intake_batches ib on ib.id = mtp.intake_batch_id
      join public.seasons s on s.id = ib.season_id
      where s.code = 'HAM-S6'
    ),
    'expected_min', 55,
    'expected_max', 60
  ),

  -- 8. Active matches
  'active_matches', jsonb_build_object(
    'count', (
      select count(*)::int
      from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.code = 'HAM-S6' and m.status = 'active'
    ),
    'expected_min', 45,
    'expected_max', 52
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

  -- 13. No cross-program leakage (HAM match rows not linked to HAM-S6 season)
  'cross_program_leakage_check', jsonb_build_object(
    'ham_matches_with_non_ham_season', (
      select count(*)::int
      from public.matches m
      join public.seasons s on s.id = m.season_id
      where m.season_code = 'HAM-S6'
        and s.code <> 'HAM-S6'
    ),
    'pass', (
      select count(*) = 0
      from public.matches m
      join public.seasons s on s.id = m.season_id
      where m.season_code = 'HAM-S6' and s.code <> 'HAM-S6'
    )
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

  -- Summary pass
  'summary_pass', (
    select
      (select count(*) = 1 from public.programs where code = 'HAM')
      and (select count(*) = 1 from public.seasons where code = 'HAM-S6')
      and (select count(*) = 1 from public.intake_batches where code = 'HAM-S6-B1')
      and (select count(*) >= 45 from public.matches m join public.seasons s on s.id = m.season_id where s.code = 'HAM-S6' and m.status = 'active')
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
