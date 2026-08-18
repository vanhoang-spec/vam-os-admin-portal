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
  /** Phase 043: which application created this profile (null for S11 legacy rows). */
  source_application_id?: string | null;
  /** Phase 043: intake batch the applicant came from (null for S11 legacy rows). */
  intake_batch_id?: string | null;
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
  /** Phase 043: which application created this profile (null for S11 legacy rows). */
  source_application_id?: string | null;
  /** Phase 043: intake batch the applicant came from (null for S11 legacy rows). */
  intake_batch_id?: string | null;
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
  /** Phase 046A — manual matching foundation */
  mentor_profile_id?: string | null;
  mentee_profile_id?: string | null;
  intake_batch_id?: string | null;
  match_source?: string | null;
  matched_by?: string | null;
  matched_at?: string | null;
  ended_at?: string | null;
  end_reason?: string | null;
  admin_notes?: string | null;
};

/** Lightweight admin_users projection used for reviewer assignment dropdowns. */
export type AdminUserPublic = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
};

/** One review assignment + scoring record in public.application_reviews. */
export type ApplicationReview = JsonRecord & {
  id: string;
  application_id: string;
  review_round: string; // 'profile_screening' | 'interview'
  reviewer_admin_user_id: string | null;
  reviewer_person_id: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  due_at: string | null;
  status: string; // 'assigned' | 'in_progress' | 'submitted' | 'returned_for_clarification' | 'cancelled'
  score_motivation: number | null;
  score_goal_clarity: number | null;
  score_commitment: number | null;
  score_fit: number | null;
  score_communication: number | null;
  total_score: number | null;
  recommendation: string | null;
  reviewer_note: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  /** Phase 044a: which bulk-assignment batch created this review row. */
  assignment_batch_id?: string | null;
  /** Phase 044B: timestamp when reviewer self-claimed this review. */
  claimed_at?: string | null;
  /** Phase 044B: "self_claim" | "bulk_assign" | null (legacy). */
  claim_source?: string | null;
};

/** Audit record for one bulk-assignment operation. */
export type ReviewAssignmentBatch = JsonRecord & {
  id: string;
  intake_batch_id: string | null;
  review_round: string;
  created_by: string | null;
  created_at: string;
  due_at: string | null;
  assignment_note: string | null;
  application_count: number | null;
  reviewer_count: number | null;
};

/**
 * Lightweight application row used in the bulk-assignment UI.
 * Includes a pre-computed count of existing profile_screening reviews.
 */
export type ReviewAssignableApplication = {
  id: string;
  full_name: string | null;
  email_primary: string | null;
  role_applied: string | null;
  status: string | null;
  submitted_at: string | null;
  intake_batch_id: string | null;
  existing_review_count: number;
};

/**
 * Active admin user enriched with current review workload.
 * Used in the bulk-assignment reviewer checklist.
 */
export type ReviewEligibleReviewer = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  current_workload: number;
};

/** Per-reviewer progress row for the /reviews/progress dashboard. */
export type ReviewProgressRow = {
  reviewer_admin_user_id: string | null;
  reviewer_name: string | null;
  reviewer_email: string | null;
  assigned_count: number;
  submitted_count: number;
  in_progress_count: number;
  pending_count: number;
  cancelled_count: number;
  latest_submitted_at: string | null;
};

/** One admin/core-team decision recorded against an application. */
export type ApplicationDecision = JsonRecord & {
  id: string;
  application_id: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decision: string;
  previous_status: string | null;
  new_status: string;
  decision_note: string | null;
  created_at: string;
};

export type Season = JsonRecord & {
  id: string;
  code: string | null;
  name: string | null;
};

export type IntakeBatch = JsonRecord & {
  id: string;
  season_id: string | null;
  code: string | null;
  name: string | null;
  is_active: boolean;
};

/**
 * One mentor enriched with their current admin_user reviewer status.
 * Used in the /reviews/reviewer-pool page.
 * Joined in JS: mentor_profiles → people (person_id) → admin_users (email).
 */
export type ReviewerPoolRow = {
  mentor_profile_id: string;
  person_id: string | null;
  full_name: string | null;
  email_primary: string | null;
  mentor_code: string | null;
  intake_batch_id: string | null;
  /** null when no admin_users row exists for this mentor's email. */
  admin_user_id: string | null;
  admin_user_role: string | null;
  admin_user_status: string | null;
};

/**
 * One application candidate eligible for interview self-claim.
 * Enriched with the first active (non-cancelled) interview review for the app.
 * Used in the /interviews self-claim page.
 */
export type InterviewCandidateRow = {
  id: string;
  full_name: string | null;
  email_primary: string | null;
  phone_primary: string | null;
  status: string | null;
  intake_batch_id: string | null;
  role_applied: string | null;
  sbd: string | null;
  submitted_at: string | null;
  /** null when no active interview review exists yet. */
  interview_review_id: string | null;
  interview_review_status: string | null;
  interview_reviewer_admin_user_id: string | null;
  interview_reviewer_name: string | null;
  /** Migration 067 - the appointment; null for a review claimed on the day. */
  interview_scheduled_at: string | null;
  interview_mode: string | null;
  interview_location: string | null;
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
  /** Phase 045A: optional link to a specific intake batch. */
  intake_batch_id?: string | null;
  event_name?: string | null;
  event_type?: string | null;
  /** Phase 045A: "active" (default) | "cancelled". */
  status?: "active" | "cancelled" | string | null;
  starts_at?: string | null;
  source_notes?: string | null;

  // ── Phase 2: configurable registration & check-in fields ─────────────────
  /** If true, a pre-existing non-cancelled registration is required to check in. */
  registration_required?: boolean | null;
  /** If true, new public registrations start as pending_review. */
  approval_required?: boolean | null;
  /** Master toggle for capacity enforcement. */
  capacity_limit_enabled?: boolean | null;
  /** Max number of confirmed/registered registrants (enforced when capacity_limit_enabled). */
  capacity_limit?: number | null;
  /** When capacity is full, route new registrations to waitlisted. */
  waitlist_enabled?: boolean | null;
  /** If false, walk-in check-in is blocked. Default: true (open behaviour). */
  allow_walk_in?: boolean | null;
  /**
   * Check-in mode:
   *   "open"                 — anyone with the link may check in (default)
   *   "registration_required"— must have a non-cancelled registration
   *   "confirmed_only"       — must have registration_status = 'confirmed'
   *   "manual_admin_only"    — public check-in is entirely disabled
   */
  checkin_mode?: "open" | "registration_required" | "confirmed_only" | "manual_admin_only" | string | null;
  /** Enable checkin_opens_at / checkin_closes_at time gates. */
  checkin_window_enabled?: boolean | null;
  /** Earliest time check-in is accepted (when checkin_window_enabled). */
  checkin_opens_at?: string | null;
  /** Latest time check-in is accepted (when checkin_window_enabled). */
  checkin_closes_at?: string | null;
  /** Master toggle for proof/evidence collection. */
  proof_required?: boolean | null;
  /** Custom label for the proof field shown on the public form. */
  proof_label?: string | null;
  /** Helper text explaining what proof is required. */
  proof_description?: string | null;
  /** If true, proof must be submitted at registration time. */
  proof_required_for_registration?: boolean | null;
  /** If true, proof must be submitted/accepted before check-in is allowed. */
  proof_required_for_checkin?: boolean | null;
  /** If true, a question-to-speaker/organiser field appears on the form. */
  question_collection_enabled?: boolean | null;
  /** Custom label for the speaker question field. */
  speaker_question_label?: string | null;
  /** If true, display no_show_policy_text prominently on the registration form. */
  no_show_policy_enabled?: boolean | null;
  /** Policy text warning about consequences for confirmed no-shows. */
  no_show_policy_text?: string | null;
  /** Master toggle for fee collection. */
  fee_required?: boolean | null;
  /** Fee amount (in fee_currency). */
  fee_amount?: number | null;
  /** Currency code, e.g. "VND". */
  fee_currency?: string | null;
  /** Description of what the fee covers. */
  fee_description?: string | null;
  /** How to pay — bank account, QR description, contact person, etc. */
  payment_instruction?: string | null;
  /** If true, payment proof URL must be submitted with registration. */
  payment_proof_required?: boolean | null;
  // ── Phase 2B: optional meal / lunch add-on ───────────────────────────────
  /** If true, a meal/lunch choice is shown on the public registration form. */
  meal_option_enabled?: boolean | null;
  /** Label for the meal option shown on the form (e.g. "Cơm trưa"). */
  meal_label?: string | null;
  /** Fee for the meal add-on (in meal_fee_currency). */
  meal_fee_amount?: number | null;
  /** Currency code for the meal fee, e.g. "VND". */
  meal_fee_currency?: string | null;
  /** Payment/transfer instructions specific to the meal add-on. */
  meal_payment_instruction?: string | null;
  /** If true, payment proof must be submitted at registration when meal is selected. */
  meal_payment_proof_required?: boolean | null;
  /** Public-facing event description (distinct from admin-only source_notes). */
  event_description?: string | null;
  // Field-visibility toggles
  show_student_id_field?: boolean | null;
  student_id_required?: boolean | null;
  show_mentee_code_field?: boolean | null;
  mentee_code_required?: boolean | null;
  show_school_field?: boolean | null;
  show_program_field?: boolean | null;
  show_role_text_field?: boolean | null;
  show_notes_field?: boolean | null;
};

export type EventLink = JsonRecord & {
  id: string;
  event_id: string;
  link_type: "registration" | "checkin" | string;
  token: string;
  is_active: boolean;
  opens_at: string | null;
  closes_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRegistration = JsonRecord & {
  id: string;
  event_id: string;
  event_link_id: string | null;
  linked_person_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  student_id: string | null;
  school: string | null;
  program_of_study: string | null;
  role_text: string | null;
  notes: string | null;
  consent_given: boolean;
  registration_source: "public_form" | "admin_input" | "walk_in" | "imported" | string;
  /**
   * Phase 2 expanded values:
   *   "registered"    — accepted, no review needed (open events)
   *   "pending_review"— submitted, awaiting admin confirmation
   *   "confirmed"     — admin confirmed; required for confirmed_only check-in
   *   "waitlisted"    — capacity full; may be promoted if slot opens
   *   "rejected"      — admin rejected; may not attend
   *   "cancelled"     — registrant or admin cancelled
   */
  registration_status:
    | "registered"
    | "cancelled"
    | "pending_review"
    | "confirmed"
    | "waitlisted"
    | "rejected"
    | string;
  attendance_status: "pending" | "checked_in" | "no_show" | "cancelled" | string;
  is_walk_in: boolean;
  registered_at: string;
  checked_in_at: string | null;
  checkin_source: "self_qr" | "admin_manual" | "imported" | string | null;
  match_method: "exact_email" | "mssv" | "phone_pending" | "manual" | "unlinked" | string;
  match_review_status: "auto_linked" | "pending_review" | "confirmed" | "rejected" | string;
  matched_at: string | null;
  created_at: string;
  updated_at: string;

  // ── Phase 2 fields (all optional / nullable) ──────────────────────────────
  /** VAM-assigned mentee code (collected when show_mentee_code_field = true). */
  mentee_code?: string | null;
  /** Registrant's question for the speaker / organiser. */
  speaker_question?: string | null;
  /** URL of proof submitted by registrant (Phase 2A: external link). */
  proof_url?: string | null;
  /** Optional note accompanying the proof submission. */
  proof_note?: string | null;
  /** not_required | submitted | accepted | rejected */
  proof_status?: "not_required" | "submitted" | "accepted" | "rejected" | string | null;
  /** When an admin reviewed the proof. */
  proof_reviewed_at?: string | null;
  /** admin_users.id of the reviewer. */
  proof_reviewed_by?: string | null;
  /** Admin's note on proof acceptance or rejection. */
  proof_review_note?: string | null;
  /**
   * Admin review workflow status (separate from registration_status).
   *   pending | approved | rejected | null
   */
  review_status?: "pending" | "approved" | "rejected" | string | null;
  /** Admin note when confirming or rejecting. */
  review_note?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  waitlisted_at?: string | null;
  /** Position in the waitlist queue (1-based). */
  waitlist_position?: number | null;
  waitlisted_by?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  reject_reason?: string | null;
  /** Timestamp when admin or registrant cancelled the registration. */
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  /** not_required | pending | submitted | confirmed | rejected */
  payment_status?: "not_required" | "pending" | "submitted" | "confirmed" | "rejected" | string | null;
  /** URL of payment proof (Phase 2A: external link). */
  payment_proof_url?: string | null;
  payment_proof_note?: string | null;
  payment_confirmed_at?: string | null;
  payment_confirmed_by?: string | null;
  payment_rejected_at?: string | null;
  payment_rejected_by?: string | null;
  payment_rejection_note?: string | null;
  /** True when admin flags this as a no-show post-event. */
  no_show_flagged?: boolean | null;
  no_show_flagged_at?: string | null;
  no_show_flagged_by?: string | null;
  /** Escalation from no_show_flagged. Manual admin action only. */
  blacklist_flag?: boolean | null;
  blacklist_note?: string | null;
  // ── Phase 2B: optional meal / lunch add-on ───────────────────────────────
  /** Whether the registrant selected the meal/lunch add-on. */
  meal_selected?: boolean | null;
  /** Denormalized meal label from event config at registration time. */
  meal_label?: string | null;
  /** Denormalized meal fee amount from event config at registration time. */
  meal_fee_amount?: number | null;
  /** Denormalized meal fee currency from event config at registration time. */
  meal_fee_currency?: string | null;
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
