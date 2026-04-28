from __future__ import annotations

import argparse
import csv
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row


ROOT_DIR = Path(__file__).resolve().parents[1]
RUNNER_DIR = Path(__file__).resolve().parent
REPORTS_DIR = RUNNER_DIR / "reports"

EXPECTED_COLUMNS = [
    "season_code",
    "person_id",
    "full_name",
    "email",
    "phone",
    "source_role_group",
    "operational_role",
    "functional_team",
    "team_name",
    "assigned_scope",
    "role_note",
    "source_sheet",
    "source_row",
    "match_method",
    "match_confidence",
    "notes",
]

ALLOWED_SOURCE_ROLE_GROUPS = {"coreteam", "support_team"}
ALLOWED_OPERATIONAL_ROLES = {
    "core_team",
    "ops_lead",
    "recap_steward",
    "event_steward",
    "data_quality_reviewer",
    "reviewer",
    "support_team_member",
    "event_support",
    "design_support",
    "communication_support",
    "project_coordination_support",
    "other",
}
ALLOWED_FUNCTIONAL_TEAMS = {
    "",
    "project_coordination",
    "communication_media",
    "event",
    "design",
    "other",
    "unknown",
}
ALLOWED_STATUSES = {"active", "inactive", "needs_review"}


@dataclass
class PreparedRow:
    row_number: int
    source_row: dict[str, str]
    payload: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return not self.errors

    @property
    def is_duplicate(self) -> bool:
        return any(warning.startswith("Duplicate assignment exists") for warning in self.warnings)


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def optional_text(value: Any) -> str | None:
    text = clean(value)
    return text or None


def require_uuid(value: str, field_name: str, errors: list[str]) -> str | None:
    text = clean(value)
    if not text:
        errors.append(f"{field_name} is required")
        return None
    try:
        UUID(text)
    except ValueError:
        errors.append(f"{field_name} must be a UUID")
        return None
    return text


def parse_source_row(value: str, errors: list[str]) -> int | None:
    text = clean(value)
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        errors.append("source_row must be an integer when provided")
        return None


def load_environment() -> None:
    local_env = RUNNER_DIR / ".env"
    fallback_env = ROOT_DIR / "activity_import_runner" / ".env"
    if local_env.exists():
        load_dotenv(local_env)
    elif fallback_env.exists():
        load_dotenv(fallback_env)


def connect() -> psycopg.Connection:
    load_environment()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("Missing DATABASE_URL. Create team_assignment_import_runner/.env or activity_import_runner/.env.", file=sys.stderr)
        sys.exit(1)
    return psycopg.connect(database_url, row_factory=dict_row)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        missing = [column for column in EXPECTED_COLUMNS if column not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")
        return list(reader)


def resolve_season_id(conn: psycopg.Connection, season_code: str) -> str | None:
    row = conn.execute("select id from seasons where code = %s limit 1", (season_code,)).fetchone()
    return str(row["id"]) if row else None


def person_exists(conn: psycopg.Connection, person_id: str) -> bool:
    row = conn.execute("select id from people where id = %s limit 1", (person_id,)).fetchone()
    return bool(row)


def duplicate_exists(conn: psycopg.Connection, payload: dict[str, Any]) -> bool:
    if payload["functional_team"] is None:
        row = conn.execute(
            """
            select id
            from operational_team_assignments
            where season_id = %s
              and person_id = %s
              and operational_role = %s
              and functional_team is null
            limit 1
            """,
            (payload["season_id"], payload["person_id"], payload["operational_role"]),
        ).fetchone()
    else:
        row = conn.execute(
            """
            select id
            from operational_team_assignments
            where season_id = %s
              and person_id = %s
              and operational_role = %s
              and functional_team = %s
            limit 1
            """,
            (payload["season_id"], payload["person_id"], payload["operational_role"], payload["functional_team"]),
        ).fetchone()
    return bool(row)


def prepare_row(conn: psycopg.Connection, row: dict[str, str], row_number: int) -> PreparedRow:
    prepared = PreparedRow(row_number=row_number, source_row=row)

    season_code = clean(row.get("season_code"))
    season_id = resolve_season_id(conn, season_code) if season_code else None
    if not season_code:
        prepared.errors.append("season_code is required")
    elif not season_id:
        prepared.errors.append(f"Cannot resolve season_code={season_code}")

    person_id = require_uuid(clean(row.get("person_id")), "person_id", prepared.errors)
    if person_id and not person_exists(conn, person_id):
        prepared.errors.append(f"person_id does not exist in people: {person_id}")

    source_role_group = clean(row.get("source_role_group"))
    operational_role = clean(row.get("operational_role"))
    functional_team_text = clean(row.get("functional_team"))
    status = clean(row.get("status")) or "active"

    if source_role_group not in ALLOWED_SOURCE_ROLE_GROUPS:
        prepared.errors.append(f"source_role_group must be one of: {', '.join(sorted(ALLOWED_SOURCE_ROLE_GROUPS))}")
    if operational_role not in ALLOWED_OPERATIONAL_ROLES:
        prepared.errors.append(f"operational_role must be one of: {', '.join(sorted(ALLOWED_OPERATIONAL_ROLES))}")
    if functional_team_text not in ALLOWED_FUNCTIONAL_TEAMS:
        prepared.errors.append(f"functional_team must be blank or one of: {', '.join(sorted(ALLOWED_FUNCTIONAL_TEAMS - {''}))}")
    if status not in ALLOWED_STATUSES:
        prepared.errors.append(f"status must be one of: {', '.join(sorted(ALLOWED_STATUSES))}")

    prepared.payload = {
        "season_id": season_id,
        "person_id": person_id,
        "source_role_group": source_role_group,
        "operational_role": operational_role,
        "functional_team": functional_team_text or None,
        "team_name": optional_text(row.get("team_name")),
        "assigned_scope": optional_text(row.get("assigned_scope")),
        "role_note": optional_text(row.get("role_note")),
        "status": status,
        "source_sheet": optional_text(row.get("source_sheet")),
        "source_row": parse_source_row(clean(row.get("source_row")), prepared.errors),
        "notes": optional_text(row.get("notes")),
    }

    if prepared.is_valid and duplicate_exists(conn, prepared.payload):
        prepared.warnings.append("Duplicate assignment exists for season_id + person_id + operational_role + functional_team; row will be skipped")

    return prepared


def insert_row(conn: psycopg.Connection, payload: dict[str, Any]) -> None:
    conn.execute(
        """
        insert into operational_team_assignments (
          season_id, person_id, source_role_group, operational_role,
          functional_team, team_name, assigned_scope, role_note,
          status, source_sheet, source_row, notes
        )
        values (
          %(season_id)s, %(person_id)s, %(source_role_group)s, %(operational_role)s,
          %(functional_team)s, %(team_name)s, %(assigned_scope)s, %(role_note)s,
          %(status)s, %(source_sheet)s, %(source_row)s, %(notes)s
        )
        """,
        payload,
    )


def write_reports(prepared_rows: list[PreparedRow], did_import: bool) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    valid_rows = [row for row in prepared_rows if row.is_valid]
    duplicate_rows = [row for row in valid_rows if row.is_duplicate]
    insertable_rows = [row for row in valid_rows if not row.is_duplicate]
    unresolved_rows = [row for row in prepared_rows if not row.is_valid]
    warning_rows = [row for row in prepared_rows if row.warnings]

    report_path = REPORTS_DIR / f"team_assignment_import_report_{timestamp}.md"
    report_path.write_text(
        "\n".join(
            [
                "# Team Assignment Import Report",
                "",
                f"- Mode: {'import' if did_import else 'dry-run'}",
                f"- Total rows: {len(prepared_rows)}",
                f"- Valid rows: {len(valid_rows)}",
                f"- Insertable rows: {len(insertable_rows)}",
                f"- Unresolved rows: {len(unresolved_rows)}",
                f"- Duplicate warnings: {len(duplicate_rows)}",
                f"- Rows with any warning: {len(warning_rows)}",
                f"- Inserted rows: {len(insertable_rows) if did_import else 0}",
                "",
                "## Notes",
                "",
                "- Duplicate rows are skipped; this runner never updates or deletes existing rows.",
                "- Import mode requires typing IMPORT before insertion.",
            ]
        ),
        encoding="utf-8",
    )

    if unresolved_rows:
        write_row_report(REPORTS_DIR / f"unresolved_team_assignment_rows_{timestamp}.csv", unresolved_rows, "errors")
    if warning_rows:
        write_row_report(REPORTS_DIR / f"warning_team_assignment_rows_{timestamp}.csv", warning_rows, "warnings")

    return report_path


def write_row_report(path: Path, rows: list[PreparedRow], detail_attr: str) -> None:
    columns = ["csv_row", "details", *EXPECTED_COLUMNS]
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "csv_row": row.row_number,
                    "details": "; ".join(getattr(row, detail_attr)),
                    **{column: row.source_row.get(column, "") for column in EXPECTED_COLUMNS},
                }
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Import VAM OS operational team assignments.")
    parser.add_argument("--file", required=True, help="Path to DRAFT_REVIEWED_team_assignments_v3.csv")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Validate only; do not insert rows")
    mode.add_argument("--import", dest="do_import", action="store_true", help="Insert valid non-duplicate rows after confirmation")
    args = parser.parse_args()

    csv_path = (ROOT_DIR / args.file).resolve() if not Path(args.file).is_absolute() else Path(args.file)
    source_rows = read_csv(csv_path)

    with connect() as conn:
        prepared_rows = [prepare_row(conn, row, index) for index, row in enumerate(source_rows, start=2)]
        valid_rows = [row for row in prepared_rows if row.is_valid]
        duplicate_rows = [row for row in valid_rows if row.is_duplicate]
        insertable_rows = [row for row in valid_rows if not row.is_duplicate]
        unresolved_rows = [row for row in prepared_rows if not row.is_valid]

        print(f"Total rows: {len(prepared_rows)}")
        print(f"Valid rows: {len(valid_rows)}")
        print(f"Insertable rows: {len(insertable_rows)}")
        print(f"Unresolved rows: {len(unresolved_rows)}")
        print(f"Duplicate warnings: {len(duplicate_rows)}")

        did_import = False
        if args.do_import:
            if unresolved_rows:
                print("Import blocked: unresolved rows exist. Review the generated report.", file=sys.stderr)
            else:
                confirmation = input("Type IMPORT to insert valid non-duplicate rows: ").strip()
                if confirmation != "IMPORT":
                    print("Import cancelled.")
                else:
                    for row in insertable_rows:
                        insert_row(conn, row.payload)
                    conn.commit()
                    did_import = True
                    print(f"Inserted rows: {len(insertable_rows)}")

        report_path = write_reports(prepared_rows, did_import)
        print(f"Report written: {report_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
