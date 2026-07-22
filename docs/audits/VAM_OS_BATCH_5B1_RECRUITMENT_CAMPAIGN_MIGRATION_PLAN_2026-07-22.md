# VAM OS Batch 5B-1 Recruitment Campaign Migration Plan

Date: 2026-07-22

**DESIGN ONLY — NOT APPLIED — OWNER AUTHORIZATION REQUIRED**

No migration, seed, backfill, staging write or production mutation was performed in Batch 5B-1A.

## 1. Existing Workflow Map

| Step | Current route/action | Table | Guard | Status | Gap |
|---|---|---|---|---|---|
| Public mentee entry | `/apply/mentee?token=...` | None | Global feature flag + shared token | Partial | Fixed global S12/batch; no campaign |
| Public mentor entry | `/apply/mentor?token=...` | None | Global feature flag + shared token | Partial | Same limitation; separate page logic |
| Form submit | `app/actions/apply.ts` | `applications` | Server action + service role | Partial | Trust target constants, not campaign; no rate limit |
| Context lookup | `submitPilotApplication` | `seasons`, `intake_batches` | Code lookup | Partial | No program proof in submission model |
| Duplicate precheck | `submitPilotApplication` | `applications` | Same batch/role/email query | Partial | Non-unique index; race can duplicate |
| Confirmation | `/apply/thanks` | None | Public | Partial | No reference or campaign context |
| Admin queue | `/applications`, `/admin/applications` | `applications` | Auth + scoped loaders | Substantial | No campaign filter/dashboard |
| Review | `/reviews/**` | reviews/applications | Reviewer/admin and scope guards | Substantial | Reusable after campaign linkage |
| Decision/approval | application actions | applications/profiles/audit | Role/scope guards | Partial | Confirmation deferred to 5B-2 |

Reusable assets: mentor/mentee form components, form primitives, Vietnamese field validation, application pipeline statuses, review routes, canonical program context and event public-token server patterns. Legacy routes remain operational until a campaign exists and an explicit compatibility mapping is approved.

## 2. Proposed Entity

`recruitment_campaigns` owns immutable scope and public governance:

- `program_id`, `season_id`, `intake_batch_id`;
- `applicant_role` (`mentor` or `mentee`);
- name and opaque public slug;
- stored lifecycle status;
- `opens_at`, `closes_at`, canonical `Asia/Ho_Chi_Minh` timezone;
- capacity target and interview policy;
- later confirmation deadline;
- eligibility, privacy notice, consent version and success message;
- creator/updater/archive audit timestamps.

`applications` gains nullable additive linkage for compatibility: `recruitment_campaign_id`, opaque `application_reference`, `consent_version`, and `consented_at`. Season 11 and existing pilot rows remain unchanged.

## 3. Status Model

Stored statuses: `draft`, `published`, `paused`, `closed`, `archived`.

Effective statuses are derived:

- draft: never public;
- scheduled: published and current instant is before `opens_at`;
- open: published and `opens_at <= now < closes_at`;
- paused: not accepting submissions regardless of time;
- closed: manual closed or `now >= closes_at`;
- archived: historical and hidden from public lookup.

Timestamps are `timestamptz`. UI uses `Asia/Ho_Chi_Minh`; no naive timestamp comparison is allowed. Opening is inclusive and closing is exclusive.

## 4. Constraints and Integrity

- Trigger proves season belongs to program and batch belongs to season.
- Slug is lowercase, normalized and case-insensitively unique.
- Open time must precede close time.
- Role and stored statuses are constrained.
- Capacity and confirmation days are positive when present.
- Application trigger proves campaign season/batch/role match submitted row.
- Unique campaign/role/canonical-email index is the race-safe duplicate guard.
- Application reference is unique.
- Campaign FK uses `ON DELETE RESTRICT`; campaign with applications cannot be deleted.
- Runtime additionally disables scope edits after the first application and uses close/archive instead of delete.

One intake batch may have multiple campaigns when role or recruitment wave differs. Slug remains globally unique; duplicate identity semantics are campaign-specific.

## 5. Duplicate Policy

1. Same canonical email + campaign + role: block and return existing opaque reference when policy allows.
2. Same email + different campaign in the same season/role: require review; do not silently insert.
3. Previous season: allowed; global person may be linked later without copying the old application.
4. Different mentor/mentee role: allowed unless owner later sets a campaign rule.
5. Different program: independent application; never expose the other program record.
6. Database unique index is authoritative under concurrent submits; precheck only improves UX.

## 6. Access Matrix

| Actor | List/detail | Create/edit | Pause/resume/close/archive | Public submit |
|---|---|---|---|---|
| Super Admin | All programs | All programs | All programs | Not applicable |
| Program operations/full access | Granted program/season | Granted program/season | Granted program/season | Not applicable |
| Reviewer | Read-only if granted | No | No | Same as public if independently applying |
| Viewer | Read-only if granted | No | No | Same as public |
| Anonymous | No admin table read | No | No | Guarded server action only while open |

Service-role calls must resolve the slug, verify effective status, build scope exclusively from the campaign row and perform post-insert scope assertion. Client hidden inputs are never authority.

## 7. RLS Design

- Enable RLS on `recruitment_campaigns`.
- Authenticated admin read is defense in depth; program scoping remains in server loaders while legacy grants use mixed code/UUID values.
- No anonymous campaign table SELECT policy: invalid, draft and archived slugs all resolve to the same safe not-found result through server code.
- No anonymous application INSERT or SELECT policy.
- Public submit uses a server action/API with service role only after campaign validation.
- Program-scoped write authorization must be checked before every service-role admin mutation.
- A later migration should replace broad authenticated read with FK-backed program RLS after `admin_scope_access` normalization.

## 8. Threat Matrix

| Risk | Current control | Required control | Test |
|---|---|---|---|
| Submit to closed campaign | Global feature flag only | Effective status check in server action | Boundary/paused/closed tests |
| Wrong program/season/batch | Fixed constants | Campaign FK trigger + trusted server projection | Cross-scope and tamper tests |
| Hidden-field override | Server action parses form | Ignore scope/role fields; bind campaign row | Trusted-scope test |
| Duplicate race | Precheck + non-unique index | Unique campaign/email/role index | Duplicate classification + DB integration later |
| Read another application | No public read surface | No anon SELECT; opaque reference not lookup credential | PII/count-only tests |
| Enumerate draft slug | Shared token gate | Uniform not-found for invalid/draft/archive | Public resolution tests |
| Service-role bypass | Application code | Access before query and post-query scope assertion | Access matrix tests |
| Spam/rate abuse | None evident | Edge/IP rate limit, honeypot, body limit, optional Turnstile after owner decision | 5B-1B integration tests |
| Consent dispute | Boolean only | Version + timestamp + displayed notice snapshot/version | Validation and submit tests |

## 9. Preflight Queries

Run only after explicit staging authorization:

```sql
select to_regclass('public.recruitment_campaigns') as existing_campaign_table;
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'applications'
order by ordinal_position;
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid in ('public.seasons'::regclass, 'public.intake_batches'::regclass, 'public.applications'::regclass);
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'applications';
select count(*) as existing_rows from public.applications;
```

No PII should be selected for preflight.

## 10. Backfill and Duplicate Reconciliation

No automatic backfill is proposed. Existing S11 and pilot S12 applications keep a null campaign link. If owner later maps existing S12 pilot rows, first produce a count-only dry run grouped by season/batch/role and duplicate bucket. Ambiguous rows remain null. Never invent consent version or campaign linkage for historical rows.

Before adding the unique index in an environment containing campaign-linked rows, verify duplicate groups. The initial migration is expected to run before runtime creates any campaign-linked applications, so the result should be zero.

## 11. Post-migration Verification

```sql
select to_regclass('public.recruitment_campaigns');
select column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'public' and table_name in ('recruitment_campaigns','applications')
order by table_name, ordinal_position;
select policyname, cmd, roles, qual from pg_policies
where schemaname = 'public' and tablename = 'recruitment_campaigns';
select count(*) from public.recruitment_campaigns;
select count(*) from public.applications where recruitment_campaign_id is not null;
```

Expected immediately after migration: both final counts are zero unless separately authorized staging fixtures are created.

## 12. Rollback

Rollback script: `docs/audits/sql/VAM_OS_BATCH_5B1_RECRUITMENT_CAMPAIGN_ROLLBACK.sql`.

It aborts when any campaign-backed application exists. After runtime use, preserve records and perform a forward repair; do not drop historical linkage. Before runtime use, rollback removes triggers/indexes/additive columns and the empty campaign table transactionally.

## 13. Lock and Operational Risk

- `ALTER TABLE applications ADD COLUMN` takes a short metadata lock; nullable columns avoid table rewrite on supported PostgreSQL versions.
- Building unique indexes may scan applications and should be timed on staging/production size.
- Trigger installation is low duration but affects subsequent writes.
- Enabling RLS changes access semantics and requires staging tests with actual roles.
- Estimated risk: medium/high because `applications` is production-active and schema/RLS parity has historical differences.

## 14. Authorization Commands

These phrases are documentation, not authorization granted in this batch:

- Staging: `AUTHORIZE STAGING BATCH 5B1 RECRUITMENT CAMPAIGN MIGRATION 061`
- Production: `AUTHORIZE PRODUCTION BATCH 5B1 RECRUITMENT CAMPAIGN MIGRATION 061`

Production authorization must follow staging migration, role tests, public submit tests, rollback rehearsal and owner review.

## 15. Delivery Boundary

PR 5B-1A may merge domain code, tests and this migration package without executing it. PR 5B-1B admin/public runtime must not be enabled against an environment where migration 061 is absent. No email/notification provider is included. Acceptance confirmation remains Batch 5B-2.
