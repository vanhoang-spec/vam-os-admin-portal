"use server";

import { revalidatePath } from "next/cache";
import { evaluateApplyGate } from "@/lib/apply-gate";
import {
  submitPilotApplication,
  type ApplicationRole,
  type ApplicationSubmissionResult
} from "@/lib/applications-create";
import { APPLY_TOKEN_FIELD, type ApplyActionState } from "@/lib/apply-types";
import { sendApplicationConfirmation } from "@/lib/email";
import { SEASON_CONFIG } from "@/lib/season-config";
import { seasonLabel } from "@/lib/season-labels";
import {
  acknowledgementsForRole,
  validateMenteeCommitments,
  validateMentorCommitments
} from "@/lib/application-commitments";
import {
  enforceOtherDetails,
  isValidApplicationPhone,
  validateMaxThreeWithOther,
  MENTEE_OTHER_DETAIL_RULES,
  MENTOR_OTHER_DETAIL_RULES
} from "@/lib/application-form-validation";

const SEASON_CODE = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
const INTAKE_BATCH_CODE = SEASON_CONFIG.CURRENT_APPLICATION_BATCH_CODE;

function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Read the relayed pilot token.
 *
 * Deliberately separate from `formText` so the token is never picked up by
 * one of the bulk `raw_payload` builders below, and so grepping for this
 * field name finds every place it is touched. The value is passed straight
 * to the gate and to nothing else — it is not logged here or anywhere
 * downstream, and no error message echoes it back.
 */
function applyToken(formData: FormData): string | null {
  const value = String(formData.get(APPLY_TOKEN_FIELD) ?? "").trim();
  return value || null;
}

function formArray(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
}

function formBoolean(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  if (value === null) return false;
  return value === "true" || value === "on" || value === "1";
}

function formNumber(formData: FormData, key: string): number {
  const raw = formText(formData, key);
  return raw === "" ? Number.NaN : Number(raw);
}

function acceptedAcknowledgementKeys(role: ApplicationRole, formData: FormData) {
  return new Set(
    acknowledgementsForRole(role)
      .filter((entry) => entry.key.endsWith("ACTIVE_READING_V1") || formBoolean(formData, entry.key))
      .map((entry) => entry.key)
  );
}

function acknowledgementAnswers(role: ApplicationRole, acceptedAt: string) {
  return acknowledgementsForRole(role).map((entry) => ({
    questionKey: entry.key,
    questionLabel: entry.wording,
    valueText: "true",
    acceptedAt
  }));
}

function fail(scope: string, err: unknown): ApplyActionState {
  console.error(`[${scope}] unhandled error`, err);
  return {
    ok: false,
    message:
      "Lỗi hệ thống khi gửi đơn. Vui lòng thử lại sau ít phút hoặc liên hệ BTC."
  };
}

/**
 * Nhãn mùa như người nộp đơn đọc được, chứ không phải mã nội bộ: thư viết
 * "cho Mùa 12" thay vì "cho UEHM-S12".
 *
 * Cố ý KHÔNG kèm tên chương trình. Mọi tiêu đề thư đã mở đầu bằng
 * "[UEH Mentoring]", nên nhãn mùa mà cũng mang tên ấy thì một dòng tiêu đề sẽ
 * nhắc tên chương trình hai lần.
 */
const APPLICATION_SEASON_LABEL = seasonLabel(SEASON_CODE);

/**
 * Báo đã nhận đơn qua email.
 *
 * Không bao giờ được phép gây lỗi cho người nộp: đơn đã nằm trong database rồi,
 * và không ai được nghe rằng đơn của mình hỏng chỉ vì nhà cung cấp email không
 * trả lời. Mọi kết quả gửi đều đã được ghi vào outbound_emails, kể cả lượt bị
 * cấu hình chặn, nên BTC vẫn tra lại được ở /operations/emails.
 */
async function acknowledgeSubmission(input: {
  applicationId: string;
  role: ApplicationRole;
  fullName: string;
  emailPrimary: string;
}) {
  try {
    await sendApplicationConfirmation({
      toEmail: input.emailPrimary,
      applicantName: input.fullName,
      role: input.role,
      seasonLabel: APPLICATION_SEASON_LABEL,
      applicationId: input.applicationId
    });
  } catch (err) {
    console.error("[apply] confirmation email failed (non-fatal)", err);
  }
}

/**
 * Refuse the whole action before a single field is inspected when the gate is
 * not open.
 *
 * `submitPilotApplication` re-checks the same gate, so this is not the only
 * defence — but checking here means a closed form answers a direct Server
 * Action invocation with "not open" rather than with a field-validation
 * error, which would otherwise confirm to an anonymous caller that the
 * endpoint is live and reveal the shape of the form behind it.
 */
async function gateRefusal(role: ApplicationRole, token: string | null): Promise<ApplyActionState | null> {
  const gate = await evaluateApplyGate(token, role);
  if (gate.status === "open") return null;
  return {
    ok: false,
    message: "Đơn đăng ký cho vai trò này hiện chưa được mở. Vui lòng chờ thông báo chính thức."
  };
}

function resultToState(result: ApplicationSubmissionResult): ApplyActionState {
  if (result.ok) {
    return {
      ok: true,
      message: "Đã ghi nhận đơn đăng ký.",
      applicationId: result.applicationId
    };
  }
  return {
    ok: false,
    message: result.message,
    // Carried so the form can render the returning-Mentor guidance next to the
    // submit button instead of a generic failure banner at the top of a page
    // the applicant has already scrolled past.
    ...(result.reason ? { errorKind: result.reason } : {})
  };
}

/**
 * MENTOR pilot intake.
 * Builds raw_payload from every Form Spec v2 mentor field except the
 * top-level columns the DB stores natively (full_name, email_primary,
 * phone_primary, gender, consent_data_storage).
 */
export async function submitMentorApplicationAction(
  _previous: ApplyActionState,
  formData: FormData
): Promise<ApplyActionState> {
  try {
    const token = applyToken(formData);
    const refused = await gateRefusal("mentor", token);
    if (refused) return refused;

    // Top-level columns
    const fullName = formText(formData, "full_name");
    const emailPrimary = formText(formData, "email_primary");
    const phonePrimary = formText(formData, "phone_primary");
    const gender = formText(formData, "gender");
    const consentDataStorage = formBoolean(formData, "consent_data_storage");
    const totalWorkYears = formNumber(formData, "mentor_total_work_years");
    const peopleManagementYears = formNumber(formData, "mentor_people_management_years");
    const largestTeamSize = formNumber(formData, "mentor_largest_team_size");
    const mentorReference = formText(formData, "mentor_reference");
    const activeReading = formText(formData, "MENTOR_ACTIVE_READING_V1");

    // raw_payload: every other Spec v2 mentor field, in declared order
    const rawPayload: Record<string, unknown> = {
      // Section 1 — consent & contact channels
      consent_contact_methods: formArray(formData, "consent_contact_methods"),
      // Section 2 — identity extras
      gender_other: formText(formData, "gender_other") || null,
      preferred_name: formText(formData, "preferred_name") || null,
      year_of_birth: formText(formData, "year_of_birth") || null,
      current_city: formText(formData, "current_city") || null,
      // Section 3 — contact extras
      linkedin_url: formText(formData, "linkedin_url") || null,
      // Section 4 — career
      company_current: formText(formData, "company_current"),
      title_current: formText(formData, "title_current"),
      years_of_experience: formText(formData, "years_of_experience"),
      industry_primary: formText(formData, "industry_primary"),
      industry_primary_other: formText(formData, "industry_primary_other") || null,
      function_primary: formText(formData, "function_primary"),
      function_primary_other: formText(formData, "function_primary_other") || null,
      secondary_industries_functions: formArray(formData, "secondary_industries_functions"),
      secondary_industries_functions_other: formText(formData, "secondary_industries_functions_other") || null,
      highest_degree: formText(formData, "highest_degree") || null,
      highest_degree_other: formText(formData, "highest_degree_other") || null,
      university: formText(formData, "university"),
      university_other: formText(formData, "university_other") || null,
      // Section 5 — mentoring readiness
      prior_vam_involvement: formText(formData, "prior_vam_involvement") || null,
      first_vam_season: formText(formData, "first_vam_season") || null,
      sme_mentoring_experience: formText(formData, "sme_mentoring_experience") || null,
      motivation_text: formText(formData, "motivation_text"),
      can_attend_orientation: formText(formData, "can_attend_orientation"),
      open_to_intro_call: formText(formData, "open_to_intro_call"),
      // Section 6 — capacity & commitment
      mentoring_capacity_total: formText(formData, "mentoring_capacity_total"),
      meeting_frequency: formText(formData, "meeting_frequency") || null,
      meeting_format_preference: formArray(formData, "meeting_format_preference"),
      preferred_mentee_persona: formText(formData, "preferred_mentee_persona") || null,
      preferred_language: formArray(formData, "preferred_language"),
      programs_willing_to_join: formArray(formData, "programs_willing_to_join"),
      mentoring_topics: formText(formData, "mentoring_topics") || null,
      activities_willing_to_support: formArray(formData, "activities_willing_to_support"),
      activities_willing_to_support_other: formText(formData, "activities_willing_to_support_other") || null,
      // Section 7 — attachments
      bio_or_cv_url: formText(formData, "bio_or_cv_url") || null,
      profile_picture_url: formText(formData, "profile_picture_url") || null,
      // Section 8 — other
      referrer_or_source: formText(formData, "referrer_or_source") || null,
      referrer_or_source_other: formText(formData, "referrer_or_source_other") || null,
      additional_notes: formText(formData, "additional_notes") || null,
      mentor_total_work_years: Number.isFinite(totalWorkYears) ? totalWorkYears : null,
      mentor_people_management_years: Number.isFinite(peopleManagementYears) ? peopleManagementYears : null,
      mentor_largest_team_size: Number.isFinite(largestTeamSize) ? largestTeamSize : null,
      mentor_reference: mentorReference || null
    };

    // Required field checks (UI also validates; this is defense-in-depth)
    const required = {
      full_name: fullName,
      email_primary: emailPrimary,
      phone_primary: phonePrimary,
      company_current: rawPayload.company_current,
      title_current: rawPayload.title_current,
      years_of_experience: rawPayload.years_of_experience,
      industry_primary: rawPayload.industry_primary,
      function_primary: rawPayload.function_primary,
      university: rawPayload.university,
      motivation_text: rawPayload.motivation_text,
      can_attend_orientation: rawPayload.can_attend_orientation,
      open_to_intro_call: rawPayload.open_to_intro_call,
      mentoring_capacity_total: rawPayload.mentoring_capacity_total
    };
    const programsOk = (rawPayload.programs_willing_to_join as string[]).length > 0;
    const consentMethodsOk = (rawPayload.consent_contact_methods as string[]).length > 0;
    const secondaryValidation = validateMaxThreeWithOther({
      values: rawPayload.secondary_industries_functions as string[],
      otherText: String(rawPayload.secondary_industries_functions_other ?? ""),
      fieldName: "secondary_industries_functions",
      fieldLabel: "Ngành / chức năng phụ"
    });

    const missingField = Object.entries(required).find(([, v]) => !v || (typeof v === "string" && !v.trim()));
    if (missingField) {
      return {
        ok: false,
        message: `Thiếu trường bắt buộc: ${missingField[0]}.`
      };
    }
    if (!isValidApplicationPhone(phonePrimary)) {
      return {
        ok: false,
        message: "Số điện thoại phải gồm đúng 10 chữ số.",
        fieldErrors: [{ name: "phone_primary", label: "Số điện thoại" }]
      };
    }
    if (!programsOk) {
      return { ok: false, message: "Vui lòng chọn ít nhất một chương trình bạn sẵn sàng tham gia." };
    }
    if (!consentMethodsOk) {
      return { ok: false, message: "Vui lòng chọn ít nhất một kênh liên lạc bạn đồng ý nhận thông tin." };
    }
    if (!consentDataStorage) {
      return {
        ok: false,
        message: "Bạn cần đồng ý cho phép VAM OS lưu trữ dữ liệu cá nhân để gửi đơn."
      };
    }
    if (!secondaryValidation.ok) {
      return {
        ok: false,
        message: secondaryValidation.message,
        fieldErrors: [{ name: secondaryValidation.fieldName, label: secondaryValidation.fieldLabel }]
      };
    }
    // Authoritative "Khác / Other" detail enforcement. Also strips stale or forged
    // `_other` text whose parent no longer selects Other.
    const otherDetails = enforceOtherDetails({ ...rawPayload, gender }, rawPayload, MENTOR_OTHER_DETAIL_RULES);
    if (!otherDetails.ok) {
      return {
        ok: false,
        message: otherDetails.message,
        fieldErrors: [{ name: otherDetails.fieldName, label: otherDetails.fieldLabel }]
      };
    }
    const commitmentValidation = validateMentorCommitments({
      totalWorkYears,
      peopleManagementYears,
      largestTeamSize,
      acceptedKeys: acceptedAcknowledgementKeys("mentor", formData),
      activeReading
    });
    if (!commitmentValidation.ok) return commitmentValidation;

    const acceptedAt = new Date().toISOString();
    const answers = [
      {
        questionKey: "mentor_total_work_years",
        questionLabel: "Tổng số năm kinh nghiệm làm việc",
        valueText: String(totalWorkYears)
      },
      {
        questionKey: "mentor_people_management_years",
        questionLabel: "Tổng số năm kinh nghiệm quản lý con người/đội ngũ",
        valueText: String(peopleManagementYears)
      },
      {
        questionKey: "mentor_largest_team_size",
        questionLabel: "Quy mô đội ngũ lớn nhất đã trực tiếp quản lý",
        valueText: Number.isFinite(largestTeamSize) ? String(largestTeamSize) : ""
      },
      {
        questionKey: "mentor_reference",
        questionLabel: "Người giới thiệu/người tham chiếu",
        valueText: mentorReference
      },
      ...acknowledgementAnswers("mentor", acceptedAt)
    ];

    const result = await submitPilotApplication({
      role: "mentor" as ApplicationRole,
      seasonCode: SEASON_CODE,
      intakeBatchCode: INTAKE_BATCH_CODE,
      applyToken: token,
      fullName,
      emailPrimary,
      phonePrimary,
      gender: gender || null,
      consentDataStorage,
      rawPayload,
      answers
    });

    // Both outcomes return a state; neither navigates from the server.
    if (!result.ok) return resultToState(result);

    await acknowledgeSubmission({
      applicationId: result.applicationId,
      role: "mentor",
      fullName,
      emailPrimary
    });

    revalidatePath("/admin/applications");

    // Returns confirmed success instead of redirecting from here.
    //
    // `redirect()` throws NEXT_REDIRECT from inside the action, so the client
    // never observes the success — it observes a navigation. Both public forms
    // keep a local autosave draft in the applicant's browser, and after a
    // server-side redirect there is no point at which the client can be told
    // the write actually happened, so a successfully submitted application
    // would leave its draft behind for seven days on what is often a shared
    // machine.
    //
    // The state below carries `applicationId`, which exists only once the row
    // is written, so the client can distinguish a confirmed create from every
    // failure shape and clear the exact draft BEFORE navigating itself. Every
    // failure path above still returns a state and never navigates, which is
    // what keeps a rejected submission's answers intact.
    return resultToState(result);
  } catch (err) {
    return fail("submitMentorApplicationAction", err);
  }
}

/**
 * MENTEE pilot intake.
 * Same pattern as mentor; raw_payload covers every Spec v2 mentee field
 * except the top-level DB columns.
 */
export async function submitMenteeApplicationAction(
  _previous: ApplyActionState,
  formData: FormData
): Promise<ApplyActionState> {
  try {
    const token = applyToken(formData);
    const refused = await gateRefusal("mentee", token);
    if (refused) return refused;

    // Top-level columns
    const fullName = formText(formData, "full_name");
    const emailPrimary = formText(formData, "email_primary");
    const phonePrimary = formText(formData, "phone_primary");
    const gender = formText(formData, "gender");
    const consentDataStorage = formBoolean(formData, "consent_data_storage");
    const activeReading = formText(formData, "MENTEE_ACTIVE_READING_V1");

    // raw_payload: every other Spec v2 mentee field
    const rawPayload: Record<string, unknown> = {
      // Section 1 — consent extras
      email_notification_consent: formArray(formData, "email_notification_consent"),
      // Section 2 — identity extras
      gender_other: formText(formData, "gender_other") || null,
      year_of_birth: formText(formData, "year_of_birth") || null,
      // Section 3 — contact extras
      social_contact: formText(formData, "social_contact") || null,
      // Section 4 — education
      university: formText(formData, "university"),
      university_other: formText(formData, "university_other") || null,
      school_or_faculty: formText(formData, "school_or_faculty"),
      school_or_faculty_other: formText(formData, "school_or_faculty_other") || null,
      major: formText(formData, "major"),
      class_cohort: formText(formData, "class_cohort"),
      year_of_study: formText(formData, "year_of_study"),
      mssv: formText(formData, "mssv") || null,
      gpa_4: formText(formData, "gpa_4") || null,
      // Section 5 — direction
      target_industry: formText(formData, "target_industry"),
      target_industry_other: formText(formData, "target_industry_other") || null,
      target_function: formText(formData, "target_function"),
      target_function_other: formText(formData, "target_function_other") || null,
      one_year_vision_text: formText(formData, "one_year_vision_text"),
      // Section 6 — mentoring expectations
      mentoring_goals_text: formText(formData, "mentoring_goals_text"),
      top_3_questions_for_mentor: formText(formData, "top_3_questions_for_mentor"),
      current_difficulty_text: formText(formData, "current_difficulty_text") || null,
      target_soft_skills: formArray(formData, "target_soft_skills"),
      target_soft_skills_other: formText(formData, "target_soft_skills_other") || null,
      meeting_format_preference: formText(formData, "meeting_format_preference") || null,
      mentor_gender_preference: formText(formData, "mentor_gender_preference") || null,
      training_topics_interest: formArray(formData, "training_topics_interest"),
      training_topics_interest_other: formText(formData, "training_topics_interest_other") || null,
      // Section 7 — essay & commitment
      why_uem_text: formText(formData, "why_uem_text") || null,
      mentoring_plan_text: formText(formData, "mentoring_plan_text") || null,
      if_not_effective_text: formText(formData, "if_not_effective_text") || null,
      profile_or_cv_url: formText(formData, "profile_or_cv_url") || null,
      commitment_understanding: formBoolean(formData, "commitment_understanding"),
      // Section 8 — readiness & source
      available_for_interview: formArray(formData, "available_for_interview"),
      available_for_kickoff: formText(formData, "available_for_kickoff"),
      referrer_or_source: formText(formData, "referrer_or_source") || null,
      referrer_or_source_other: formText(formData, "referrer_or_source_other") || null,
      additional_notes: formText(formData, "additional_notes") || null
    };

    // Required field checks
    const required: Record<string, unknown> = {
      full_name: fullName,
      email_primary: emailPrimary,
      phone_primary: phonePrimary,
      university: rawPayload.university,
      school_or_faculty: rawPayload.school_or_faculty,
      major: rawPayload.major,
      class_cohort: rawPayload.class_cohort,
      year_of_study: rawPayload.year_of_study,
      target_industry: rawPayload.target_industry,
      target_function: rawPayload.target_function,
      one_year_vision_text: rawPayload.one_year_vision_text,
      mentoring_goals_text: rawPayload.mentoring_goals_text,
      top_3_questions_for_mentor: rawPayload.top_3_questions_for_mentor,
      current_difficulty_text: rawPayload.current_difficulty_text,
      why_uem_text: rawPayload.why_uem_text,
      mentoring_plan_text: rawPayload.mentoring_plan_text,
      if_not_effective_text: rawPayload.if_not_effective_text,
      available_for_kickoff: rawPayload.available_for_kickoff
    };
    const narrativeRequirements = [
      { key: "one_year_vision_text", label: "Phiên bản tốt nhất của bạn sau 1 năm", minLength: 100 },
      { key: "mentoring_goals_text", label: "Mục tiêu cụ thể qua mentoring", minLength: 100 },
      { key: "top_3_questions_for_mentor", label: "3 câu hỏi cụ thể bạn muốn hỏi Mentor", minLength: 50 },
      { key: "current_difficulty_text", label: "Khó khăn cụ thể bạn đang cần Mentor hỗ trợ", minLength: 100 },
      { key: "why_uem_text", label: "Vì sao bạn chọn UEH Mentoring?", minLength: 100 },
      { key: "mentoring_plan_text", label: "Kế hoạch của bạn để tận dụng mentoring", minLength: 100 },
      { key: "if_not_effective_text", label: "Nếu mentoring không hiệu quả như mong đợi, bạn sẽ làm gì?", minLength: 100 }
    ] as const;
    const interviewOk = (rawPayload.available_for_interview as string[]).length > 0;
    const emailNotifOk = (rawPayload.email_notification_consent as string[]).length > 0;
    const softSkillValidation = validateMaxThreeWithOther({
      values: rawPayload.target_soft_skills as string[],
      otherText: String(rawPayload.target_soft_skills_other ?? ""),
      fieldName: "target_soft_skills",
      fieldLabel: "Soft skills bạn muốn phát triển"
    });

    const missingField = Object.entries(required).find(([, v]) => !v || (typeof v === "string" && !v.trim()));
    if (missingField) {
      return {
        ok: false,
        message: `Thiếu trường bắt buộc: ${missingField[0]}.`
      };
    }
    const tooShortNarrative = narrativeRequirements.find(({ key, minLength }) =>
      String(rawPayload[key] ?? "").trim().length < minLength
    );
    if (tooShortNarrative) {
      return {
        ok: false,
        message: `${tooShortNarrative.label} cần tối thiểu ${tooShortNarrative.minLength} ký tự.`,
        fieldErrors: [{ name: tooShortNarrative.key, label: tooShortNarrative.label }]
      };
    }
    if (!interviewOk) {
      return { ok: false, message: "Vui lòng chọn ít nhất một khoảng thời gian sẵn sàng phỏng vấn." };
    }
    if (!isValidApplicationPhone(phonePrimary)) {
      return {
        ok: false,
        message: "Số điện thoại phải gồm đúng 10 chữ số.",
        fieldErrors: [{ name: "phone_primary", label: "Số điện thoại" }]
      };
    }
    if (!emailNotifOk) {
      return { ok: false, message: "Vui lòng chọn ít nhất một kênh nhận thông báo." };
    }
    if (!rawPayload.commitment_understanding) {
      return { ok: false, message: "Vui lòng xác nhận đã đọc và cam kết các điều khoản tham gia." };
    }
    if (!consentDataStorage) {
      return {
        ok: false,
        message: "Bạn cần đồng ý cho phép VAM OS lưu trữ dữ liệu cá nhân để gửi đơn."
      };
    }
    if (!softSkillValidation.ok) {
      return {
        ok: false,
        message: softSkillValidation.message,
        fieldErrors: [{ name: softSkillValidation.fieldName, label: softSkillValidation.fieldLabel }]
      };
    }
    // Authoritative "Khác / Other" detail enforcement. Also strips stale or forged
    // `_other` text whose parent no longer selects Other.
    const otherDetails = enforceOtherDetails({ ...rawPayload, gender }, rawPayload, MENTEE_OTHER_DETAIL_RULES);
    if (!otherDetails.ok) {
      return {
        ok: false,
        message: otherDetails.message,
        fieldErrors: [{ name: otherDetails.fieldName, label: otherDetails.fieldLabel }]
      };
    }
    const commitmentValidation = validateMenteeCommitments({
      acceptedKeys: acceptedAcknowledgementKeys("mentee", formData),
      activeReading
    });
    if (!commitmentValidation.ok) return commitmentValidation;

    const acceptedAt = new Date().toISOString();

    const result = await submitPilotApplication({
      role: "mentee" as ApplicationRole,
      seasonCode: SEASON_CODE,
      intakeBatchCode: INTAKE_BATCH_CODE,
      applyToken: token,
      fullName,
      emailPrimary,
      phonePrimary,
      gender: gender || null,
      consentDataStorage,
      rawPayload,
      answers: acknowledgementAnswers("mentee", acceptedAt)
    });

    if (!result.ok) return resultToState(result);

    await acknowledgeSubmission({
      applicationId: result.applicationId,
      role: "mentee",
      fullName,
      emailPrimary
    });

    revalidatePath("/admin/applications");

    // Returns confirmed success instead of redirecting from here.
    //
    // `redirect()` throws NEXT_REDIRECT from inside the action, so the client
    // never observes the success — it observes a navigation. Both public forms
    // keep a local autosave draft in the applicant's browser, and after a
    // server-side redirect there is no point at which the client can be told
    // the write actually happened, so a successfully submitted application
    // would leave its draft behind for seven days on what is often a shared
    // machine.
    //
    // The state below carries `applicationId`, which exists only once the row
    // is written, so the client can distinguish a confirmed create from every
    // failure shape and clear the exact draft BEFORE navigating itself. Every
    // failure path above still returns a state and never navigates, which is
    // what keeps a rejected submission's answers intact.
    return resultToState(result);
  } catch (err) {
    return fail("submitMenteeApplicationAction", err);
  }
}
