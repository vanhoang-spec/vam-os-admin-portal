"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  submitPilotApplication,
  type ApplicationRole,
  type ApplicationSubmissionResult
} from "@/lib/applications-create";
import type { ApplyActionState } from "@/lib/apply-types";
import { guardPublicSubmission, recordAcceptedSubmission, recordGateRejection } from "@/lib/apply-abuse";
import { HONEYPOT_FIELD, truncateFieldValues, truncateShortField } from "@/lib/apply-abuse-core";
import { evaluateApplyGate } from "@/lib/apply-gate";
import { sendApplicationConfirmation } from "@/lib/email";
import { SEASON_CONFIG } from "@/lib/season-config";

const SEASON_CODE = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
const INTAKE_BATCH_CODE = SEASON_CONFIG.CURRENT_APPLICATION_BATCH_CODE;

function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
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

/**
 * Everything that must hold before a public submission is stored.
 *
 * The form gate is re-evaluated HERE, not only in the page: a server action is
 * a plain POST endpoint, so a caller who kept an action id from an earlier,
 * legitimately-open page load would otherwise bypass the enable flag and the
 * token entirely.
 */
async function guardSubmission(
  formData: FormData,
  role: ApplicationRole
): Promise<{ ok: true; ipHash: string | null } | { ok: false; state: ApplyActionState }> {
  const route = role === "mentor" ? "apply_mentor" : "apply_mentee";

  const guard = await guardPublicSubmission({
    route,
    honeypotValue: formData.get(HONEYPOT_FIELD)
  });

  if (!guard.allowed) {
    // A honeypot hit is answered as if it succeeded — naming the trap would
    // only teach the next attempt to avoid it.
    return {
      ok: false,
      state: { ok: guard.reason === "honeypot", message: guard.message }
    };
  }

  const gate = evaluateApplyGate(formText(formData, "apply_token") || undefined, role);
  if (gate.status === "closed") {
    await recordGateRejection(route, guard.ipHash ?? null);
    return { ok: false, state: { ok: false, message: gate.reason } };
  }

  return { ok: true, ipHash: guard.ipHash ?? null };
}

/**
 * Acknowledge the submission by email. Never fatal: the application is already
 * stored, and an applicant must not be told their submission failed because a
 * mail provider was unreachable.
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
      seasonLabel: SEASON_CODE,
      applicationId: input.applicationId
    });
  } catch (err) {
    console.error("[apply] confirmation email failed (non-fatal)", err);
  }
}

function fail(scope: string, err: unknown): ApplyActionState {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}] unhandled error`, err);
  return {
    ok: false,
    message:
      "Lỗi hệ thống khi gửi đơn. Vui lòng thử lại sau ít phút hoặc liên hệ BTC."
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
  return { ok: false, message: result.message };
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
  let ipHash: string | null = null;
  try {
    const guard = await guardSubmission(formData, "mentor");
    if (!guard.ok) return guard.state;
    ipHash = guard.ipHash;

    // Top-level columns
    const fullName = truncateShortField(formText(formData, "full_name"));
    const emailPrimary = truncateShortField(formText(formData, "email_primary"));
    const phonePrimary = truncateShortField(formText(formData, "phone_primary"));
    const gender = truncateShortField(formText(formData, "gender"));
    const consentDataStorage = formBoolean(formData, "consent_data_storage");

    // raw_payload: every other Spec v2 mentor field, in declared order
    const rawPayload: Record<string, unknown> = {
      // Section 1 — consent & contact channels
      consent_contact_methods: formArray(formData, "consent_contact_methods"),
      // Section 2 — identity extras
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
      function_primary: formText(formData, "function_primary"),
      secondary_industries_functions: formArray(formData, "secondary_industries_functions"),
      highest_degree: formText(formData, "highest_degree") || null,
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
      activities_willing_to_support: formArray(formData, "activities_willing_to_support"),
      // Section 7 — attachments
      bio_or_cv_url: formText(formData, "bio_or_cv_url") || null,
      profile_picture_url: formText(formData, "profile_picture_url") || null,
      // Section 8 — other
      referrer_or_source: formText(formData, "referrer_or_source") || null,
      additional_notes: formText(formData, "additional_notes") || null
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
      motivation_text: rawPayload.motivation_text,
      can_attend_orientation: rawPayload.can_attend_orientation,
      open_to_intro_call: rawPayload.open_to_intro_call,
      mentoring_capacity_total: rawPayload.mentoring_capacity_total
    };
    const programsOk = (rawPayload.programs_willing_to_join as string[]).length > 0;
    const consentMethodsOk = (rawPayload.consent_contact_methods as string[]).length > 0;

    const missingField = Object.entries(required).find(([, v]) => !v || (typeof v === "string" && !v.trim()));
    if (missingField) {
      return {
        ok: false,
        message: `Thiếu trường bắt buộc: ${missingField[0]}.`
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

    const result = await submitPilotApplication({
      role: "mentor" as ApplicationRole,
      seasonCode: SEASON_CODE,
      intakeBatchCode: INTAKE_BATCH_CODE,
      fullName,
      emailPrimary,
      phonePrimary,
      gender: gender || null,
      consentDataStorage,
      // Cap every stored string so one request cannot write unbounded text.
      rawPayload: truncateFieldValues(rawPayload)
    });

    // On failure return the error state immediately.
    // On success fall through — redirect() must be called outside try/catch
    // because it throws NEXT_REDIRECT internally, which the catch block
    // would otherwise swallow and convert into a generic error state.
    if (!result.ok) return resultToState(result);

    await recordAcceptedSubmission("apply_mentor", ipHash);
    // Inside the try and before the redirect below: redirect() throws, so
    // anything after it never runs.
    await acknowledgeSubmission({
      applicationId: result.applicationId,
      role: "mentor",
      fullName,
      emailPrimary
    });

    revalidatePath("/admin/applications");
  } catch (err) {
    return fail("submitMentorApplicationAction", err);
  }

  // Reached only when result.ok === true.
  redirect("/apply/thanks?role=mentor");
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
  let ipHash: string | null = null;
  try {
    const guard = await guardSubmission(formData, "mentee");
    if (!guard.ok) return guard.state;
    ipHash = guard.ipHash;

    // Top-level columns
    const fullName = truncateShortField(formText(formData, "full_name"));
    const emailPrimary = truncateShortField(formText(formData, "email_primary"));
    const phonePrimary = truncateShortField(formText(formData, "phone_primary"));
    const gender = truncateShortField(formText(formData, "gender"));
    const consentDataStorage = formBoolean(formData, "consent_data_storage");

    // raw_payload: every other Spec v2 mentee field
    const rawPayload: Record<string, unknown> = {
      // Section 1 — consent extras
      email_notification_consent: formArray(formData, "email_notification_consent"),
      // Section 2 — identity extras
      year_of_birth: formText(formData, "year_of_birth") || null,
      // Section 3 — contact extras
      social_contact: formText(formData, "social_contact") || null,
      // Section 4 — education
      university: formText(formData, "university"),
      school_or_faculty: formText(formData, "school_or_faculty"),
      major: formText(formData, "major"),
      class_cohort: formText(formData, "class_cohort"),
      year_of_study: formText(formData, "year_of_study"),
      mssv: formText(formData, "mssv") || null,
      gpa_4: formText(formData, "gpa_4") || null,
      // Section 5 — direction
      target_industry: formText(formData, "target_industry"),
      target_function: formText(formData, "target_function"),
      one_year_vision_text: formText(formData, "one_year_vision_text"),
      // Section 6 — mentoring expectations
      mentoring_goals_text: formText(formData, "mentoring_goals_text"),
      top_3_questions_for_mentor: formText(formData, "top_3_questions_for_mentor"),
      current_difficulty_text: formText(formData, "current_difficulty_text") || null,
      target_soft_skills: formArray(formData, "target_soft_skills"),
      meeting_format_preference: formText(formData, "meeting_format_preference") || null,
      mentor_gender_preference: formText(formData, "mentor_gender_preference") || null,
      training_topics_interest: formArray(formData, "training_topics_interest"),
      // Section 7 — essay & commitment
      why_uem_text: formText(formData, "why_uem_text") || null,
      mentoring_plan_text: formText(formData, "mentoring_plan_text") || null,
      if_not_effective_text: formText(formData, "if_not_effective_text") || null,
      commitment_understanding: formBoolean(formData, "commitment_understanding"),
      // Section 8 — readiness
      available_for_interview: formArray(formData, "available_for_interview"),
      available_for_kickoff: formText(formData, "available_for_kickoff"),
      referrer_or_source: formText(formData, "referrer_or_source") || null,
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
      available_for_kickoff: rawPayload.available_for_kickoff
    };
    const interviewOk = (rawPayload.available_for_interview as string[]).length > 0;
    const emailNotifOk = (rawPayload.email_notification_consent as string[]).length > 0;

    const missingField = Object.entries(required).find(([, v]) => !v || (typeof v === "string" && !v.trim()));
    if (missingField) {
      return {
        ok: false,
        message: `Thiếu trường bắt buộc: ${missingField[0]}.`
      };
    }
    if (!interviewOk) {
      return { ok: false, message: "Vui lòng chọn ít nhất một khoảng thời gian sẵn sàng phỏng vấn." };
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

    const result = await submitPilotApplication({
      role: "mentee" as ApplicationRole,
      seasonCode: SEASON_CODE,
      intakeBatchCode: INTAKE_BATCH_CODE,
      fullName,
      emailPrimary,
      phonePrimary,
      gender: gender || null,
      consentDataStorage,
      // Cap every stored string so one request cannot write unbounded text.
      rawPayload: truncateFieldValues(rawPayload)
    });

    if (!result.ok) return resultToState(result);

    await recordAcceptedSubmission("apply_mentee", ipHash);
    // Inside the try and before the redirect below: redirect() throws, so
    // anything after it never runs.
    await acknowledgeSubmission({
      applicationId: result.applicationId,
      role: "mentee",
      fullName,
      emailPrimary
    });

    revalidatePath("/admin/applications");
  } catch (err) {
    return fail("submitMenteeApplicationAction", err);
  }

  redirect("/apply/thanks?role=mentee");
}

