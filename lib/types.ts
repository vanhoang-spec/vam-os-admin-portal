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
  years_in_vam?: number | null;
  first_vam_season?: string | null;
  industry: string | null;
  function_area: string | null;
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
  // Legacy status field (Season 11 and earlier)
  final_status: string | null;
  submitted_at: string | null;
  sbd: string | null;
  // Legacy PDPA fields
  consent_pdpa: boolean | string | null;
  consent_pdpa_at: string | null;
  acquisition_channel: string | null;
  profile_url: string | null;
  // S12 native form fields (added in migration 038)
  full_name: string | null;
  email_primary: string | null;
  phone_primary: string | null;
  gender: string | null;
  intake_batch_id: string | null;
  status: string | null;
  raw_payload: Record<string, unknown> | null;
  consent_data_storage: boolean | null;
  source: string | null;
  score_total: number | null;
  score_breakdown: Record<string, unknown> | null;
  internal_notes: Record<string, unknown> | null;
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

export type Program = JsonRecord & {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type Industry = JsonRecord & {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type FunctionArea = JsonRecord & {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type MentorProgramParticipation = JsonRecord & {
  id: string;
  mentor_profile_id: string;
  program_id: string;
  status: string | null;
  role: string | null;
};

export type MentorIndustryLink = JsonRecord & {
  mentor_profile_id: string;
  industry_id: string;
};

export type MentorFunctionAreaLink = JsonRecord & {
  mentor_profile_id: string;
  function_area_id: string;
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

export type ActivityCorrectionLog = JsonRecord & {
  id: string;
  target_table: "mentoring_recaps" | "event_participations";
  target_id: string;
  correction_type: "update_field" | "status_change" | "issue_flag_change" | "admin_note" | "manual_review" | "other";
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  corrected_by: string | null;
  created_at: string;
};

export type WorkflowOwner = JsonRecord & {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

export type WorkflowQueueItem = JsonRecord & {
  id: string;
  action_type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  owner_name: string | null;
  due_date: string | null;
  entity_type: string | null;
  entity_id: string | null;
  mentee_name?: string | null;
  mentee_email?: string | null;
  mentor_name?: string | null;
  created_at: string;
  updated_at: string;
  metadata: JsonRecord;
};

export type WorkflowCorrectionLog = JsonRecord & {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  correction_type: string;
  reason: string | null;
  requested_by_name: string | null;
  reviewed_by_name: string | null;
  status: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type OperationsWorkflowData = JsonRecord & {
  summary: {
    openActionCount: number;
    overdueActionCount: number;
    followUpOpenCount: number;
    followUpResolvedCount: number;
    dataIssueOpenCount: number;
    correctionsThisMonth: number;
  };
  followUpQueue: WorkflowQueueItem[];
  dataIssuesQueue: WorkflowQueueItem[];
  correctionLog: WorkflowCorrectionLog[];
  myTasks: WorkflowQueueItem[];
  owners: WorkflowOwner[];
  currentAdmin?: { id: string; role: string };
};

export type OperationalTeamAssignment = JsonRecord & {
  id: string;
  person_id: string;
  source_role_group: string | null;
  operational_role: string | null;
  functional_team: string | null;
  team_name: string | null;
  assigned_scope: string | null;
  role_note: string | null;
  status: string | null;
  notes: string | null;
};

export type IntelligenceCountRow = JsonRecord & {
  count: number;
};

export type FounderIntelligenceDashboard = JsonRecord & {
  definitions: {
    selectedMonth: string;
    activeMentor: string;
    silentMentee: string;
    overloadedMentor: string;
    validRecapStatuses: string[];
  };
  mentorProfile: JsonRecord & {
    totalMentors: number;
    activeMentors: number;
    inactiveMentors: number;
    byIndustry: Array<{ industry: string; count: number }>;
    byFunction: Array<{ functionArea: string; count: number }>;
    byExperienceBand: Array<{ band: string; count: number }>;
    byVamSeniority: Array<{ band: string; count: number }>;
    bySeniorityLevel: Array<{ level: string; count: number }>;
    overloadedMentors: Array<JsonRecord>;
    inactiveMentorsWithMentees: Array<JsonRecord>;
  };
  menteeProfile: JsonRecord & {
    totalMentees: number;
    activeMentees: number;
    silentMentees: number;
    byMajor: Array<{ major: string; count: number }>;
    byUniversity: Array<{ university: string; count: number }>;
    byCareerInterest: Array<{ careerInterest: string; count: number }>;
    byTargetIndustry: Array<{ targetIndustry: string; count: number }>;
    byYearOfStudy: Array<{ yearOfStudy: string; count: number }>;
    bySupportTeam: Array<{ supportTeam: string; count: number }>;
  };
  matchingIntelligence: JsonRecord & {
    totalActiveMatches: number;
    mentorMenteeRatio: string;
    matchesByIndustryAlignment: Array<{ alignment: string; count: number }>;
    matchesByFunctionAlignment: Array<{ alignment: string; count: number }>;
    unmatchedOrWeakSegments: Array<JsonRecord>;
    menteesWithoutIndustryMentor: number;
    mentorSupplyVsMenteeDemand: Array<{ segment: string; mentorSupply: number; menteeDemand: number; gap: number }>;
  };
  activityBySegment: JsonRecord & {
    activeMenteeRateByMajor: Array<JsonRecord>;
    recapRateBySupportTeam: Array<JsonRecord>;
    activeMentorRateByIndustry: Array<JsonRecord>;
    silentMenteeByCareerInterest: Array<JsonRecord>;
  };
  recommendedActions: Array<{
    priority: string;
    title: string;
    reason: string;
    suggestedOwner: string;
    suggestedAction: string;
  }>;
};
