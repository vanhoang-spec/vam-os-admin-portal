# VAM OS Public View Remediation — 2026-07-22

Production contains exactly three public views. Repository SQL is useful reconstruction evidence, but exact production definitions and catalog dependencies remain uncollected.

| View | Dependencies | Definition available | Repository source | Status |
|---|---|---|---|---|
| `v_monthly_activity_summary` | `mentoring_recaps`, `event_participations`, `seasons` (repository evidence) | Repository candidate only | migration 012 | PARTIAL |
| `v_mentee_monthly_tracking` | mentoring/application activity objects (repository evidence) | Repository candidate only | migration 031 | PARTIAL |
| `v_season_latest_closed_month` | `season_monthly_kpis`, `seasons` (repository evidence) | Repository candidate only | migration 031 | PARTIAL |

All three are application-owned and required by dashboard/operations behavior or later migrations. Exact `pg_get_viewdef` output and dependency OIDs must be collected before executable baseline DDL. No extension- or Supabase-managed views are included.
