from __future__ import annotations

import csv
import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import psycopg
from dotenv import load_dotenv
from openpyxl import load_workbook
from psycopg.rows import dict_row


ROOT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT_DIR / "tracking_audit_output"
TRACKING_WORKBOOK = Path(
    r"C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\TRACKING _ SEASON 11.xlsx"
)
SEASON_CODE = "UEHM-S11"
CAPTURED_BY = "tracking_file_import"

MENTORING_COLUMNS = [
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
    "meeting_type",
    "captured_by",
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
    "captured_by",
    "walk_in",
]

MANUAL_COLUMNS = [
    "source",
    "source_file",
    "source_sheet",
    "source_row",
    "reason",
    "name",
    "email",
    "code",
    "notes",
]

SOURCE_SPECS = {
    "Raw data": {"start": 2, "date": 1, "content": 2, "poster": 3},
    "Sheet15": {"start": 1, "date": 3, "content": 7, "poster": 8},
    "Sheet18": {"start": 1, "date": 3, "content": 9, "poster": 11},
    "Sheet12": {"start": 1, "date": 3, "content": 7, "poster": 8},
    "Sheet20": {"start": 1, "date": 3, "content": 8, "poster": 9},
}

CODE_RE = re.compile(r"\bUEH[A-Z]{1,3}\d{4,6}\b", re.IGNORECASE)
DATE_RE = re.compile(r"(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?!\d)")
FACEBOOK_RE = re.compile(r"https://www\.facebook\.com/groups/\d+/permalink/\d+/?")


@dataclass
class SourceRow:
    source_sheet: str
    source_row: int
    post_date: str | None
    content: str
    poster: str
    url: str


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def cell_url(cell: Any) -> str:
    if cell.hyperlink and cell.hyperlink.target:
        return cell.hyperlink.target.strip()
    value = text(cell.value)
    match = FACEBOOK_RE.search(value)
    return match.group(0) if match else ""


def parse_date_value(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = text(value)
    if not raw:
        return None
    for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%d/%m/%Y %I:%M %p", "%m/%d/%Y %I:%M %p"):
        try:
            return datetime.strptime(raw.replace("  ", " "), fmt).date()
        except ValueError:
            pass
    match = DATE_RE.search(raw)
    if match:
        first, second, year = [int(part) for part in match.groups()]
        if first > 12:
            return date(year, second, first)
        if second > 12:
            return date(year, first, second)
        return date(year, second, first)
    return None


def date_from_content(content: str) -> date | None:
    for match in DATE_RE.finditer(content):
        first, second, year = [int(part) for part in match.groups()]
        try:
            if first > 12:
                return date(year, second, first)
            if second > 12:
                return date(year, first, second)
            return date(year, second, first)
        except ValueError:
            continue
    return None


def classify_recap(content: str) -> str:
    lower = content.lower()
    if (
        "#training" in lower
        or "recap training" in lower
        or "recaptraining" in lower
        or classify_phase2_event(content)
    ):
        return "training/event"
    if "cross" in lower:
        return "cross mentoring"
    if "mentoring" in lower or "mentor:" in lower or "mentor " in lower:
        return "mentoring"
    return "other/unknown"


def classify_phase2_event(content: str) -> str | None:
    # Phase 2 event import needs an event signal in the recap title/header, not
    # a generic reflection hashtag buried later in the post.
    lower = content.lower()[:500]
    if re.search(r"(#\s*orientation|recap\s+(?:buổi\s+)?(?:mentee\s+)?orientation)", lower):
        return "Mentee Orientation"
    if re.search(r"(#\s*kick\s*off|#\s*kickoff|recap\s+(?:buổi\s+)?kick\s*off|recap\s+(?:buổi\s+)?kickoff)", lower):
        return "Kickoff"
    if re.search(r"(#\s*tổng\s*kết|#\s*tong\s*ket|recap\s+(?:buổi\s+)?tổng\s+kết|recap\s+(?:buổi\s+)?tong\s+ket|event\s+tổng\s+kết|event\s+tong\s+ket)", lower):
        return "Tổng kết"
    return None


def normalize_note(content: str) -> str:
    compact = " ".join(content.replace("\n", " ").split())
    bracketed_title = re.search(r"\[\s*(RECAP[^\]\r\n]{0,100})\]", compact, re.IGNORECASE)
    if bracketed_title:
        return f"[{bracketed_title.group(1).strip()}]"[:120]

    loose_title = re.search(r"\b(RECAP[^\]\r\n]{0,100}\])", compact, re.IGNORECASE)
    if loose_title:
        title = loose_title.group(1).strip()
        return f"[{title}"[:120]

    return "Imported Facebook recap"


def extract_rows() -> list[SourceRow]:
    wb = load_workbook(TRACKING_WORKBOOK, read_only=False, data_only=False)
    rows: list[SourceRow] = []
    for sheet_name, spec in SOURCE_SPECS.items():
        ws = wb[sheet_name]
        for row_idx in range(spec["start"], ws.max_row + 1):
            content_cell = ws.cell(row_idx, spec["content"])
            poster_cell = ws.cell(row_idx, spec["poster"])
            content = text(content_cell.value)
            if not content or len(content) < 20:
                continue
            url = cell_url(content_cell) or cell_url(poster_cell)
            if not url:
                for cell in ws[row_idx]:
                    url = cell_url(cell)
                    if url:
                        break
            post_date = parse_date_value(ws.cell(row_idx, spec["date"]).value)
            rows.append(
                SourceRow(
                    source_sheet=sheet_name,
                    source_row=row_idx,
                    post_date=post_date.isoformat() if post_date else None,
                    content=content,
                    poster=text(poster_cell.value),
                    url=url,
                )
            )
    return rows


def load_active_matches() -> dict[str, dict[str, str]]:
    load_dotenv(ROOT_DIR / "activity_import_runner" / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return {}
    query = """
        select
          mp.mentee_code,
          p_mentee.email_primary::text as mentee_email,
          p_mentor.email_primary::text as mentor_email,
          m.id::text as match_id
        from matches m
        join mentee_profiles mp on mp.person_id = m.mentee_person_id
        join people p_mentee on p_mentee.id = m.mentee_person_id
        join people p_mentor on p_mentor.id = m.mentor_person_id
        where m.status = 'active'
          and m.match_type = 'primary'
    """
    matches: dict[str, dict[str, str]] = {}
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            for row in cur.fetchall():
                code = text(row["mentee_code"]).upper()
                if code:
                    matches[code] = {
                        "mentee_email": text(row["mentee_email"]),
                        "mentor_email": text(row["mentor_email"]),
                        "match_id": text(row["match_id"]),
                    }
    return matches


def first_code(content: str) -> str:
    codes = [match.group(0).upper() for match in CODE_RE.finditer(content)]
    return codes[0] if codes else ""


def write_csv(path: Path, columns: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    source_rows = extract_rows()
    active_matches = load_active_matches()
    seen_urls: set[str] = set()

    mentoring_rows: list[dict[str, str]] = []
    event_rows: list[dict[str, str]] = []
    manual_rows: list[dict[str, str]] = []
    excluded = Counter()
    event_excluded = Counter()
    candidates_mentoring = 0
    candidates_event = 0

    for source in source_rows:
        recap_type = classify_recap(source.content)
        event_name = classify_phase2_event(source.content)
        code = first_code(source.content)
        meeting = date_from_content(source.content) or parse_date_value(source.post_date)
        admin_notes = f"source_sheet={source.source_sheet}; source_row={source.source_row}"

        if recap_type in {"mentoring", "cross mentoring"}:
            candidates_mentoring += 1
            reasons: list[str] = []
            if not source.url:
                reasons.append("missing_url")
            if not code:
                reasons.append("missing_mentee_code")
            if not meeting:
                reasons.append("missing_meeting_date")
            if source.url and source.url in seen_urls:
                reasons.append("duplicate_recap_url")
            match = active_matches.get(code)
            if not match:
                reasons.append("no_active_primary_match_for_mentee_code")
            if recap_type == "cross mentoring":
                reasons.append("cross_mentoring_needs_mentor_review")

            if reasons:
                excluded.update(reasons)
                manual_rows.append(
                    {
                        "source": "tracking_recap",
                        "source_file": TRACKING_WORKBOOK.name,
                        "source_sheet": source.source_sheet,
                        "source_row": str(source.source_row),
                        "reason": "; ".join(reasons),
                        "name": "",
                        "email": "",
                        "code": code,
                        "notes": source.url or normalize_note(source.content),
                    }
                )
                continue

            seen_urls.add(source.url)
            mentoring_rows.append(
                {
                    "season_code": SEASON_CODE,
                    "mentee_email": match["mentee_email"],
                    "mentee_code": code,
                    "mentor_email": match["mentor_email"],
                    "mentor_code": "",
                    "match_id": match["match_id"],
                    "meeting_date": meeting.isoformat(),
                    "meeting_month": meeting.strftime("%Y-%m"),
                    "recap_url": source.url,
                    "recap_source": "facebook_group",
                    "recap_note": normalize_note(source.content),
                    "issue_flag": "false",
                    "admin_notes": admin_notes,
                    "meeting_type": "1on1_primary",
                    "captured_by": CAPTURED_BY,
                }
            )
            continue

        if recap_type == "training/event":
            candidates_event += 1
            if not event_name:
                event_excluded.update(["outside_phase2_event_scope"])
                manual_rows.append(
                    {
                        "source": "tracking_event",
                        "source_file": TRACKING_WORKBOOK.name,
                        "source_sheet": source.source_sheet,
                        "source_row": str(source.source_row),
                        "reason": "outside_phase2_event_scope",
                        "name": "",
                        "email": "",
                        "code": code,
                        "notes": source.url or normalize_note(source.content),
                    }
                )
                continue
            if not source.url or not code or not meeting:
                reasons = []
                if not source.url:
                    reasons.append("missing_url")
                if not code:
                    reasons.append("missing_person_code")
                if not meeting:
                    reasons.append("missing_event_date")
                event_excluded.update(reasons)
                manual_rows.append(
                    {
                        "source": "tracking_event",
                        "source_file": TRACKING_WORKBOOK.name,
                        "source_sheet": source.source_sheet,
                        "source_row": str(source.source_row),
                        "reason": "; ".join(reasons),
                        "name": "",
                        "email": "",
                        "code": code,
                        "notes": source.url or normalize_note(source.content),
                    }
                )
                continue

            event_rows.append(
                {
                    "season_code": SEASON_CODE,
                    "event_code": "",
                    "event_name": event_name,
                    "event_date": meeting.isoformat(),
                    "person_email": active_matches.get(code, {}).get("mentee_email", ""),
                    "person_code": code,
                    "role_at_event": "mentee",
                    "registration_status": "registered",
                    "attendance_status": "attended",
                    "recap_url": source.url,
                    "excuse_reason": "",
                    "admin_notes": admin_notes,
                    "captured_by": CAPTURED_BY,
                    "walk_in": "false",
                }
            )
            continue

        if recap_type == "other/unknown":
            manual_rows.append(
                {
                    "source": "tracking_recap",
                    "source_file": TRACKING_WORKBOOK.name,
                    "source_sheet": source.source_sheet,
                    "source_row": str(source.source_row),
                    "reason": "recap_type=other/unknown",
                    "name": "",
                    "email": "",
                    "code": code,
                    "notes": source.url or normalize_note(source.content),
                }
            )

    write_csv(OUTPUT_DIR / "DRAFT_REVIEWED_mentoring_recaps_from_tracking.csv", MENTORING_COLUMNS, mentoring_rows)
    write_csv(OUTPUT_DIR / "DRAFT_REVIEWED_event_participations_from_tracking.csv", EVENT_COLUMNS, event_rows)
    write_csv(OUTPUT_DIR / "DRAFT_manual_review_remaining.csv", MANUAL_COLUMNS, manual_rows)
    write_csv(OUTPUT_DIR / "SAMPLE_50_mentoring_recaps_from_tracking.csv", MENTORING_COLUMNS, mentoring_rows[:50])

    excluded_lines = "\n".join(f"- {reason}: {count}" for reason, count in sorted(excluded.items())) or "- None"
    event_excluded_lines = "\n".join(f"- {reason}: {count}" for reason, count in sorted(event_excluded.items())) or "- None"
    summary = f"""# Draft Import Summary

Generated from Tracking Season 11 audit sources.

## Counts

- Candidate mentoring rows considered: {candidates_mentoring}
- Mentoring rows included: {len(mentoring_rows)}
- Mentoring rows excluded: {candidates_mentoring - len(mentoring_rows)}
- Event/training rows considered: {candidates_event}
- Phase 2 event rows included: {len(event_rows)}
- Rows remaining for manual review: {len(manual_rows)}

## Mentoring Rows Excluded And Why

{excluded_lines}

## Event/Training Rows Excluded And Why

{event_excluded_lines}

## Key Assumptions

- `season_code` is fixed to `{SEASON_CODE}`.
- Only URL-backed rows were eligible for import drafts.
- Normal mentoring rows are included only when `mentee_code` resolves to one active primary match, then `mentor_email` and `match_id` are filled from that match.
- Cross mentoring rows were kept for manual review unless the cross mentor can be explicitly verified later.
- Generic training rows are not Phase 2 event import rows unless they mention Mentee Orientation, Kickoff, or Tổng kết.
- `recap_note` was intentionally shortened to avoid storing/displaying long Facebook content.
- `captured_by` is `{CAPTURED_BY}` for all draft rows.
- `walk_in` is `false` unless a source row explicitly indicates walk-in attendance.
- These files are draft CSVs only; no dry-run or import was executed.
"""
    (OUTPUT_DIR / "DRAFT_IMPORT_SUMMARY.md").write_text(summary, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
