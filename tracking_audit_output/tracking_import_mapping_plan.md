# Tracking Import Mapping Plan

## Source Recommendation

The most reliable import source appears to be `Raw data`, because each row has Facebook recap content plus embedded hyperlink targets on the content/poster cells. `Cleaning data` is useful as a helper/derived parsing sheet because it contains extracted codes, mentor names, and type flags, but it does not consistently preserve a clean URL value in plain text.

Do not import directly from the workbook yet. First generate a reviewed CSV using `templates/mentoring_recaps_import_template.csv` and/or `templates/event_participations_import_template.csv`.

## Sheet Classification

| Class | Sheets |
|---|---|
| A. Raw recap/event source data | Sheet20, Raw data, Cleaning data |
| B. Mentee-level monthly recap totals | Mentee Tracking |
| C. Mentor-level tracking | Mentor Tracking |
| D. Summary/control totals | Overview, Báo cáo Recap |
| E. Helper/draft sheets | nháp tháng 1, Sheet18, Sheet12, Sheet15 |

## Recap Audit Counts

- Total recap-like rows found across workbook: 6397
- Rows likely importable to `mentoring_recaps` after review: 748
- Rows likely event/training recaps: 1224
- Rows needing manual review: 5649
- Rows missing URL: 2717
- Rows missing mentee code: 298
- Rows with ambiguous mentor: 5122

By detected recap type:

- cross mentoring: 210
- mentoring: 4954
- other/unknown: 9
- training/event: 1224

By source sheet:

- Cleaning data: 1824
- DATA TỔNG: 1
- Raw data: 1824
- Sheet12: 58
- Sheet15: 1031
- Sheet18: 264
- Sheet20: 519
- nháp tháng 1: 876

## Mapping to `mentoring_recaps`

| Target field | Source / derivation |
|---|---|
| `season_code` | Fixed value for Season 11, likely `UEHM-S11` or the current production season code. Confirm before import. |
| `mentee_email` | Not consistently present in raw recap rows; resolve via mentee code against VAM OS. |
| `mentee_code` | Extract first UEH mentee-like code from recap content. Manual review if multiple codes or no code. |
| `mentor_email` | Not consistently present in raw recap rows; resolve via match table after mentee/mentor name review. |
| `mentor_code` | Not consistently present in raw recap rows. |
| `match_id` | Resolve by active match where mentee and mentor match; otherwise leave blank for importer to resolve if possible. |
| `meeting_date` | Prefer date inside recap title/content if parsed; fallback to Facebook post date. Manual review for mismatch. |
| `meeting_month` | `YYYY-MM` from `meeting_date`. |
| `recap_url` | Embedded Facebook hyperlink target from raw content/poster cell. |
| `recap_source` | `facebook_group`. |
| `recap_note` | Short content excerpt or admin note; do not copy full post into VAM OS. |
| `issue_flag` | `true` when URL/code/mentor/date is ambiguous; otherwise `false`. |
| `admin_notes` | Manual review reason, if any. |

## Mapping to `event_participations`

Training/event recap rows should not be imported to `mentoring_recaps`. For Phase 2 event scope, only map rows that relate to:

- Mentee Orientation
- Kickoff
- T?ng k?t

Rows mentioning generic training sessions should be reviewed against the finalized Phase 2 scope before import.

## Before Importing

1. Confirm the production Season 11 code.
2. Decide whether historical training rows outside the three Phase 2 events should be excluded or archived only.
3. Review `tracking_raw_recap_audit_sample.csv` and `manual_review_needed.csv`.
4. Generate clean import CSVs from reviewed rows only.
5. Run the activity import runner in `--dry-run` mode first.
