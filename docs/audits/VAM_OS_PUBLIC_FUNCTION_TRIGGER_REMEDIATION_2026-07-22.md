# VAM OS Public Function and Trigger Remediation — 2026-07-22

Production definitions below were captured as metadata only. They must be dependency-reviewed before inclusion. Trigger ordering is ordinary PostgreSQL name ordering for same-kind triggers unless catalog metadata demonstrates otherwise.

| Function family | Repository source | Production definition | Dependencies | Security/search path | Classification |
|---|---|---|---|---|---|
| `set_updated_at` | 012, 026–031 | Available | row tables with `updated_at` | invoker; production definition review required | SAFE TO RECONSTRUCT |
| `current_admin_role`, `is_active_admin`, `is_admin_role` | 018, 020 | Available | `admin_users`, `auth.uid()` | SECURITY DEFINER; `search_path=public` in production | NEEDS OWNER REVIEW |
| `current_admin_context`, `admin_can_access_season` | 023 | Available | admin/scope/program/season tables | SECURITY DEFINER; `search_path=public` | NEEDS OWNER REVIEW |
| operations/founder dashboard RPCs and `intel_*` helpers | 019, 022, 025, 029, 030, 032, 035 | Available | broad core/reporting graph | mixed; RPCs SECURITY DEFINER | NEEDS OWNER REVIEW |
| membership scope/log guards | 052 | Available | people/program/season/membership tables | invoker; production definition available | SAFE TO RECONSTRUCT after tables |
| `citext` operators/helpers/aggregates | extension-managed | Available but extension-owned | `citext` extension | extension ACLs | EXTENSION-MANAGED — EXCLUDE |
| regex/string overloads accepting `citext` | extension-managed | Available | `citext` extension | extension ACLs | EXTENSION-MANAGED — EXCLUDE |

All 20 public triggers in inventory are accounted for by repository sources: 16 updated-at triggers, two immutable membership-log triggers, one membership-scope validator, and the remaining updated-at trigger bindings. Their target tables must exist first. Exact trigger name ordering is retained from production names; no custom ordering is inferred.

Unresolved provenance: functions whose repository has multiple replacement versions require selecting the production-matching definition by normalized comparison; pre-012 function history, if any, remains unknown. No extension-managed function is copied into the design package.
