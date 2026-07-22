# VAM OS Batch 5A Security and Migration Plan

Date: 2026-07-22

Status: DESIGN ONLY — NOT APPLIED. Owner authorization is required before any migration, backfill, staging mutation, or production mutation.

## 1. Canonical Context

The canonical hierarchy remains `programs -> seasons -> intake_batches`. UEH Mentoring (`UEHM`) and HAM are programs; Batch 5A does not add an organization layer. `people` remains a global identity.

The URL model is `/programs/[programCode]` with optional validated `season` code and `batch` UUID query parameters. Codes are stable, human-readable routing keys. Server resolution produces IDs for every query:

```ts
{
  selectedProgramId,
  selectedProgramCode,
  selectedSeasonId,
  selectedSeasonCode,
  selectedIntakeBatchId,
  accessMode: "global" | "program_scoped"
}
```

`lib/program-context-core.ts::resolveCanonicalContext` validates parent-child relationships and access. `lib/program-context.ts::resolveAuthorizedProgramContext` loads the catalog server-side using the service-role client, then resolves authorization before a route may load domain data. Client parameters are selectors, never authority.

Dependency table:

| File/function | Program source | Season source | Authorization source | Risk/treatment |
|---|---|---|---|---|
| `lib/program-context.ts::loadProgramContextCatalog` | `programs.id/code` | `seasons.id/code/program_id` | None; catalog load only | Must never return domain PII; resolution follows immediately |
| `resolveAuthorizedProgramContext` | Server catalog | Server catalog | `getAdminScopeContext` | Canonical entry point for program workspace |
| `lib/program-context-core.ts::resolveAccessiblePrograms` | UUID after legacy key resolution | Season grant can derive parent | Principal grants | Compatibility accepts legacy code/UUID read-only |
| `lib/program-scope.ts::getAdminScopeContext` | `admin_scope_access.program_id` text | `admin_scope_access.season_id` text | Active `admin_users` | Mixed semantic values; normalization proposed |
| `lib/data.ts` scoped readers | `ScopeFilter.allowedProgramIds` | `allowedSeasonIds` | `getScopeFilter` | Existing compatibility layer; domain routes migrate incrementally |
| `lib/season-config.ts` | Global constants | UEHM S11/S12 constants | None | Technical debt; public application unchanged in 5A |
| `lib/supabase-server.ts::getSupabaseServiceRoleClient` | Any table | Any table | Bypasses RLS | Every sensitive use needs pre-resolution and post-query assertion |
| `middleware.ts` | None | None | Supabase session + active admin row | Authentication only; not program authorization |
| `components/app-shell.tsx`, `lib/nav-model.ts` | None today | None today | UI visibility | 5A-2 switcher must consume server-resolved programs |

Canonical sources:

- Program identity: `programs.id`; `programs.code` is the routing key.
- Season identity: `seasons.id`; `seasons.code` is display/routing; `seasons.program_id` is the parent proof.
- Intake identity: `intake_batches.id`; `intake_batches.season_id` is the parent proof.
- User program access: active `admin_scope_access` grants resolved to canonical UUIDs in the application layer.
- Global access: active `admin_users.role = 'super_admin'`; null scope rows do not imply global access.

## 2. Access Matrix

| Actor | Portfolio aggregate | Program workspace | Season | Batch | PII |
|---|---|---|---|---|---|
| Super Admin | All active programs | All allowed | Any valid season | Any valid child batch | Not on portfolio; domain routes only |
| Program full-access/admin | No global portfolio | Granted program | Program grant: all child seasons; season grant: that season only | Child of allowed season | Only within domain scope |
| Operations | No global portfolio | Granted program | Allowed program/season | Allowed child batch | Operational need only |
| Reviewer | No global portfolio | Granted program | Assigned/review scope | Allowed child batch | Application/review need only |
| Read/viewer | No global portfolio | Granted program | Allowed program/season | Allowed child batch | Read-only, minimized |
| Unauthenticated | None | None | None | None | None |

Errors are structured as `unauthenticated`, `forbidden`, `not_found`, and `invalid_scope`. Cross-program direct IDs return `not_found` to avoid confirming that an entity exists elsewhere.

## 3. Existing RLS

- Migration 018 enables broad internal-role reads on core tables.
- Migration 020 enables RLS on `admin_scope_access`, readable by self or Super Admin.
- Migrations 023 and 025 disable RLS on `mentoring_recaps` and `event_participations` for compatibility.
- Migration 040/041/044a enables read policies on reviews/decisions/assignment batches.
- Migration 052 explicitly leaves membership and CRM RLS to the application layer.
- Migration 057 enables RLS and denies anonymous table reads for event links/registrations.
- Migration 059 documents a staging applications bootstrap whose RLS state may differ from production.

Repository migrations are not proof of current production policy state. Verification must be read-only and separately authorized.

## 4. Required RLS

Future RLS should derive the authenticated active admin, Super Admin role, and canonical program/season grants. At minimum review policies for:

- `intake_batches` through its season/program;
- `person_season_memberships` and append-only log;
- `mentor_program_participations`;
- `crm_notes`, especially null program/season scope;
- `applications`, answers, reviews and decisions;
- `matches`, events, registrations, participations and recaps;
- action items, correction logs and data-quality tables;
- future aggregate/export surfaces.

Service role still requires application authorization because it bypasses RLS. RLS is defense in depth, not a replacement for server guards.

## 5. Service-role Query Matrix

| Query family | Pre-query authorization | Required filter | Post-query validation |
|---|---|---|---|
| Catalog (`programs/seasons/batches`) | Authenticated principal for accessible result | Active/catalog keys | Parent relationships |
| Program aggregate | `requireGlobalAdmin` or program access | `program_id`/authorized seasons | Result contains no PII and only requested program |
| Application/review | Program + season access | `season_id`; join through application | Entity season equals context |
| People/profiles | Authorized context first | Membership/linked scoped IDs | Return only context memberships; never global profile spillover |
| Match | Season access | `season_id` | Match season equals context |
| Event/registration | Season access | Event `season_id` | Event and registration share context |
| Recap/activity/report | Season access | `season_id` | Every row belongs to selected season |
| CRM/task | Program/season access | Explicit program/season | Null-scope policy enforced; no implicit global rows |

`assertEntityBelongsToSeason` and `assertEntityBelongsToProgram` are mandatory post-query guards for direct-ID service-role reads touched by 5A and future migrations.

## 6. `admin_scope_access` Normalization

Current schema (`020_admin_scope_access_schema_alignment.sql`):

- `user_id uuid`, referring by convention to `auth.users.id`;
- `program_id text`, which may contain UUID or code;
- `season_id text`, which may contain UUID or code;
- `role text`, `status text`;
- unique active scope across coalesced text values;
- RLS select for self/Super Admin;
- application writes in `lib/admin-users.ts`.

Canonical target:

- `program_id uuid null references programs(id)`;
- `season_id uuid null references seasons(id)`;
- exactly one of program-level or season-level semantics, with season always proving its program;
- no `(null, null)` grant represents global access; global access remains `admin_users.role='super_admin'`;
- unique active `(user_id, program_id, season_id, role)` after normalization;
- application writes accept code only as lookup input, then persist UUID.

Batch 5A reads legacy values safely but does not silently rewrite them.

## 7. Proposed Migration

No executable migration is included in PR 5A-1. Proposed later migration, owner-authorized:

1. Add nullable `program_uuid` and `season_uuid` FK columns.
2. Backfill only rows that resolve uniquely by exact UUID or normalized exact code.
3. Validate season belongs to program when both exist; derive program from season when safe.
4. Quarantine ambiguous/unresolved/duplicate active grants in a review report; do not guess.
5. Update application reads/writes to UUID columns behind compatibility support.
6. Add constraints/indexes and reviewed RLS policies.
7. After at least one verified release, rename canonical columns or retire legacy text columns in a separate migration.

## 8. Backfill Plan

Before write authorization, export counts only: total/active rows, value formats, UUID matches, code matches, missing catalog matches, conflicting program-season pairs, duplicate normalized grants and null/null rows. Produce a dry-run mapping with `scope_id`, old values, proposed UUIDs and disposition. Owner approves every unresolved category. Backfill in a transaction with before/after counts and no deletes.

## 9. Rollback Plan

- Keep legacy text columns during the compatibility window.
- On application issue, switch reads back to legacy resolver; do not delete UUID data.
- Roll back policies/indexes/constraints by named objects only.
- Restore grant values from the dry-run mapping/audit table if any canonical write was incorrect.
- Never downgrade by rewriting historical application, membership, match, event or recap data.

## 10. Production Verification Queries

Run only after separate read-only owner authorization:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'admin_scope_access'
order by ordinal_position;

select status, role, count(*)
from public.admin_scope_access
group by status, role
order by status, role;

select
  count(*) filter (where program_id is null and season_id is null) as null_scope,
  count(*) filter (where program_id is not null) as program_scope,
  count(*) filter (where season_id is not null) as season_scope
from public.admin_scope_access
where status = 'active';

select schemaname, tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select s.id, s.code, s.program_id, p.code as program_code
from public.seasons s
left join public.programs p on p.id = s.program_id
order by p.code, s.code;
```

Do not select emails, names, phones, payloads or other PII for schema verification.

## 11. Required Owner Authorization

Explicit authorization is required for:

- read-only production schema/policy verification;
- creating or applying any normalization/RLS migration;
- writing a dry-run mapping table;
- backfilling scope grants;
- changing production environment variables;
- deploying a preview or production release;
- any PII export.

This document grants none of those permissions.

## 12. Remaining Risks

1. Production schema/RLS may differ from migrations.
2. Legacy scope values may contain ambiguous codes/UUIDs or null/null rows.
3. Routes still using `CURRENT_OPERATING_SEASON_CODE` remain compatibility technical debt until migrated.
4. Public application/check-in routes intentionally remain outside program workspace changes in 5A-1.
5. Global `people` requires membership-based projection to avoid cross-program PII.
6. Service-role functions outside routes touched by Batch 5A still need incremental post-query guards.
7. Portfolio aggregates and switcher/workspace belong to PR 5A-2 and must build only on this validated foundation.
