"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { createMenteeProfile, createMentorProfile, updateMenteeProfile, updateMentorProfile } from "@/lib/people-create";

export type PeopleActionState = {
  ok: boolean;
  message: string | null;
  createdPersonId?: string | null;
};

const initialState: PeopleActionState = { ok: false, message: null };

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function formArray(formData: FormData, key: string) {
  return formData.getAll(key).map((value) => String(value ?? "").trim()).filter(Boolean);
}

async function ensureAuth(): Promise<PeopleActionState | null> {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return { ok: false, message: "Bạn không có quyền tạo hồ sơ mentor/mentee." };
  }
  return null;
}

export async function createMentorAction(_previous: PeopleActionState, formData: FormData): Promise<PeopleActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const result = await createMentorProfile({
    link_to_person_id: formText(formData, "link_to_person_id"),
    full_name: formText(formData, "full_name"),
    email: formText(formData, "email"),
    phone: formText(formData, "phone"),
    gender: formText(formData, "gender"),
    person_notes: formText(formData, "person_notes"),
    mentor_code: formText(formData, "mentor_code"),
    company_current: formText(formData, "company_current"),
    title_current: formText(formData, "title_current"),
    years_experience_min: formText(formData, "years_experience_min"),
    years_experience_text: formText(formData, "years_experience_text"),
    bio_url: formText(formData, "bio_url"),
    first_vam_season: formText(formData, "first_vam_season"),
    years_in_vam: formText(formData, "years_in_vam"),
    program_ids: formArray(formData, "program_ids"),
    industry_ids: formArray(formData, "industry_ids"),
    function_area_ids: formArray(formData, "function_area_ids")
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/mentors", "layout");
  revalidatePath("/people", "layout");
  const personId = (result.data?.person as { id?: string })?.id ?? null;
  if (personId) revalidatePath(`/people/${personId}`, "page");
  return { ok: true, message: result.message, createdPersonId: personId };
}

export async function createMenteeAction(_previous: PeopleActionState, formData: FormData): Promise<PeopleActionState> {
  const denied = await ensureAuth();
  if (denied) return denied;

  const result = await createMenteeProfile({
    link_to_person_id: formText(formData, "link_to_person_id"),
    full_name: formText(formData, "full_name"),
    email: formText(formData, "email"),
    phone: formText(formData, "phone"),
    gender: formText(formData, "gender"),
    person_notes: formText(formData, "person_notes"),
    mentee_code: formText(formData, "mentee_code"),
    school_code: formText(formData, "school_code"),
    school_raw: formText(formData, "school_raw"),
    major: formText(formData, "major"),
    class_cohort: formText(formData, "class_cohort"),
    mssv: formText(formData, "mssv"),
    year_of_study: formText(formData, "year_of_study"),
    career_interests: formText(formData, "career_interests")
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/mentees", "layout");
  revalidatePath("/people", "layout");
  const personId = (result.data?.person as { id?: string })?.id ?? null;
  if (personId) revalidatePath(`/people/${personId}`, "page");
  return { ok: true, message: result.message, createdPersonId: personId };
}

export async function updateMentorAction(_previous: PeopleActionState, formData: FormData): Promise<PeopleActionState> {
  try {
    const denied = await ensureAuth();
    if (denied) return denied;

    const mentorProfileId = formText(formData, "mentor_profile_id");
    if (!mentorProfileId) return { ok: false, message: "Thiếu mentor_profile_id." };

    const result = await updateMentorProfile({
      mentor_profile_id: mentorProfileId,
      full_name: formText(formData, "full_name"),
      email: formText(formData, "email"),
      phone: formText(formData, "phone"),
      gender: formText(formData, "gender"),
      mentor_code: formText(formData, "mentor_code"),
      company_current: formText(formData, "company_current"),
      title_current: formText(formData, "title_current"),
      years_experience_min: formText(formData, "years_experience_min"),
      years_experience_text: formText(formData, "years_experience_text"),
      bio_url: formText(formData, "bio_url"),
      first_vam_season: formText(formData, "first_vam_season"),
      years_in_vam: formText(formData, "years_in_vam"),
      program_ids: formArray(formData, "program_ids"),
      industry_ids: formArray(formData, "industry_ids"),
      function_area_ids: formArray(formData, "function_area_ids")
    });

    if (!result.ok) return { ok: false, message: result.message };

    revalidatePath("/mentors", "layout");
    revalidatePath("/people", "layout");
    const personId = (result.data?.person as { id?: string })?.id ?? null;
    if (personId) revalidatePath(`/people/${personId}`, "page");
    revalidatePath(`/mentors/${mentorProfileId}/edit`, "page");
    return { ok: true, message: result.message, createdPersonId: personId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[updateMentorAction] unhandled error", err);
    return { ok: false, message: `Lỗi hệ thống: ${msg}` };
  }
}

export async function updateMenteeAction(_previous: PeopleActionState, formData: FormData): Promise<PeopleActionState> {
  try {
    // DEBUG (temporary): dump every FormData key/value so we can verify the
    // browser is actually submitting mentee_profile_id, person_id and major.
    try {
      const debugEntries: Record<string, string> = {};
      formData.forEach((v, k) => {
        debugEntries[k] = typeof v === "string" ? v : `[File:${(v as File).name}]`;
      });
      console.log("[updateMenteeAction] received FormData", debugEntries);
    } catch (e) {
      console.warn("[updateMenteeAction] could not enumerate FormData", e);
    }

    const denied = await ensureAuth();
    if (denied) {
      console.warn("[updateMenteeAction] auth denied", denied);
      return denied;
    }

    const menteeProfileId = formText(formData, "mentee_profile_id");
    const personId = formText(formData, "person_id");
    if (!menteeProfileId) {
      console.warn("[updateMenteeAction] missing mentee_profile_id");
      return { ok: false, message: "Thiếu mentee_profile_id — biểu mẫu không gửi ID hồ sơ. Vui lòng tải lại trang." };
    }
    if (!personId) {
      console.warn("[updateMenteeAction] missing person_id");
      return { ok: false, message: "Thiếu person_id — biểu mẫu không gửi ID người. Vui lòng tải lại trang." };
    }

    const result = await updateMenteeProfile({
      mentee_profile_id: menteeProfileId,
      full_name: formText(formData, "full_name"),
      email: formText(formData, "email"),
      phone: formText(formData, "phone"),
      gender: formText(formData, "gender"),
      mentee_code: formText(formData, "mentee_code"),
      school_code: formText(formData, "school_code"),
      school_raw: formText(formData, "school_raw"),
      major: formText(formData, "major"),
      class_cohort: formText(formData, "class_cohort"),
      mssv: formText(formData, "mssv"),
      year_of_study: formText(formData, "year_of_study"),
      career_interests: formText(formData, "career_interests")
    });

    if (!result.ok) {
      console.warn("[updateMenteeAction] updateMenteeProfile returned not-ok", result.message);
      return { ok: false, message: result.message };
    }

    revalidatePath("/mentees", "layout");
    revalidatePath("/people", "layout");
    const resolvedPersonId = (result.data?.person as { id?: string })?.id ?? personId ?? null;
    if (resolvedPersonId) revalidatePath(`/people/${resolvedPersonId}`, "page");
    revalidatePath(`/mentees/${menteeProfileId}/edit`, "page");
    console.log("[updateMenteeAction] success", { menteeProfileId, personId: resolvedPersonId });
    return { ok: true, message: result.message, createdPersonId: resolvedPersonId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[updateMenteeAction] unhandled error", err);
    return { ok: false, message: `Lỗi hệ thống: ${msg}` };
  }
}

