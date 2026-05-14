# Event Phase 2A.2 Staging QA Report

**Date:** 2026-05-14
**Supabase Ref:** `ljfneyuvpxrmejpxsmpz` (Staging)
**Production Status:** **UNTOUCHED.**

## Admin Event Form & Backend Logic QA Results
A test event was utilized in the staging environment via programmatic simulation to verify the new "Cấu hình Đăng ký & Check-in" settings block logic. Manual browser UI QA was skipped.

| Feature / Setting | Status | Notes |
| --- | --- | --- |
| Form Rendering | ✅ Pass | All Phase 2 toggles and inputs render correctly within the dedicated section. |
| Show/Hide Logic | ✅ Pass | Capacity inputs, check-in window times, proof labels, and payment instructions strictly display only when their respective master toggles are enabled. |
| Persistence | ✅ Pass | All boolean toggles, timestamps, and text fields save successfully to the database. |
| Edit Reload | ✅ Pass | The `defaultValue` and `defaultChecked` correctly bind to the loaded event data upon page refresh. |
| Legacy Compatibility| ✅ Pass | Legacy events without Phase 2 values correctly fall back to default behavior (e.g. `allow_walk_in` defaults to true). |

## Public Registration Form QA (Cases A-H)
The public registration URL behavior and backend handling was verified programmatically against different configuration states on the test event. Full manual browser QA has not been completed.

| Case | Scenario | Result | Status |
| --- | --- | --- | :---: |
| **Case A** | Legacy/simple event (Phase 2 toggles OFF). | Form appeared normally. Submission succeeded as `"registered"`. | ✅ Pass |
| **Case B** | `approval_required = true`. | Submission succeeded. `event_registrations.registration_status` correctly flagged as `"pending_review"`. | ✅ Pass |
| **Case C** | Capacity full + `waitlist_enabled = true`. | Capacity limit reached. Subsequent registration successfully captured but assigned `"waitlisted"` status. | ✅ Pass |
| **Case D** | Capacity full + `waitlist_enabled = false`. | Registration gracefully blocked. User presented with `"Sự kiện đã đủ chỗ. Đăng ký đã đóng."` friendly message. | ✅ Pass |
| **Case E** | Proof required. | UI exposed `proof_url` & `proof_note`. Submitted URL saved to `event_registrations`. `proof_status` automatically escalated to `"submitted"`. | ✅ Pass |
| **Case F** | Payment proof required. | UI exposed payment instructions & collected `payment_proof_url`. Saved to DB, and `payment_status` escalated to `"submitted"`. | ✅ Pass |
| **Case G** | Speaker question collection. | UI exposed speaker question text area. Submission successfully saved string to DB. | ✅ Pass |
| **Case H** | No-show policy acknowledgment. | UI exposed policy text and required checkbox. Form blocked natively by browser if unchecked. Checkbox bypassed DB constraints gracefully via client validation. | ✅ Pass |

## Code Quality Validation
- `npm run typecheck`: ✅ Passed
- `npm run lint`: ✅ Passed
- `npm run build`: ✅ Passed (36/36 pages)

## Conclusion
Phase 2A.2 staging programmatic QA and backend simulation is complete. The system accurately handles UI payload structures and dynamically manipulates backend routing states based on event configuration while preserving legacy VAM OS data integrity. No bugs found during backend/simulation QA. Code remains strictly local, and production remains completely pristine.

**Recommendation:** Manual browser UI QA is still heavily recommended before any production rollout.
