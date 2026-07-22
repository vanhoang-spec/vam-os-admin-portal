# Migration 061 Expected Schema Contract

Date: 2026-07-22
Source of truth: `supabase_migrations/061_design_only_recruitment_campaigns.sql`

Comparison result vocabulary: **exact match**, **semantically equivalent**, **missing**, **conflict**, **unknown**. Object names alone never prove equivalence.

| Object | Expected exact definition | Allowed equivalent | Blocking discrepancy |
|---|---|---|---|
| `recruitment_campaigns` | UUID PK; required program/season/batch/role/name/slug/status/open-close/content fields; audit timestamps | Equivalent UUID generator or check syntax with identical accepted set | Incompatible type/nullability/default, omitted business field, pre-existing unexplained data |
| Program FK | `program_id -> programs(id) ON DELETE RESTRICT` | NO ACTION if operational semantics are proven equivalent | CASCADE/SET NULL, wrong parent/type |
| Season FK | `season_id -> seasons(id) ON DELETE RESTRICT` | NO ACTION with equivalent protection | Wrong direction or destructive delete |
| Batch FK | `intake_batch_id -> intake_batches(id) ON DELETE RESTRICT` | NO ACTION with equivalent protection | Wrong scope/type/delete behavior |
| Actor FKs | created/updated by admin user, ON DELETE SET NULL | Equivalent audit-principal FK | Cascade or mandatory actor preventing retention |
| Role/status checks | mentor/mentee; draft/published/paused/closed/archived | Native enum with exactly compatible lifecycle, after separate risk review | Broader unsafe values or missing archive |
| Time/archive checks | `opens_at < closes_at`; archived status requires `archived_at` | Equivalent validated constraints | Naive timestamp or invalid boundary accepted |
| Text/capacity checks | trimmed nonblank content; positive optional capacity/deadline | Equivalent domains/checks | Blank consent/privacy or nonpositive values |
| Slug canonicalization | lowercase trimmed pattern plus unique `lower(btrim(public_slug))` | Stored generated canonical slug with same collision rules | Case/space duplicates possible |
| Scope index | program, season, batch, role, status | Index with same leading access path | Missing when query plan requires it |
| Application campaign FK | nullable UUID to campaign, ON DELETE RESTRICT | NO ACTION with equivalent retention | Destructive delete or incompatible type |
| Consent/reference columns | reference text, consent version text, consented_at timestamptz | Stricter compatible domain | Missing/incompatible timezone or nullable semantics that break legacy routes |
| Duplicate unique index | campaign + role + `lower(btrim(email_primary))`, partial on campaign and nonblank email | Generated canonical email with identical predicate/key | Global uniqueness, missing role/campaign, no trim/case fold, race not protected |
| Reference unique index | unique non-null application reference | Unique constraint with same null semantics | Duplicates allowed or blank references accepted for campaign submissions |
| Campaign/status index | campaign, status, submitted_at | Same leading columns/order usefulness | Missing if material operational regression |
| Campaign scope function | PL/pgSQL trigger; validates hierarchy, locks scope after first linked app, updates timestamp | Separate validated constraint/trigger set with identical atomic behavior | Client-trusted scope, mutable linked scope, recursion |
| Application governance function | PL/pgSQL trigger; validates nonblank email, `^VAM-[A-Z0-9]{10,12}$`, consent evidence and campaign scope | Equivalent constraints plus trigger(s), all atomic | Missing evidence/reference/scope enforcement |
| Function security | invoker security, `search_path=pg_catalog, public`, schema-qualified objects, EXECUTE revoked | Tighter search path/ACL | SECURITY DEFINER without necessity, writable search path, broad execute |
| Campaign trigger | BEFORE INSERT/UPDATE; scope lock and validation | Multiple triggers with identical timing/coverage | UPDATE path can bypass scope lock or timestamp |
| Application trigger | BEFORE INSERT or relevant column UPDATE; governance and scope | Constraints/triggers with identical coverage | Update can bypass governance |
| RLS | enabled before exposure | Forced RLS if compatible with service design | Disabled or permissive anonymous access |
| Campaign SELECT policy | authenticated active Super Admin globally; otherwise matching program/season scope | Equivalent helper-function policy proven fail-closed | UEH/HAM cross-scope visibility |
| Campaign mutation | no direct authenticated mutation policies/grants | Tighter deny | Reviewer/viewer/direct client mutation |
| Anonymous access | no direct campaign/application table privilege or policy | Tighter deny | Anonymous application SELECT or direct table write |
| Service role | only server-side after application authorization | Dedicated least-privilege backend role | Client exposure or authorization assumed from RLS bypass |
| Archive behavior | archive preserves campaigns/applications; no delete workflow | Immutable tombstone equivalent | Cascade/destructive archival |
| Scope immutability | program/season/batch immutable after first application | Equivalent database-enforced rule | UI-only or server-only guard |

## Classification rules

- **Exact match:** normalized catalog definitions match reviewed 061.
- **Semantically equivalent:** syntax/name differs but types, accepted data, concurrency, RLS and lifecycle behavior are demonstrably identical.
- **Missing:** prerequisite or target object is absent.
- **Conflict:** object exists with weaker/incompatible semantics or unsafe data.
- **Unknown:** metadata, provenance, environment identity or behavior cannot be proven.

An already-applied environment must be aligned with a new migration (normally 062). Do not rewrite migration history or edit 061 to imitate that environment.
