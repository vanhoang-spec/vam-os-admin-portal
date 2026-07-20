/**
 * Supabase column-select strings used by lib/data.ts.
 * Kept in a dependency-free file so tests can assert on their contents
 * without importing the full data layer.
 */

/** Columns returned by getOperationsData for mentoring_recaps.
 *  Must include admin_notes, recap_source, issue_flag, meeting_type
 *  so that computeS11RecapReconciliation receives all required fields. */
export const OPS_RECAPS_SELECT =
  "id,season_id,match_id,mentor_person_id,mentee_person_id,meeting_date,meeting_month,recap_url,recap_source,recap_note,meeting_type,captured_by,issue_flag,status,admin_notes";
