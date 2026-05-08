"""
v2 — adds body-text extraction for mentor/mentee, normalises mentor names (strips * ** Anh Chị prefixes)
"""
"""
HAM Data Audit & Cleaning Script — Phase 1
Source: Data HAM mua 6.xlsx (Ha Noi Alumni Mentoring Season 6)

Sheets:
  - Mentor S6   : 52 mentors — identity, field, match info
  - Mentee S6   : 60 mentees — identity, orientation, matched mentor
  - Recap S6    : 163 recap posts — FB posts scraped with structured fields

Outputs:
  data_imports/ham/
    ham_people_clean.csv
    ham_matches_clean.csv
    ham_recaps_clean.csv
    ham_events_or_group_activities_clean.csv
    ham_manual_review_issues.csv
    ham_summary_by_file.csv
"""

import openpyxl
import csv
import glob
import re
import os
from datetime import datetime
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────────────────────
BASE_OUT = r"C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Admin_Portal\data_imports\ham"

files = glob.glob(
    r"C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\**\*.xlsx",
    recursive=True
)
HAM_FILE = next(f for f in files if "HAM" in f)
print(f"Source: {HAM_FILE}")

os.makedirs(BASE_OUT, exist_ok=True)

# ── Helpers ───────────────────────────────────────────────────────────────────
def norm_name(v):
    s = (v or "").strip()
    # Strip markdown stars and Vietnamese honorific prefixes for name normalisation
    s = re.sub(r'^[\*\#]+\s*', '', s)          # leading ** # markers
    s = re.sub(r'^(Anh|Chị|Chi|chị|anh)\s+', '', s, flags=re.IGNORECASE)
    return " ".join(s.split()).title()

def extract_mentee_from_body(body):
    """Extract mentee names embedded in the post body text."""
    if not body:
        return []
    m = re.search(r'[Mm]entee[:\s]+([^\n\*\#]{2,120})', body)
    if m:
        val = m.group(1).strip().rstrip('*#')
        names = [n.strip() for n in re.split(r'[,;/]', val) if n.strip() and len(n.strip()) > 1]
        return names[:10]
    return []

def extract_mentor_from_body(body):
    """Extract mentor name embedded in the post body text."""
    if not body:
        return ''
    m = re.search(r'[Mm]entor[:\s]+([^\n\*\#]{3,80})', body)
    if m:
        raw = m.group(1).strip().lstrip('*').strip()
        # Trim trailing punctuation / newline
        raw = re.split(r'[\n\r]', raw)[0].strip()
        return raw[:80]
    return ''

def norm_email(v):
    return (v or "").strip().lower()

def norm_phone(v):
    import re
    p = re.sub(r"[\s\-\.\(\)]", "", str(v or "").strip())
    if p.startswith("84") and len(p) >= 11:
        p = "0" + p[2:]
    return p

def safe_str(v, maxlen=None):
    if v is None:
        return ""
    s = str(v).strip()
    if maxlen:
        s = s[:maxlen]
    return s

def write_csv(path, fieldnames, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"  -> Wrote {len(rows)} rows to {os.path.basename(path)}")

def classify_recap_type(body, recap_type_raw, mentees_raw, mentor_raw):
    """
    Classify a recap row into one of the 8 activity types based on content signals.
    """
    body_l = (body or "").lower()
    rtype  = (recap_type_raw or "").lower().strip()
    mentees_l = (mentees_raw or "").lower()

    # Explicit type tags embedded in posts
    if "#mentoring1-1" in body_l or "#mentoring1on1" in body_l or rtype == "#mentoring1":
        return "1on1_primary"
    if "#doublecrossmentoring" in body_l or "#crossmentoring" in body_l or "cross" in rtype:
        return "1on1_cross"
    if "#groupmentoring" in body_l or "nhóm" in body_l and "mentor" in body_l:
        return "group_mentoring"
    if "training" in body_l or "workshop" in body_l or "seminar" in body_l:
        return "training_event"
    if "orientation" in body_l or "giới thiệu" in body_l or "kick off" in body_l or "khai mạc" in body_l:
        return "orientation_or_intro"
    if "cộng đồng" in body_l or "giao lưu" in body_l or "picnic" in body_l or "team building" in body_l:
        return "community_activity"
    if "tuyển" in body_l or "ứng tuyển" in body_l or "phỏng vấn mentee" in body_l or "tuyển chọn" in body_l:
        return "application_or_selection_activity"

    # Heuristics on type tag
    if "#mentoring1" in rtype:
        return "1on1_primary"
    if "#doublecross" in rtype or "cross" in rtype:
        return "1on1_cross"

    # Multiple mentees → group or cross
    if mentees_raw:
        mentee_names = [m.strip() for m in re.split(r"[,;/\n]", mentees_raw) if m.strip()]
        if len(mentee_names) >= 3:
            return "group_mentoring"
        if len(mentee_names) == 2:
            return "1on1_cross"

    # Default: if has mentor + mentee → likely 1on1
    if mentor_raw and mentor_raw.strip() not in ("", "undefined"):
        return "1on1_primary"

    return "unknown_manual_review"


# ── Load workbook ─────────────────────────────────────────────────────────────
wb = openpyxl.load_workbook(HAM_FILE, data_only=True)
print(f"Sheets: {wb.sheetnames}\n")

# ──────────────────────────────────────────────────────────────────────────────
# SHEET 1: Mentor S6
# Headers: STT, Họ và Tên, Số lượng Mentee trong mùa, Lĩnh vực(1), GT,
#          Họ tên Mentee, Email, Số điện thoại, Ngày sinh, Chức vụ hiện tại,
#          Đơn vị hiện tại, Chuyên môn, Lĩnh vực(2), Hoạt động Mentoring...,
#          Profile, Link FB, Linkdin, [spare cols...]
# ──────────────────────────────────────────────────────────────────────────────
ws_mentor = wb["Mentor S6"]
mentor_rows_raw = list(ws_mentor.iter_rows(values_only=True))
# First non-empty row = header
mentor_header = mentor_rows_raw[0]
mentor_data = [r for r in mentor_rows_raw[1:] if any(c is not None for c in r)]

print(f"=== Mentor S6 ===")
print(f"  Raw rows: {len(mentor_data)}")

people_rows = []
issues = []
mentor_map = {}  # name_normalised -> row dict

for i, row in enumerate(mentor_data):
    def g(idx): return safe_str(row[idx] if idx < len(row) else None)
    stt       = g(0)
    full_name = norm_name(g(1))
    mentee_count = g(2)
    field1    = g(3)
    gender    = g(4)
    mentee_names_raw = g(5)
    email     = norm_email(g(6))
    phone     = norm_phone(g(7))
    dob       = g(8)
    title     = g(9)
    company   = g(10)
    expertise = g(11)
    field2    = g(12)
    activities = g(13)
    profile   = g(14)
    fb_link   = g(15)
    linkedin  = g(16)

    issue_flags = []
    if not full_name:
        issue_flags.append("missing_name")
    if not email:
        issue_flags.append("missing_email")
    if not phone or len(norm_phone(phone)) < 9:
        issue_flags.append("missing_or_short_phone")

    p = {
        "source_file":    "Data HAM mua 6.xlsx",
        "source_sheet":   "Mentor S6",
        "row_num":        i + 2,
        "stt":            stt,
        "full_name":      full_name,
        "role":           "mentor",
        "program":        "HAM",
        "season":         "HAM_S6",
        "email":          email,
        "phone":          norm_phone(phone),
        "gender":         gender,
        "dob":            dob,
        "school":         "",
        "company":        company,
        "title":          title,
        "expertise":      expertise,
        "field":          field1 or field2,
        "fb_profile":     fb_link,
        "linkedin":       linkedin,
        "vam_profile_link": profile,
        "mentee_names_raw": mentee_names_raw,
        "mentee_count_raw": mentee_count,
        "issue_flag":     "TRUE" if issue_flags else "FALSE",
        "issue_note":     "; ".join(issue_flags),
        "import_ready":   "FALSE" if issue_flags else "TRUE",
    }
    people_rows.append(p)

    if full_name:
        mentor_map[full_name.lower()] = p

    if issue_flags:
        issues.append({
            "source_sheet": "Mentor S6",
            "row_num": i + 2,
            "full_name": full_name,
            "email": email,
            "issue_type": "; ".join(issue_flags),
            "raw_value": g(1),
            "action_needed": "manual_review",
        })

print(f"  Mentor people rows: {len(people_rows)}")
print(f"  Issues flagged: {len([p for p in people_rows if p['issue_flag']=='TRUE'])}")


# ──────────────────────────────────────────────────────────────────────────────
# SHEET 2: Mentee S6
# Headers: STT, Họ và tên, Định hướng, Mentor, Email, Số điện thoại, Trường
# ──────────────────────────────────────────────────────────────────────────────
ws_mentee = wb["Mentee S6"]
mentee_rows_raw = list(ws_mentee.iter_rows(values_only=True))
mentee_data = [r for r in mentee_rows_raw[1:] if any(c is not None for c in r)]

print(f"\n=== Mentee S6 ===")
print(f"  Raw rows: {len(mentee_data)}")

mentee_map = {}  # name_normalised -> row dict
matches_rows = []

for i, row in enumerate(mentee_data):
    def g(idx): return safe_str(row[idx] if idx < len(row) else None)
    stt        = g(0)
    full_name  = norm_name(g(1))
    direction  = g(2)
    mentor_name= norm_name(g(3))
    email      = norm_email(g(4))
    phone      = norm_phone(g(5))
    school     = g(6)

    issue_flags = []
    if not full_name:
        issue_flags.append("missing_name")
    if not email:
        issue_flags.append("missing_email")
    if not mentor_name:
        issue_flags.append("missing_mentor")

    p = {
        "source_file":    "Data HAM mua 6.xlsx",
        "source_sheet":   "Mentee S6",
        "row_num":        i + 2,
        "stt":            stt,
        "full_name":      full_name,
        "role":           "mentee",
        "program":        "HAM",
        "season":         "HAM_S6",
        "email":          email,
        "phone":          phone,
        "gender":         "",
        "dob":            "",
        "school":         school,
        "company":        "",
        "title":          "",
        "expertise":      "",
        "field":          direction,
        "fb_profile":     "",
        "linkedin":       "",
        "vam_profile_link": "",
        "mentee_names_raw": "",
        "mentee_count_raw": "",
        "issue_flag":     "TRUE" if issue_flags else "FALSE",
        "issue_note":     "; ".join(issue_flags),
        "import_ready":   "FALSE" if issue_flags else "TRUE",
    }
    people_rows.append(p)

    if full_name:
        mentee_map[full_name.lower()] = p

    if issue_flags:
        issues.append({
            "source_sheet": "Mentee S6",
            "row_num": i + 2,
            "full_name": full_name,
            "email": email,
            "issue_type": "; ".join(issue_flags),
            "raw_value": g(1),
            "action_needed": "manual_review",
        })

    # Build match row
    if full_name and mentor_name:
        matches_rows.append({
            "source_file":    "Data HAM mua 6.xlsx",
            "source_sheet":   "Mentee S6",
            "row_num":        i + 2,
            "program":        "HAM",
            "season":         "HAM_S6",
            "mentee_name":    full_name,
            "mentee_email":   email,
            "mentee_phone":   phone,
            "mentee_school":  school,
            "mentor_name":    mentor_name,
            "mentor_email":   "",
            "direction":      direction,
            "match_status":   "matched",
            "issue_flag":     "TRUE" if issue_flags else "FALSE",
            "issue_note":     "; ".join(issue_flags),
            "import_ready":   "FALSE" if issue_flags else "TRUE",
        })

print(f"  Mentee people rows: {len(mentee_data)}")
print(f"  Match rows (mentee→mentor): {len(matches_rows)}")
print(f"  Issues flagged: {len([p for p in people_rows if p['source_sheet']=='Mentee S6' and p['issue_flag']=='TRUE'])}")


# ──────────────────────────────────────────────────────────────────────────────
# SHEET 3: Recap S6
# Headers: Link, Date, Time, Header, Body, Author, Views, Reacts,
#          MSSV, Type, Topic, Mentor, Mentees, Thời gian, Location
# ──────────────────────────────────────────────────────────────────────────────
ws_recap = wb["Recap S6"]
recap_rows_raw = list(ws_recap.iter_rows(values_only=True))
recap_data = [r for r in recap_rows_raw[1:] if any(c is not None for c in r)]

print(f"\n=== Recap S6 ===")
print(f"  Raw rows: {len(recap_data)}")

recaps_rows = []
group_activities_rows = []
classified_counts = defaultdict(int)

for i, row in enumerate(recap_data):
    def g(idx): return safe_str(row[idx] if idx < len(row) else None)
    link     = g(0)
    date_raw = row[1] if 1 < len(row) else None
    time_raw = g(2)
    header   = g(3)
    body     = g(4)
    author   = g(5)
    views    = g(6)
    reacts   = g(7)
    mssv     = g(8)
    type_tag = g(9)
    topic    = g(10)
    # Mentor: use column value, fall back to body extraction
    mentor_col = g(11)
    mentor_body = extract_mentor_from_body(body) if mentor_col in ('', 'undefined', 'None') else ''
    mentor   = norm_name(mentor_col) if mentor_col not in ('', 'undefined', 'None') else norm_name(mentor_body)
    # Mentees: column is always 'undefined' — extract from body
    mentees_col = g(12)
    mentees_extracted = extract_mentee_from_body(body)
    mentees  = "; ".join(mentees_extracted) if mentees_extracted else mentees_col
    time_str = g(13)
    location = g(14)

    # Parse date
    if isinstance(date_raw, datetime):
        post_date = date_raw.strftime("%Y-%m-%d")
    else:
        post_date = safe_str(date_raw)

    # Classify
    activity_type = classify_recap_type(body, type_tag, mentees, mentor)
    classified_counts[activity_type] += 1

    # Issue detection
    issue_flags = []
    if not mentor or mentor.lower() in ('', 'undefined', 'none'):
        issue_flags.append('missing_mentor')
    # Mentees: flag only if BOTH column and body extraction failed
    if not mentees or mentees.lower() in ('', 'undefined', 'none'):
        issue_flags.append('missing_mentee_list')
    if not body or len(body) < 50:
        issue_flags.append('body_too_short_or_empty')
    if not link:
        issue_flags.append('missing_fb_link')
    if activity_type == 'unknown_manual_review':
        issue_flags.append('unclassifiable_activity_type')

    base = {
        "source_file":      "Data HAM mua 6.xlsx",
        "source_sheet":     "Recap S6",
        "row_num":          i + 2,
        "program":          "HAM",
        "season":           "HAM_S6",
        "post_date":        post_date,
        "post_time":        time_raw,
        "fb_post_link":     link,
        "post_author":      author,
        "views":            views,
        "reacts":           reacts,
        "mssv_tag":         mssv,
        "type_tag":         type_tag,
        "topic":            topic,
        "mentor_name":      mentor,
        "mentee_names_raw": mentees,
        "meeting_time_raw": time_str,
        "location":         location,
        "activity_type":    activity_type,
        "body_length":      len(body),
        "body_snippet":     body[:300] if body else "",
        "mentees_extracted": "; ".join(mentees_extracted),
        "issue_flag":       "TRUE" if issue_flags else "FALSE",
        "issue_note":       "; ".join(issue_flags),
        "import_ready":     "FALSE" if issue_flags else "TRUE",
    }

    if activity_type in ("1on1_primary", "1on1_cross"):
        recaps_rows.append(base)
    elif activity_type in ("group_mentoring", "training_event", "orientation_or_intro",
                           "community_activity", "application_or_selection_activity"):
        group_activities_rows.append(base)
    else:
        # unknown → goes to recaps with flag
        recaps_rows.append(base)

    if issue_flags:
        issues.append({
            "source_sheet": "Recap S6",
            "row_num": i + 2,
            "full_name": mentor,
            "email": "",
            "issue_type": "; ".join(issue_flags),
            "raw_value": f"link={link}, mentor={mentor}, type={type_tag}",
            "action_needed": "manual_review",
        })

print(f"\n  Activity classification:")
for k, v in sorted(classified_counts.items()):
    print(f"    {k}: {v}")
print(f"\n  Recap rows (1on1 + unknown): {len(recaps_rows)}")
print(f"  Group/event rows: {len(group_activities_rows)}")
print(f"  Issues flagged: {len([r for r in recaps_rows + group_activities_rows if r['issue_flag']=='TRUE'])}")


# ──────────────────────────────────────────────────────────────────────────────
# Duplicate detection — people
# ──────────────────────────────────────────────────────────────────────────────
email_counts = defaultdict(list)
for p in people_rows:
    if p["email"]:
        email_counts[p["email"]].append(p["full_name"])

dupes = {e: names for e, names in email_counts.items() if len(names) > 1}
if dupes:
    print(f"\nDuplicate emails found ({len(dupes)}):")
    for e, names in dupes.items():
        print(f"  {e}: {names}")
        issues.append({
            "source_sheet": "People dedup",
            "row_num": "",
            "full_name": "; ".join(names),
            "email": e,
            "issue_type": "duplicate_email",
            "raw_value": str(names),
            "action_needed": "manual_dedup",
        })
else:
    print("\nNo duplicate emails found in people.")


# ──────────────────────────────────────────────────────────────────────────────
# Write outputs
# ──────────────────────────────────────────────────────────────────────────────
print("\n=== Writing output files ===")

PEOPLE_FIELDS = [
    "source_file","source_sheet","row_num","stt","full_name","role","program","season",
    "email","phone","gender","dob","school","company","title","expertise","field",
    "fb_profile","linkedin","vam_profile_link","mentee_names_raw","mentee_count_raw",
    "issue_flag","issue_note","import_ready",
]
write_csv(f"{BASE_OUT}\\ham_people_clean.csv", PEOPLE_FIELDS, people_rows)

MATCH_FIELDS = [
    "source_file","source_sheet","row_num","program","season",
    "mentee_name","mentee_email","mentee_phone","mentee_school",
    "mentor_name","mentor_email","direction","match_status",
    "issue_flag","issue_note","import_ready",
]
write_csv(f"{BASE_OUT}\\ham_matches_clean.csv", MATCH_FIELDS, matches_rows)

RECAP_FIELDS = [
    "source_file","source_sheet","row_num","program","season",
    "post_date","post_time","fb_post_link","post_author","views","reacts",
    "mssv_tag","type_tag","topic","mentor_name","mentee_names_raw","mentees_extracted",
    "meeting_time_raw","location","activity_type","body_length","body_snippet",
    "issue_flag","issue_note","import_ready",
]
write_csv(f"{BASE_OUT}\\ham_recaps_clean.csv", RECAP_FIELDS, recaps_rows)
write_csv(f"{BASE_OUT}\\ham_events_or_group_activities_clean.csv", RECAP_FIELDS, group_activities_rows)

ISSUE_FIELDS = [
    "source_sheet","row_num","full_name","email","issue_type","raw_value","action_needed",
]
write_csv(f"{BASE_OUT}\\ham_manual_review_issues.csv", ISSUE_FIELDS, issues)

# Summary by file/sheet
total_people  = len(people_rows)
mentor_count  = len([p for p in people_rows if p["role"]=="mentor"])
mentee_count2 = len([p for p in people_rows if p["role"]=="mentee"])
people_ready  = len([p for p in people_rows if p["import_ready"]=="TRUE"])
match_count   = len(matches_rows)
match_ready   = len([m for m in matches_rows if m["import_ready"]=="TRUE"])
recap_count   = len(recaps_rows)
recap_ready   = len([r for r in recaps_rows if r["import_ready"]=="TRUE"])
group_count   = len(group_activities_rows)
group_ready   = len([r for r in group_activities_rows if r["import_ready"]=="TRUE"])
issue_count   = len(issues)

summary_rows = [
    {
        "sheet": "Mentor S6", "source_file": "Data HAM mua 6.xlsx",
        "total_rows": mentor_count, "import_ready": len([p for p in people_rows if p["role"]=="mentor" and p["import_ready"]=="TRUE"]),
        "issues": len([p for p in people_rows if p["role"]=="mentor" and p["issue_flag"]=="TRUE"]),
        "output_file": "ham_people_clean.csv", "notes": "Mentor identity + match info",
    },
    {
        "sheet": "Mentee S6", "source_file": "Data HAM mua 6.xlsx",
        "total_rows": mentee_count2, "import_ready": len([p for p in people_rows if p["role"]=="mentee" and p["import_ready"]=="TRUE"]),
        "issues": len([p for p in people_rows if p["role"]=="mentee" and p["issue_flag"]=="TRUE"]),
        "output_file": "ham_people_clean.csv + ham_matches_clean.csv", "notes": "Mentee identity + mentor assignment",
    },
    {
        "sheet": "Recap S6 (1on1/unknown)", "source_file": "Data HAM mua 6.xlsx",
        "total_rows": recap_count, "import_ready": recap_ready,
        "issues": len([r for r in recaps_rows if r["issue_flag"]=="TRUE"]),
        "output_file": "ham_recaps_clean.csv", "notes": "1on1_primary, 1on1_cross, unknown",
    },
    {
        "sheet": "Recap S6 (group/events)", "source_file": "Data HAM mua 6.xlsx",
        "total_rows": group_count, "import_ready": group_ready,
        "issues": len([r for r in group_activities_rows if r["issue_flag"]=="TRUE"]),
        "output_file": "ham_events_or_group_activities_clean.csv", "notes": "group_mentoring, community, training etc.",
    },
    {
        "sheet": "TOTAL", "source_file": "Data HAM mua 6.xlsx",
        "total_rows": total_people + len(recaps_rows) + len(group_activities_rows),
        "import_ready": people_ready + recap_ready + group_ready,
        "issues": issue_count,
        "output_file": "all", "notes": "Combined totals",
    },
]

SUMMARY_FIELDS = ["sheet","source_file","total_rows","import_ready","issues","output_file","notes"]
write_csv(f"{BASE_OUT}\\ham_summary_by_file.csv", SUMMARY_FIELDS, summary_rows)

# ──────────────────────────────────────────────────────────────────────────────
# Final report
# ──────────────────────────────────────────────────────────────────────────────
print("\n" + "="*70)
print("HAM AUDIT SUMMARY — Data HAM mua 6.xlsx")
print("="*70)
print(f"  Source sheets: 3 (Mentor S6, Mentee S6, Recap S6)")
print(f"\n  PEOPLE")
print(f"    Mentors:             {mentor_count}")
print(f"    Mentees:             {mentee_count2}")
print(f"    Total people rows:   {total_people}")
print(f"    Import-ready people: {people_ready}")
print(f"\n  MATCHES")
print(f"    Match rows:          {match_count}")
print(f"    Import-ready:        {match_ready}")
print(f"\n  RECAPS (1on1 + unknown → ham_recaps_clean.csv)")
print(f"    Total:               {recap_count}")
print(f"    Import-ready:        {recap_ready}")
print(f"\n  GROUP / EVENTS (→ ham_events_or_group_activities_clean.csv)")
print(f"    Total:               {group_count}")
print(f"    Import-ready:        {group_ready}")
print(f"\n  ACTIVITY TYPE BREAKDOWN (Recap S6):")
for k, v in sorted(classified_counts.items()):
    print(f"    {k:<40} {v:>4}")
print(f"\n  ISSUES TO REVIEW: {issue_count}")
print(f"\nOutput directory: {BASE_OUT}")
print("Done.")
