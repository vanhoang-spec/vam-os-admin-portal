-- =============================================================================
-- VAM OS — PRODUCTION /operations ROLE DATA DIVERGENCE
-- READ-ONLY PROBE (confirmatory)
--
-- Target      : PRODUCTION Supabase project vam-os-mvp (ref qkkroesfiazsejkzflcd)
-- Execution   : OWNER-RUN in the Supabase SQL Editor. No agent connection.
-- Read-only   : YES. SELECT only. No DML, no DDL, no SET, no function creation.
-- Output      : one JSON row per section. COUNTS, CODES AND UUIDs ONLY.
-- PII         : the two admin emails under investigation are echoed back because
--               they are the probe's subject and the owner already has them.
--               No mentor/mentee name, email or free text is selected anywhere.
--
-- PURPOSE
--   The root cause is already proven in application code and reproduced by a
--   regression test (__tests__/operations-scoped-aggregate-parity.test.ts):
--   the scoped read path paged nothing and was silently truncated by PostgREST
--   `db-max-rows`. This probe is CONFIRMATORY. It establishes:
--     S1  the two users' identity, role and grants — to show scope was CORRECT
--         and therefore not the cause;
--     S2  the recap volume that crosses the row cap;
--     S3  the authoritative July-2026 UEHM-S11 KPI truth, which the fixed page
--         must reproduce for BOTH users.
--
--   Section 3 mirrors lib/operations-kpis.ts exactly:
--     valid recap status  = '' | 'submitted' | 'needs_review' (trimmed, lower)
--     active match        = status 'active' AND both person ids present
--     month key           = mentoring_recaps.meeting_month
-- =============================================================================

-- ── S1. The two users: identity, role, status, grants ────────────────────────
select jsonb_pretty(jsonb_build_object(
  'section', 'S1_user_identity_and_scope',
  'users', (
    select coalesce(jsonb_agg(u), '[]'::jsonb) from (
      select jsonb_build_object(
        'email',            au.email,
        'admin_user_id',    au.id,
        'role',             au.role,
        'status',           au.status,
        'auth_user_id',     au.auth_user_id,
        'auth_user_exists', exists (select 1 from auth.users x where x.id = au.auth_user_id),
        'scope_rows',       (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'program_id', a.program_id,
                   'season_id',  a.season_id,
                   'role',       a.role,
                   'status',     a.status)), '[]'::jsonb)
          from public.admin_scope_access a
          where a.user_id = au.auth_user_id
        ),
        -- Effective read access to UEHM-S11 under lib/program-scope.ts rules:
        -- super_admin bypasses; otherwise an active grant naming the season
        -- (by id or code) or its program (by id or code).
        'is_super_admin', (au.role = 'super_admin'),
        'has_uehm_s11_grant', exists (
          select 1
          from public.admin_scope_access a
          left join public.seasons  s on s.code = 'UEHM-S11'
          left join public.programs p on p.id   = s.program_id
          where a.user_id = au.auth_user_id
            and a.status  = 'active'
            and (
                 a.season_id::text  = s.id::text
              or a.season_id::text  = s.code
              or a.program_id::text = p.id::text
              or a.program_id::text = p.code
            )
        )
      ) as u
      from public.admin_users au
      where lower(au.email) in ('uehmentoring@gmail.com', 'thangnguyen@redsquarevietnam.com')
    ) t
  )
)) as s1_user_identity_and_scope;

-- ── S2. Row volume vs the PostgREST cap ──────────────────────────────────────
-- `scoped_rows_returned_uncapped` > 1000 is the mechanical precondition for the
-- bug: the scoped Admin read returned only the first 1000 of these.
select jsonb_pretty(jsonb_build_object(
  'section', 'S2_row_volume_vs_postgrest_cap',
  'postgrest_db_max_rows_assumed', 1000,
  'mentoring_recaps_total',        (select count(*) from public.mentoring_recaps),
  'mentoring_recaps_uehm_s11',     (select count(*) from public.mentoring_recaps r
                                     join public.seasons s on s.id = r.season_id
                                    where s.code = 'UEHM-S11'),
  'matches_uehm_s11',              (select count(*) from public.matches m
                                     join public.seasons s on s.id = m.season_id
                                    where s.code = 'UEHM-S11'),
  'event_participations_uehm_s11', (select count(*) from public.event_participations e
                                     join public.seasons s on s.id = e.season_id
                                    where s.code = 'UEHM-S11'),
  -- Expected shape of the finding: recaps over the cap, matches under it.
  -- That asymmetry is exactly why match-derived KPIs agreed between the two
  -- users while every recap-derived KPI diverged.
  'recaps_exceed_cap',             (select count(*) > 1000 from public.mentoring_recaps r
                                     join public.seasons s on s.id = r.season_id
                                    where s.code = 'UEHM-S11'),
  'matches_exceed_cap',            (select count(*) > 1000 from public.matches m
                                     join public.seasons s on s.id = m.season_id
                                    where s.code = 'UEHM-S11')
)) as s2_row_volume_vs_postgrest_cap;

-- ── S3. Authoritative July-2026 UEHM-S11 KPI truth ───────────────────────────
with season as (
  select id from public.seasons where code = 'UEHM-S11'
),
valid_recaps as (
  select r.*
  from public.mentoring_recaps r
  join season s on s.id = r.season_id
  where coalesce(lower(btrim(r.status)), '') in ('', 'submitted', 'needs_review')
),
active_matches as (
  select m.mentor_person_id, m.mentee_person_id
  from public.matches m
  join season s on s.id = m.season_id
  where lower(btrim(m.status)) = 'active'
    and m.mentor_person_id is not null
    and m.mentee_person_id is not null
),
closed as (
  select
    (select latest_closed_month   from public.v_season_latest_closed_month v join season s on s.season_id = v.season_id) as closed_month,
    (select previous_closed_month from public.v_season_latest_closed_month v join season s on s.season_id = v.season_id) as previous_closed_month
),
july        as (select * from valid_recaps where meeting_month = '2026-07'),
closed_m    as (select * from valid_recaps where meeting_month = (select closed_month from closed)),
closed_prev as (select * from valid_recaps where meeting_month = (select previous_closed_month from closed)),
active_mentees as (select distinct mentee_person_id id from active_matches),
active_mentors as (select distinct mentor_person_id id from active_matches)
select jsonb_pretty(jsonb_build_object(
  'section', 'S3_authoritative_july_2026_uehm_s11',
  'selected_month',            '2026-07',
  'official_closed_month',     (select closed_month from closed),
  'official_previous_closed',  (select previous_closed_month from closed),

  -- KPI cards, in the order they appear on /operations
  'recap_count',               (select count(*) from july),
  'active_mentee_count',       (select count(distinct mentee_person_id) from july where mentee_person_id is not null),
  'active_mentor_count',       (select count(distinct mentor_person_id) from july where mentor_person_id is not null),
  'active_mentee_rate_pct',    (select case when (select count(*) from active_mentees) = 0 then 0
                                       else round(100.0 * (select count(*) from active_mentees am
                                                            where am.id in (select mentee_person_id from july))
                                                        / (select count(*) from active_mentees))
                                       end),
  'mentor_without_recap',      (select count(*) from active_mentors am
                                 where am.id not in (select mentor_person_id from july where mentor_person_id is not null)),
  'active_mentee_closed_month',(select count(*) from active_mentees am
                                 where am.id in (select mentee_person_id from closed_m)),
  'no_recap_latest_month',     (select count(*) from active_mentees am
                                 where am.id not in (select mentee_person_id from closed_m where mentee_person_id is not null)),
  'no_recap_two_months',       (select count(*) from active_mentees am
                                 where am.id not in (select mentee_person_id from closed_m      where mentee_person_id is not null)
                                   and am.id not in (select mentee_person_id from closed_prev   where mentee_person_id is not null)),

  -- Denominators, for reading the rate correctly
  'active_mentees_total',      (select count(*) from active_mentees),
  'active_mentors_total',      (select count(*) from active_mentors),

  -- Month distribution: shows where an unpaginated 1000-row read would cut.
  'recaps_by_month',           (select coalesce(jsonb_object_agg(meeting_month, n), '{}'::jsonb)
                                from (select meeting_month, count(*) n
                                      from valid_recaps
                                      where meeting_month is not null
                                      group by meeting_month) x)
)) as s3_authoritative_july_2026_uehm_s11;

-- =============================================================================
-- HOW TO READ THE RESULT
--
--   S1  Expect BOTH users to resolve, both status 'active', and
--       has_uehm_s11_grant = true (super_admin is true by bypass). That result
--       CLEARS admin_scope_access as the cause and confirms both users were
--       genuinely authorized for the same aggregate.
--       If uehmentoring@gmail.com shows has_uehm_s11_grant = false, the fix in
--       this branch will DENY that user the page instead of showing zeros —
--       correct behaviour, but the owner must then grant the scope.
--
--   S2  Expect recaps_exceed_cap = true and matches_exceed_cap = false.
--       That is the mechanical signature of the reported symptom pattern
--       (recap KPIs zeroed, population KPIs intact).
--
--   S3  These are the values BOTH users must see after the fix ships.
--       Compare against the reported Super Admin figures:
--         recap_count 18 · active_mentee_count 15 · active_mentor_count 3
--         active_mentee_rate_pct 2 · mentor_without_recap 435
--         active_mentee_closed_month 230 · no_recap_latest_month 407
--         no_recap_two_months 343
--       If S3 matches those, the Super Admin view was already correct and only
--       the Admin view was wrong — no data repair is required, application
--       deploy alone closes the gap.
-- =============================================================================
