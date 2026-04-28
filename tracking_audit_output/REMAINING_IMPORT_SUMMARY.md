# Remaining Import Summary

Created after successful SAMPLE_50 mentoring recap pilot import.

## Counts

- Full draft rows: 901
- Sample rows excluded: 50
- Remaining rows: 851

## Duplicate Key

Rows were excluded when this stable key matched a row in `SAMPLE_50_mentoring_recaps_from_tracking.csv`:

- `mentee_code`
- `meeting_date`
- `recap_url`

Original full-draft row order was preserved. No dry-run or import was executed.
