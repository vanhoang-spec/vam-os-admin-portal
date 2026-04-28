export type JsonRecord = Record<string, any>;

export type Person = JsonRecord & {
  id: string;
  full_name: string | null;
  email_primary: string | null;
  phone_primary: string | null;
  gender: string | null;
  source_sheets: string | null;
  data_quality_flags: string | null;
};

export type MentorProfile = JsonRecord & {
  id: string;
  person_id: string | null;
  mentor_code: string | null;
  bio_url: string | null;
  company_current: string | null;
  title_current: string | null;
  years_experience_min: number | null;
  years_experience_text: string | null;
};

export type MenteeProfile = JsonRecord & {
  id: string;
  person_id: string | null;
  mentee_code: string | null;
  school_code: string | null;
  school_raw: string | null;
  major: string | null;
  class_cohort: string | null;
  mssv: string | null;
};

export type Application = JsonRecord & {
  id: string;
  person_id: string | null;
  season_id: string | null;
  role_applied: string | null;
  final_status: string | null;
  submitted_at: string | null;
  sbd: string | null;
  consent_pdpa: boolean | string | null;
  consent_pdpa_at: string | null;
  acquisition_channel: string | null;
  profile_url: string | null;
};

export type Match = JsonRecord & {
  id: string;
  season_id: string | null;
  mentor_person_id: string | null;
  mentee_person_id: string | null;
  status: string | null;
  match_type: string | null;
  match_source_raw: string | null;
  match_confidence: number | null;
  notes: string | null;
};

export type Season = JsonRecord & {
  id: string;
  code: string | null;
  name: string | null;
};

export type Event = JsonRecord & {
  id: string;
  legacy_event_temp_id?: string | null;
  season_id?: string | null;
  event_name?: string | null;
  event_type?: string | null;
  starts_at?: string | null;
  source_notes?: string | null;
};

export type MentoringRecap = JsonRecord & {
  id: string;
  season_id: string | null;
  match_id: string | null;
  mentor_person_id: string | null;
  mentee_person_id: string | null;
  meeting_date: string | null;
  meeting_month: string | null;
  recap_url: string | null;
  recap_source: string | null;
  recap_note: string | null;
  meeting_type?: string | null;
  captured_by?: string | null;
  issue_flag: boolean | null;
  status: string | null;
  admin_notes: string | null;
};

export type EventParticipation = JsonRecord & {
  id: string;
  event_id: string | null;
  season_id: string | null;
  person_id: string | null;
  role_at_event: string | null;
  registration_status: string | null;
  attendance_status: string | null;
  attendance_date: string | null;
  recap_url: string | null;
  excuse_reason: string | null;
  admin_notes: string | null;
  captured_by?: string | null;
  walk_in?: boolean | null;
};
