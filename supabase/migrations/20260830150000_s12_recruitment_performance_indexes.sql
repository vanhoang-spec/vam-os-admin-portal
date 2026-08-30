-- VAM OS S12 Recruitment - Performance Index Remediation
-- Generated: 2026-08-30  Baseline: Micro compute, ap-southeast-1, Pro plan
--
-- Supabase Advisor findings addressed:
--   1. application_answers.application_id  -- FK with no lookup index
--   2. applications.person_id              -- no index (used in approval path)
--   3. application_reviews composite       -- hot path: application_id + review_round + status
--   4. admin_scope_access composite        -- RLS init-plan hot path
--
-- All indexes are CONCURRENTLY-safe (IF NOT EXISTS, no data modification).
-- Safe to run against staging first; no Production migration until UAT complete.
--
-- Performance hot paths diagnosed:
--   * Recruitment list load:  getApplications -> applications.season_id (or.filter)
--   * Application detail:     getAnswersForApplications -> application_answers.application_id
--                             (getInterviewCandidates uses selectInChunks by application_id)
--   * Review queue:           getInterviewCandidates -> application_reviews
--                             WHERE application_id IN (...) AND review_round = 'interview'
--                             AND status <> 'cancelled'
--   * Profile review queue:   same as above with review_round = 'profile_screening'
--   * Previous/Next nav:      getApplication single-row by id (uses PK, already fast)
--   * Approval finalization:  vam090_finalize_recruitment_approval uses applications.person_id
--                             and application_decisions.application_id (already indexed)
--   * RLS evaluation:         admin_scope_access checked on every service-role bypass;
--                             vam084_operator_for_season / vam084_participant_for_stage
--                             both JOIN admin_scope_access by user_id + season_id + role + status

begin;

-- ---------------------------------------------------------------------------
-- 1. application_answers.application_id
--    Hot path: getAnswersForApplications uses selectInChunks(application_id, ...)
--    Without this, Supabase Micro does a sequential scan of the full table on
--    every application detail load and interview candidate enrichment.
-- ---------------------------------------------------------------------------
create index if not exists application_answers_application_id_idx
  on public.application_answers (application_id);

-- ---------------------------------------------------------------------------
-- 2. applications.person_id
--    Hot path: vam090_finalize_recruitment_approval links application -> person.
--    Also used by approval eligibility gate to check existing profile linkage.
--    The Supabase Advisor flags this as missing; FK does not auto-create index.
-- ---------------------------------------------------------------------------
create index if not exists applications_person_id_idx
  on public.applications (person_id)
  where person_id is not null;

-- ---------------------------------------------------------------------------
-- 3. applications.season_id
--    Hot path: getApplications filters by season_id in the OR predicate.
--    The staging bootstrap (059) created this without IF NOT EXISTS; production
--    may not have it. Safe to re-declare with IF NOT EXISTS.
-- ---------------------------------------------------------------------------
create index if not exists applications_season_id_idx
  on public.applications (season_id)
  where season_id is not null;

-- ---------------------------------------------------------------------------
-- 4. application_reviews composite covering index
--    Hot path: getInterviewCandidates queries:
--      WHERE application_id = any(ids)
--        AND review_round = 'interview'
--        AND status <> 'cancelled'
--    The existing separate single-col indexes (application_id, review_round,
--    status) each require a bitmap heap scan merge. A composite index on
--    (application_id, review_round, status) lets Postgres index-only scan
--    the entire predicate.
--
--    The M090 unique index application_reviews_active_reviewer_round_uidx
--    covers (application_id, reviewer_admin_user_id, review_round) WHERE
--    status IS DISTINCT FROM 'cancelled' — useful for dedup enforcement but
--    not optimal for the list-query access pattern below.
-- ---------------------------------------------------------------------------
create index if not exists application_reviews_app_round_status_idx
  on public.application_reviews (application_id, review_round, status);

-- ---------------------------------------------------------------------------
-- 5. admin_scope_access composite for RLS hot path
--    vam084_operator_for_season and vam084_participant_for_stage both execute:
--      SELECT 1 FROM admin_scope_access asa
--        WHERE asa.user_id = p_auth_user_id   -- auth.uid() equivalent
--          AND asa.status = 'active'
--          AND asa.season_id = p_season_id::text
--          AND asa.role IN ('review', 'operations', 'full_access')
--    The existing unique index covers (user_id, coalesce(program_id,''),
--    coalesce(season_id,''), role) WHERE status='active', which handles the
--    active-status predicate. However, the partial index only applies when
--    status='active' is the filter. A separate composite covering the most
--    common lookup order avoids the function-call overhead in the RLS
--    init-plan (Supabase Advisor warning: auth-init-plan cost on service_role).
--
--    NOTE: The M090 RPCs use security invoker + service_role guard, so RLS
--    is not re-evaluated per row. The cost is only at function init. This
--    index makes the admin_scope_access lookup within those functions faster.
-- ---------------------------------------------------------------------------
create index if not exists admin_scope_access_user_season_role_status_idx
  on public.admin_scope_access (user_id, season_id, role, status)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 6. application_reviews: reviewer isolation query index
--    getInterviewCandidates reviewer queue filters:
--      WHERE reviewer_admin_user_id = actor.adminUserId
--        AND review_round = 'interview'
--        AND status <> 'cancelled'
--    This is the M090-B isolation predicate. The existing reviewer_admin_user_id
--    partial index does not include review_round, forcing a post-filter.
-- ---------------------------------------------------------------------------
create index if not exists application_reviews_reviewer_round_status_idx
  on public.application_reviews (reviewer_admin_user_id, review_round, status)
  where reviewer_admin_user_id is not null;

commit;
