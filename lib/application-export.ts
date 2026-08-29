import { applicationStatusLabel } from "@/lib/ui-labels";
import type { Application, JsonRecord, MenteeProfile, MentorProfile, Person, Season } from "@/lib/types";

export type ApplicationExportField = {
  section: string;
  label: string;
  value: string;
};

export type ApplicationExportData = {
  applicationId: string;
  applicantName: string;
  role: "Mentor" | "Mentee" | string;
  season: string;
  fields: ApplicationExportField[];
};

export type ApplicationExportSource = {
  application: Application;
  answers: JsonRecord[];
  person: Person | null;
  mentorProfile: MentorProfile | null;
  menteeProfile: MenteeProfile | null;
  season: Season | null;
};

const RAW_PAYLOAD_LABELS: Record<string, string> = {
  consent_contact_methods: "Kênh liên hệ đã đồng ý",
  email_notification_consent: "Đồng ý nhận thông báo qua email",
  gender_other: "Giới tính khác",
  preferred_name: "Tên muốn được gọi",
  year_of_birth: "Năm sinh",
  current_city: "Thành phố hiện tại",
  social_contact: "Kênh liên hệ mạng xã hội",
  linkedin_url: "LinkedIn",
  company_current: "Công ty hiện tại",
  title_current: "Chức danh hiện tại",
  years_of_experience: "Số năm kinh nghiệm",
  industry_primary: "Ngành nghề chính",
  industry_primary_other: "Ngành nghề chính khác",
  function_primary: "Chức năng chuyên môn chính",
  function_primary_other: "Chức năng chuyên môn khác",
  secondary_industries_functions: "Ngành / chức năng phụ",
  secondary_industries_functions_other: "Ngành / chức năng phụ khác",
  highest_degree: "Bằng cấp cao nhất",
  highest_degree_other: "Bằng cấp khác",
  university: "Trường đại học",
  university_other: "Trường đại học khác",
  prior_vam_involvement: "Kinh nghiệm tham gia VAM",
  first_vam_season: "Mùa đầu tiên tham gia VAM",
  sme_mentoring_experience: "Kinh nghiệm mentoring SME",
  motivation_text: "Động lực tham gia",
  can_attend_orientation: "Có thể tham gia buổi định hướng",
  open_to_intro_call: "Sẵn sàng tham gia cuộc gọi giới thiệu",
  mentoring_capacity_total: "Số mentee có thể đồng hành",
  meeting_frequency: "Tần suất gặp mong muốn",
  meeting_format_preference: "Hình thức gặp mong muốn",
  preferred_mentee_persona: "Chân dung mentee mong muốn",
  preferred_language: "Ngôn ngữ ưu tiên",
  programs_willing_to_join: "Chương trình sẵn sàng tham gia",
  mentoring_topics: "Chủ đề mentoring",
  activities_willing_to_support: "Hoạt động sẵn sàng hỗ trợ",
  activities_willing_to_support_other: "Hoạt động hỗ trợ khác",
  bio_or_cv_url: "Liên kết Bio / CV",
  profile_picture_url: "Liên kết ảnh hồ sơ",
  referrer_or_source: "Kênh biết đến chương trình",
  referrer_or_source_other: "Kênh biết đến khác",
  additional_notes: "Thông tin bổ sung",
  mentor_total_work_years: "Tổng số năm kinh nghiệm làm việc",
  mentor_people_management_years: "Số năm quản lý con người / đội ngũ",
  mentor_largest_team_size: "Đội ngũ lớn nhất trực tiếp quản lý",
  mentor_reference: "Người giới thiệu / tham chiếu",
  school_or_faculty: "Trường / khoa",
  school_or_faculty_other: "Trường / khoa khác",
  major: "Ngành học",
  class_cohort: "Khóa / lớp",
  year_of_study: "Năm học",
  mssv: "Mã số sinh viên",
  gpa_4: "GPA (thang 4)",
  target_industry: "Ngành nghề mục tiêu",
  target_industry_other: "Ngành nghề mục tiêu khác",
  target_function: "Chức năng mục tiêu",
  target_function_other: "Chức năng mục tiêu khác",
  one_year_vision_text: "Hình dung bản thân sau một năm",
  mentoring_goals_text: "Mục tiêu mentoring",
  top_3_questions_for_mentor: "Ba câu hỏi dành cho Mentor",
  current_difficulty_text: "Khó khăn hiện tại",
  target_soft_skills: "Kỹ năng mềm muốn phát triển",
  target_soft_skills_other: "Kỹ năng mềm khác",
  mentor_gender_preference: "Ưu tiên giới tính Mentor",
  training_topics_interest: "Chủ đề đào tạo quan tâm",
  training_topics_interest_other: "Chủ đề đào tạo khác",
  why_uem_text: "Lý do chọn UEH Mentoring",
  mentoring_plan_text: "Kế hoạch trong mùa mentoring",
  if_not_effective_text: "Cách xử lý khi mentoring chưa hiệu quả",
  commitment_understanding: "Xác nhận hiểu cam kết",
  available_for_interview: "Khung giờ phỏng vấn",
  available_for_kickoff: "Có thể tham gia kickoff"
};

const SECTION_ORDER = ["Thông tin ứng viên", "Thông tin ứng tuyển", "Hồ sơ Mentor", "Hồ sơ Mentee", "Nội dung form S12", "Câu trả lời ứng tuyển"];

/**
 * Defense-in-depth for future raw_payload writers. Applicant fields remain
 * forward-compatible, but exact normalized path segments reserved for
 * internal, authorization, scoring, or secret metadata never become exports.
 */
export const INTERNAL_RAW_PAYLOAD_SEGMENTS = new Set([
  "internal_notes",
  "score",
  "score_breakdown",
  "reviewer",
  "reviewed_by",
  "decision",
  "admin",
  "token",
  "token_hash",
  "secret",
  "password",
  "credential",
  "api_key",
  "scope"
]);

function normalizePathSegment(segment: string) {
  return segment
    .normalize("NFKC")
    .replace(/\[\d+\]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isInternalRawPayloadSegment(segment: string) {
  return INTERNAL_RAW_PAYLOAD_SEGMENTS.has(normalizePathSegment(segment));
}

function text(value: unknown): string {
  if (value === true) return "Có";
  if (value === false) return "Không";
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(text).filter((item) => item !== "-").join("; ") || "-";
  return String(value);
}

function formatDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
}

function roleLabel(value: unknown) {
  const role = String(value ?? "").toLowerCase();
  if (role === "mentor") return "Mentor";
  if (role === "mentee") return "Mentee";
  return text(value);
}

function genderLabel(value: unknown) {
  const gender = String(value ?? "").toLowerCase();
  if (gender === "male") return "Nam";
  if (gender === "female") return "Nữ";
  if (gender === "other") return "Khác";
  if (gender === "undisclosed") return "Không muốn tiết lộ";
  return text(value);
}

function humanizeKey(key: string) {
  return RAW_PAYLOAD_LABELS[key] ?? key.replace(/[._]/g, " ").replace(/\[(\d+)\]/g, " $1");
}

export function flattenRawPayload(payload: Record<string, unknown> | null): Array<{ key: string; value: string }> {
  if (!payload) return [];
  const rows: Array<{ key: string; value: string }> = [];

  function visit(value: unknown, path: string) {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
        const rendered = value.filter((item) => item !== null).map(text).join("; ");
        if (rendered) rows.push({ key: path, value: rendered });
        return;
      }
      value.forEach((item, index) => visit(item, `${path}[${index + 1}]`));
      return;
    }
    if (typeof value === "object") {
      Object.keys(value as Record<string, unknown>)
        .sort((a, b) => a.localeCompare(b, "vi"))
        .filter((key) => !isInternalRawPayloadSegment(key))
        .forEach((key) => visit((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
      return;
    }
    rows.push({ key: path, value: text(value) });
  }

  Object.keys(payload)
    .sort((a, b) => a.localeCompare(b, "vi"))
    .filter((key) => !isInternalRawPayloadSegment(key))
    .forEach((key) => visit(payload[key], key));
  return rows;
}

function applicantRawPayload(application: Application) {
  if (application.source !== "s12_mentor_renewal") return application.raw_payload;
  const renewal = application.raw_payload?.renewal;
  if (!renewal || typeof renewal !== "object" || Array.isArray(renewal)) return null;
  return renewal as Record<string, unknown>;
}

function addField(fields: ApplicationExportField[], section: string, label: string, value: unknown) {
  fields.push({ section, label, value: text(value) });
}

export function buildApplicationExportData(source: ApplicationExportSource): ApplicationExportData {
  const { application, answers, person, mentorProfile, menteeProfile, season } = source;
  const fields: ApplicationExportField[] = [];
  const fullName = application.full_name ?? person?.full_name;
  const email = application.email_primary ?? person?.email_primary;
  const phone = application.phone_primary ?? person?.phone_primary;
  const gender = application.gender ?? person?.gender;
  const status = application.status ?? application.final_status;
  const consent = application.consent_data_storage ?? application.consent_pdpa;

  addField(fields, "Thông tin ứng viên", "Họ và tên", fullName);
  addField(fields, "Thông tin ứng viên", "Email", email);
  addField(fields, "Thông tin ứng viên", "Số điện thoại", phone);
  addField(fields, "Thông tin ứng viên", "Giới tính", genderLabel(gender));

  addField(fields, "Thông tin ứng tuyển", "Mã đơn ứng tuyển", application.id);
  addField(fields, "Thông tin ứng tuyển", "Số báo danh (SBD)", application.sbd);
  addField(fields, "Thông tin ứng tuyển", "Vai trò ứng tuyển", roleLabel(application.role_applied));
  addField(fields, "Thông tin ứng tuyển", "Mùa chương trình", season?.code ?? season?.name ?? application.season_id);
  addField(fields, "Thông tin ứng tuyển", "Ngày nộp đơn", formatDate(application.submitted_at));
  addField(fields, "Thông tin ứng tuyển", "Trạng thái hồ sơ", applicationStatusLabel(status));
  addField(fields, "Thông tin ứng tuyển", "Nguồn đơn ứng tuyển", application.source);
  addField(fields, "Thông tin ứng tuyển", "Đồng ý lưu trữ dữ liệu", consent);
  addField(fields, "Thông tin ứng tuyển", "Kênh tiếp cận", application.acquisition_channel);
  addField(fields, "Thông tin ứng tuyển", "Liên kết hồ sơ ứng viên", application.profile_url);

  if (mentorProfile) {
    addField(fields, "Hồ sơ Mentor", "Mã Mentor", mentorProfile.mentor_code);
    addField(fields, "Hồ sơ Mentor", "Công ty hiện tại", mentorProfile.company_current);
    addField(fields, "Hồ sơ Mentor", "Chức danh hiện tại", mentorProfile.title_current);
    addField(fields, "Hồ sơ Mentor", "Số năm kinh nghiệm tối thiểu", mentorProfile.years_experience_min);
    addField(fields, "Hồ sơ Mentor", "Mô tả kinh nghiệm", mentorProfile.years_experience_text);
    addField(fields, "Hồ sơ Mentor", "Ngành nghề", mentorProfile.industry);
    addField(fields, "Hồ sơ Mentor", "Chức năng chuyên môn", mentorProfile.function_area);
    addField(fields, "Hồ sơ Mentor", "Liên kết giới thiệu", mentorProfile.bio_url);
  }

  if (menteeProfile) {
    addField(fields, "Hồ sơ Mentee", "Mã Mentee", menteeProfile.mentee_code);
    addField(fields, "Hồ sơ Mentee", "Mã trường", menteeProfile.school_code);
    addField(fields, "Hồ sơ Mentee", "Tên trường", menteeProfile.school_raw);
    addField(fields, "Hồ sơ Mentee", "Ngành học", menteeProfile.major);
    addField(fields, "Hồ sơ Mentee", "Khóa / lớp", menteeProfile.class_cohort);
    addField(fields, "Hồ sơ Mentee", "Mã số sinh viên", menteeProfile.mssv);
  }

  for (const row of flattenRawPayload(applicantRawPayload(application))) {
    addField(fields, "Nội dung form S12", humanizeKey(row.key), row.value);
  }

  const sortedAnswers = [...answers].sort((a, b) => {
    const aKey = [a.question_key, a.question_label, a.created_at, a.id, a.value_text].map(text).join("\u0000");
    const bKey = [b.question_key, b.question_label, b.created_at, b.id, b.value_text].map(text).join("\u0000");
    return aKey.localeCompare(bKey, "vi");
  });
  sortedAnswers.forEach((answer, index) => {
    const label = text(answer.question_label ?? answer.question_key ?? `Câu trả lời ${index + 1}`);
    const key = String(answer.question_key ?? "").trim();
    addField(fields, "Câu trả lời ứng tuyển", key && label !== key ? `${label} (${key})` : label, answer.value_text);
  });

  fields.sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
  return {
    applicationId: application.id,
    applicantName: text(fullName),
    role: roleLabel(application.role_applied),
    season: text(season?.code ?? season?.name ?? application.season_id),
    fields
  };
}

const FORMULA_TRIGGER = /^[=+\-@]/;
const LEADING_SPACING_OR_CONTROL = /^[\s\u00a0\ufeff\u2000-\u200b\x00-\x1f\x7f-\x9f]+/;

export function guardSpreadsheetFormula(value: string) {
  const effectiveValue = value.replace(LEADING_SPACING_OR_CONTROL, "");
  return FORMULA_TRIGGER.test(value) || FORMULA_TRIGGER.test(effectiveValue) ? `'${value}` : value;
}

function csvCell(value: string) {
  return `"${guardSpreadsheetFormula(value).replace(/"/g, '""')}"`;
}

export function applicationExportCsv(data: ApplicationExportData) {
  const rows = [
    ["Field", "Value"],
    ...data.fields.map((field) => [
      `${field.section} — ${guardSpreadsheetFormula(field.label)}`,
      guardSpreadsheetFormula(field.value)
    ])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function applicationExportFilename(data: ApplicationExportData, extension: "csv" | "pdf") {
  const role = data.role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "application";
  const id = data.applicationId.replace(/[^a-zA-Z0-9-]+/g, "-");
  return `vam-s12-${role}-application-${id}.${extension}`;
}
