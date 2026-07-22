# VAM OS Staging RLS and Grants Target — 2026-07-22

Design only. **OWNER APPROVAL REQUIRED.** No policy or grant in this document is authorized for execution, and production grants are not a staging template.

| Table | RLS proposed | anon | authenticated | service_role | Server action | Owner decision |
|---|---|---|---|---|---|---|
| `programs` | Enable | None | Scoped read only | Guarded CRUD | Program scope | Approve read scope |
| `seasons` | Enable | None | Scoped read only | Guarded CRUD | Program/season scope | Approve read scope |
| `intake_batches` | Enable | None | None | Guarded CRUD | Admin workflow | Approve |
| `people` | Enable | None | No direct write; scoped read if needed | Guarded CRUD | Program/season and role | Approve PII access |
| `person_roles` | Enable | None | Scoped self/admin read only | Guarded CRUD | Program/season and role | Approve |
| `mentor_profiles` | Enable | None | Scoped self/admin read only | Guarded CRUD | Program/season and role | Approve PII access |
| `mentee_profiles` | Enable | None | Scoped self/admin read only | Guarded CRUD | Program/season and role | Approve PII access |
| `applications` | Enable | No baseline access | No direct write; scoped own/admin read if needed | Guarded workflow | Campaign/program/season | Decide intake separately |
| `application_answers` | Enable | No baseline access | No direct write; scoped own/admin read if needed | Guarded workflow | Application ownership | Decide intake separately |
| `matches` | Enable | None | Scoped participant/admin read only | Guarded workflow | Program/season and role | Approve after DDL blocker clears |
| `events` | Enable | None | Scoped read only | Guarded CRUD | Program/season and role | Approve |
| `event_links` | Enable | None | Scoped read only | Guarded CRUD | Event scope | Approve |
| `event_registrations` | Enable | None | Scoped self/admin read only | Guarded CRUD | Event/person scope | Approve |
| `event_participations` | Enable | None | Scoped self/admin read only | Guarded CRUD | Event/person scope | Approve |
| `mentoring_recaps` | Enable | None | Scoped participant/admin read only | Guarded CRUD | Match/season scope | Approve PII access |
| `season_monthly_kpis` | Enable | None | Scoped admin read only | Guarded refresh/write | Program/season scope | Approve reporting access |
| `admin_users` | Enable; consider force | None | Self row only if required | Guarded administration | Fail-closed active-admin check | Approve operator model |
| `admin_scope_access` | Enable; consider force | None | No direct access | Guarded administration | Fail-closed role/scope check | Approve operator model |
| `application_reviews` | Enable | None | Assigned reviewer/admin only | Guarded workflow | Assignment/program/season | Approve |
| `application_decisions` | Enable | None | Scoped admin read only | Guarded workflow | Program/season and role | Approve |
| `review_assignment_batches` | Enable | None | Scoped reviewer/admin read only | Guarded workflow | Program/season and role | Approve |
| `person_season_memberships` | Enable | None | Scoped self/admin read only | Guarded CRUD | Person/program/season | Approve |
| `person_season_membership_log` | Enable | None | Scoped admin read only | Guarded append | Person/program/season | Approve audit access |

`postgres` retains ownership and maintenance capabilities but is not an application actor. `service_role` bypass does not replace authorization: every server action must authenticate the actor and validate role, program, season, ownership, and operation before using privileged credentials.

### Recommended default security profile

- Deny `anon` direct access to every core table. Treat public application intake as a separate owner decision and preferably expose a narrow validated server action.
- Give `authenticated` no direct writes. Add only route-proven, row-scoped reads after tests demonstrate the need.
- Revoke unrestricted `PUBLIC` and `anon` function execution; allowlist only necessary functions for `authenticated` or guarded server use.
- Keep `admin_users` and `admin_scope_access` non-public and make all role/scope checks fail closed.
- Enable RLS table by table after policies, caller tests, and owner approval exist. Do not blindly copy production grants.
- Keep migration 061 security and objects outside this pre-061 baseline.

### Alternatives

1. Browser-direct Supabase reads: permit narrowly scoped `authenticated` SELECT policies. This reduces server traffic but increases policy complexity and data-exposure risk.
2. Server-only data plane: remove browser table access and use guarded server actions. This centralizes authorization but makes service-role handling and route tests critical.
3. Mixed intake model: expose only a validated intake endpoint while keeping all administrative and reporting tables server-only.

### Operational impact

The recommended profile may require existing browser-direct routes to move behind server actions. Tightening function grants can break dashboard RPC calls until caller identities are explicit. Enabling RLS without complete policies fails closed and can make staging appear empty; staged route-by-route smoke tests are required. Force-RLS changes owner-path behavior and needs separate compatibility confirmation.

### Owner choices required

- Select browser-direct, server-only, or mixed caller model.
- Approve the exact `authenticated` read allowlist and whether public intake is permitted.
- Approve RLS versus forced RLS for privileged tables.
- Approve the seven SECURITY DEFINER functions, safe search paths, and EXECUTE allowlists documented in the companion decision report.
- Approve staging operator roles and the order for applying and smoke-testing policies and grants.

No security SQL has been applied or authorized.
