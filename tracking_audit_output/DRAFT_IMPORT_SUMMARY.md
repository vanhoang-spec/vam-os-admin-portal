# Draft Import Summary

Generated from Tracking Season 11 audit sources.

## Counts

- Candidate mentoring rows considered: 2452
- Mentoring rows included: 901
- Mentoring rows excluded: 1551
- Event/training rows considered: 374
- Phase 2 event rows included: 0
- Rows remaining for manual review: 1955

## Mentoring Rows Excluded And Why

- cross_mentoring_needs_mentor_review: 90
- duplicate_recap_url: 594
- missing_meeting_date: 151
- missing_mentee_code: 69
- missing_url: 722
- no_active_primary_match_for_mentee_code: 190

## Event/Training Rows Excluded And Why

- outside_phase2_event_scope: 374

## Key Assumptions

- `season_code` is fixed to `UEHM-S11`.
- Only URL-backed rows were eligible for import drafts.
- Normal mentoring rows are included only when `mentee_code` resolves to one active primary match, then `mentor_email` and `match_id` are filled from that match.
- Cross mentoring rows were kept for manual review unless the cross mentor can be explicitly verified later.
- Generic training rows are not Phase 2 event import rows unless they mention Mentee Orientation, Kickoff, or Tổng kết.
- `recap_note` was intentionally shortened to avoid storing/displaying long Facebook content.
- `captured_by` is `tracking_file_import` for all draft rows.
- `walk_in` is `false` unless a source row explicitly indicates walk-in attendance.
- These files are draft CSVs only; no dry-run or import was executed.
