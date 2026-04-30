# Staging Dashboard QA: Remaining Issues & Diagnostics

This document outlines the root causes, fallback logic added, and safe fix paths for the three remaining issue groups identified during staging deployment QA.

## Issue Group 1: Home Dashboard missing/broken data

**Root Cause:**
The Home Dashboard was fetching data from the `applications` table, which was missing in the staging environment schema cache. When the fetch failed, the error propagated and broke the UI or returned empty states (0 counts) across multiple dashboard metrics.

**Fix/Fallback Logic Added:**
* Modified `getDashboardData` in `lib/data.ts` to make the `applications` table query optional.
* If the query fails, the error is swallowed and fallback data is returned: `{ data: 0, error: null }` for counts and `{ data: [], error: null }` for rows.
* This ensures that the governance data (e.g., `v_season_latest_closed_month`, `matches`, `recaps`, `people`) continues to load correctly, preventing a full dashboard failure.

## Issue Group 2: Operations selected month vs official closed month

**Root Cause:**
The "Tháng đã chốt" (Closed Month) label on the Operations page was displaying the dynamically calculated `selectedMonth` from the KPI calculation logic, which defaults to the selected dropdown month (e.g., `2026-04`). It was not utilizing the official governance source of truth (`v_season_latest_closed_month`).

**Fix/Fallback Logic Added:**
* Extracted `latestClosedMonth` into the return payload of `getOperationsData` in `lib/data.ts`.
* On the Operations page, decoupled the `officialClosedMonth` from the dynamic `selectedMonth`.
* The governance label "Tháng đã chốt" now strictly reflects the `officialClosedMonth` from the governance view.
* If the user selects a month greater than the official closed month (e.g., selecting April when March is closed), a warning is displayed: "Dữ liệu tháng mở không dùng cho KPI chính thức".

## Issue Group 3: Vietnamese mojibake/encoding issue

**Root Cause:**
Vietnamese names display corrupted characters (e.g., `HoĂ ng BĂch Thá»§y`, `Nguyá»…n ÄĂ¬nh TuĂ¢n`, `Äá»— KhĂ¡nh Linh`). This is a classic mojibake issue that typically occurs during CSV export/import when UTF-8 encoded text is interpreted or saved using a different encoding (like Windows-1252 or ISO-8859-1). It is not a CSS or font issue, but actual data corruption at the source file or import level.

**Diagnostic Queries:**
To detect mojibake patterns in the database without modifying data, you can run these read-only SQL queries:

```sql
-- 1. Check mojibake in people table
SELECT id, full_name, email_primary 
FROM people 
WHERE full_name LIKE '%Ă%' 
   OR full_name LIKE '%Ä%' 
   OR full_name LIKE '%á»%' 
   OR full_name LIKE '%Ă¢%';

-- 2. Check mojibake in mentor profile fields (e.g., company, title)
SELECT id, person_id, company_current, title_current 
FROM mentor_profiles 
WHERE company_current LIKE '%Ă%' OR company_current LIKE '%Ä%'
   OR title_current LIKE '%Ă%' OR title_current LIKE '%Ä%';

-- 3. Check mojibake in mentee profile fields (e.g., major)
SELECT id, person_id, major 
FROM mentee_profiles 
WHERE major LIKE '%Ă%' OR major LIKE '%Ä%';
```

**Recommended Safe Fix Path:**
* **Do NOT** attempt to run a string replacement script (mass data fix) inside the database. String repair of mojibake is notoriously error-prone and can create irreversible data corruption.
* **DO** regenerate a clean CSV export from the source system (e.g., Google Sheets, Excel) ensuring explicit UTF-8 encoding.
* Re-import the clean data to overwrite the corrupted text fields (e.g., using a merge/upsert script based on primary keys or emails).

## Manual Staging QA Checklist (Post-Redeploy)
- [ ] Verify Home Dashboard (`/`) loads without breaking, even if `applications` table is missing.
- [ ] Confirm Home Dashboard displays correct KPIs (Tháng đã chốt = 2026-03, recap = 271, active mentee = 224).
- [ ] Navigate to `/operations?month=2026-04`.
- [ ] Verify the label explicitly states "Tháng đã chốt: 2026-03" (not 2026-04).
- [ ] Ensure the warning "Dữ liệu tháng mở không dùng cho KPI chính thức" is displayed.
- [ ] Verify that no data has been modified to address the mojibake issue yet, maintaining adherence to the rule of no unapproved mass data updates.
