# VAM OS – Season 11 Supabase Staging Playbook

> **Purpose:** Provide a strict, step-by-step operational checklist to safely audit, migrate, and import Season 11 data. This guarantees that production data is protected and that operations rely exclusively on accurate, validated metrics.

---

## 1. Read-Only Inspection Phase

*Before writing any migration or generating data imports.*

- [ ] **What to Inspect:**
  - Verify if tables for `season_monthly_kpis`, `recap_events`, `data_import_batches`, and `data_quality_issues` exist.
  - Check existing primary keys and unique constraints (do they accidentally block multiple recaps per mentee per month?).
  - Review foreign keys linking to `mentee_profiles` and `mentor_profiles`.
- [ ] **Allowed SQL Types:**
  - `SELECT`, `EXPLAIN`, `\d` (describe table), and checking the `information_schema`.
- [ ] **NOT Allowed:**
  - `INSERT`, `UPDATE`, `DELETE`, `COPY`.
  - `CREATE`, `ALTER`, `DROP`.

---

## 2. Staging Migration Decision

*When reviewing the Codex Schema Gap Analysis, apply this framework.*

- [ ] **Avoid Migration:** If an existing table already meets the exact requirements (e.g., `mentor_profiles` is stable and usable as-is).
- [ ] **Create a View / Materialized View:** Prefer this for aggregations like distinct mentees, follow-up queues, or monthly KPIs if the raw event table is sufficient.
- [ ] **Extend Existing Table:** If a core table (like `season_monthly_kpis`) exists but lacks a critical flag (like `closed` boolean), use `ALTER TABLE ... ADD COLUMN`.
- [ ] **Create New Table:** If tracking something entirely new (e.g., `data_import_batches` for auditability).
- [ ] **Create Staging-Only Import Table:** If raw data is incredibly messy and needs to be loaded into the DB before normalization, create `staging_raw_recaps_import`. (Usually, prefer cleaning in Node/TS first, then importing to the clean `recap_events` table).

---

## 3. Data Import Preparation Phase

*Before writing the staging import SQL.*

- [ ] **Deduplication Rules Applied:** Exact row duplicates (same mentor, mentee, date, type, text) must be purged from the CSV.
- [ ] **ID Mapping Validated:** All names/emails must be fully resolved to exact Supabase `person_id`s. Missing IDs are completely removed from the payload.
- [ ] **Activity Type Normalization:** Ensure the `type` column matches an exact enum/string set (mentoring, cross_mentoring, training, company_visit, other).
- [ ] **Import Batch Tracking Setup:** The payload must be ready to bind to a unique `batch_id`.
- [ ] **QA Report Finalized:** `SEASON11_TRACKING_AUDIT.md` is complete, showing 0 "Block" issues.

---

## 4. Staging Import Phase

*High-level execution sequence for staging ONLY.*

- [ ] **1. Transaction Start:** Wrap the entire operation in a `BEGIN; ... COMMIT;` block.
- [ ] **2. Batch Registration:** `INSERT INTO data_import_batches` with status `pending`. Capture the `batch_id`.
- [ ] **3. Import:** Use `COPY` or batched `INSERT` to load the prepared CSV into `recap_events`.
- [ ] **4. KPI Update:** Upsert the official March 2026 aggregates from `Báo cáo Recap` into `season_monthly_kpis` with `closed = TRUE`.
- [ ] **5. Validation Checks:** Run inline `SELECT` checks to verify row counts.
- [ ] **6. Status Update:** `UPDATE data_import_batches SET status = 'completed'`.
- [ ] **7. Rollback Plan:** If any step fails, the transaction automatically `ROLLBACK`s. If discovered later, execute: `DELETE FROM recap_events WHERE batch_id = [ID]`.

---

## 5. QA Phase

*Verify the data inside the staging Supabase environment.*

- [ ] **Total recap entries:** Verify `COUNT(*)` in `recap_events` for March 2026 matches the expected >90% of the `Báo cáo Recap` volume.
- [ ] **Distinct mentees with recap:** Verify `COUNT(DISTINCT mentee_id)` in `recap_events` for March matches expectations.
- [ ] **Distinct mentor–mentee pairs:** Verify `COUNT(DISTINCT mentor_id, mentee_id)`.
- [ ] **Silent List (Feb + Mar):** Query mentees missing recaps in both months. Ensure the list matches the expected follow-up queue.
- [ ] **April Excluded:** Query `season_monthly_kpis` where `closed = TRUE`. Ensure April 2026 does NOT appear.

---

## 6. Production Gate

*The final checkpoint before touching the live system.*

- [ ] **Sign-off Checklist:** All previous phases completed and documented.
- [ ] **No Block Issues:** 0 unhandled foreign key violations or data duplication errors.
- [ ] **Accepted Warnings:** All >5% variances are documented and accepted by Operations.
- [ ] **Dashboard Verified:** The VAM OS Staging UI renders the new data correctly without crashing.
- [ ] **Rollback Plan Tested:** A verified SQL script to revert the production DB back to its exact pre-import state exists.

---

## 7. Human Approval Points

**Thắng MUST explicitly approve at these specific gates:**

1.  **Approval Gate 1 (Post-Gap Analysis):** Approve the staging schema migration scripts *before* they are executed on staging.
2.  **Approval Gate 2 (Post-Data Audit):** Approve the `SEASON11_TRACKING_AUDIT.md` report, accepting any listed warnings, *before* the staging data import is executed.
3.  **Approval Gate 3 (Production Go-Live):** Approve the final production migration and import scripts *after* successful QA in the staging environment.
