# VAM OS Program Isolation and Role QA Matrix — 2026-07-22

| Case | Local mocks/tests | Requires staging evidence | Expected |
|---|---:|---:|---|
| UEH admin cannot view HAM; HAM cannot view UEH | Yes | Yes | lists/details/actions all deny cross-program |
| Reviewer assigned applications only | Yes | Yes | unassigned/direct URL denied |
| Support Team operational scope only | route tests | Yes | no admin/reviewer decision routes |
| Viewer read-only | permission tests | Yes | writes absent/denied |
| Super Admin portfolio | portfolio tests | Yes | authorized cross-program overview |
| null/invalid scope | isolation tests | Yes | fail closed |
| direct URL attempts | route/unit partial | Yes | not found/denied, no data |
| server action authorization | action tests | Yes | authorization before service-role work |
| list/detail/action consistency | partial | Yes | identical scope semantics |
| KPI/list scope consistency | operations tests | Yes | same program/season/batch counts |
| selector leakage | partial | Yes | no foreign option/data leakage |

Repository evidence covers mocked authorization, navigation, service-role post-query validation and KPI context. It does **not** prove database RLS isolation. Any staging pass requires real role accounts, two-program synthetic fixtures, direct URL/action negative tests and captured redacted results.
