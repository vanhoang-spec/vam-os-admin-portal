# Production Rollout Plan: Post-Staging Remediation
**Objective:** Safely deploy the Dashboard Governance codebase updates to the Production environment, following the successful remediation of the Staging data encoding and the successful QA of the dashboard logic.

## 1. Staging QA Result (PASS)
- **Data Integrity:** Vietnamese mojibake has been successfully eradicated on the Staging database. All affected records perfectly matched the clean production source and were updated via a direct SQL transaction. 
- **Application Logic:** The `app/page.tsx` dashboard governance code changes were validated.
- **KPI Metrics:** Staging accurately displays closed-month (March 2026) values: 271 recaps, 224 active mentees, 180 active mentors, 451 pending follow-ups. Open-month (April 2026) context accurately shows a warning without hijacking official metrics.

## 2. Encoding Fix Summary (Staging DB)
- **Issue:** Staging database (`ljfneyuvpxrmejpxsmpz`) suffered from corrupted Vietnamese display names due to an older, flawed CSV import. Production (`qkkroesfiazsejkzflcd`) remained clean.
- **Remediation:** We executed a read-only extract of the Production MVP `people` table. A temporary table was created in Staging, and exactly 1,313 names were explicitly patched using a secure `email_primary` matching key.
- **Result:** No application logic was modified. The database remediation was 100% successful.

## 3. KPI Values to Re-check Post-Production Rollout
Immediately following the Vercel production deployment, check the Production Admin Portal (`/` and `/operations?month=2026-03`):
* **Số recap tháng này:** 271
* **Mentee active tháng này:** 224
* **Mentor active tháng này:** 180
* **Cần follow-up:** 451
*(Any deviation means the production data state differs from staging, triggering an immediate rollback).*

## 4. Rollback Plan
Since the Production Database is already clean (no encoding fix needed), the only risk is the front-end Next.js code deployment.
* **Instant Revert:** If the Production Vercel build fails or KPIs deviate post-launch, immediately trigger a **Vercel Instant Rollback** to the previous stable deployment from the Vercel dashboard.
* **Zero DB Risk:** Do not execute any database mutations or `pg_dump` restorations, as the Production Database is not being touched during this code rollout.

## 5. Exact "Go / No-Go" Checklist Before Touching Production
- [ ] **Approval:** Explicit written approval received from Management/Founders to trigger the production deployment.
- [ ] **Sanity Check:** Production database is confirmed to still possess clean Vietnamese encoding (no regressions during our testing window).
- [ ] **Merge:** Ensure the `main` branch holds the exact commit matching our Staging QA (no unreviewed commits).
- [ ] **Lockdown:** Instruct operations team to halt any manual data imports/mutations in the Production DB during the 5-minute deployment window.
- [ ] **Execution:** Push the Vercel deployment button.

> **CRITICAL:** Do NOT push to production or merge branches without completing the explicit approval step above.
