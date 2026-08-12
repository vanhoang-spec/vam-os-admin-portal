-- =============================================================================
-- VAM OS — PRODUCTION /operations ROLE DATA DIVERGENCE
-- READ-ONLY PROBE (confirmatory)  ·  REVISION 2
--
-- Target      : PRODUCTION Supabase project vam-os-mvp (ref qkkroesfiazsejkzflcd)
-- Execution   : OWNER-RUN in the Supabase SQL Editor. No agent connection.
-- Read-only   : YES. SELECT only. No DML, no DDL, no SET, no function creation,
--               no temp objects. Safe to run on a live Production database.
-- Output      : one JSON row per section. COUNTS, CODES AND UUIDs ONLY.
-- PII         : the two admin emails under investigation are echoed back because
--               they are the probe's subject and the owner already has them.
--               No mentor/mentee name, email or free text is selected anywhere.
--
-- INDEPENDENCE
--   This probe does NOT call get_operations_dashboard_data or any other
--   application RPC. Calling the application to check the application proves
--   nothing. Every figure below is recomputed from canonical base tables
--   (mentoring_recaps, matches, events, event_participations, seasons) plus the
--   one view the page itself reads for month closure
--   (v_season_latest_closed_month). If a value here disagrees with the page,
--   exactly one of the two is wrong and the disagreement is the finding.
--
-- WHAT CHANGED IN REVISION 2
--   S1  now reports explicit_scope_grant, is_super_admin and
--       effective_uehm_s11_access separately. A super admin has no
--       admin_scope_access row and must not read as "no access".
--   S3  now reproduces every value the page displays — all eight KPI cards in
--       the primary row plus the three closed-month cards — each with its
--       source, filters, month boundary and distinct key stated in comments.
--       The two different "active mentee" concepts are computed SEPARATELY and
--       named, because they are intentionally different (see S3 header).
--   S4  is new: it checks the other reads this remediation paginated, so the
--       owner can see whether any of them was ALSO truncated in Production.
--
-- HOW TO SET THE MONTH
--   Every section pins the month as a literal '2026-07'. To probe another
--   month, replace every occurrence of '2026-07'. The page's own month
--   resolution (lib/dashboard-month.ts resolveOperationsMonth) is deliberately
--   NOT modelled here: the probe answers "what is true for this month", and the
--   URL ?month=2026-07 makes the page answer the same question.
-- =============================================================================


-- ── S1. The two users: identity, role, status, and EFFECTIVE access ──────────
--
-- Three distinct facts, reported separately, because collapsing them is how a
-- super admin gets misread as unauthorized:
--
--   explicit_scope_grant      — does an active admin_scope_access row name
--                               UEHM-S11 or its program? Meaningful only for a
--                               non-super-admin; a super admin legitimately has
--                               none.
--   is_super_admin            — admin_users.role = 'super_admin'.
--   effective_uehm_s11_access — what lib/program-scope.ts actually grants:
--                               is_super_admin OR explicit_scope_grant.
--                               THIS is the value to compare against behaviour.
select jsonb_pretty(jsonb_build_object(
  'section', 'S1_user_identity_and_effective_access',
  'season_code', 'UEHM-S11',
  'users', (
    select coalesce(jsonb_agg(u order by u->>'email'), '[]'::jsonb) from (
      select jsonb_build_object(
        'email',            au.email,
        'admin_user_id',    au.id,
        'role',             au.role,
        'status',           au.status,
        'auth_user_id',     au.auth_user_id,
        'auth_user_exists', exists (select 1 from auth.users x where x.id = au.auth_user_id),

        -- Every active grant this user holds, for context.
        'scope_rows',       (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'program_id', a.program_id,
                   'season_id',  a.season_id,
                   'role',       a.role,
                   'status',     a.status)), '[]'::jsonb)
          from public.admin_scope_access a
          where a.user_id = au.auth_user_id
        ),

        -- (1) Explicit grant naming UEHM-S11 by season id/code or program
        --     id/code, matching lib/program-scope.ts getAllowedSeasonIds.
        'explicit_scope_grant', exists (
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
        ),

        -- (2) Role-level bypass.
        'is_super_admin', (au.role = 'super_admin'),

        -- (3) What the application actually enforces. A super admin is TRUE
        --     here with zero admin_scope_access rows; that is correct, not a
        --     missing grant.
        'effective_uehm_s11_access', (
          au.role = 'super_admin'
          or exists (
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
        ),

        -- The highest scope level the grants confer, which gates ACTIONS
        -- (recap editing) but never the aggregate KPI read.
        'max_scope_level', (
          case when au.role = 'super_admin' then 'full_access'
          else (
            select a.role
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
            order by case a.role
                       when 'full_access' then 4
                       when 'operations'  then 3
                       when 'review'      then 2
                       else 1 end desc
            limit 1
          ) end
        )
      ) as u
      from public.admin_users au
      where lower(au.email) in ('uehmentoring@gmail.com', 'thangnguyen@redsquarevietnam.com')
    ) t
  )
)) as s1_user_identity_and_effective_access;


-- ── S2. Row volume vs the PostgREST cap ──────────────────────────────────────
-- The mechanical precondition for the reported symptom: the scoped read
-- returned only the first `db_max_rows` rows of each of these, silently.
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


-- ── S3. Authoritative /operations?month=2026-07 truth for UEHM-S11 ───────────
--
-- Reproduces every displayed value independently. Shared definitions, taken
-- from lib/operations-kpis.ts and app/operations/page.tsx:
--
--   season           seasons.code = 'UEHM-S11'; every source below is filtered
--                    on season_id = that season's id.
--   valid recap      coalesce(lower(btrim(status)),'') IN ('','submitted',
--                    'needs_review'). NULL and empty status are accepted for
--                    legacy imports; 'invalid', 'duplicate' and 'excluded' are
--                    not. Mirrors VALID_ACTIVITY_STATUSES.
--   month key        mentoring_recaps.meeting_month, a TEXT 'YYYY-MM' column.
--                    NOT derived from meeting_date. A recap whose meeting_date
--                    and meeting_month disagree is counted under meeting_month.
--   active match     matches.status lower/trimmed = 'active' AND
--                    mentor_person_id IS NOT NULL AND mentee_person_id IS NOT NULL.
--   event month      to_char(events.starts_at AT TIME ZONE 'UTC','YYYY-MM').
--                    ** UTC, NOT Asia/Ho_Chi_Minh. ** PostgREST serialises
--                    timestamptz in UTC and lib/operations-kpis.ts monthFromDate
--                    slices the first seven characters of that string, so an
--                    event at 2026-08-01 06:00 +07 counts as 2026-07. Recorded
--                    here because it is a real boundary rule, not an accident of
--                    this query.
--
-- THE TWO "ACTIVE MENTEE" CONCEPTS
--   The page shows both, and they are intentionally different. The authority is
--   docs/OPERATIONS_DASHBOARD_QA.md, which states for "Ty le mentee active":
--   "Luu y tu so khac voi card 'Mentee active' neu co recap ngoai active match".
--   The database view v_monthly_activity_summary defines the first the same way
--   — count(distinct mentee_person_id) with no join to matches.
--
--     A. recap_activity_mentee_count  — distinct mentees with a valid recap in
--        the month. NO match requirement. Card "Mentee active".
--     B. active_matched_mentee_with_recap_count — distinct mentees who BOTH
--        hold an active match AND filed a valid recap in the month. This is the
--        NUMERATOR of card "Tỷ lệ mentee active"; it is never the card
--        "Mentee active".
--
--   B <= A always. If they are equal in Production it means every recapping
--   mentee also has an active match, not that the concepts merged.
with season as (
  select id from public.seasons where code = 'UEHM-S11'
),
valid_recaps as (
  -- source: public.mentoring_recaps · filter: season + valid status
  select r.*
  from public.mentoring_recaps r
  join season s on s.id = r.season_id
  where coalesce(lower(btrim(r.status)), '') in ('', 'submitted', 'needs_review')
),
active_matches as (
  -- source: public.matches · filter: season + status 'active' + both persons set
  select m.mentor_person_id, m.mentee_person_id
  from public.matches m
  join season s on s.id = m.season_id
  where lower(btrim(m.status)) = 'active'
    and m.mentor_person_id is not null
    and m.mentee_person_id is not null
),
active_mentees as (select distinct mentee_person_id as id from active_matches),
active_mentors as (select distinct mentor_person_id as id from active_matches),
closed as (
  -- source: public.v_season_latest_closed_month, the same view the page reads.
  select v.latest_closed_month as closed_month,
         v.previous_closed_month as previous_closed_month
  from public.v_season_latest_closed_month v
  join season s on s.id = v.season_id
),
july        as (select * from valid_recaps where meeting_month = '2026-07'),
closed_m    as (select * from valid_recaps where meeting_month = (select closed_month from closed)),
closed_prev as (select * from valid_recaps where meeting_month = (select previous_closed_month from closed)),
season_events as (
  -- source: public.events · filter: season
  select e.id, e.starts_at
  from public.events e
  join season s on s.id = e.season_id
),
events_in_month as (
  select id from season_events
  where to_char(starts_at at time zone 'UTC', 'YYYY-MM') = '2026-07'
),
season_participations as (
  -- source: public.event_participations · filter: season OR event in season,
  -- mirroring the page's `row.season_id === season.id || seasonEventIds.has(row.event_id)`
  select p.*
  from public.event_participations p
  where p.season_id = (select id from season)
     or p.event_id in (select id from season_events)
),
participations_in_month as (
  select * from season_participations where event_id in (select id from events_in_month)
)
select jsonb_pretty(jsonb_build_object(
  'section', 'S3_authoritative_2026_07_uehm_s11',
  'selected_month',           '2026-07',
  'official_closed_month',    (select closed_month from closed),
  'official_previous_closed', (select previous_closed_month from closed),

  -- ══ Card 1 · "Số recap trong tháng" ═════════════════════════════════════
  -- source: mentoring_recaps · status: valid · month: meeting_month = '2026-07'
  -- distinct key: NONE — this is a ROW COUNT, so two recaps for one pair count twice.
  'card_1_recap_count',
    (select count(*) from july),

  -- ══ Card 2 · "Mentee active"  (CONCEPT A) ═══════════════════════════════
  -- source: mentoring_recaps · status: valid · month: meeting_month = '2026-07'
  -- match-status requirement: NONE
  -- distinct key: mentee_person_id, NULL excluded
  'card_2_recap_activity_mentee_count',
    (select count(distinct mentee_person_id) from july where mentee_person_id is not null),

  -- ══ Card 3 · "Mentor active" ════════════════════════════════════════════
  -- source: mentoring_recaps · status: valid · month: meeting_month = '2026-07'
  -- match-status requirement: NONE
  -- distinct key: mentor_person_id, NULL excluded
  'card_3_recap_activity_mentor_count',
    (select count(distinct mentor_person_id) from july where mentor_person_id is not null),

  -- ══ Card 4 · "Tỷ lệ mentee active" ══════════════════════════════════════
  -- numerator   (CONCEPT B): active-matched mentees who also have a valid July
  --                          recap. source: matches ∩ mentoring_recaps.
  -- denominator            : distinct mentees in an active match. source: matches.
  -- rounding    : the UI is Math.round(numerator/denominator*100), half-up.
  'card_4_active_matched_mentee_with_recap_count',
    (select count(*) from active_mentees am where am.id in (select mentee_person_id from july)),
  'card_4_active_matched_mentee_total',
    (select count(*) from active_mentees),
  'card_4_rate_pct',
    (select case when (select count(*) from active_mentees) = 0 then 0
            else round(100.0 * (select count(*) from active_mentees am
                                 where am.id in (select mentee_person_id from july))
                             / (select count(*) from active_mentees))
            end),
  -- The gap between concept A and concept B, stated so it cannot be mistaken
  -- for an inconsistency. Positive means some mentees recapped without an
  -- active match: expected, and the reason both cards exist.
  'concept_a_minus_concept_b',
    (select (select count(distinct mentee_person_id) from july where mentee_person_id is not null)
          - (select count(*) from active_mentees am where am.id in (select mentee_person_id from july))),

  -- ══ Card 5 · "Mentor chưa có recap" ═════════════════════════════════════
  -- population : active-matched mentors (source: matches)
  -- subtracted : mentors on a valid July recap (source: mentoring_recaps)
  -- distinct key: mentor_person_id
  'card_5_mentor_without_recap',
    (select count(*) from active_mentors am
      where am.id not in (select mentor_person_id from july where mentor_person_id is not null)),

  -- ══ Card 6 · "Event/training trong tháng" ═══════════════════════════════
  -- source: events · filter: season · month: UTC month of starts_at
  -- distinct key: events.id (row count over distinct events)
  'card_6_event_training_count',
    (select count(*) from events_in_month),

  -- ══ Card 7 · "Lượt tham dự event" ═══════════════════════════════════════
  -- source: event_participations joined to the month's events
  -- status filter: btrim(attendance_status) = 'attended' EXACTLY.
  --   NOTE the case-sensitivity difference from recap status: the KPI helper
  --   lower-cases (normalizeStatus) but the page-level attendance card uses
  --   isEventAttendedStatus, which trims WITHOUT lower-casing. Both are
  --   computed below so a case mismatch in the data is visible rather than
  --   averaged away.
  -- distinct key: NONE — a participation row count.
  'card_7_event_attendance_count_case_sensitive',
    (select count(*) from participations_in_month where btrim(attendance_status) = 'attended'),
  'card_7_event_attendance_count_case_insensitive',
    (select count(*) from participations_in_month where lower(btrim(attendance_status)) = 'attended'),

  -- ══ Card 8 · "Tỷ lệ tham dự / tổng đăng ký" ═════════════════════════════
  -- numerator  : attended participations in the month
  -- denominator: ALL participations in the month, INCLUDING rows whose
  --              attendance_status has not been updated. The page states this
  --              in its own helper text ("Bao gồm cả các lượt chưa cập nhật
  --              trạng thái trong mẫu số").
  -- DOC DRIFT  : docs/OPERATIONS_DASHBOARD_QA.md row "Ty le attendance" still
  --              documents attended/(attended+registered_absent). The shipped
  --              code uses attended/total and discloses it in the UI. Both
  --              denominators are returned so the owner can see the size of the
  --              difference and decide which definition is canonical.
  -- formatting : the UI prints one decimal place and strips a trailing '.0';
  --              "—" when the denominator is 0.
  'card_8_attended',
    (select count(*) from participations_in_month where btrim(attendance_status) = 'attended'),
  'card_8_total_participations',
    (select count(*) from participations_in_month),
  'card_8_registered_absent',
    (select count(*) from participations_in_month
      where btrim(attendance_status) in ('absent_excused','absent_unexcused','registered_absent')),
  'card_8_not_updated',
    (select greatest(0,
        (select count(*) from participations_in_month)
      - (select count(*) from participations_in_month where btrim(attendance_status) = 'attended')
      - (select count(*) from participations_in_month
          where btrim(attendance_status) in ('absent_excused','absent_unexcused','registered_absent')))),
  'card_8_rate_over_total_pct',
    (select case when (select count(*) from participations_in_month) = 0 then null
            else round(100.0 * (select count(*) from participations_in_month where btrim(attendance_status) = 'attended')
                             / (select count(*) from participations_in_month), 1)
            end),
  'card_8_rate_over_attended_plus_absent_pct_doc_definition',
    (select case when (select count(*) from participations_in_month
                        where btrim(attendance_status) in ('attended','absent_excused','absent_unexcused','registered_absent')) = 0 then null
            else round(100.0 * (select count(*) from participations_in_month where btrim(attendance_status) = 'attended')
                             / (select count(*) from participations_in_month
                                 where btrim(attendance_status) in ('attended','absent_excused','absent_unexcused','registered_absent')), 1)
            end),

  -- ══ Card 9 · "Mentee active tháng đã đóng" ══════════════════════════════
  -- population : active-matched mentees
  -- intersected: mentees with a valid recap in the OFFICIAL closed month from
  --              v_season_latest_closed_month (NOT the selected month)
  -- distinct key: mentee_person_id
  'card_9_active_mentee_closed_month',
    (select count(*) from active_mentees am where am.id in (select mentee_person_id from closed_m)),

  -- ══ Card 10 · "Chưa có recap tháng gần nhất" ════════════════════════════
  'card_10_no_recap_latest_closed_month',
    (select count(*) from active_mentees am
      where am.id not in (select mentee_person_id from closed_m where mentee_person_id is not null)),

  -- ══ Card 11 · "Chưa có recap 2 tháng liên tiếp" ═════════════════════════
  -- months: the official closed month AND the official previous closed month.
  'card_11_no_recap_two_consecutive_months',
    (select count(*) from active_mentees am
      where am.id not in (select mentee_person_id from closed_m    where mentee_person_id is not null)
        and am.id not in (select mentee_person_id from closed_prev where mentee_person_id is not null)),

  -- Denominators and context for reading the rates correctly.
  'active_matched_mentors_total', (select count(*) from active_mentors),

  -- Month distribution: shows exactly where an unpaginated 1000-row read cut.
  'valid_recaps_by_month', (select coalesce(jsonb_object_agg(meeting_month, n), '{}'::jsonb)
                            from (select meeting_month, count(*) n
                                  from valid_recaps
                                  where meeting_month is not null
                                  group by meeting_month) x),

  -- Data-quality context: rows that silently drop out of a distinct count.
  'july_recaps_missing_mentee', (select count(*) from july where mentee_person_id is null),
  'july_recaps_missing_mentor', (select count(*) from july where mentor_person_id is null)
)) as s3_authoritative_2026_07_uehm_s11;


-- ── S4. The other reads this remediation paginated ───────────────────────────
-- Each row below was an unpaginated PostgREST read before the fix. Where the
-- count exceeds the cap, that loader was returning truncated data in Production
-- too, in a page the reporter did not happen to be looking at.
select jsonb_pretty(jsonb_build_object(
  'section', 'S4_other_previously_unpaginated_reads',
  'cap', 1000,
  'reads', jsonb_build_object(
    'people_total',                        (select count(*) from public.people),
    'mentor_profiles_total',               (select count(*) from public.mentor_profiles),
    'mentee_profiles_total',               (select count(*) from public.mentee_profiles),
    'applications_total',                  (select count(*) from public.applications),
    'application_answers_total',           (select count(*) from public.application_answers),
    'application_reviews_total',           (select count(*) from public.application_reviews),
    'person_season_memberships_total',     (select count(*) from public.person_season_memberships),
    'operational_team_assignments_total',  (select count(*) from public.operational_team_assignments),
    'action_items_total',                  (select count(*) from public.action_items),
    'events_total',                        (select count(*) from public.events),
    'event_participations_total',          (select count(*) from public.event_participations),
    'matches_total',                       (select count(*) from public.matches),
    'mentor_industries_total',             (select count(*) from public.mentor_industries),
    'mentor_function_areas_total',         (select count(*) from public.mentor_function_areas)
  ),
  -- The largest single-application answer fan-out. `getAnswersForApplications`
  -- reads answers for EVERY application in scope at once, so the relevant bound
  -- is the total, not this — but a large per-application value would mean even
  -- the single-application detail page was capped.
  'max_answers_for_one_application',
    (select coalesce(max(n), 0) from (select count(*) n from public.application_answers group by application_id) x)
)) as s4_other_previously_unpaginated_reads;


-- =============================================================================
-- HOW TO READ THE RESULT
--
--   S1  Expect BOTH users to resolve, both status 'active', and
--       effective_uehm_s11_access = true. For the super admin that will be true
--       with explicit_scope_grant = false and scope_rows = []; that is correct.
--       If uehmentoring@gmail.com shows effective_uehm_s11_access = false, the
--       fix in this branch DENIES that user the page instead of showing zeros —
--       correct behaviour, but the owner must then grant the scope.
--
--   S2  Expect recaps_exceed_cap = true and matches_exceed_cap = false.
--       That is the mechanical signature of the reported symptom pattern
--       (recap KPIs zeroed, population KPIs intact).
--
--   S3  These are the values BOTH users must see after the fix ships, for
--       /operations?month=2026-07. Compare card by card. The reported Super
--       Admin figures were:
--         card_1 18 · card_2 15 · card_3 3 · card_5 435
--         card_9 230 · card_10 407 · card_11 343
--       Note that card_2 (concept A) and card_4's numerator (concept B) are
--       expected to differ; `concept_a_minus_concept_b` quantifies it. A
--       non-zero value there is NOT a bug.
--
--   S4  Any count above 1000 identifies a loader that was silently truncated in
--       Production before this remediation. It is a scope check on the fix, not
--       a new incident: the code path is already paginated in this branch.
-- =============================================================================
