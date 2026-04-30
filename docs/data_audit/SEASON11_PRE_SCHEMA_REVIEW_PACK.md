# VAM OS – Season 11 Pre-Schema Gap Review Pack

> **Purpose:** A manual review guide to evaluate the upcoming `docs/data_audit/SEASON11_SCHEMA_GAP_ANALYSIS.md` before approving any migration scripts.
> **Context:** Codex is analyzing the Supabase schema to see what's missing for the VAM OS Season 11 data integration (defined in `SEASON11_IMPLEMENTATION_SPEC.md`).

---

## 1. Schema Gap Review Checklist

When reviewing the Codex schema gap report, ensure the following constraints are evaluated:
- [ ] **Closed Month Tracking:** Does the proposed schema natively support tracking `closed` vs `open` months (e.g., a `closed` boolean flag)?
- [ ] **Event Granularity:** Can the proposed `recap_events` structure handle multiple distinct recaps from the same mentee in the same month without triggering primary key/unique constraint violations?
- [ ] **ID Foreign Keys:** Are `mentor_id` and `mentee_id` strictly tied to the `person_id` in `mentor_profiles` and `mentee_profiles` (or `people` table)?
- [ ] **Distinct Mentee Logic:** Do the proposed views/aggregates clearly separate `COUNT(id)` (volume) from `COUNT(DISTINCT mentee_id)` (engagement)?
- [ ] **Follow-up Logic:** Is there a clear path to query mentees with NO recap in specific rolling months (e.g., Feb 2026 and Mar 2026)?
- [ ] **Auditability:** Are the `data_import_batches` and `data_quality_issues` objects present to prevent blind imports?

---

## 2. Supabase Object Decision Framework

For each required object identified in the Implementation Spec, apply this decision matrix:

| Required Object | Reuse Existing? | Extend Existing? | Create New Staging-Only? | Defer? |
| :--- | :--- | :--- | :--- | :--- |
| **season baseline metrics** | Yes, if a historical summary table exists. | No. | Yes, if nothing exists yet (e.g., `staging_season_baselines`). | No. |
| **season monthly KPI snapshots**| If an existing `kpis` table exists, check if it has a `closed` flag. | Yes, by adding a `closed` boolean column. | Yes, if no suitable table exists. | No. |
| **raw recap events** | If `mentoring_recaps` exists, check if it allows multiple rows per mentee/month. | Yes, by adding `activity_type` or `source_sheet`. | Yes, if current table is restrictive. | No. |
| **monthly recap aggregates** | No (use views). | No (use views). | Yes, create as a Materialized View over events. | No. |
| **distinct mentees with recap** | No (use views). | No (use views). | Yes, logic baked into views. | No. |
| **distinct mentor–mentee pairs**| No (use views). | No (use views). | Yes, logic baked into views. | No. |
| **mentee monthly tracking** | No (use views). | No (use views). | Yes, derived from profiles + events. | No. |
| **silent/follow-up list** | No (use views). | No (use views). | Yes, derived from mentee tracking. | No. |
| **data import batches** | If an import log table exists, reuse. | Yes, add `source_sheet` or `status`. | Yes, if not present. | No. |
| **data quality issues** | If an issue tracker exists, reuse. | Yes, add `severity` and `resolved` flags. | Yes, if not present. | No. |

---

## 3. Dashboard Readiness Criteria

Before dashboard frontend logic can be safely updated to point to the new data, the following must be true:
1. **Views Deployed to Staging**: All required materialized views (`v_mentor_dashboard`, `v_mentee_dashboard`, etc.) must exist in the staging schema.
2. **`closed` Flag Enforced**: Frontend queries must explicitly append `WHERE closed = TRUE` or backend RPCs must enforce this internally.
3. **Open Month Excluded**: April 2026 data must not appear in any KPI summary or follow-up list in staging.
4. **Data Seeded in Staging**: At least one closed month (March 2026) must be populated in staging to test UI rendering.

---

## 4. Staging Import Readiness Criteria

Before running any SQL `COPY` or `INSERT` for March 2026 data into the staging tables:
1. **Schema Exists**: The target tables (`recap_events`, `season_monthly_kpis`) must be verified to exist in staging.
2. **Audit Passed**: `docs/data_audit/SEASON11_TRACKING_AUDIT.md` must be thoroughly reviewed and cleared of all "Block" issues.
3. **Foreign Keys Validated**: The generated import CSVs must only contain `mentor_id` and `mentee_id` values that exist in the staging DB's profile tables.
4. **Import Batch Initialized**: A row must be created in `data_import_batches` with a pending status.

---

## 5. Production Blocking Issues

The following must **NEVER** reach production. If any are detected during the staging phase, halt the rollout:
1. **Schema without `closed` enforcement**: Any table/view that aggregates KPIs without respecting the `closed = TRUE` filter.
2. **Destructive schema modifications**: `DROP TABLE` or `DROP COLUMN` commands targeting existing production tables without explicit, documented approval.
3. **Primary Key Violations**: `recap_events` structured in a way that prevents a mentee from having multiple recaps in the same month.
4. **Duplicate logic leaks**: Views that calculate engagement (% mentees) by counting raw recap events instead of `DISTINCT mentee_id`.

---

## 6. Supabase Staging Strategy

Our overarching strategy for staging Season 11 data without impacting production:

*   **Avoid Import until Matching Logic is Proven**: Do not touch production data.
*   **Create Staging-Only Tables**: If significant structural changes are needed (e.g., moving from a single recap per month to multiple), create a `staging_recap_events` table first.
*   **Create Views Over Existing Data**: For follow-up queues and KPIs, build materialized views (`staging_v_season_kpis`) that pull from the staging tables.
*   **Reuse Existing Tables (Carefully)**: If `mentor_profiles` and `mentee_profiles` are stable, reference them directly via foreign keys from the staging tables. Do not duplicate the profile data unless required for safety.

---

## 7. Codex Next Prompt (After Schema Gap Analysis)

**Copy and paste the following prompt to Codex once it has completed `SEASON11_SCHEMA_GAP_ANALYSIS.md`:**

```text
Please review `docs/data_audit/SEASON11_SCHEMA_GAP_ANALYSIS.md` and `docs/data_audit/SEASON11_PRE_SCHEMA_REVIEW_PACK.md`. 

Based on the gap analysis and the decision framework, please generate the required Supabase migration SQL to prepare the staging environment for Season 11 data.

Important constraints:
1. Generate SQL for a staging environment ONLY (e.g., prefix new tables with `staging_` if they conflict with production, or deploy to a specific schema if configured).
2. Do NOT write data import statements (no COPY or INSERT of actual records yet).
3. Ensure the tables can support multiple recaps per mentee per month without constraint violations.
4. Ensure KPI tables or views include a `closed` boolean flag.
5. Provide the migration as a cleanly formatted SQL artifact. Do NOT apply it directly to production.
```
