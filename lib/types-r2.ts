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
  search_blob?: string;
  batch_season_id?: string;
};
