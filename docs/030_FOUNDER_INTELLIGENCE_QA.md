# Migration 030 — Founder Intelligence Dashboard QA Guide

**File:** `030_enrich_founder_intelligence_dashboard.sql`
**Date:** 2026-04-30
**Status:** Run on STAGING first. Re-apply to Production only after staging and SQL shape checks pass.

---

## Pre-flight: Run These Before Applying

```sql
-- 1. Confirm enrichment columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'mentor_profiles'
  AND column_name IN (
    'industry','function_area','years_of_experience',
    'years_in_vam','capacity_target','seniority_level',
    'current_company','current_title'
  );
-- Expected: 8 rows

-- 2. Confirm mentee enrichment columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'mentee_profiles'
  AND column_name IN (
    'university','career_interest','target_industry',
    'year_of_study','support_team'
  );
-- Expected: 5 rows

-- 3. Confirm submitted_at does NOT exist (must not be used)
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'mentoring_recaps'
  AND column_name = 'submitted_at';
-- Expected: 0 rows

-- 4. Check null rates for enrichment columns (understand output quality)
SELECT
  COUNT(*) AS total_mentors,
  COUNT(industry) AS has_industry,
  COUNT(function_area) AS has_function_area,
  COUNT(years_in_vam) AS has_years_in_vam,
  COUNT(seniority_level) AS has_seniority_level,
  COUNT(capacity_target) AS has_capacity_target
FROM public.mentor_profiles;

SELECT
  COUNT(*) AS total_mentees,
  COUNT(career_interest) AS has_career_interest,
  COUNT(target_industry) AS has_target_industry,
  COUNT(year_of_study) AS has_year_of_study,
  COUNT(support_team) AS has_support_team
FROM public.mentee_profiles;
```

---

## 1. SQL Syntax Check

```sql
-- Dry-run: Verify the file compiles without error.
-- In psql (staging):
\i supabase_migrations/030_enrich_founder_intelligence_dashboard.sql
-- Expected: No ERROR messages. Should print:
-- CREATE FUNCTION (x3 helpers)
-- CREATE FUNCTION (main RPC)
-- COMMENT ON FUNCTION
-- REVOKE / GRANT
-- NOTIFY

-- Verify all 4 functions created:
SELECT proname, pronargs
FROM pg_proc
WHERE proname IN (
  'intel_norm',
  'intel_experience_band',
  'intel_vam_seniority_band',
  'get_founder_intelligence_dashboard'
)
AND pronamespace = 'public'::regnamespace;
-- Expected: 4 rows
```

## Production Re-apply Instruction

Use this only after staging has passed and the Production enrichment columns exist.

1. Open the Supabase Production project.
2. Go to SQL Editor > New query.
3. Paste the full contents of `supabase_migrations/030_enrich_founder_intelligence_dashboard.sql`.
4. Run the query.
5. Run this verification SQL:

```sql
select
  result ? 'match_health_summary' as has_match_health_summary,
  result ? 'matchHealthSummary' as has_camel_match_health,
  jsonb_typeof(result->'mentorProfile'->'byIndustry') as by_industry_type,
  jsonb_typeof(result->'recommendedActions') as recommended_actions_type
from public.get_founder_intelligence_dashboard('UEHM-S11') as result;
```

Expected result:

| has_match_health_summary | has_camel_match_health | by_industry_type | recommended_actions_type |
| --- | --- | --- | --- |
| true | false | array | array |

Do not run data backfills as part of this re-apply. Migration 030 replaces functions and grants only.

---

## 2. RPC Smoke Test

```sql
-- Basic call (should not crash):
SELECT public.get_founder_intelligence_dashboard('UEHM-S11');
-- Expected: returns a jsonb object (not null, not error)

-- Confirm top-level keys exist:
SELECT
  (result ? 'season_code')                   AS has_season_code,
  (result ? 'season_id')                     AS has_season_id,
  (result ? 'selected_month')                AS has_selected_month,
  (result ? 'total_mentors')                 AS has_total_mentors,
  (result ? 'total_mentees')                 AS has_total_mentees,
  (result ? 'active_matches')                AS has_active_matches,
  (result ? 'mentor_capacity_distribution')  AS has_mentor_cap_dist,
  (result ? 'mentee_school_distribution')    AS has_mentee_school,
  (result ? 'mentor_company_distribution')   AS has_mentor_company,
  (result ? 'match_health_summary')          AS has_match_health,
  (result ? 'top_mentors_by_mentee_count')   AS has_top_mentors,
  (result ? 'data_quality_flags')            AS has_dq_flags,
  (result ? 'definitions')                   AS has_definitions,
  (result ? 'mentorProfile')                 AS has_mentor_profile,
  (result ? 'menteeProfile')                 AS has_mentee_profile,
  (result ? 'matchingIntelligence')          AS has_matching_intel,
  (result ? 'activityBySegment')             AS has_activity_seg,
  (result ? 'recommendedActions')            AS has_rec_actions
FROM public.get_founder_intelligence_dashboard('UEHM-S11') AS result;
-- Expected: all TRUE

-- Confirm helper functions work independently:
SELECT public.intel_experience_band(5);     -- Expected: '4-7 years'
SELECT public.intel_experience_band(NULL);  -- Expected: 'Chưa rõ'
SELECT public.intel_vam_seniority_band(0);  -- Expected: 'New mentor'
SELECT public.intel_vam_seniority_band(3);  -- Expected: '2-3 seasons'
SELECT public.intel_norm('  Finance  ');    -- Expected: 'finance'
SELECT public.intel_norm(NULL);             -- Expected: NULL
```

---

## 3. JSON Shape Comparison vs 029

```sql
-- Extract and compare shape of key enriched sections:
WITH result AS (
  SELECT public.get_founder_intelligence_dashboard('UEHM-S11') AS data
)
SELECT
  jsonb_typeof(data->'mentorProfile'->'byIndustry')          AS by_industry_type,
  jsonb_typeof(data->'mentorProfile'->'byFunction')          AS by_function_type,
  jsonb_typeof(data->'mentorProfile'->'byExperienceBand')    AS by_exp_band_type,
  jsonb_typeof(data->'mentorProfile'->'byVamSeniority')      AS by_vam_senior_type,
  jsonb_typeof(data->'mentorProfile'->'bySeniorityLevel')    AS by_seniority_type,
  jsonb_typeof(data->'mentorProfile'->'overloadedMentors')   AS overloaded_type,
  jsonb_typeof(data->'mentorProfile'->'inactiveMentorsWithMentees') AS inactive_type,
  jsonb_typeof(data->'menteeProfile'->'byCareerInterest')    AS by_career_type,
  jsonb_typeof(data->'menteeProfile'->'byTargetIndustry')    AS by_target_ind_type,
  jsonb_typeof(data->'menteeProfile'->'byYearOfStudy')       AS by_year_type,
  jsonb_typeof(data->'menteeProfile'->'bySupportTeam')       AS by_support_type,
  jsonb_typeof(data->'activityBySegment'->'activeMenteeRateByMajor') AS act_major_type,
  jsonb_typeof(data->'activityBySegment'->'recapRateBySupportTeam')  AS recap_supp_type,
  jsonb_typeof(data->'activityBySegment'->'activeMentorRateByIndustry') AS act_ind_type,
  jsonb_typeof(data->'activityBySegment'->'silentMenteeByCareerInterest') AS silent_ci_type,
  jsonb_typeof(data->'recommendedActions')                   AS rec_actions_type,
  jsonb_typeof(data->'matchingIntelligence'->'mentorSupplyVsMenteeDemand') AS supply_demand_type
FROM result;
-- Expected: ALL values = 'array' (not 'null', not 'object')
-- supply_demand_type must also be 'array' (empty [])

-- Confirm deferred fields remain empty:
WITH result AS (
  SELECT public.get_founder_intelligence_dashboard('UEHM-S11') AS data
)
SELECT
  jsonb_array_length(data->'matchingIntelligence'->'matchesByIndustryAlignment') AS ind_align_len,
  jsonb_array_length(data->'matchingIntelligence'->'matchesByFunctionAlignment') AS fn_align_len,
  jsonb_array_length(data->'matchingIntelligence'->'mentorSupplyVsMenteeDemand') AS supply_len,
  jsonb_array_length(data->'matchingIntelligence'->'unmatchedOrWeakSegments')    AS unmatched_len
FROM result;
-- Expected: all 0 (deferred to 031)

-- Regression: confirm 029 root field values are unchanged
WITH result AS (
  SELECT public.get_founder_intelligence_dashboard('UEHM-S11') AS data
)
SELECT
  (data->>'total_mentors')::int  AS total_mentors,
  (data->>'total_mentees')::int  AS total_mentees,
  (data->>'active_matches')::int AS active_matches,
  data->>'selected_month'        AS selected_month,
  (data->'match_health_summary'->>'silentMentees')::int AS silent_mentees
FROM result;
-- Compare these values against the last 029 run output.
-- Values must match within ±0 (same season, same data).

-- Confirm overloadedMentors now has real industry (not 'Unknown')
WITH result AS (
  SELECT public.get_founder_intelligence_dashboard('UEHM-S11') AS data
)
SELECT elem->>'industry' AS industry
FROM result,
     jsonb_array_elements(data->'mentorProfile'->'overloadedMentors') AS elem
LIMIT 5;
-- Expected: real values (or 'Chưa rõ') — NOT 'Unknown'
```

---

## 4. Null / Empty-Data Safety Test

```sql
-- Test with a non-existent season code:
SELECT public.get_founder_intelligence_dashboard('FAKE-SEASON-999');
-- Expected: returns valid jsonb (not error)
-- season_id should be null or fallback uuid
-- all arrays should be [] or 0

-- Test: mentorProfile arrays are never null even with no data
WITH result AS (
  SELECT public.get_founder_intelligence_dashboard('FAKE-SEASON-999') AS data
)
SELECT
  data->'mentorProfile'->'byIndustry'     IS NOT NULL AS by_industry_not_null,
  data->'menteeProfile'->'byCareerInterest' IS NOT NULL AS by_career_not_null,
  data->'activityBySegment'->'recapRateBySupportTeam' IS NOT NULL AS recap_rate_not_null,
  data->'recommendedActions' IS NOT NULL  AS rec_actions_not_null
FROM result;
-- Expected: all TRUE

-- Test: recommendedActions does not fire on fake support teams
WITH result AS (
  SELECT public.get_founder_intelligence_dashboard('UEHM-S11') AS data
)
SELECT elem->>'title' AS rec_title
FROM result,
     jsonb_array_elements(data->'recommendedActions') AS elem
WHERE elem->>'title' LIKE '%Chưa rõ%';
-- Expected: 0 rows (fake team label must never appear in recommendations)

-- Test: inactiveMentorsWithMentees is capped at 50
WITH result AS (
  SELECT public.get_founder_intelligence_dashboard('UEHM-S11') AS data
)
SELECT jsonb_array_length(data->'mentorProfile'->'inactiveMentorsWithMentees') AS inactive_count
FROM result;
-- Expected: 0–50 (never more than 50)
```

---

## 5. Frontend Compatibility Test (`/operations/intelligence`)

**Deploy to staging, open `/operations/intelligence`, verify:**

| UI Element | Expected Behavior | Check |
|------------|------------------|-------|
| Page loads without error | No crash, no blank screen | ☐ |
| "Mentor by industry" bar chart | Renders (even if single bar 'Chưa rõ') | ☐ |
| "Mentor by function" bar chart | Renders | ☐ |
| "Mentor experience band" donut | Renders (was already working in 029) | ☐ |
| "Mentor by years in VAM" donut | Renders (was [] in 029, now populated) | ☐ |
| "Mentor seniority level" bar | Renders | ☐ |
| "Overloaded mentors" table | `industry` column shows real values (not 'Unknown') | ☐ |
| "Inactive mentors with mentees" table | Renders (was [] in 029, now populated) | ☐ |
| "Mentee by career interest" bar | Renders | ☐ |
| "Mentee by target industry" bar | Renders | ☐ |
| "Mentee by year of study" bar | Renders | ☐ |
| "Mentee by support team" donut | Renders | ☐ |
| "Recap rate by support team" table | Renders | ☐ |
| "Active mentor rate by industry" table | Renders | ☐ |
| "Silent mentee by career interest" table | Renders | ☐ |
| Recommended action cards | Renders (or shows empty state cleanly) | ☐ |
| No JS console errors | `undefined is not iterable` must not appear | ☐ |
| CSV export buttons | Still functional (no regression) | ☐ |

---

## Rollback Plan

If any check fails on staging, rollback by re-running migration 029:

```bash
# In psql (staging):
\i supabase_migrations/029_founder_intelligence_rpc.sql
```

Migration 030 is RPC-only. No DDL was changed. Re-running 029 atomically restores the previous function body.

---

## Sign-off Checklist

- [ ] All 5 SQL check sections passed on staging
- [ ] Frontend smoke test passed (all 18 UI checks)
- [ ] Rollback plan verified (re-run 029 restores function)
- [ ] Peer review completed
- [ ] Apply to production approved
