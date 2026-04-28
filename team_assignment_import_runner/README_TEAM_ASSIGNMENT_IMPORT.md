# VAM OS Team Assignment Import Runner

Local runner for importing reviewed V3 operational team assignments into `operational_team_assignments`.

This runner is insert-only. It does not create people, update rows, delete rows, change schema, or enable RLS.

## Setup

Install dependencies:

```bash
pip install -r team_assignment_import_runner/requirements.txt
```

Create local env file:

```bash
copy team_assignment_import_runner\.env.example team_assignment_import_runner\.env
```

Set `DATABASE_URL` in `team_assignment_import_runner/.env`.

If that file is missing, the runner falls back to `activity_import_runner/.env` when present.

## Input CSV

Default reviewed file:

```text
tracking_audit_output/team_matching_v3/DRAFT_REVIEWED_team_assignments_v3.csv
```

Expected columns:

- `season_code`
- `person_id`
- `full_name`
- `email`
- `phone`
- `source_role_group`
- `operational_role`
- `functional_team`
- `team_name`
- `assigned_scope`
- `role_note`
- `source_sheet`
- `source_row`
- `match_method`
- `match_confidence`
- `notes`

## Dry Run

```bash
python team_assignment_import_runner/import_team_assignments.py --file tracking_audit_output/team_matching_v3/DRAFT_REVIEWED_team_assignments_v3.csv --dry-run
```

Dry-run validates:

- `season_code` resolves through `seasons.code`
- `person_id` exists in `people`
- allowed values for `source_role_group`, `operational_role`, `functional_team`, and `status`
- duplicate assignment key: `season_id`, `person_id`, `operational_role`, `functional_team`

## Import

```bash
python team_assignment_import_runner/import_team_assignments.py --file tracking_audit_output/team_matching_v3/DRAFT_REVIEWED_team_assignments_v3.csv --import
```

Import mode requires typing:

```text
IMPORT
```

The runner inserts valid non-duplicate rows only. Duplicate rows are skipped with warnings. Existing rows are never updated or deleted.

## Reports

Every run writes a report to:

```text
team_assignment_import_runner/reports/
```

Possible report files:

- `team_assignment_import_report_YYYYMMDD_HHMMSS.md`
- `unresolved_team_assignment_rows_YYYYMMDD_HHMMSS.csv`
- `warning_team_assignment_rows_YYYYMMDD_HHMMSS.csv`
