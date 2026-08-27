import "server-only";

import { emailsEqual, normalizeEmail } from "@/lib/identity";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { JsonRecord, MenteeProfile, MentorProfile, Person } from "@/lib/types";

// -----------------------------------------------------------------------
// Phase 042 — Approve an application as official mentor or mentee.
//
// This module is intentionally narrow in scope:
//   - Does NOT call createMentorProfile / createMenteeProfile from
//     people-create.ts (those require a full form payload + canEditRecaps).
//   - Creates or refreshes mentor profiles through a narrow canonical-field
//     allowlist. Admins fill in unsupported rich fields later.
//   - Handles dedup by email so re-approving the same applicant is safe.
//   - Records both an application_decisions audit row and an
//     admin_audit_log entry.
//   - Does NOT build industry links, program participations, or any other
//     relational profile data — those are Phase 043+.
// -----------------------------------------------------------------------

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    console.error("[application-approvals] service-role client unavailable");
    return null;
  }
  return client;
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[application-approvals]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApproveApplicationInput = {
  applicationId: string;
  approvedByAdminUserId: string;
  approvedByName: string | null;
  /** Identity from the application row (coalesced display values). */
  fullName: string | null;
  emailPrimary: string | null;
  phonePrimary: string | null;
  gender: string | null;
  /** The season code to tag on the profile source (e.g. "UEHM-S12"). */
  seasonCode: string | null;
  /** Phase 043: intake_batch_id from the source application row. */
  intakeBatchId: string | null;
  /** "mentor" or "mentee" — drives which profile table is written. */
  targetRole: "mentor" | "mentee";
  previousStatus: string | null;
};

type LookupResult<T> =
  | { ok: true; data: T | null }
  | { ok: false };

type ApprovalApplicationSource = {
  person_id: string | null;
  season_id: string | null;
  role_applied: string | null;
  raw_payload: Record<string, unknown> | null;
  source?: string | null;
  renewal_invites?: Array<{
    id?: string | null;
    person_id?: string | null;
    season_id?: string | null;
    role?: string | null;
  }> | null;
};

export type MentorProfileRefresh = Pick<
  MentorProfile,
  | "company_current"
  | "title_current"
  | "years_experience_min"
  | "years_experience_text"
  | "industry"
  | "function_area"
> & {
  capacity_target?: number | null;
  first_vam_season?: string | null;
};

export type ApproveApplicationResult =
  | {
      ok: true;
      personId: string;
      profileId: string;
      personCreated: boolean;
      profileCreated: boolean;
    }
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Gender normalization
//
// public.people.gender uses the gender_type enum: male | female | other | undisclosed
// S12 native application forms submit "prefer_not_say" which is not a valid
// enum value. Normalize the raw application gender before inserting into people.
//
// Mapping:
//   "male"           → "male"
//   "female"         → "female"
//   "other"          → "other"
//   "prefer_not_say" → "undisclosed"
//   "undisclosed"    → "undisclosed"
//   empty / unknown  → null  (safer than storing garbage in the enum column)
// ---------------------------------------------------------------------------

const VALID_PEOPLE_GENDER = new Set(["male", "female", "other", "undisclosed"]);

function normalizeGenderForPeople(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "prefer_not_say") return "undisclosed";
  if (VALID_PEOPLE_GENDER.has(raw)) return raw;
  // Unknown value — omit rather than write an invalid string into the enum column
  return null;
}

function nonBlankText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * Explicit allowlist from the current S12 mentor application payload to the
 * profile fields used by current display, editing, matching, search and export.
 * Unmapped payload fields deliberately remain historical application data.
 */
export function buildMentorProfileRefresh(
  rawPayload: Record<string, unknown> | null | undefined
): Partial<MentorProfileRefresh> {
  const payload = rawPayload ?? {};
  const patch: Partial<MentorProfileRefresh> = {};

  const company = nonBlankText(payload.company_current);
  if (company !== undefined) patch.company_current = company;
  const title = nonBlankText(payload.title_current);
  if (title !== undefined) patch.title_current = title;
  const functionArea = nonBlankText(payload.function_primary);
  if (functionArea !== undefined) patch.function_area = functionArea;
  const industry = nonBlankText(payload.industry_primary);
  if (industry !== undefined) patch.industry = industry;
  const experienceBucket = nonBlankText(payload.years_of_experience);
  if (experienceBucket !== undefined) patch.years_experience_text = experienceBucket;
  const firstVamSeason = nonBlankText(payload.first_vam_season);
  if (firstVamSeason !== undefined) patch.first_vam_season = firstVamSeason;

  const capacity = nonNegativeInteger(payload.mentoring_capacity_total);
  if (capacity !== undefined) patch.capacity_target = capacity;

  // Exact numeric work years and the submitted experience bucket are distinct.
  // Never derive this value from years_of_experience (for example "16+").
  const exactWorkYears = nonNegativeInteger(payload.mentor_total_work_years);
  if (exactWorkYears !== undefined) patch.years_experience_min = exactWorkYears;

  return patch;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findPersonByEmail(
  client: ReturnType<typeof getSupabaseServiceRoleClient>,
  email: string
): Promise<LookupResult<Person>> {
  const { data, error } = await (client as NonNullable<typeof client>)
    .from("people")
    .select("id,full_name,email_primary,phone_primary,gender")
    .ilike("email_primary", email)
    .maybeSingle();
  if (error) {
    log("findPersonByEmail", error);
    return { ok: false };
  }
  const person = (data as Person) ?? null;
  if (person && !emailsEqual(person.email_primary, email)) {
    log("findPersonByEmail returned a non-exact candidate", { code: "IDENTITY_MISMATCH" });
    return { ok: false };
  }
  return { ok: true, data: person };
}

async function findPersonById(
  client: ReturnType<typeof getSupabaseServiceRoleClient>,
  id: string
): Promise<LookupResult<Person>> {
  const { data, error } = await (client as NonNullable<typeof client>)
    .from("people")
    .select("id,full_name,email_primary,phone_primary,gender")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    log("findPersonById", error);
    return { ok: false };
  }
  return { ok: true, data: (data as Person) ?? null };
}

async function findMentorProfileByPersonId(
  client: ReturnType<typeof getSupabaseServiceRoleClient>,
  personId: string
): Promise<LookupResult<MentorProfile>> {
  const { data, error } = await (client as NonNullable<typeof client>)
    .from("mentor_profiles")
    .select("id,person_id,mentor_code")
    .eq("person_id", personId)
    .maybeSingle();
  if (error) {
    log("findMentorProfileByPersonId", error);
    return { ok: false };
  }
  return { ok: true, data: (data as MentorProfile) ?? null };
}

async function findMenteeProfileByPersonId(
  client: ReturnType<typeof getSupabaseServiceRoleClient>,
  personId: string
): Promise<LookupResult<MenteeProfile>> {
  const { data, error } = await (client as NonNullable<typeof client>)
    .from("mentee_profiles")
    .select("id,person_id,mentee_code")
    .eq("person_id", personId)
    .maybeSingle();
  if (error) {
    log("findMenteeProfileByPersonId", error);
    return { ok: false };
  }
  return { ok: true, data: (data as MenteeProfile) ?? null };
}

// ---------------------------------------------------------------------------
// Core approval function
// ---------------------------------------------------------------------------

export async function approveApplication(
  input: ApproveApplicationInput
): Promise<ApproveApplicationResult> {
  if (!input.fullName?.trim()) {
    return { ok: false, message: "Họ tên ứng viên không được để trống khi tạo hồ sơ." };
  }

  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // Load profile input from the stored application, never from a client-sent
  // raw_payload. This also proves the target application exists before writes.
  const { data: applicationSourceData, error: applicationSourceError } = await client
    .from("applications")
    .select(
      "person_id,season_id,role_applied,raw_payload,source,renewal_invites:person_season_invites!person_season_invites_application_id_fkey(id,person_id,season_id,role)"
    )
    .eq("id", input.applicationId)
    .maybeSingle();
  if (applicationSourceError || !applicationSourceData) {
    log("load approval application source failed", applicationSourceError);
    return { ok: false, message: "Không thể tải đơn ứng tuyển. " + SAFE_ERROR };
  }
  const applicationSource = applicationSourceData as ApprovalApplicationSource;

  // P0-RT-10/11 — renewal approval is impossible until M071 has durably
  // recorded the admin's profile confirmation AND the exact invite-bound
  // person+season+role membership is active. These checks live in the shared
  // approval boundary, before the first INSERT/UPDATE, so every caller is
  // protected, including the ordinary application page.
  // The invite binding is checked independently of `source`: a malformed or
  // legacy source value must not turn an invite-bound renewal into an ordinary
  // application. The relationship is read in the same trusted query as the
  // application; a query failure above therefore refuses before any write.
  const inviteBindings = Array.isArray(applicationSource.renewal_invites)
    ? applicationSource.renewal_invites
    : [];
  const isRenewal =
    applicationSource.source === "s12_mentor_renewal" || inviteBindings.length > 0;

  if (isRenewal) {
    // A renewal source without exactly one matching invite is ambiguous. The
    // application and invite are both trusted server reads; browser-supplied
    // identity, season and role values are never used for this gate.
    const invite = inviteBindings.length === 1 ? inviteBindings[0] : null;
    const boundPersonId = String(invite?.person_id ?? "").trim();
    const boundSeasonId = String(invite?.season_id ?? "").trim();
    const boundRole = String(invite?.role ?? "").trim();
    if (
      !invite ||
      !boundPersonId ||
      !boundSeasonId ||
      !boundRole ||
      boundPersonId !== applicationSource.person_id ||
      boundSeasonId !== applicationSource.season_id ||
      boundRole !== applicationSource.role_applied ||
      boundRole !== input.targetRole
    ) {
      log("renewal approval refused: invite binding missing or ambiguous", {
        code: "RENEWAL_BINDING_INVALID"
      });
      return {
        ok: false,
        message: "Liên kết gia hạn không hợp lệ hoặc không duy nhất. Không có thay đổi nào được thực hiện."
      };
    }

    const { data: confirmationRows, error: confirmationError } = await client
      .from("admin_audit_log")
      .select("id,details")
      .eq("action_type", "confirm_renewal")
      .eq("details->>application_id", input.applicationId)
      .order("created_at", { ascending: false })
      .limit(1);

    const confirmation = Array.isArray(confirmationRows) ? confirmationRows[0] : null;
    const confirmedApplicationId = String(
      (confirmation as { details?: { application_id?: unknown } } | null)?.details?.application_id ?? ""
    );
    if (
      confirmationError ||
      !confirmation ||
      confirmedApplicationId !== input.applicationId
    ) {
      log("renewal approval refused: durable confirmation evidence missing or untrusted", {
        code: confirmationError?.code ?? "RENEWAL_CONFIRMATION_REQUIRED"
      });
      return {
        ok: false,
        message: "Đơn gia hạn chưa có xác nhận hồ sơ hợp lệ. Không có thay đổi nào được thực hiện."
      };
    }

    const { data: membershipData, error: membershipError } = await client
      .from("person_season_memberships")
      .select("id,status")
      .eq("person_id", boundPersonId)
      .eq("season_id", boundSeasonId)
      .eq("role", boundRole)
      .maybeSingle();
    const membership = membershipData as { id?: string; status?: string | null } | null;
    if (
      membershipError ||
      !membership ||
      membership.status !== "active"
    ) {
      log("renewal approval refused: bound membership is not active", {
        code: membershipError?.code ?? "RENEWAL_MEMBERSHIP_NOT_ACTIVE"
      });
      return {
        ok: false,
        message: "Membership gia hạn chưa ở trạng thái active. Không có thay đổi nào được thực hiện."
      };
    }
  }

  const mentorProfileRefresh = buildMentorProfileRefresh(applicationSource.raw_payload);

  // ------------------------------------------------------------------
  // 1. Resolve person (find by email or create new)
  // ------------------------------------------------------------------

  let person: Person | null = null;
  let personCreated = false;

  const emailNorm = input.emailPrimary ? normalizeEmail(input.emailPrimary) : null;

  // An existing application linkage is authoritative. For an unlinked
  // application, email lookup must resolve zero or one row; maybeSingle fails
  // closed if data corruption has produced multiple candidates.
  if (applicationSource.person_id) {
    const linkedPerson = await findPersonById(client, applicationSource.person_id);
    if (!linkedPerson.ok || !linkedPerson.data) {
      return { ok: false, message: "Không thể xác định hồ sơ người đã liên kết. " + SAFE_ERROR };
    }
    person = linkedPerson.data;
  } else if (emailNorm) {
    const emailPerson = await findPersonByEmail(client, emailNorm);
    if (!emailPerson.ok) {
      return { ok: false, message: "Không thể xác định duy nhất hồ sơ người theo email. " + SAFE_ERROR };
    }
    person = emailPerson.data;
  }

  if (!person) {
    // Create new person
    const { data: newPerson, error: personErr } = await client
      .from("people")
      .insert({
        full_name: input.fullName.trim(),
        email_primary: emailNorm,
        phone_primary: input.phonePrimary?.trim() ?? null,
        gender: normalizeGenderForPeople(input.gender),
        source_sheets: "s12_native_application"
      })
      .select("id,full_name,email_primary,phone_primary,gender")
      .maybeSingle();

    if (personErr || !newPerson) {
      log("insert person failed", personErr);
      return { ok: false, message: "Không thể tạo hồ sơ người. " + SAFE_ERROR };
    }
    person = newPerson as Person;
    personCreated = true;
  }

  // ------------------------------------------------------------------
  // 2. Create or reuse profile
  // ------------------------------------------------------------------

  let profileId: string;
  let profileCreated = false;
  const newStatus =
    input.targetRole === "mentor" ? "approved_as_mentor" : "approved_as_mentee";

  if (input.targetRole === "mentor") {
    const profileLookup = await findMentorProfileByPersonId(client, person.id);
    if (!profileLookup.ok) {
      return { ok: false, message: "Không thể xác định duy nhất mentor profile. " + SAFE_ERROR };
    }
    const existing = profileLookup.data;
    if (existing) {
      // Reuse and refresh only explicitly allowlisted, non-blank canonical
      // fields. mentor_code and creation provenance are intentionally absent.
      if (Object.keys(mentorProfileRefresh).length > 0) {
        const { error: refreshError } = await client
          .from("mentor_profiles")
          .update(mentorProfileRefresh as JsonRecord)
          .eq("id", existing.id);
        if (refreshError) {
          log("refresh mentor_profile failed", refreshError);
          return { ok: false, message: "Không thể cập nhật mentor profile. " + SAFE_ERROR };
        }
      }
      profileId = existing.id;
      profileCreated = false;
    } else {
      const { data: newProfile, error: profileErr } = await client
        .from("mentor_profiles")
        .insert({
          person_id: person.id,
          mentor_code: null, // Admin sets via /mentors/[id]/edit
          source_application_id: input.applicationId,
          intake_batch_id: input.intakeBatchId ?? null,
          ...mentorProfileRefresh
        })
        .select("id")
        .maybeSingle();

      if (profileErr || !newProfile) {
        log("insert mentor_profile failed", profileErr);
        return { ok: false, message: "Không thể tạo mentor profile. " + SAFE_ERROR };
      }
      profileId = (newProfile as { id: string }).id;
      profileCreated = true;
    }
  } else {
    const profileLookup = await findMenteeProfileByPersonId(client, person.id);
    if (!profileLookup.ok) {
      return { ok: false, message: "Không thể xác định duy nhất mentee profile. " + SAFE_ERROR };
    }
    const existing = profileLookup.data;
    if (existing) {
      profileId = existing.id;
      profileCreated = false;
    } else {
      const { data: newProfile, error: profileErr } = await client
        .from("mentee_profiles")
        .insert({
          person_id: person.id,
          mentee_code: null, // Admin sets via /mentees/[id]/edit
          source_application_id: input.applicationId,
          intake_batch_id: input.intakeBatchId ?? null
        })
        .select("id")
        .maybeSingle();

      if (profileErr || !newProfile) {
        log("insert mentee_profile failed", profileErr);
        return { ok: false, message: "Không thể tạo mentee profile. " + SAFE_ERROR };
      }
      profileId = (newProfile as { id: string }).id;
      profileCreated = true;
    }
  }

  // ------------------------------------------------------------------
  // 3. Update application: status + person_id link
  // ------------------------------------------------------------------

  const { error: appErr } = await client
    .from("applications")
    .update({
      status: newStatus,
      person_id: person.id
    })
    .eq("id", input.applicationId);

  if (appErr) {
    log("update application status/person_id failed", appErr);
    return {
      ok: false,
      message: "Không thể cập nhật trạng thái đơn. " + SAFE_ERROR
    };
  }

  // ------------------------------------------------------------------
  // 4. Audit row in application_decisions (non-fatal)
  // ------------------------------------------------------------------

  const { error: auditErr } = await client.from("application_decisions").insert({
    application_id: input.applicationId,
    decided_by: input.approvedByAdminUserId,
    decided_by_name: input.approvedByName,
    decision: newStatus,
    previous_status: input.previousStatus,
    new_status: newStatus,
    decision_note: `Approved as ${input.targetRole}. person_id=${person.id} profile_id=${profileId} person_created=${personCreated} profile_created=${profileCreated}`
  });

  if (auditErr) {
    log("insert application_decisions audit row failed (non-fatal)", auditErr);
  }

  // ------------------------------------------------------------------
  // 5. admin_audit_log (non-fatal — same pattern as people-create.ts)
  // ------------------------------------------------------------------

  await client
    .from("admin_audit_log")
    .insert({
      actor_admin_user_id: input.approvedByAdminUserId,
      action_type: `approve_application_as_${input.targetRole}`,
      target_admin_user_id: null,
      before_data: null,
      after_data: {
        application_id: input.applicationId,
        person_id: person.id,
        profile_id: profileId,
        person_created: personCreated,
        profile_created: profileCreated,
        new_status: newStatus
      },
      details: null
    })
    .then(({ error }) => {
      if (error) log("admin_audit_log insert failed (non-fatal)", error);
    });

  return {
    ok: true,
    personId: person.id,
    profileId,
    personCreated,
    profileCreated
  };
}
