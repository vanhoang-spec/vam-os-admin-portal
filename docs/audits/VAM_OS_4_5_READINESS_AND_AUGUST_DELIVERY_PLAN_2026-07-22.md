# VAM OS 4.5 Readiness and August Delivery Plan — 2026-07-22

Evidence date: 22 July 2026. Current defensible readiness: **4.2/5**. This is repository/demo readiness, not production-launch authorization.

| Gate | Current status | Evidence | Blocker | Required action | Owner/Codex | Deadline |
|---|---|---|---|---|---|---|
| Code quality/tests | READY | 522 baseline tests; lint/type/build pass | None known | Preserve regression gate | Codex | 6 Aug |
| Accessibility implementation | READY WITH LIMITATIONS | semantic/focus tests and UI audit | manual device QA absent | Execute QA matrix | Owner | 5 Aug |
| Manual accessibility QA | NOT STARTED | No signed matrix | devices/testers | Run and record | Owner | 5 Aug |
| Multi-program isolation | READY WITH LIMITATIONS | scope unit tests | database/RLS not staging-proven | mock UAT now; staging later | Both | 2 Aug |
| Role-based access | READY WITH LIMITATIONS | permission/nav/action tests | real accounts unverified | prepare synthetic accounts | Owner | 26 Jul |
| Staging environment | BLOCKED | baseline gate closed | missing metadata/security authorization | run read-only probe; decide baseline | Owner | 24 Jul |
| Recruitment campaign domain | BLOCKED | design/tests and migration 061 exist | migration 061 unauthorized | present roadmap only | Owner | post-demo |
| Application workflow | READY WITH LIMITATIONS | list/review/decision tests | live synthetic dataset unavailable | preview/local fixture | Both | 26 Jul |
| Matching/events | READY WITH LIMITATIONS | workflow/event tests | seeded target unauthorized | authorized synthetic target or screenshots | Owner | 26 Jul |
| Support Team UAT | OWNER ACTION REQUIRED | UAT pack prepared | URL/accounts/target not confirmed | configure safe environment | Owner | 26 Jul |
| Core Team demo | READY WITH LIMITATIONS | scripted walkthrough/fallback | rehearsal/data/target pending | two rehearsals and freeze | Both | 7 Aug |
| Deployment/rollback | READY WITH LIMITATIONS | build and deployment docs | preview pin/rollback not verified | owner verify Vercel | Owner | 6 Aug |
| Production safety | READY | no DB/deploy action; gates explicit | production rollout intentionally excluded | retain prohibitions | Both | ongoing |

## Critical path

- 22–24 July: accept the read-only metadata probe, choose preview/local target, and prepare UAT accounts/data without writes.
- 25–26 July: owner proves target ref, separately authorizes any staging fixture, verifies login/routes, and publishes test URL.
- 27 July–2 August: limited synthetic UAT, daily triage, immediate S0/S1 containment.
- 3–5 August: regression, manual accessibility/isolation QA, demo rehearsal.
- 6–7 August: feature freeze, pin preview commit, verify accounts/routes, rehearse fallback.
- 8 August: synthetic-only Core Team demo.

Minimum UAT: safe non-production target, synthetic data, support account, route/access smoke test, bug intake, no cross-program leak. Minimum demo: pinned working build, coherent synthetic journey, verified accounts, fallback assets, no claim that migration 061 is live. Post-demo: executable baseline, migration 061 staging validation, full RLS evidence, automation/notifications. Production launch additionally requires security approval, migration/rollback rehearsal, production QA, owner authorization and monitoring; demo success does not satisfy these gates.
