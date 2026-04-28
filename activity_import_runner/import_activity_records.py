from __future__ import annotations

import argparse
import csv
import json
import os
import re
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

RECAP_COLUMNS = [
    "season_code",
    "mentee_email",
    "mentee_code",
    "mentor_email",
    "mentor_code",
    "match_id",
    "meeting_date",
    "meeting_month",
    "recap_url",
    "recap_source",
    "recap_note",
    "issue_flag",
    "admin_notes",
]

EVENT_COLUMNS = [
    "season_code",
    "event_code",
    "event_name",
    "event_date",
    "person_email",
    "person_code",
    "role_at_event",
    "registration_status",
    "attendance_status",
    "recap_url",
    "excuse_reason",
    "admin_notes",
]

ALLOWED_RECAP_SOURCES = {"facebook_group", "google_sheet", "admin_input"}
ALLOWED_ISSUE_FLAGS = {"true", "false"}
ALLOWED_REGISTRATION_STATUSES = {"registered", "unknown"}
ALLOWED_ATTENDANCE_STATUSES = {"attended", "registered_absent"}
ALLOWED_EVENT_ROLES = {"mentor", "mentee", "core_team", "speaker", "trainer", "guest", "unknown"}
PHASE_2_EVENT_NAMES = {"Mentee Orientation", "Kickoff", "Tổng kết"}
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
SEASON_LOOKUP_COLUMNS = ["code", "season_code", "slug", "name"]


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


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def optional_text(value: Any) -> str | None:
    text = clean(value)
    return text or None


def parse_bool(value: str) -> bool | None:
    text = clean(value).lower()
    if text == "true":
        return True
    if text == "false":
        return False
    return None


def is_uuid(value: str) -> bool:
    try:
        UUID(clean(value))
        return True
    except ValueError:
        return False


def require_date(value: str, field_name: str, errors: list[str]) -> str | None:
    text = clean(value)
    if not text:
        errors.append(f"{field_name} is required")
        return None
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        errors.append(f"{field_name} must use YYYY-MM-DD format")
        return None
    return text


def read_csv(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        rows = [dict(row) for row in reader]
        return rows, reader.fieldnames or []


def validate_columns(found: list[str], expected: list[str]) -> list[str]:
    missing = [column for column in expected if column not in found]
    extra = [column for column in found if column not in expected]
    issues = []
    if missing:
        issues.append(f"Missing columns: {', '.join(missing)}")
    if extra:
        issues.append(f"Extra columns will be ignored: {', '.join(extra)}")
    return issues


def fetch_one_value(conn: psycopg.Connection, query: str, params: tuple[Any, ...]) -> Any:
    with conn.cursor() as cur:
        cur.execute(query, params)
        row = cur.fetchone()
        if not row:
            return None
        return next(iter(row.values()))


def get_existing_columns(conn: psycopg.Connection, table_name: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = %s
            """,
            (table_name,),
        )
        return {row["column_name"] for row in cur.fetchall()}


def resolve_season_id(conn: psycopg.Connection, season_code: str, warnings: list[str]) -> str | None:
    if not season_code:
        return None

    existing_columns = get_existing_columns(conn, "seasons")
    checked_columns = [column for column in SEASON_LOOKUP_COLUMNS if column in existing_columns]
    for column in checked_columns:
        season_id = fetch_one_value(
            conn,
            f"select id from seasons where {column} = %s limit 1",
            (season_code,),
        )
        if season_id:
            return season_id

    if checked_columns:
        warnings.append(
            f"Cannot resolve season for season_code={season_code}. "
            f"Checked seasons columns: {', '.join(checked_columns)}"
        )
    else:
        warnings.append(
            f"Cannot resolve season for season_code={season_code}. "
            "Checked seasons columns: none of code, season_code, slug, name exist"
        )
    return None


def resolve_mentee_person_id(conn: psycopg.Connection, mentee_code: str, mentee_email: str) -> str | None:
    if mentee_code:
        person_id = fetch_one_value(
            conn,
            "select person_id from mentee_profiles where mentee_code = %s limit 1",
            (mentee_code,),
        )
        if person_id:
            return person_id
    if mentee_email:
        return fetch_one_value(
            conn,
            "select id from people where lower(email_primary) = lower(%s) limit 1",
            (mentee_email,),
        )
    return None


def resolve_mentor_person_id(conn: psycopg.Connection, mentor_code: str, mentor_email: str) -> str | None:
    if mentor_code:
        person_id = fetch_one_value(
            conn,
            "select person_id from mentor_profiles where mentor_code = %s limit 1",
            (mentor_code,),
        )
        if person_id:
            return person_id
    if mentor_email:
        return fetch_one_value(
            conn,
            "select id from people where lower(email_primary) = lower(%s) limit 1",
            (mentor_email,),
        )
    return None


def resolve_person_id(conn: psycopg.Connection, person_code: str, person_email: str) -> str | None:
    if person_code:
        person_id = fetch_one_value(
            conn,
            "select person_id from mentor_profiles where mentor_code = %s limit 1",
            (person_code,),
        )
        if person_id:
            return person_id
        person_id = fetch_one_value(
            conn,
            "select person_id from mentee_profiles where mentee_code = %s limit 1",
            (person_code,),
        )
        if person_id:
            return person_id
    if person_email:
        return fetch_one_value(
            conn,
            "select id from people where lower(email_primary) = lower(%s) limit 1",
            (person_email,),
        )
    return None


def resolve_match_id(
    conn: psycopg.Connection,
    provided_match_id: str,
    mentor_person_id: str | None,
    mentee_person_id: str | None,
    warnings: list[str],
) -> str | None:
    if provided_match_id:
        if not is_uuid(provided_match_id):
            warnings.append(f"match_id is not a valid UUID: {provided_match_id}")
        else:
            match_id = fetch_one_value(conn, "select id from matches where id = %s limit 1", (provided_match_id,))
            if match_id:
                return match_id
            warnings.append(f"match_id not found: {provided_match_id}")

    if mentor_person_id and mentee_person_id:
        return fetch_one_value(
            conn,
            """
            select id
            from matches
            where mentor_person_id = %s
              and mentee_person_id = %s
              and status = 'active'
            limit 1
            """,
            (mentor_person_id, mentee_person_id),
        )
    return None


def resolve_event_id(
    conn: psycopg.Connection,
    event_code: str,
    event_name: str,
    event_date: str,
    warnings: list[str],
) -> str | None:
    if event_code:
        event_id = fetch_one_value(conn, "select id from events where event_code = %s limit 1", (event_code,))
        if event_id:
            return event_id
        warnings.append(f"event_code not found: {event_code}")

    if event_name and event_date:
        return fetch_one_value(
            conn,
            "select id from events where event_name = %s and event_date = %s limit 1",
            (event_name, event_date),
        )
    return None


def recap_duplicate_exists(conn: psycopg.Connection, mentee_person_id: str | None, meeting_date: str, recap_url: str) -> bool:
    if not mentee_person_id or not meeting_date or not recap_url:
        return False
    duplicate_id = fetch_one_value(
        conn,
        """
        select id
        from mentoring_recaps
        where mentee_person_id = %s
          and meeting_date = %s
          and recap_url = %s
        limit 1
        """,
        (mentee_person_id, meeting_date, recap_url),
    )
    return bool(duplicate_id)


def event_duplicate_exists(conn: psycopg.Connection, event_id: str | None, person_id: str | None) -> bool:
    if not event_id or not person_id:
        return False
    duplicate_id = fetch_one_value(
        conn,
        """
        select id
        from event_participations
        where event_id = %s
          and person_id = %s
        limit 1
        """,
        (event_id, person_id),
    )
    return bool(duplicate_id)


def prepare_recap_row(conn: psycopg.Connection, row: dict[str, str], row_number: int) -> PreparedRow:
    prepared = PreparedRow(row_number=row_number, source_row=row)

    season_code = clean(row.get("season_code"))
    mentee_email = clean(row.get("mentee_email"))
    mentee_code = clean(row.get("mentee_code"))
    mentor_email = clean(row.get("mentor_email"))
    mentor_code = clean(row.get("mentor_code"))
    provided_match_id = clean(row.get("match_id"))
    meeting_month = clean(row.get("meeting_month"))
    recap_url = clean(row.get("recap_url"))
    recap_source = clean(row.get("recap_source")) or "facebook_group"
    issue_flag_text = clean(row.get("issue_flag")) or "false"

    meeting_date = require_date(clean(row.get("meeting_date")), "meeting_date", prepared.errors)
    if not meeting_month:
        prepared.errors.append("meeting_month is required")
    elif not MONTH_RE.match(meeting_month):
        prepared.errors.append("meeting_month must use YYYY-MM format")
    if not recap_url:
        prepared.errors.append("recap_url is required")
    if recap_source not in ALLOWED_RECAP_SOURCES:
        prepared.errors.append(f"recap_source must be one of: {', '.join(sorted(ALLOWED_RECAP_SOURCES))}")
    if issue_flag_text.lower() not in ALLOWED_ISSUE_FLAGS:
        prepared.errors.append("issue_flag must be true or false")

    season_id = resolve_season_id(conn, season_code, prepared.warnings)
    mentee_person_id = resolve_mentee_person_id(conn, mentee_code, mentee_email)
    mentor_person_id = resolve_mentor_person_id(conn, mentor_code, mentor_email)
    if not mentee_person_id:
        prepared.errors.append("Could not resolve mentee_person_id from mentee_code or mentee_email")
    if not mentor_person_id:
        prepared.errors.append("Could not resolve mentor_person_id from mentor_code or mentor_email")

    match_id = resolve_match_id(conn, provided_match_id, mentor_person_id, mentee_person_id, prepared.warnings)
    if not match_id:
        prepared.warnings.append("No active match_id resolved; row can still be inserted with match_id empty")

    if meeting_date and recap_duplicate_exists(conn, mentee_person_id, meeting_date, recap_url):
        prepared.warnings.append("Duplicate-looking recap exists for same mentee_person_id + meeting_date + recap_url")

    prepared.payload = {
        "season_id": season_id,
        "match_id": match_id,
        "mentor_person_id": mentor_person_id,
        "mentee_person_id": mentee_person_id,
        "meeting_date": meeting_date,
        "meeting_month": meeting_month,
        "recap_url": recap_url,
        "recap_source": recap_source,
        "recap_note": optional_text(row.get("recap_note")),
        "issue_flag": parse_bool(issue_flag_text) or False,
        "status": "submitted",
        "admin_notes": optional_text(row.get("admin_notes")),
    }
    return prepared


def prepare_event_row(conn: psycopg.Connection, row: dict[str, str], row_number: int) -> PreparedRow:
    prepared = PreparedRow(row_number=row_number, source_row=row)

    season_code = clean(row.get("season_code"))
    event_code = clean(row.get("event_code"))
    event_name = clean(row.get("event_name"))
    person_email = clean(row.get("person_email"))
    person_code = clean(row.get("person_code"))
    role_at_event = clean(row.get("role_at_event")) or "unknown"
    registration_status = clean(row.get("registration_status")) or "registered"
    attendance_status = clean(row.get("attendance_status")) or "registered_absent"

    event_date = require_date(clean(row.get("event_date")), "event_date", prepared.errors)
    if not event_code and not event_name:
        prepared.errors.append("event_name is required when event_code is missing")
    if not person_email and not person_code:
        prepared.errors.append("person_email or person_code is required")
    if registration_status not in ALLOWED_REGISTRATION_STATUSES:
        prepared.errors.append(f"registration_status must be one of: {', '.join(sorted(ALLOWED_REGISTRATION_STATUSES))}")
    if attendance_status not in ALLOWED_ATTENDANCE_STATUSES:
        prepared.errors.append(f"attendance_status must be one of: {', '.join(sorted(ALLOWED_ATTENDANCE_STATUSES))}")
    if role_at_event not in ALLOWED_EVENT_ROLES:
        prepared.errors.append(f"role_at_event must be one of: {', '.join(sorted(ALLOWED_EVENT_ROLES))}")
    if event_name and event_name not in PHASE_2_EVENT_NAMES:
        prepared.warnings.append(f"event_name is outside Phase 2 scope: {event_name}")

    season_id = resolve_season_id(conn, season_code, prepared.warnings)
    event_id = resolve_event_id(conn, event_code, event_name, event_date or "", prepared.warnings)
    person_id = resolve_person_id(conn, person_code, person_email)
    if not event_id:
        prepared.errors.append("Could not resolve event_id from event_code or event_name + event_date")
    if not person_id:
        prepared.errors.append("Could not resolve person_id from person_code or person_email")

    if event_duplicate_exists(conn, event_id, person_id):
        prepared.warnings.append("Duplicate-looking event participation exists for same event_id + person_id")

    prepared.payload = {
        "event_id": event_id,
        "season_id": season_id,
        "person_id": person_id,
        "role_at_event": role_at_event,
        "registration_status": registration_status,
        "attendance_status": attendance_status,
        "attendance_date": event_date,
        "recap_url": optional_text(row.get("recap_url")),
        "excuse_reason": optional_text(row.get("excuse_reason")),
        "admin_notes": optional_text(row.get("admin_notes")),
    }
    return prepared


def insert_recap(conn: psycopg.Connection, payload: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into mentoring_recaps (
              season_id, match_id, mentor_person_id, mentee_person_id,
              meeting_date, meeting_month, recap_url, recap_source,
              recap_note, issue_flag, status, admin_notes
            )
            values (
              %(season_id)s, %(match_id)s, %(mentor_person_id)s, %(mentee_person_id)s,
              %(meeting_date)s, %(meeting_month)s, %(recap_url)s, %(recap_source)s,
              %(recap_note)s, %(issue_flag)s, %(status)s, %(admin_notes)s
            )
            """,
            payload,
        )


def insert_event_participation(conn: psycopg.Connection, payload: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into event_participations (
              event_id, season_id, person_id, role_at_event,
              registration_status, attendance_status, attendance_date,
              recap_url, excuse_reason, admin_notes
            )
            values (
              %(event_id)s, %(season_id)s, %(person_id)s, %(role_at_event)s,
              %(registration_status)s, %(attendance_status)s, %(attendance_date)s,
              %(recap_url)s, %(excuse_reason)s, %(admin_notes)s
            )
            """,
            payload,
        )


def write_reports(import_type: str, mode: str, rows: list[PreparedRow], inserted_count: int) -> tuple[Path, Path | None]:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = REPORTS_DIR / f"activity_import_report_{timestamp}.md"
    unresolved_path = REPORTS_DIR / f"unresolved_activity_rows_{timestamp}.csv"

    valid_rows = [row for row in rows if row.is_valid]
    unresolved_rows = [row for row in rows if not row.is_valid]
    warning_rows = [row for row in rows if row.warnings]
    duplicate_warnings = [
        warning
        for row in rows
        for warning in row.warnings
        if "Duplicate-looking" in warning
    ]
    validation_errors = [error for row in rows for error in row.errors]

    lines = [
        "# Activity Import Report",
        "",
        f"- Timestamp: `{timestamp}`",
        f"- Type: `{import_type}`",
        f"- Mode: `{mode}`",
        f"- Total rows: `{len(rows)}`",
        f"- Valid rows: `{len(valid_rows)}`",
        f"- Unresolved rows: `{len(unresolved_rows)}`",
        f"- Rows with warnings: `{len(warning_rows)}`",
        f"- Duplicate-looking warnings: `{len(duplicate_warnings)}`",
        f"- Inserted rows: `{inserted_count}`",
        "",
        "## Validation Errors",
        "",
    ]
    if validation_errors:
        lines.extend([f"- {error}" for error in validation_errors])
    else:
        lines.append("- None")

    lines.extend(["", "## Row Details", ""])
    for row in rows:
        if row.errors or row.warnings:
            lines.append(f"### CSV row {row.row_number}")
            if row.errors:
                lines.append(f"- Errors: {'; '.join(row.errors)}")
            if row.warnings:
                lines.append(f"- Warnings: {'; '.join(row.warnings)}")
            lines.append("")

    report_path.write_text("\n".join(lines), encoding="utf-8")

    if unresolved_rows:
        with unresolved_path.open("w", encoding="utf-8", newline="") as csv_file:
            fieldnames = ["row_number", "errors", "warnings", "source_row_json"]
            writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
            writer.writeheader()
            for row in unresolved_rows:
                writer.writerow(
                    {
                        "row_number": row.row_number,
                        "errors": "; ".join(row.errors),
                        "warnings": "; ".join(row.warnings),
                        "source_row_json": json.dumps(row.source_row, ensure_ascii=False),
                    }
                )
        return report_path, unresolved_path

    return report_path, None


def confirm_import(valid_count: int, unresolved_count: int) -> bool:
    print("")
    print("REAL IMPORT REQUESTED")
    print(f"Valid rows ready to insert: {valid_count}")
    print(f"Unresolved rows that will not be inserted: {unresolved_count}")
    answer = input("Type IMPORT to continue: ").strip()
    return answer == "IMPORT"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import VAM OS Phase 2 activity records.")
    parser.add_argument("--type", choices=["mentoring_recaps", "event_participations"], required=True)
    parser.add_argument("--file", required=True, help="CSV file path")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report without importing")
    parser.add_argument("--import", dest="do_import", action="store_true", help="Insert valid rows")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt for real import")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    mode = "import" if args.do_import else "dry-run"
    if args.dry_run and args.do_import:
        print("Use either --dry-run or --import, not both.", file=sys.stderr)
        return 2

    load_dotenv(RUNNER_DIR / ".env")
    load_dotenv(ROOT_DIR / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is missing. Create activity_import_runner/.env from .env.example.", file=sys.stderr)
        return 2

    csv_path = Path(args.file)
    if not csv_path.is_absolute():
        csv_path = ROOT_DIR / csv_path
    if not csv_path.exists():
        print(f"CSV file not found: {csv_path}", file=sys.stderr)
        return 2

    source_rows, fieldnames = read_csv(csv_path)
    expected_columns = RECAP_COLUMNS if args.type == "mentoring_recaps" else EVENT_COLUMNS
    column_issues = validate_columns(fieldnames, expected_columns)
    if any(issue.startswith("Missing") for issue in column_issues):
        print("CSV column validation failed:")
        for issue in column_issues:
            print(f"- {issue}")
        return 2
    for issue in column_issues:
        print(f"Warning: {issue}")

    print(f"Mode: {mode}")
    print(f"Type: {args.type}")
    print(f"CSV: {csv_path}")
    print(f"Rows loaded: {len(source_rows)}")
    print("DATABASE_URL loaded. Password will not be printed.")

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        prepared_rows = []
        for index, row in enumerate(source_rows, start=2):
            if args.type == "mentoring_recaps":
                prepared_rows.append(prepare_recap_row(conn, row, index))
            else:
                prepared_rows.append(prepare_event_row(conn, row, index))

        valid_rows = [row for row in prepared_rows if row.is_valid]
        unresolved_rows = [row for row in prepared_rows if not row.is_valid]
        warning_rows = [row for row in prepared_rows if row.warnings]

        print("")
        print("Summary before import:")
        print(f"- Total rows: {len(prepared_rows)}")
        print(f"- Valid rows: {len(valid_rows)}")
        print(f"- Unresolved rows: {len(unresolved_rows)}")
        print(f"- Rows with warnings: {len(warning_rows)}")

        inserted_count = 0
        if args.do_import:
            if not args.yes and not confirm_import(len(valid_rows), len(unresolved_rows)):
                print("Import cancelled.")
            else:
                try:
                    for row in valid_rows:
                        if args.type == "mentoring_recaps":
                            insert_recap(conn, row.payload)
                        else:
                            insert_event_participation(conn, row.payload)
                        inserted_count += 1
                    conn.commit()
                    print(f"Inserted rows: {inserted_count}")
                except Exception:
                    conn.rollback()
                    raise
        else:
            print("Dry-run only. No rows inserted.")

    report_path, unresolved_path = write_reports(args.type, mode, prepared_rows, inserted_count)
    print("")
    print(f"Report written: {report_path}")
    if unresolved_path:
        print(f"Unresolved rows CSV written: {unresolved_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
