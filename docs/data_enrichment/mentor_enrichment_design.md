# Mentor Enrichment Design

## Scope

This document prepares the mentor enrichment review process only.

Do not update the database from this document. Do not modify UI from this document.

## Business Rule

A mentor may have experience in multiple industries and multiple functions.

Do not force one mentor into one industry or one function.

The enrichment review source must support multiple selected values. Current single-value fields such as `mentor_profiles.industry` and `mentor_profiles.function_area` may remain as primary/default dashboard fields when they already exist, but they must not be treated as the full truth of a mentor's experience.

## Review File Columns

Use this shape for CSV review:

| Column | Purpose |
| --- | --- |
| `person_id` | Stable person ID from `people.id`. |
| `full_name` | Human review label. |
| `email` | Primary email for reviewer matching. |
| `company_current` | Existing current company from mentor profile. |
| `title_current` | Existing current title from mentor profile. |
| `bio_url` | Existing mentor profile/bio URL when available. |
| `primary_industry` | One default industry for current dashboard grouping. May be blank if unclear. |
| `industry_experience_list` | Comma-separated multi-value list of industries the mentor has meaningful experience in. |
| `primary_function` | One default function for current dashboard grouping. May be blank if unclear. |
| `function_experience_list` | Comma-separated multi-value list of functions the mentor has meaningful experience in. |
| `confidence` | Reviewer confidence: `high`, `medium`, `low`, or `needs_review`. |
| `reviewer_note` | Short reason, source note, uncertainty, or follow-up needed. |

## CSV Rules

- Use comma-separated values for multi-value fields during review.
- Trim spaces around each value.
- Prefer taxonomy labels exactly as written in the approved taxonomy.
- Leave primary fields blank when the reviewer cannot choose a fair default.
- A primary value should also appear in its matching multi-value list when known.
- Use `confidence = needs_review` when source data is ambiguous or conflicting.
- Do not invent data to fill blanks.

Example:

```csv
person_id,full_name,email,company_current,title_current,bio_url,primary_industry,industry_experience_list,primary_function,function_experience_list,confidence,reviewer_note
00000000-0000-0000-0000-000000000000,Nguyen Van A,a@example.com,Example Co,Product Lead,https://example.com/bio,Technology,"Technology, Education",Product,"Product, Strategy, Operations",medium,"Bio mentions edtech startup and product leadership."
```

## Future Data Model Options

### Option A: Array Fields

Add array fields when the team wants a simple schema:

- `mentor_profiles.industry_experience text[]`
- `mentor_profiles.function_experience text[]`

Keep existing fields as primary/default:

- `mentor_profiles.industry`
- `mentor_profiles.function_area`

Use this option when dashboard filters only need labels and counts.

### Option B: Normalized Tables

Add normalized tables when the team needs provenance, confidence, season scope, or review workflow:

- `mentor_industry_experience`
- `mentor_function_experience`

Suggested table shape:

| Column | Purpose |
| --- | --- |
| `id` | Row ID. |
| `mentor_person_id` | Mentor person ID. |
| `label` | Taxonomy value. |
| `is_primary` | Marks the default dashboard grouping value. |
| `confidence` | `high`, `medium`, `low`, or `needs_review`. |
| `source` | `manual_review`, `bio`, `application`, `import`, or other source. |
| `reviewer_note` | Optional reviewer note. |
| `created_at` | Audit timestamp. |
| `updated_at` | Audit timestamp. |

Use this option when a mentor can have many labels, labels need review history, or multiple source systems contribute enrichment.

## Dashboard Compatibility

For now, keep current dashboard fields as primary/default:

- `primary_industry` maps later to `mentor_profiles.industry` only if approved.
- `primary_function` maps later to `mentor_profiles.function_area` only if approved.
- `industry_experience_list` and `function_experience_list` are the richer multi-value source.

Future dashboard work should treat primary fields as summary labels, not complete mentor expertise.

## Import Guardrails

- No automatic DB update from review CSV.
- No destructive migration.
- No backfill without approval.
- No UI changes until the data model direction is approved.
- If normalizing later, preserve all multi-value labels rather than choosing only the primary fields.

## Local Sample Pipeline

The local helper script creates a first-pass manual QA sample from a Production mentor CSV export. It does not update Supabase and does not read `bio_url` content.

Input file:

- `docs/data_enrichment/production_mentor_export.csv`

Output file:

- `docs/data_enrichment/mentor_enrichment_sample_50.csv`

Run:

```bash
node scripts/enrich_mentor_sample.mjs
```

If `production_mentor_export.csv` is missing, export it from Supabase Production SQL Editor:

```sql
select
  mp.person_id,
  p.full_name,
  p.email_primary as email,
  mp.company_current,
  mp.title_current,
  mp.bio_url
from public.mentor_profiles mp
left join public.people p on p.id = mp.person_id
order by p.full_name nulls last, mp.person_id;
```

Download the SQL result as CSV and save it at `docs/data_enrichment/production_mentor_export.csv`.

The script uses deterministic keyword rules from `company_current` and `title_current` only. If the result is unclear, it leaves industry/function blank and sets `confidence` to `low`.

Google Drive CV/Profile PDFs should be reviewed later only for low-confidence rows. Do not scrape or read those PDFs in this pipeline.
