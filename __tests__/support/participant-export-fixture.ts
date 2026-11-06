/** Dữ liệu thử cho VAM00025 (xuất hồ sơ Mentor/Mentee). Toàn bộ là người giả, email @example.test. */

export const uuid = (n: number, kind = 0) => `${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SEASON_ID = uuid(1, 1);
export const SEASON_CODE = "UEHM-S12";
export const BATCH_ID = uuid(1, 2);

/** Một dòng `people` đủ mọi cột như `select *` trả về: cột không có giá trị vẫn có mặt, mang null. */
export function personRow(n: number, partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuid(n, 3),
    legacy_person_temp_id: null,
    full_name: `Người Thử ${n}`,
    full_name_normalized: null,
    email_primary: `nguoi${n}@example.test`,
    phone_primary: `09000000${String(n).padStart(2, "0")}`,
    phone_raw: null,
    gender: "female",
    date_of_birth: null,
    facebook_url: null,
    preferred_language: null,
    consent_pdpa: null,
    consent_pdpa_at: null,
    consent_marketing_email: null,
    source_sheets: null,
    source_sheet: null,
    source_row_id: null,
    data_quality_flags: null,
    member_code: null,
    created_at: "2026-09-01T03:00:00Z",
    updated_at: "2026-09-02T03:00:00Z",
    ...partial
  };
}

export function mentorProfileRow(n: number, partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuid(n, 4),
    person_id: uuid(n, 3),
    mentor_code: null,
    bio_url: null,
    company_current: null,
    title_current: null,
    alma_mater: null,
    first_joined_year: null,
    years_experience_min: null,
    years_experience_text: null,
    interests_text: null,
    support_team_lead: null,
    admin_notes: null,
    source_sheet: null,
    source_row_id: null,
    created_at: "2026-09-01T03:00:00Z",
    updated_at: "2026-09-02T03:00:00Z",
    current_company: null,
    current_title: null,
    industry: null,
    function_area: null,
    years_of_experience: null,
    years_in_vam: null,
    capacity_target: null,
    seniority_level: null,
    first_vam_season: null,
    source_application_id: null,
    intake_batch_id: null,
    mentor_type: null,
    bio_short: null,
    linkedin_url: null,
    ...partial
  };
}

export function menteeProfileRow(n: number, partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuid(n, 5),
    person_id: uuid(n, 3),
    mentee_code: null,
    school_code: null,
    school_raw: null,
    mssv: null,
    mssv_raw: null,
    major: null,
    class_cohort: null,
    gpa_4: null,
    has_prior_season: null,
    source_sheet: null,
    source_row_id: null,
    created_at: "2026-09-01T03:00:00Z",
    updated_at: "2026-09-02T03:00:00Z",
    university: null,
    career_interest: null,
    target_industry: null,
    year_of_study: null,
    support_team: null,
    source_application_id: null,
    intake_batch_id: null,
    school_or_faculty: null,
    graduation_year: null,
    target_function: null,
    english_level: null,
    location: null,
    mentee_status: null,
    ...partial
  };
}
