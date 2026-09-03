# S12 Recruitment UAT Matrix

Status: test cases being derived

| Area | Scenario | Expected result | Evidence | Status |
|---|---|---|---|---|
| Profile review | Required count is 1 for S12 stage | One qualifying completed review satisfies the stage gate | Migration/source tests | Automated pass; staging pending |
| Profile review | Additional reviewer assigned | Extra assignment is accepted without changing minimum | Unique index + no maximum rule | Automated pass; staging pending |
| Access | Named participant receives Reviewer only | Reviewer routes/actions allowed; Interviewer/admin actions denied | Pending | Pending |
| Access | Named participant receives Interviewer only | Interview routes/actions allowed; unrelated privileges denied | Pending | Pending |
| Access | Non-participant has no recruitment role | Recruitment actions denied | Pending | Pending |
| Interview isolation | Reviewer B lists/searches A assignment | No row or contact/application payload returned | `wp1b-pii-isolation`, M090 boundary tests | Automated pass; browser pending |
| Interview isolation | Reviewer B opens A review ID | Server lookup constrained to B; not found | Existing data accessor + M090 boundary | Automated/source pass; browser pending |
| Cancel/reassign | A reassigned to B with reason | A row cancelled and preserved; clean B row; audit event written | M090 migration tests | Automated/source pass; staging DB pending |
| Lifecycle | Required interview submitted | Application becomes `ready_for_final_decision` | M090 migration tests | Automated/source pass; staging DB pending |
| Bulk decision | All rows lifecycle eligible | Successful decision transition with audit evidence | `m090-application-decisions` | Automated pass; staging pending |
| Bulk decision | Mixed eligible/ineligible rows | Eligible rows apply; ineligible rows blocked without gate bypass | `m090-application-decisions` | Automated pass; staging pending |
| Bulk decision | Eligibility changes after page load | Required expected status prevents stale bypass | M090 migration tests | Automated pass; staging pending |
