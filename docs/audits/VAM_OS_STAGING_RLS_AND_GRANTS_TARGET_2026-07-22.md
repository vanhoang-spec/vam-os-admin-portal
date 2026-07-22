# VAM OS Staging RLS and Grants Target — 2026-07-22

Proposed design only; owner security approval is required. Production-wide grants are not a template.

| Table group | RLS target | anon | authenticated | service_role | App-layer access |
|---|---|---|---|---|---|
| `admin_users`, `admin_scope_access`, audit/governance | Enabled/forced where compatible | None | No direct writes; scoped self/admin reads only | Required operations only | Guarded server actions with fail-closed role/scope checks |
| people/profile/role/membership | Enabled | None | No direct writes; narrowly scoped read only if approved | Guarded CRUD | Server authorization by program and season |
| applications, answers, reviews, decisions | Enabled | No read/write in baseline | No direct writes | Guarded workflow only | Server actions enforce campaign/program/season and role |
| seasons/programs/taxonomy/intake | Enabled | None by default | Authenticated read only if explicitly approved | Guarded mutation | Scoped server reads/writes |
| events/registrations/activity/matches/feedback/communications | Enabled | None in baseline | No direct writes | Guarded workflow only | Scoped operational routes |
| import/staging helpers | Enabled or inaccessible | None | None | Import job only | Never browser-accessible |

`postgres` retains owner/maintenance capability and is not an application actor. `service_role` bypass does not replace application authorization: server code must validate authenticated actor, role, program, season, and requested operation before using it. Legacy routes remain server-side and must pass regression tests before tightening grants.

Owner decisions required: whether any authenticated direct read is needed; exact policies per route; whether to force RLS on owner paths; service-role function execute allowlist; staging operator roles. Migration 061 policies and grants remain a separate approval and are not included here.
