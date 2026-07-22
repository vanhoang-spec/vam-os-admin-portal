# VAM OS Support Team UAT Plan — 2026-07-22

Safest viable environment: **A, a branch preview proven to use staging with authorized synthetic data**. Until that proof/authorization exists, use **B, local build with synthetic/mocked data**, and limit UAT accordingly. Never use production as a test path. Option C becomes preferred after a separately authorized baseline; D is rejected.

| ID | Role | Preconditions | Steps | Expected result | Severity if failed |
|---|---|---|---|---|---|
| AUTH-01 | support | synthetic account | Login; open home | only authorized menu/routes | S1 |
| AUTH-02 | support | logged in | Direct-open `/admin/users`, reviewer assignment | denied/not found; no data | S0 |
| AUTH-03 | support | logged in | Logout; revisit protected route | session cleared; login required | S1 |
| AUTH-04 | support | invalid/expired session | Open protected route | safe generic denial; no details | S1 |
| APP-01 | support | demo batch exists | Open applications; filter program/season/batch | only selected scope shown | S0 |
| APP-02 | support | varied statuses | Filter/search and clear filters | consistent rows/counts | S2 |
| APP-03 | support | synthetic application | Open detail/data check/notes | fields load; permitted notes only | S2 |
| APP-04 | support | prohibited transition | Attempt decision/admin action | action absent or denied | S0 |
| APP-05 | support | duplicate/error fixture | Submit/retry safe test action | clear error; no duplicate | S2 |
| APP-06 | support | UEH and HAM fixtures | change selector/direct URL | no cross-program data | S0 |
| PROF-01 | support | synthetic people | find mentor/mentee | correct scoped profile | S2 |
| PROF-02 | support | two matches | open matching views | visible relationships; unsafe actions denied | S2 |
| PROF-03 | support | legacy fixture | open legacy workflow pages | no regression | S2 |
| EVT-01 | support | orientation event | open registrations | statuses/payment/proof visible by permission | S2 |
| EVT-02 | support | state fixtures | exercise permitted approve/reject/waitlist/cancel | valid transition or explicit denial | S2 |
| EVT-03 | support | capacity 8 | confirm/waitlist cases | capacity and waitlist consistent | S2 |
| EVT-04 | support | checked-in fixtures | open/check permitted check-in | correct attendance; no duplicate | S2 |
| A11Y-01 | support | keyboard only | navigate header/sidebar/content | visible focus and logical order | S3 |
| A11Y-02 | support | narrow viewport | open/close drawer via keyboard/Escape | focus trapped/returned | S3 |
| A11Y-03 | support | induced validation/error | submit invalid form | labelled error announced | S2 |
| A11Y-04 | support | slow/loading path | navigate/action | loading state clear; controls safe | S3 |
| A11Y-05 | support | Vietnamese UI | inspect core routes/dialogs | no material English/technical labels | S3 |

Stop testing immediately for S0, any real personal data, unexpected production hostname/ref, or cross-program leakage. Database RLS isolation is not considered passed by mock/local tests.
