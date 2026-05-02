import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { isValidUuid } from "@/lib/events";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { JsonRecord, MenteeProfile, MentorProfile, Person } from "@/lib/types";

const SAFE_ERROR = "Không thể thực hiện tác vụ. Vui lòng kiểm tra cấu hình Supabase và server logs.";

export type MutationResult = {
  ok: boolean;
  message: string;
  data?: JsonRecord | null;
};

export type CreateMentorInput = {
  link_to_person_id?: unknown;
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  gender?: unknown;
  person_notes?: unknown;
  mentor_code?: unknown;
  company_current?: unknown;
  title_current?: unknown;
  years_experience_min?: unknown;
  years_experience_text?: unknown;
  bio_url?: unknown;
  first_vam_season?: unknown;
  years_in_vam?: unknown;
  program_ids?: string[];
  industry_ids?: string[];
  function_area_ids?: string[];
};

export type UpdateMentorInput = {
  mentor_profile_id: string;
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  gender?: unknown;
  mentor_code?: unknown;
  company_current?: unknown;
  title_current?: unknown;
  years_experience_min?: unknown;
  years_experience_text?: unknown;
  bio_url?: unknown;
  first_vam_season?: unknown;
  years_in_vam?: unknown;
  program_ids?: string[];
  industry_ids?: string[];
  function_area_ids?: string[];
};

export type CreateMenteeInput = {
  link_to_person_id?: unknown;
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  gender?: unknown;
  person_notes?: unknown;
  mentee_code?: unknown;
  school_code?: unknown;
  school_raw?: unknown;
  major?: unknown;
  class_cohort?: unknown;
  mssv?: unknown;
  year_of_study?: unknown;
  career_interests?: unknown;
};

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[people-create]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanEmail(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return text || null;
}

function cleanInt(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function clientResult() {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { client: null, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY trên server." as string | null };
  return { client, error: null as string | null };
}

async function requireAdmin(): Promise<{ ok: true; admin: Awaited<ReturnType<typeof getCurrentAdminUser>> } | { ok: false; message: string }> {
  const admin = await getCurrentAdminUser();
  if (!canEditRecaps(admin)) return { ok: false, message: "Bạn không có quyền tạo hồ sơ mentor/mentee." };
  return { ok: true, admin };
}

async function writeAdminAudit(client: any, input: { actionType: string; afterData?: unknown; details?: unknown }) {
  try {
    const admin = await getCurrentAdminUser();
    const { error } = await client.from("admin_audit_log").insert({
      actor_admin_user_id: admin?.id ?? null,
      action_type: input.actionType,
      target_admin_user_id: null,
      before_data: null,
      after_data: input.afterData ?? null,
      details: input.details ?? null
    });
    if (error) log("admin_audit_log insert failed", error);
  } catch (error) {
    log("admin audit crashed", error);
  }
}

async function findPersonByEmail(client: any, email: string): Promise<Person | null> {
  const { data, error } = await client
    .from("people")
    .select("id,full_name,email_primary,phone_primary,gender")
    .ilike("email_primary", email)
    .limit(1)
    .maybeSingle();
  if (error) {
    log("findPersonByEmail failed", error);
    return null;
  }
  return (data as Person) ?? null;
}

async function findPersonById(client: any, id: string): Promise<Person | null> {
  const { data, error } = await client
    .from("people")
    .select("id,full_name,email_primary,phone_primary,gender")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    log("findPersonById failed", error);
    return null;
  }
  return (data as Person) ?? null;
}

async function resolvePerson(
  client: any,
  input: { link_to_person_id?: unknown; full_name?: unknown; email?: unknown; phone?: unknown; gender?: unknown; person_notes?: unknown }
): Promise<{ ok: true; person: Person; created: boolean } | { ok: false; message: string; existing?: Person }> {
  const linkId = clean(input.link_to_person_id);
  if (linkId) {
    if (!isValidUuid(linkId)) return { ok: false, message: "ID người được liên kết không hợp lệ." };
    const existing = await findPersonById(client, linkId);
    if (!existing) return { ok: false, message: "Không tìm thấy người để liên kết." };
    return { ok: true, person: existing, created: false };
  }

  const fullName = clean(input.full_name);
  if (!fullName) return { ok: false, message: "Họ tên là bắt buộc khi tạo người mới." };

  const email = cleanEmail(input.email);
  if (email) {
    const duplicate = await findPersonByEmail(client, email);
    if (duplicate) {
      return {
        ok: false,
        message: `Email "${email}" đã tồn tại trong hệ thống (người: ${duplicate.full_name ?? duplicate.id}). Vui lòng dùng "Liên kết với người đã có" hoặc nhập email khác.`,
        existing: duplicate
      };
    }
  }

  const payload: JsonRecord = {
    full_name: fullName,
    email_primary: email,
    phone_primary: clean(input.phone),
    gender: clean(input.gender),
    source_sheets: "admin_manual_input"
  };
  const notes = clean(input.person_notes);
  if (notes) payload.data_quality_flags = `manual_note:${notes}`;

  const { data, error: insertError } = await client.from("people").insert(payload).select("*").maybeSingle();
  if (insertError) {
    log("insert person failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (people: ${insertError.message})` };
  }
  return { ok: true, person: data as Person, created: true };
}

function uniqueValidUuids(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!isValidUuid(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function fetchIndustriesByIds(client: any, ids: string[]) {
  if (!ids.length) return [] as Array<{ id: string; code: string; name: string }>;
  const { data, error } = await client.from("industries").select("id,code,name").in("id", ids);
  if (error) {
    log("fetchIndustriesByIds failed", error);
    return [];
  }
  return (data ?? []) as Array<{ id: string; code: string; name: string }>;
}

async function fetchFunctionAreasByIds(client: any, ids: string[]) {
  if (!ids.length) return [] as Array<{ id: string; code: string; name: string }>;
  const { data, error } = await client.from("function_areas").select("id,code,name").in("id", ids);
  if (error) {
    log("fetchFunctionAreasByIds failed", error);
    return [];
  }
  return (data ?? []) as Array<{ id: string; code: string; name: string }>;
}

async function fetchProgramsByIds(client: any, ids: string[]) {
  if (!ids.length) return [] as Array<{ id: string; code: string; name: string }>;
  const { data, error } = await client.from("programs").select("id,code,name").in("id", ids);
  if (error) {
    log("fetchProgramsByIds failed", error);
    return [];
  }
  return (data ?? []) as Array<{ id: string; code: string; name: string }>;
}

function orderedByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: T[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) out.push(row);
  }
  return out;
}

async function replaceMentorIndustryLinks(client: any, mentorProfileId: string, industryIds: string[]) {
  const del = await client.from("mentor_industries").delete().eq("mentor_profile_id", mentorProfileId);
  if (del.error) {
    log("replaceMentorIndustryLinks delete failed", del.error);
    return { error: del.error.message as string };
  }
  if (!industryIds.length) return { error: null as string | null };
  const rows = industryIds.map((industry_id) => ({ mentor_profile_id: mentorProfileId, industry_id }));
  const ins = await client.from("mentor_industries").insert(rows);
  if (ins.error) {
    log("replaceMentorIndustryLinks insert failed", ins.error);
    return { error: ins.error.message as string };
  }
  return { error: null as string | null };
}

async function replaceMentorFunctionAreaLinks(client: any, mentorProfileId: string, functionAreaIds: string[]) {
  const del = await client.from("mentor_function_areas").delete().eq("mentor_profile_id", mentorProfileId);
  if (del.error) {
    log("replaceMentorFunctionAreaLinks delete failed", del.error);
    return { error: del.error.message as string };
  }
  if (!functionAreaIds.length) return { error: null as string | null };
  const rows = functionAreaIds.map((function_area_id) => ({ mentor_profile_id: mentorProfileId, function_area_id }));
  const ins = await client.from("mentor_function_areas").insert(rows);
  if (ins.error) {
    log("replaceMentorFunctionAreaLinks insert failed", ins.error);
    return { error: ins.error.message as string };
  }
  return { error: null as string | null };
}

async function replaceMentorProgramParticipations(client: any, mentorProfileId: string, programIds: string[]) {
  const del = await client.from("mentor_program_participations").delete().eq("mentor_profile_id", mentorProfileId);
  if (del.error) {
    log("replaceMentorProgramParticipations delete failed", del.error);
    return { error: del.error.message as string };
  }
  if (!programIds.length) return { error: null as string | null };
  const rows = programIds.map((program_id) => ({
    mentor_profile_id: mentorProfileId,
    program_id,
    status: "active"
  }));
  const ins = await client.from("mentor_program_participations").insert(rows);
  if (ins.error) {
    log("replaceMentorProgramParticipations insert failed", ins.error);
    return { error: ins.error.message as string };
  }
  return { error: null as string | null };
}

async function loadMentorProfileLinks(client: any, mentorProfileId: string) {
  const [industries, functions, programs] = await Promise.all([
    client.from("mentor_industries").select("industry_id").eq("mentor_profile_id", mentorProfileId),
    client.from("mentor_function_areas").select("function_area_id").eq("mentor_profile_id", mentorProfileId),
    client.from("mentor_program_participations").select("program_id,status,role").eq("mentor_profile_id", mentorProfileId)
  ]);
  return {
    industry_ids: ((industries.data ?? []) as Array<{ industry_id: string }>).map((row) => row.industry_id),
    function_area_ids: ((functions.data ?? []) as Array<{ function_area_id: string }>).map((row) => row.function_area_id),
    programs: (programs.data ?? []) as Array<{ program_id: string; status: string | null; role: string | null }>
  };
}

async function existingMentorProfile(client: any, personId: string): Promise<MentorProfile | null> {
  const { data, error } = await client.from("mentor_profiles").select("id,person_id").eq("person_id", personId).limit(1).maybeSingle();
  if (error) {
    log("existingMentorProfile failed", error);
    return null;
  }
  return (data as MentorProfile) ?? null;
}

async function existingMenteeProfile(client: any, personId: string): Promise<MenteeProfile | null> {
  const { data, error } = await client.from("mentee_profiles").select("id,person_id").eq("person_id", personId).limit(1).maybeSingle();
  if (error) {
    log("existingMenteeProfile failed", error);
    return null;
  }
  return (data as MenteeProfile) ?? null;
}

export async function createMentorProfile(input: CreateMentorInput): Promise<MutationResult> {
  const access = await requireAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const person = await resolvePerson(client, input);
  if (!person.ok) return { ok: false, message: person.message };

  const dup = await existingMentorProfile(client, person.person.id);
  if (dup) return { ok: false, message: "Người này đã có hồ sơ mentor. Vui lòng mở hồ sơ thay vì tạo mới." };

  const programIds = uniqueValidUuids(input.program_ids);
  const industryIds = uniqueValidUuids(input.industry_ids);
  const functionAreaIds = uniqueValidUuids(input.function_area_ids);

  const [industriesPicked, functionsPicked, programsPicked] = await Promise.all([
    fetchIndustriesByIds(client, industryIds),
    fetchFunctionAreasByIds(client, functionAreaIds),
    fetchProgramsByIds(client, programIds)
  ]);

  const orderedIndustries = orderedByIds(industriesPicked, industryIds);
  const orderedFunctions = orderedByIds(functionsPicked, functionAreaIds);
  const orderedPrograms = orderedByIds(programsPicked, programIds);

  const primaryIndustryName = orderedIndustries[0]?.name ?? null;
  const primaryFunctionName = orderedFunctions[0]?.name ?? null;

  const payload: JsonRecord = {
    person_id: person.person.id,
    mentor_code: clean(input.mentor_code),
    company_current: clean(input.company_current),
    title_current: clean(input.title_current),
    industry: primaryIndustryName,
    function_area: primaryFunctionName,
    years_experience_min: cleanInt(input.years_experience_min),
    years_experience_text: clean(input.years_experience_text),
    bio_url: clean(input.bio_url),
    first_vam_season: clean(input.first_vam_season),
    years_in_vam: cleanInt(input.years_in_vam)
  };

  const { data, error: insertError } = await client.from("mentor_profiles").insert(payload).select("*").maybeSingle();
  if (insertError) {
    log("insert mentor_profile failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (mentor_profiles: ${insertError.message})` };
  }

  const mentorProfile = data as MentorProfile;
  const linkErrors: string[] = [];
  const indLink = await replaceMentorIndustryLinks(client, mentorProfile.id, orderedIndustries.map((row) => row.id));
  if (indLink.error) linkErrors.push(`mentor_industries: ${indLink.error}`);
  const funcLink = await replaceMentorFunctionAreaLinks(client, mentorProfile.id, orderedFunctions.map((row) => row.id));
  if (funcLink.error) linkErrors.push(`mentor_function_areas: ${funcLink.error}`);
  const progLink = await replaceMentorProgramParticipations(client, mentorProfile.id, orderedPrograms.map((row) => row.id));
  if (progLink.error) linkErrors.push(`mentor_program_participations: ${progLink.error}`);

  await writeAdminAudit(client, {
    actionType: "create_mentor_profile",
    afterData: {
      mentor_profile: mentorProfile,
      person: person.person,
      person_created: person.created,
      industry_ids: orderedIndustries.map((row) => row.id),
      function_area_ids: orderedFunctions.map((row) => row.id),
      program_ids: orderedPrograms.map((row) => row.id),
      primary_industry: primaryIndustryName,
      primary_function_area: primaryFunctionName
    },
    details: linkErrors.length ? { partial_failures: linkErrors } : null
  });

  if (linkErrors.length) {
    return {
      ok: true,
      message: `${person.created ? "Đã tạo person và hồ sơ mentor" : "Đã liên kết người sẵn có và tạo hồ sơ mentor"}, nhưng một số liên kết lỗi: ${linkErrors.join("; ")}`,
      data: { mentor_profile: mentorProfile, person: person.person, person_created: person.created }
    };
  }

  return {
    ok: true,
    message: person.created ? "Đã tạo person và hồ sơ mentor mới." : "Đã liên kết người sẵn có và tạo hồ sơ mentor.",
    data: { mentor_profile: mentorProfile, person: person.person, person_created: person.created }
  };
}

export async function updateMentorProfile(input: UpdateMentorInput): Promise<MutationResult> {
  const access = await requireAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const mentorProfileId = String(input.mentor_profile_id ?? "").trim();
  if (!isValidUuid(mentorProfileId)) {
    return { ok: false, message: "ID hồ sơ mentor không hợp lệ." };
  }

  const { data: before, error: beforeError } = await client
    .from("mentor_profiles")
    .select("*")
    .eq("id", mentorProfileId)
    .maybeSingle();
  if (beforeError) {
    log("load mentor_profile failed", beforeError);
    return { ok: false, message: `${SAFE_ERROR} (mentor_profiles: ${beforeError.message})` };
  }
  if (!before) return { ok: false, message: "Không tìm thấy hồ sơ mentor." };

  const personBeforeRes = await client
    .from("people")
    .select("id,full_name,email_primary,phone_primary,gender")
    .eq("id", before.person_id)
    .maybeSingle();
  if (personBeforeRes.error || !personBeforeRes.data) {
    log("load person failed", personBeforeRes.error);
    return { ok: false, message: "Không tìm thấy person liên kết." };
  }
  const personBefore = personBeforeRes.data as Person;
  const linksBefore = await loadMentorProfileLinks(client, mentorProfileId);

  const programIds = uniqueValidUuids(input.program_ids);
  const industryIds = uniqueValidUuids(input.industry_ids);
  const functionAreaIds = uniqueValidUuids(input.function_area_ids);

  const [industriesPicked, functionsPicked, programsPicked] = await Promise.all([
    fetchIndustriesByIds(client, industryIds),
    fetchFunctionAreasByIds(client, functionAreaIds),
    fetchProgramsByIds(client, programIds)
  ]);
  const orderedIndustries = orderedByIds(industriesPicked, industryIds);
  const orderedFunctions = orderedByIds(functionsPicked, functionAreaIds);
  const orderedPrograms = orderedByIds(programsPicked, programIds);
  const primaryIndustryName = orderedIndustries[0]?.name ?? null;
  const primaryFunctionName = orderedFunctions[0]?.name ?? null;

  const personUpdates: JsonRecord = {};
  if (Object.prototype.hasOwnProperty.call(input, "full_name")) {
    const fullName = clean(input.full_name);
    if (!fullName) return { ok: false, message: "Họ tên không được để trống." };
    personUpdates.full_name = fullName;
  }
  if (Object.prototype.hasOwnProperty.call(input, "email")) {
    const newEmail = cleanEmail(input.email);
    if (newEmail && newEmail !== (personBefore.email_primary ?? "").toLowerCase()) {
      const dup = await findPersonByEmail(client, newEmail);
      if (dup && dup.id !== personBefore.id) {
        return { ok: false, message: `Email "${newEmail}" đã được dùng bởi người khác.` };
      }
    }
    personUpdates.email_primary = newEmail;
  }
  if (Object.prototype.hasOwnProperty.call(input, "phone")) personUpdates.phone_primary = clean(input.phone);
  if (Object.prototype.hasOwnProperty.call(input, "gender")) personUpdates.gender = clean(input.gender);

  let personAfter: Person = personBefore;
  if (Object.keys(personUpdates).length) {
    const { data: updatedPerson, error: personError } = await client
      .from("people")
      .update(personUpdates)
      .eq("id", personBefore.id)
      .select("*")
      .maybeSingle();
    if (personError) {
      log("update person failed", personError);
      return { ok: false, message: `${SAFE_ERROR} (people update: ${personError.message})` };
    }
    personAfter = updatedPerson as Person;
  }

  const mentorUpdates: JsonRecord = {
    mentor_code: clean(input.mentor_code),
    company_current: clean(input.company_current),
    title_current: clean(input.title_current),
    industry: primaryIndustryName,
    function_area: primaryFunctionName,
    years_experience_min: cleanInt(input.years_experience_min),
    years_experience_text: clean(input.years_experience_text),
    bio_url: clean(input.bio_url),
    first_vam_season: clean(input.first_vam_season),
    years_in_vam: cleanInt(input.years_in_vam)
  };

  const { data: after, error: updateError } = await client
    .from("mentor_profiles")
    .update(mentorUpdates)
    .eq("id", mentorProfileId)
    .select("*")
    .maybeSingle();
  if (updateError) {
    log("update mentor_profile failed", updateError);
    return { ok: false, message: `${SAFE_ERROR} (mentor_profiles update: ${updateError.message})` };
  }

  const linkErrors: string[] = [];
  const indLink = await replaceMentorIndustryLinks(client, mentorProfileId, orderedIndustries.map((row) => row.id));
  if (indLink.error) linkErrors.push(`mentor_industries: ${indLink.error}`);
  const funcLink = await replaceMentorFunctionAreaLinks(client, mentorProfileId, orderedFunctions.map((row) => row.id));
  if (funcLink.error) linkErrors.push(`mentor_function_areas: ${funcLink.error}`);
  const progLink = await replaceMentorProgramParticipations(client, mentorProfileId, orderedPrograms.map((row) => row.id));
  if (progLink.error) linkErrors.push(`mentor_program_participations: ${progLink.error}`);

  await writeAdminAudit(client, {
    actionType: "update_mentor_profile",
    afterData: {
      mentor_profile_before: before,
      mentor_profile_after: after,
      person_before: personBefore,
      person_after: personAfter,
      links_before: linksBefore,
      links_after: {
        industry_ids: orderedIndustries.map((row) => row.id),
        function_area_ids: orderedFunctions.map((row) => row.id),
        program_ids: orderedPrograms.map((row) => row.id)
      }
    },
    details: linkErrors.length ? { partial_failures: linkErrors } : null
  });

  if (linkErrors.length) {
    return {
      ok: true,
      message: `Đã cập nhật hồ sơ mentor, nhưng một số liên kết lỗi: ${linkErrors.join("; ")}`,
      data: { mentor_profile: after, person: personAfter }
    };
  }

  return {
    ok: true,
    message: "Đã cập nhật hồ sơ mentor.",
    data: { mentor_profile: after, person: personAfter }
  };
}

export async function createMenteeProfile(input: CreateMenteeInput): Promise<MutationResult> {
  const access = await requireAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const person = await resolvePerson(client, input);
  if (!person.ok) return { ok: false, message: person.message };

  const dup = await existingMenteeProfile(client, person.person.id);
  if (dup) return { ok: false, message: "Người này đã có hồ sơ mentee. Vui lòng mở hồ sơ thay vì tạo mới." };

  const yearOfStudy = clean(input.year_of_study);
  const careerInterests = clean(input.career_interests);

  const payload: JsonRecord = {
    person_id: person.person.id,
    mentee_code: clean(input.mentee_code),
    school_code: clean(input.school_code),
    school_raw: clean(input.school_raw),
    major: clean(input.major),
    class_cohort: clean(input.class_cohort) ?? yearOfStudy,
    mssv: clean(input.mssv)
  };

  const { data, error: insertError } = await client.from("mentee_profiles").insert(payload).select("*").maybeSingle();
  if (insertError) {
    log("insert mentee_profile failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (mentee_profiles: ${insertError.message})` };
  }

  await writeAdminAudit(client, {
    actionType: "create_mentee_profile",
    afterData: { mentee_profile: data, person: person.person, person_created: person.created },
    details:
      yearOfStudy || careerInterests
        ? { note: "year_of_study/career_interests saved as audit only — schema gap", year_of_study: yearOfStudy, career_interests: careerInterests }
        : null
  });
  return {
    ok: true,
    message: person.created ? "Đã tạo person và hồ sơ mentee mới." : "Đã liên kết người sẵn có và tạo hồ sơ mentee.",
    data: { mentee_profile: data, person: person.person, person_created: person.created }
  };
}
