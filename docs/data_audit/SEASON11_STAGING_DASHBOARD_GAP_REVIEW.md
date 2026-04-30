# VAM OS – Season 11 Staging Dashboard Gap Review

## 1. Executive Diagnosis

The staging dashboard is currently displaying a severe data illusion. It is dynamically defaulting to the **current calendar month (April 2026)** instead of the **latest closed month (March 2026)**. Furthermore, the complete absence of a bar for `2026-03` in the "Recap mentoring theo tháng" chart confirms that the March 2026 data has not yet been imported into the Supabase database.

Because April is an open, ongoing month with only 1 early/test recap submitted, the dashboard calculates that almost the entire program is failing (637 mentees missing recaps, 573 silent for 2 months).

## 2. Likely Root Causes

1.  **Date-Math vs. Business Logic**: The frontend or RPC logic is likely using `new Date()` or similar raw date math to determine "tháng này" (this month) rather than looking for a specific `closed = TRUE` database flag.
2.  **Missing March Data**: The Excel audit shows ~286 recaps for March, but the database currently has 0. The import has not been executed yet.
3.  **Cascading Follow-up Failure**: Because March data is 0, the "Silent 2 months" query looks at February (which had a legitimate drop to 126 recaps) and March (0 recaps), resulting in a massive false-positive list of 573 mentees.

## 3. Risks

*   **Founder Panic**: Without context, a founder looking at this dashboard will assume the program completely died in March and April.
*   **Operational Misdirection**: Admins might start acting on the 573 "Im lặng 2 tháng" queue, sending warning emails to mentees who actually submitted recaps in March.

## 4. Codex Schema-Gap Checklist Additions

Based on this UI behavior, when Codex runs the Schema Gap Analysis, it **must** specifically check for:
1.  **The `closed` Flag**: Verify if the KPI tables/views currently have a `closed` boolean column. If not, the UI is forced to rely on raw date math.
2.  **Default Month Logic**: Identify where the RPC or API fetches the "default month". It needs to be rewritten from `current_month` to `MAX(month) WHERE closed = TRUE`.
3.  **Follow-up Query Hardcoding**: Check if the "Im lặng 2 tháng" logic strictly looks at the *latest closed month and the month before it*, rather than `current_month - 1` and `current_month - 2`.

## 5. What NOT to Fix Yet

*   **Do not manually import March data** just to make the dashboard look better. Wait for Codex to finalize the schema gap analysis so the data lands in the correct structure.
*   **Do not rewrite the complex Supabase RPCs** for follow-up logic until the tables are verified.

## 6. Safe Temporary UI Wording Suggestions (Interim Fix)

Until the data is imported and the closed-month logic is wired up, the UI should be patched with hardcoded labels to prevent misunderstandings:

1.  **KPI Card Labels**: Change "Số recap tháng này" to **"Số recap tạm tính (Tháng 4/2026)"**.
2.  **Follow-up Labels**: Change "Im lặng 2 tháng liên tiếp" to **"Dự kiến follow-up (Đang chờ dữ liệu Tháng 3)"**.
3.  **Global Banner**: Add a prominent yellow banner at the top of the Dashboard and Operations pages:
    > *"Dữ liệu Tháng 3/2026 đang trong quá trình đối soát và nhập liệu. Các chỉ số hiện tại thuộc Tháng 4 (tháng mở) chưa phản ánh đúng KPI chính thức."*
