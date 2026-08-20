import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { seedMentorFieldsFromApplication } from "@/lib/mentor-cross-fields";
import { clampCapacity, DEFAULT_MAX_MENTEES } from "@/lib/mentor-confirmations-core";
import type { MenteeProfile, MentorProfile, Person } from "@/lib/types";

// -----------------------------------------------------------------------
// Phase 042 — Approve an application as official mentor or mentee.
//
// This module is intentionally narrow in scope:
//   - Does NOT call createMentorProfile / createMenteeProfile from
//     people-create.ts (those require a full form payload + canEditRecaps).
//   - Creates only minimal profile rows from the application's identity
//     data. Admins fill in the rich fields later via /mentors/[id]/edit.
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
// Season participation seed for newly approved mentors
// ---------------------------------------------------------------------------

/**
 * Create the mentor's season-confirmation row from what they already told us on
 * the application form (`raw_payload.mentoring_capacity_total`, 1–3).
 *
 * Non-fatal in every branch: approving an application must not fail because a
 * convenience row could not be written.
 *
 * A mentor approved through this path applied for this season and was accepted,
 * so they are participating and the row is created as `confirmed`. When the
 * form carried no usable capacity — an imported or legacy row, since the field
 * is required on the current form — the smallest capacity applies: a mentor who
 * did not state a number takes at most one mentee. An operator can raise it
 * afterwards on /mentors/season-confirmations.
 */
/**
 * Give a newly approved mentor the fields they named on their application.
 *
 * Reads the same two things seedMentorSeasonConfirmation reads — the batch's
 * season and the application's raw payload — and hands them to the shared
 * seeder, which refuses to overwrite anything the mentor has already said.
 */
async function seedCrossFieldsForApproval(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  input: { applicationId: string; personId: string; intakeBatchId: string | null }
) {
  try {
    if (!input.intakeBatchId) return;

    const { data: batch } = await client
      .from("intake_batches")
      .select("season_id")
      .eq("id", input.intakeBatchId)
      .maybeSingle();

    const seasonId = (batch as { season_id?: string | null } | null)?.season_id ?? null;
    if (!seasonId) return;

    const { data: appRow } = await client
      .from("applications")
      .select("raw_payload")
      .eq("id", input.applicationId)
      .maybeSingle();

    await seedMentorFieldsFromApplication(client, {
      personId: input.personId,
      seasonId,
      rawPayload:
        (appRow as { raw_payload?: Record<string, unknown> | null } | null)?.raw_payload ?? null
    });
  } catch (err) {
    log("seed cross fields (non-fatal)", err);
  }
}

async function seedMentorSeasonConfirmation(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  input: {
    applicationId: string;
    personId: string;
    mentorProfileId: string;
    intakeBatchId: string | null;
    approvedByAdminUserId: string | null;
  }
) {
  try {
    if (!input.intakeBatchId) return;

    const { data: batch, error: batchErr } = await client
      .from("intake_batches")
      .select("season_id")
      .eq("id", input.intakeBatchId)
      .maybeSingle();
    if (batchErr || !batch) return;

    const seasonId = (batch as { season_id?: string | null }).season_id ?? null;
    if (!seasonId) return;

    // Only seed where the season actually runs the confirmation process.
    const { data: existing, error: existingErr } = await client
      .from("mentor_season_confirmations")
      .select("id")
      .eq("season_id", seasonId)
      .eq("person_id", input.personId)
      .maybeSingle();
    if (existingErr) return;
    if (existing) return; // Never overwrite an answer the mentor already gave.

    const { data: appRow } = await client
      .from("applications")
      .select("raw_payload")
      .eq("id", input.applicationId)
      .maybeSingle();

    const rawPayload = (appRow as { raw_payload?: Record<string, unknown> | null } | null)?.raw_payload ?? null;
    const declared = clampCapacity(rawPayload?.mentoring_capacity_total) ?? DEFAULT_MAX_MENTEES;

    const now = new Date().toISOString();
    const { data: inserted, error: insertErr } = await client
      .from("mentor_season_confirmations")
      .insert({
        person_id: input.personId,
        mentor_profile_id: input.mentorProfileId,
        season_id: seasonId,
        status: "confirmed",
        max_mentees: declared,
        response_source: "application",
        responded_at: now,
        created_by: input.approvedByAdminUserId
      })
      .select("id")
      .maybeSingle();

    if (insertErr || !inserted) {
      if (insertErr) log("seed mentor season confirmation failed (non-fatal)", insertErr);
      return;
    }

    await client.from("mentor_season_confirmation_log").insert({
      confirmation_id: (inserted as { id: string }).id,
      person_id: input.personId,
      season_id: seasonId,
      new_status: "confirmed",
      new_max_mentees: declared,
      change_type: "created",
      response_source: "application",
      reason: "Tạo từ đơn đăng ký được duyệt",
      changed_by_admin_user_id: input.approvedByAdminUserId
    });
  } catch (err) {
    log("seed mentor season confirmation crashed (non-fatal)", err);
  }
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findPersonByEmail(
  client: ReturnType<typeof getSupabaseServiceRoleClient>,
  email: string
): Promise<Person | null> {
  const { data, error } = await (client as NonNullable<typeof client>)
    .from("people")
    .select("id,full_name,email_primary,phone_primary,gender")
    .ilike("email_primary", email)
    .limit(1)
    .maybeSingle();
  if (error) {
    log("findPersonByEmail", error);
    return null;
  }
  return (data as Person) ?? null;
}

async function findPersonById(
  client: ReturnType<typeof getSupabaseServiceRoleClient>,
  id: string
): Promise<Person | null> {
  const { data, error } = await (client as NonNullable<typeof client>)
    .from("people")
    .select("id,full_name,email_primary,phone_primary,gender")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    log("findPersonById", error);
    return null;
  }
  return (data as Person) ?? null;
}

async function findMentorProfileByPersonId(
  client: ReturnType<typeof getSupabaseServiceRoleClient>,
  personId: string
): Promise<MentorProfile | null> {
  const { data } = await (client as NonNullable<typeof client>)
    .from("mentor_profiles")
    .select("id,person_id,mentor_code")
    .eq("person_id", personId)
    .limit(1)
    .maybeSingle();
  return (data as MentorProfile) ?? null;
}

async function findMenteeProfileByPersonId(
  client: ReturnType<typeof getSupabaseServiceRoleClient>,
  personId: string
): Promise<MenteeProfile | null> {
  const { data } = await (client as NonNullable<typeof client>)
    .from("mentee_profiles")
    .select("id,person_id,mentee_code")
    .eq("person_id", personId)
    .limit(1)
    .maybeSingle();
  return (data as MenteeProfile) ?? null;
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

  // ------------------------------------------------------------------
  // 1. Resolve person (find by email or create new)
  // ------------------------------------------------------------------

  let person: Person | null = null;
  let personCreated = false;

  const emailNorm = input.emailPrimary?.trim().toLowerCase() ?? null;

  if (emailNorm) {
    person = await findPersonByEmail(client, emailNorm);
  }

  // If application already has a person_id link, prefer that
  if (!person) {
    const { data: appRow } = await client
      .from("applications")
      .select("person_id")
      .eq("id", input.applicationId)
      .maybeSingle();
    const existingPersonId = (appRow as { person_id?: string | null } | null)?.person_id;
    if (existingPersonId) {
      person = await findPersonById(client, existingPersonId);
    }
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
    const existing = await findMentorProfileByPersonId(client, person.id);
    if (existing) {
      // Reuse — profile already exists (idempotent re-approval)
      profileId = existing.id;
      profileCreated = false;
    } else {
      const { data: newProfile, error: profileErr } = await client
        .from("mentor_profiles")
        .insert({
          person_id: person.id,
          mentor_code: null, // Admin sets via /mentors/[id]/edit
          source_application_id: input.applicationId,
          intake_batch_id: input.intakeBatchId ?? null
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
    const existing = await findMenteeProfileByPersonId(client, person.id);
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
  // 3b. Season participation for a newly approved mentor (non-fatal)
  //
  // From Season 12, matching reads a mentor's capacity from
  // mentor_season_confirmations. A mentor approved through this path has just
  // told us on the application form how many mentees they can take, so seed the
  // row from that answer instead of making an operator ask again.
  //
  // If the form carried no usable answer the row is left pending rather than
  // guessed at: an unanswered capacity must not silently become a number.
  // ------------------------------------------------------------------

  if (input.targetRole === "mentor") {
    await seedMentorSeasonConfirmation(client, {
      applicationId: input.applicationId,
      personId: person.id,
      mentorProfileId: profileId,
      intakeBatchId: input.intakeBatchId ?? null,
      approvedByAdminUserId: input.approvedByAdminUserId ?? null
    });

    // Carry the fields they named on the application onto the season, so a
    // mentor who never opens the portal still appears in the cross-mentoring
    // sweep. Non-fatal by construction: a missing field must never fail an
    // approval.
    await seedCrossFieldsForApproval(client, {
      applicationId: input.applicationId,
      personId: person.id,
      intakeBatchId: input.intakeBatchId ?? null
    });
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
