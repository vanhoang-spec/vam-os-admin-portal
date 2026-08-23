export type ApplicationListRowV1 = {
  id: string;
  person_id: string | null;
  season_id: string;
  intake_batch_id: string | null;
  role_applied: string;
  sbd: string | null;
  source: string | null;
  acquisition_channel: string | null;
  submitted_at: string;
  status_unified: string | null;
  consent_unified: string | null;
  full_name: string | null;
  email_primary: string | null;
  season_code: string | null;
  intake_batch_code: string | null;
  assigned_reviewers_count: number;
  submitted_reviews_count: number;
  review_conflict_status: "pending" | "aligned" | "needs_admin_review";
  /** Aggregate only; no reviewer recommendation is exposed by the list view. */
  has_conflict: boolean;
  /** Blinded search projection: excludes applicant email values. */
  search_blob?: string;
  batch_season_id?: string;
};
