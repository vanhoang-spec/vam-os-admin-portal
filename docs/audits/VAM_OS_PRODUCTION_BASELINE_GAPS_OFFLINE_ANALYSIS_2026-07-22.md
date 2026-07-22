# VAM OS Production Baseline-Gaps Offline Analysis — 2026-07-22

Decision: **STAGING BASELINE STILL BLOCKED**.

Source: ignored local file `docs/audits/inputs/VAM_OS_PRODUCTION_BASELINE_GAPS_2026-07-22.json`, produced by the owner from confirmed production. Exact size: 180,915 bytes. JSON/version/sections passed; no truncation or PII/secret pattern hits were detected. The raw file remains uncommitted.

## Enum labels and order

| Type | Ordered labels (`enumsortorder: label`) |
|---|---|
| `application_status` | 1 accepted; 2 rejected_or_pending; 3 rejected; 4 pending; 5 withdrawn |
| `communication_channel` | 1 email; 2 zalo; 3 sms; 4 call |
| `communication_status` | 1 queued; 2 sent; 3 delivered; 4 bounced; 5 failed; 6 opened; 7 clicked |
| `event_type` | 1 orientation; 2 training; 3 company_tour; 4 networking; 5 closing; 6 business_case; 7 job_shadowing; 8 other; 9 kickoff |
| `gender_type` | 1 male; 2 female; 3 other; 4 undisclosed |
| `match_status` | 1 active; 2 dropped; 3 completed; 4 unmatched_review |
| `match_type` | 1 primary; 2 cross; 3 secondary |
| `role_status` | 1 active; 2 inactive; 3 pending; 4 pending_or_rejected |
| `role_type` | 1 mentor; 2 mentee; 3 supporter; 4 speaker; 5 partner_contact; 6 donor; 7 admin |
| `season_status` | 1 draft; 2 open; 3 running; 4 closed |

All 51 enum rows are authoritative catalog metadata. Preserve order exactly; do not infer newer application statuses from application code or migration 061.

## Views

| View | Direct public dependency | Definition length | SHA-256 prefix |
|---|---|---:|---|
| `v_mentee_monthly_tracking` | `mentoring_recaps` | 332 | `0662a3671158` |
| `v_monthly_activity_summary` | `mentoring_recaps` | 319 | `aa083aa639d4` |
| `v_season_latest_closed_month` | `season_monthly_kpis` | 964 | `42da94125165` |

All three exact definitions are recorded in the design-only view module. Create their dependency tables first. The dependency result has one catalog row per view and no external schema dependency.

## Functions

The output contains 58 functions: 13 VAM OS-owned (`owner=postgres`, not extension-managed) and 45 `citext`/compatibility routines (`owner=supabase_admin`, extension-managed). Exclude all 45 extension-managed routines from manual staging DDL; install the approved extension instead.

| VAM OS-owned function | Class | SECURITY DEFINER |
|---|---|---:|
| `admin_can_access_season(text)` | authorization | Yes |
| `current_admin_context()` | authorization/context | Yes |
| `current_admin_role()` | authorization/context | Yes |
| `get_founder_intelligence_dashboard(text)` | dashboard/reporting | Yes |
| `get_operations_dashboard_data(text)` | dashboard/reporting | Yes |
| `intel_experience_band(integer)` | reporting helper | No |
| `intel_norm(text)` | reporting helper | No |
| `intel_vam_seniority_band(integer)` | reporting helper | No |
| `is_active_admin()` | authorization | Yes |
| `is_admin_role(text[])` | authorization | Yes |
| `prevent_person_season_membership_log_mutation()` | trigger function | No |
| `set_updated_at()` | trigger function | No |
| `validate_person_season_membership_scope()` | trigger function | No |

Seven functions are SECURITY DEFINER. Their exact definitions are authoritative evidence, but their staging deployment remains gated on an owner-approved security target, controlled `search_path`, execute grants, and dependency review.

## Triggers

All 20 triggers are VAM-owned, non-extension-managed, and enabled (`tgenabled=O`).

| Function | Trigger dependencies |
|---|---|
| `set_updated_at()` | `action_items`, `admin_users`, `crm_notes`, `data_import_batches`, `data_quality_issues`, `event_links`, `event_participations`, `event_registrations`, `function_areas`, `industries`, `intake_batches`, `mentor_program_participations`, `mentoring_recaps`, `operational_team_assignments`, `person_season_memberships`, `programs`, `season_monthly_kpis` (17 triggers) |
| `prevent_person_season_membership_log_mutation()` | `person_season_membership_log`: no-delete and no-update (2 triggers) |
| `validate_person_season_membership_scope()` | `person_season_memberships` scope validation (1 trigger) |

Functions and target tables must exist before triggers. No migration-061 trigger is present.

## Comments

There are 22 comments: 19 public table comments and comments on all three views. Comments are safe, metadata-only, and last in dependency order.

## Sequence review

`sequences` is an authoritative query of public `pg_class` rows with `relkind='S'` joined to `pg_sequence`; it is empty. Therefore production has no standalone public sequences and no public sequence DDL should be generated.

The 441 `sequence_ownership` rows are not 441 sequences. Schema distribution is: `auth` 81, `storage` 15, `realtime` 11, `vault` 2, `pg_toast` 164, and `public` 168. The CTE did not join its dependency rows to `public_sequences`, so it captured general auto/internal catalog dependencies, including indexes/toast/platform objects. Exclude every row from sequence DDL. Do not infer identity sequences or ownership from this section.

Classification: the actual public sequence result is complete and empty; the ownership section name/query is imprecise. It does not block a no-sequence public baseline, but the probe should be corrected before any future run.

## Baseline reassessment

Deterministic now: enum labels/order, all three views/dependencies, VAM-vs-extension function provenance, 20 triggers, public comments, and absence of public sequences.

Still unresolved: authoritative pre-012 table creation DDL, complete table-level dependency/cycle rendering into reviewed modules, owner-approved RLS/policies/grants for seven SECURITY DEFINER functions and browser/server access, staging disposability/recovery, and executable module review. No missing DDL is fabricated.
