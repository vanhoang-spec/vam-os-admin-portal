import {
  MENTOR_FUNCTION_OPTIONS,
  MENTOR_INDUSTRY_OPTIONS,
  MENTOR_MEETING_FORMAT_OPTIONS,
  MENTOR_PROGRAM_OPTIONS,
  MENTOR_UNIVERSITY_OPTIONS
} from "@/lib/mentor-intake-content";

/**
 * lib/application-form-options.ts — lựa chọn của hai form nộp đơn (mentor, mentee).
 *
 * Đơn lưu MÃ của lựa chọn (vd. "training_sharing"), không lưu chữ. Trước 05/10/2026 các
 * danh sách này nằm trong component form, nên chỗ đọc đơn — "Nội dung đơn" trên phiếu
 * chấm, "Xem application" ở lịch hẹn, file xuất — chỉ có mã để in ra
 * ("training_sharing; english_mentoring; other"). Giờ form và chỗ đọc dùng chung đúng
 * một nguồn: thêm / sửa một lựa chọn ở đây là cả hai cùng đổi.
 *
 * Phần thuần, an toàn cho cả client lẫn server.
 */

export type FormOption = { value: string; label: string };

/** Danh sách lựa chọn riêng của form mentor (tên giữ nguyên như trong form). */
export const MENTOR_FORM_OPTION_LISTS = {
  CONTACT_METHOD_OPTIONS: [
    { value: "email", label: "Email" },
    { value: "zalo", label: "Zalo" },
    { value: "sms", label: "SMS" }
  ],
  GENDER_OPTIONS: [
    { value: "male", label: "Nam" },
    { value: "female", label: "Nữ" },
    { value: "other", label: "Khác" },
    { value: "prefer_not_say", label: "Không muốn chia sẻ" }
  ],
  CITY_OPTIONS: [
    { value: "hcm", label: "TP. Hồ Chí Minh" },
    { value: "hanoi", label: "Hà Nội" },
    { value: "danang", label: "Đà Nẵng" },
    { value: "other_vn", label: "Tỉnh thành khác (Việt Nam)" },
    { value: "overseas", label: "Nước ngoài" }
  ],
  YEARS_EXPERIENCE_OPTIONS: [
    { value: "1-3", label: "1-3 năm" },
    { value: "4-6", label: "4-6 năm" },
    { value: "7-10", label: "7-10 năm" },
    { value: "11-15", label: "11-15 năm" },
    { value: "16+", label: "16+ năm" }
  ],
  HIGHEST_DEGREE_OPTIONS: [
    { value: "bachelor", label: "Cử nhân" },
    { value: "master", label: "Thạc sĩ" },
    { value: "phd", label: "Tiến sĩ" },
    { value: "other", label: "Khác" }
  ],
  PRIOR_VAM_OPTIONS: [
    { value: "none", label: "Chưa từng" },
    { value: "1_season", label: "Đã từng (1 mùa)" },
    { value: "2_3_seasons", label: "Đã từng (2-3 mùa)" },
    { value: "4_plus_seasons", label: "Đã từng (4+ mùa)" }
  ],
  SME_OPTIONS: [
    { value: "yes", label: "Có" },
    { value: "no", label: "Không" },
    { value: "currently_doing", label: "Đang làm" }
  ],
  ATTEND_ORIENTATION_OPTIONS: [
    { value: "yes", label: "Có" },
    { value: "if_scheduled_well", label: "Có nếu xếp lịch hợp lý" },
    { value: "no", label: "Không" }
  ],
  INTRO_CALL_OPTIONS: [
    { value: "yes", label: "Có" },
    { value: "depends_on_schedule", label: "Tùy lịch" },
    { value: "no", label: "Không" }
  ],
  CAPACITY_OPTIONS: [
    { value: "1", label: "1 mentee" },
    { value: "2", label: "2 mentee" },
    { value: "3", label: "3 mentee" }
  ],
  MEETING_FREQUENCY_OPTIONS: [
    { value: "twice_per_month", label: "2 lần/tháng" },
    { value: "once_per_month", label: "1 lần/tháng" },
    { value: "once_per_two_months", label: "1 lần/2 tháng" },
    { value: "depends_on_mentee", label: "Tùy mentee" }
  ],
  LANGUAGE_OPTIONS: [
    { value: "vi", label: "Tiếng Việt" },
    { value: "en", label: "English" }
  ],
  ACTIVITY_OPTIONS: [
    { value: "training_sharing", label: "Training / chia sẻ chuyên đề" },
    { value: "cross_mentoring", label: "Cross mentoring" },
    { value: "english_mentoring", label: "Mentoring bằng tiếng Anh" },
    { value: "mentor_gathering", label: "Mentor gathering" },
    { value: "company_visit", label: "Kết nối tham quan doanh nghiệp" },
    { value: "internship_referral", label: "Kết nối cơ hội thực tập" },
    { value: "scholarship_sponsorship", label: "Học bổng / tài trợ khoá học / hiện vật" },
    { value: "other", label: "Khác" }
  ],
  REFERRER_OPTIONS: [
    { value: "friend", label: "Bạn bè" },
    { value: "social_media", label: "Mạng xã hội" },
    { value: "website", label: "Website chương trình" },
    { value: "ueh_alumni", label: "UEH Alumni" },
    { value: "alumni_referral", label: "Cựu mentor giới thiệu" },
    { value: "other", label: "Khác" }
  ]
};

/** Danh sách lựa chọn riêng của form mentee. */
export const MENTEE_FORM_OPTION_LISTS = {
  EMAIL_NOTIF_OPTIONS: [
    { value: "email", label: "Email" },
    { value: "zalo", label: "Zalo" }
  ],
  GENDER_OPTIONS: [
    { value: "male", label: "Nam" },
    { value: "female", label: "Nữ" },
    { value: "other", label: "Khác" },
    { value: "prefer_not_say", label: "Không muốn chia sẻ" }
  ],
  UNIVERSITY_OPTIONS: [
    { value: "UEH", label: "Đại học Kinh tế TP. Hồ Chí Minh (UEH)" },
    { value: "OTHER", label: "Trường khác" }
  ],
  FACULTY_OPTIONS: [
    { value: "tai_chinh", label: "Tài chính" },
    { value: "ke_toan", label: "Kế toán" },
    { value: "marketing", label: "Marketing" },
    { value: "kinh_doanh_quoc_te", label: "Kinh doanh quốc tế" },
    { value: "quan_tri", label: "Quản trị" },
    { value: "he_thong_thong_tin", label: "Hệ thống thông tin" },
    { value: "other", label: "Khác" }
  ],
  YEAR_OF_STUDY_OPTIONS: [
    { value: "1", label: "Năm 1" },
    { value: "2", label: "Năm 2" },
    { value: "3", label: "Năm 3" },
    { value: "4", label: "Năm 4" },
    { value: "graduated", label: "Đã tốt nghiệp" }
  ],
  TARGET_INDUSTRY_OPTIONS: [
    { value: "fmcg", label: "FMCG / Bán lẻ" },
    { value: "tech", label: "Công nghệ / Phần mềm" },
    { value: "finance_banking", label: "Tài chính / Ngân hàng" },
    { value: "consulting", label: "Tư vấn / Chiến lược" },
    { value: "manufacturing", label: "Sản xuất / Công nghiệp" },
    { value: "education", label: "Giáo dục / Đào tạo" },
    { value: "healthcare", label: "Y tế / Dược" },
    { value: "media_creative", label: "Truyền thông / Sáng tạo" },
    { value: "logistics", label: "Logistics / Vận chuyển" },
    { value: "real_estate", label: "Bất động sản / Xây dựng" },
    { value: "energy_environment", label: "Năng lượng / Môi trường" },
    { value: "public_nonprofit", label: "Khu vực công / Phi lợi nhuận" },
    { value: "undecided", label: "Chưa xác định rõ" },
    { value: "other", label: "Khác" }
  ],
  TARGET_FUNCTION_OPTIONS: [
    { value: "marketing", label: "Marketing / Brand" },
    { value: "sales_bd", label: "Sales / Business Development" },
    { value: "finance_accounting", label: "Tài chính / Kế toán" },
    { value: "hr_people", label: "Nhân sự / People" },
    { value: "operations", label: "Vận hành / Operations" },
    { value: "tech_engineering", label: "Tech / Engineering" },
    { value: "data_analytics", label: "Data / Analytics" },
    { value: "product", label: "Product Management" },
    { value: "strategy_consulting", label: "Strategy / Consulting" },
    { value: "supply_chain", label: "Supply Chain / Logistics" },
    { value: "general_management", label: "Quản trị tổng hợp" },
    { value: "undecided", label: "Chưa xác định rõ" },
    { value: "other", label: "Khác" }
  ],
  SOFT_SKILL_OPTIONS: [
    { value: "communication", label: "Communication" },
    { value: "leadership", label: "Leadership" },
    { value: "critical_thinking", label: "Critical thinking" },
    { value: "time_management", label: "Time management" },
    { value: "negotiation", label: "Negotiation" },
    { value: "public_speaking", label: "Public speaking" },
    { value: "other", label: "Khác" }
  ],
  MEETING_FORMAT_OPTIONS: [
    { value: "online", label: "Online" },
    { value: "offline", label: "Offline" },
    { value: "both", label: "Cả hai" }
  ],
  MENTOR_GENDER_PREF_OPTIONS: [
    { value: "no_preference", label: "Không quan trọng" },
    { value: "male", label: "Nam" },
    { value: "female", label: "Nữ" }
  ],
  TRAINING_TOPIC_OPTIONS: [
    { value: "cv_interview", label: "CV / Interview" },
    { value: "data_skills", label: "Excel / Power BI / Data skills" },
    { value: "communication_presentation", label: "Communication / Presentation" },
    { value: "personal_branding", label: "Personal branding / LinkedIn" },
    { value: "problem_solving", label: "Problem solving / Critical thinking" },
    { value: "career_orientation", label: "Career orientation" },
    { value: "networking", label: "Networking" },
    { value: "wellbeing", label: "Mental well-being / emotional management" },
    { value: "other", label: "Khác" }
  ],
  INTERVIEW_WINDOW_OPTIONS: [
    { value: "week_1", label: "Đợt 1: 03–04/10" },
    { value: "week_2", label: "Đợt 2: 10–11/10" },
    { value: "both_weeks", label: "Cả hai đợt đều được" }
  ],
  KICKOFF_OPTIONS: [
    { value: "yes", label: "Có" },
    { value: "if_scheduled_well", label: "Có nếu xếp lịch hợp lý" },
    { value: "no", label: "Không" }
  ],
  REFERRER_OPTIONS: [
    { value: "friend", label: "Bạn bè" },
    { value: "social_media", label: "Mạng xã hội" },
    { value: "school_referral", label: "Khoa / trường giới thiệu" },
    { value: "email", label: "Email từ chương trình" },
    { value: "other", label: "Khác" }
  ]
};

const M = MENTOR_FORM_OPTION_LISTS;
const E = MENTEE_FORM_OPTION_LISTS;

/** Khoá trong đơn (raw_payload) → danh sách lựa chọn, đúng như form mentor gắn. */
export const MENTOR_APPLICATION_FIELD_OPTIONS: Readonly<Record<string, readonly FormOption[]>> = {
  consent_contact_methods: M.CONTACT_METHOD_OPTIONS,
  gender: M.GENDER_OPTIONS,
  current_city: M.CITY_OPTIONS,
  years_of_experience: M.YEARS_EXPERIENCE_OPTIONS,
  industry_primary: MENTOR_INDUSTRY_OPTIONS,
  function_primary: MENTOR_FUNCTION_OPTIONS,
  secondary_industries_functions: [...MENTOR_INDUSTRY_OPTIONS, ...MENTOR_FUNCTION_OPTIONS],
  highest_degree: M.HIGHEST_DEGREE_OPTIONS,
  university: MENTOR_UNIVERSITY_OPTIONS,
  prior_vam_involvement: M.PRIOR_VAM_OPTIONS,
  sme_mentoring_experience: M.SME_OPTIONS,
  can_attend_orientation: M.ATTEND_ORIENTATION_OPTIONS,
  open_to_intro_call: M.INTRO_CALL_OPTIONS,
  mentoring_capacity_total: M.CAPACITY_OPTIONS,
  meeting_frequency: M.MEETING_FREQUENCY_OPTIONS,
  meeting_format_preference: MENTOR_MEETING_FORMAT_OPTIONS,
  preferred_language: M.LANGUAGE_OPTIONS,
  programs_willing_to_join: MENTOR_PROGRAM_OPTIONS,
  activities_willing_to_support: M.ACTIVITY_OPTIONS,
  referrer_or_source: M.REFERRER_OPTIONS
};

/** Khoá trong đơn (raw_payload) → danh sách lựa chọn, đúng như form mentee gắn. */
export const MENTEE_APPLICATION_FIELD_OPTIONS: Readonly<Record<string, readonly FormOption[]>> = {
  email_notification_consent: E.EMAIL_NOTIF_OPTIONS,
  gender: E.GENDER_OPTIONS,
  university: E.UNIVERSITY_OPTIONS,
  school_or_faculty: E.FACULTY_OPTIONS,
  year_of_study: E.YEAR_OF_STUDY_OPTIONS,
  target_industry: E.TARGET_INDUSTRY_OPTIONS,
  target_function: E.TARGET_FUNCTION_OPTIONS,
  target_soft_skills: E.SOFT_SKILL_OPTIONS,
  meeting_format_preference: E.MEETING_FORMAT_OPTIONS,
  mentor_gender_preference: E.MENTOR_GENDER_PREF_OPTIONS,
  training_topics_interest: E.TRAINING_TOPIC_OPTIONS,
  available_for_interview: E.INTERVIEW_WINDOW_OPTIONS,
  available_for_kickoff: E.KICKOFF_OPTIONS,
  referrer_or_source: E.REFERRER_OPTIONS
};

/**
 * Bảng dịch mã → chữ theo từng câu hỏi, gộp hai form. Bốn câu hỏi dùng chung tên khoá
 * (giới tính, trường, hình thức gặp, nguồn biết đến) có mã trùng thì cùng nghĩa — test
 * khoá điều đó; nếu một ngày hai form cho cùng mã hai nghĩa khác nhau, test sẽ đỏ.
 * Form mentee đứng trước vì chữ của nó ngắn hơn ("Offline" thay vì "Offline (gặp trực tiếp)").
 */
const OPTION_LABELS: ReadonlyMap<string, ReadonlyMap<string, string>> = (() => {
  const byKey = new Map<string, Map<string, string>>();
  for (const table of [MENTEE_APPLICATION_FIELD_OPTIONS, MENTOR_APPLICATION_FIELD_OPTIONS]) {
    for (const [key, options] of Object.entries(table)) {
      const labels = byKey.get(key) ?? new Map<string, string>();
      for (const option of options) if (!labels.has(option.value)) labels.set(option.value, option.label);
      byKey.set(key, labels);
    }
  }
  return byKey;
})();

/**
 * Chữ của một mã lựa chọn, theo khoá trong đơn. `key` có thể là đường dẫn
 * ("renewal.meeting_format_preference", "x[2]") — chỉ phần cuối được xét.
 * Không phải câu hỏi có lựa chọn, hoặc mã lạ (đơn cũ, form đã đổi) → trả nguyên giá trị:
 * thà hiện mã còn hơn hiện sai chữ.
 */
export function applicationOptionLabel(key: string, value: string): string {
  const last = String(key).split(".").pop() ?? "";
  const bare = last.replace(/\[\d+\]$/, "");
  return OPTION_LABELS.get(bare)?.get(value) ?? value;
}
