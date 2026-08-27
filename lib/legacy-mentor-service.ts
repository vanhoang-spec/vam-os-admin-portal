import "server-only";

import { createHash } from "crypto";
import { canAccessAdminUser } from "@/lib/permissions";
import { getAdminScopeContext, canOperateSeason } from "@/lib/program-scope";
import { loadRenewalSeasonContext } from "@/lib/renewal-console";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createLegacyMentorPreview, consumeLegacyMentorPreview } from "@/lib/legacy-mentor-preview-store";
import { readAllPages } from "@/lib/paged-read";
import { emailsEqual, escapeIlikePattern, isValidEmail, normalizeEmail } from "@/lib/identity";
import {
  parseLegacyMentorCsv,
  type LegacyMentorSource,
  type LegacyMentorParseResult,
  type LegacyMentorReference,
  type LegacyMentorRow
} from "@/lib/legacy-mentor-import";

export type LegacyMentorApplyOutcome = {
  rowNumber: number;
  ok: boolean;
  outcome: "CREATED" | "REUSED" | "CONFLICT" | "FAILED";
  reason: string;
  personId?: string;
  profileId?: string;
};

type DbClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;
type Actor = { id: string; email?: string | null };

function provenance(row: LegacyMentorRow, source: LegacyMentorSource, sourceSha256?: string): string {
  return `legacy_candidate:${JSON.stringify({
    source,
    prior_season: row.priorSeason || null,
    legacy_mentor_code: row.legacyMentorCode || null,
    notes: row.notes || null,
    source_sha256: sourceSha256 || null
  })}`;
}

function appendProvenance(existing: unknown, marker: string): string {
  const current = String(existing ?? "").trim();
  return current.includes(marker) ? current : [current, marker].filter(Boolean).join("\n");
}

export async function requireLegacyMentorOperator(): Promise<{
  actor: Actor;
  season: { id: string; programId: string; code: string };
} | null> {
  const context = await getAdminScopeContext();
  const actor = context.adminUser;
  if (!actor?.id || !canAccessAdminUser(actor.role) || context.scopeError) return null;
  const season = await loadRenewalSeasonContext();
  if (!season || !(await canOperateSeason(context, season.id))) return null;
  return { actor: { id: actor.id, email: actor.email }, season };
}

export async function loadLegacyMentorReference(client: DbClient): Promise<LegacyMentorReference> {
  const [people, profiles] = await Promise.all([
    readAllPages<Record<string, any>>(
      "people",
      "id,full_name,email_primary",
      (columns) => client.from("people").select(columns)
    ),
    readAllPages<Record<string, any>>(
      "mentor_profiles",
      "id,person_id,mentor_code",
      (columns) => client.from("mentor_profiles").select(columns)
    )
  ]);
  if (people.error || profiles.error) throw new Error("LEGACY_REFERENCE_UNAVAILABLE");
  return {
    people: people.data.map((row) => ({
      id: String(row.id),
      fullName: row.full_name ? String(row.full_name) : null,
      email: row.email_primary ? String(row.email_primary) : null
    })),
    profiles: profiles.data.map((row) => ({
      id: String(row.id),
      personId: String(row.person_id),
      mentorCode: row.mentor_code ? String(row.mentor_code) : null
    }))
  };
}

export async function resolveLegacyMentorCandidate(
  client: DbClient,
  row: LegacyMentorRow,
  source: LegacyMentorSource,
  actor: Actor,
  sourceSha256?: string
): Promise<LegacyMentorApplyOutcome> {
  const email = normalizeEmail(row.email);
  if (!row.fullName.trim() || !isValidEmail(email)) {
    return { rowNumber: row.rowNumber, ok: false, outcome: "FAILED", reason: "invalid_identity" };
  }

  // The `%...%` lookup exists to compensate for historical untrimmed/mixed-case
  // stored values, but canonical emailsEqual remains the authority.
  const IDENTITY_LOOKUP_MAX_CANDIDATES = 25;

  const lookupPeople = async () => {
    const exactLookupPattern = escapeIlikePattern(email);
    const fallbackLookupPattern = `%${exactLookupPattern}%`;

    let result = await client
      .from("people")
      .select("id,full_name,email_primary,phone_primary,source_sheets,data_quality_flags")
      .ilike("email_primary", exactLookupPattern)
      .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);

    if (!result.error && (result.data ?? []).length === 0) {
      result = await client
        .from("people")
        .select("id,full_name,email_primary,phone_primary,source_sheets,data_quality_flags")
        .ilike("email_primary", fallbackLookupPattern)
        .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);
    }

    if (result.error) return { error: result.error, candidates: [] };
    if ((result.data ?? []).length > IDENTITY_LOOKUP_MAX_CANDIDATES) {
      return { error: { message: "too many candidates" }, candidates: [] };
    }
    return {
      error: null,
      candidates: (result.data ?? []).filter((person: any) => emailsEqual(person.email_primary, email))
    };
  };

  const peopleLookup = await lookupPeople();
  if (peopleLookup.error) {
    return { rowNumber: row.rowNumber, ok: false, outcome: "FAILED", reason: "person_lookup_failed" };
  }
  const candidates = peopleLookup.candidates;
  if (candidates.length > 1) {
    return { rowNumber: row.rowNumber, ok: false, outcome: "CONFLICT", reason: "multiple_people_for_canonical_email" };
  }

  if (row.legacyMentorCode) {
    const exactCodePattern = escapeIlikePattern(row.legacyMentorCode);
    const fallbackCodePattern = `%${exactCodePattern}%`;

    let codeLookup = await client
      .from("mentor_profiles")
      .select("id,person_id,mentor_code")
      .ilike("mentor_code", exactCodePattern)
      .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);

    if (!codeLookup.error && (codeLookup.data ?? []).length === 0) {
      codeLookup = await client
        .from("mentor_profiles")
        .select("id,person_id,mentor_code")
        .ilike("mentor_code", fallbackCodePattern)
        .limit(IDENTITY_LOOKUP_MAX_CANDIDATES + 1);
    }

    if (codeLookup.error) {
      return { rowNumber: row.rowNumber, ok: false, outcome: "FAILED", reason: "mentor_code_lookup_failed" };
    }
    if ((codeLookup.data ?? []).length > IDENTITY_LOOKUP_MAX_CANDIDATES) {
      return { rowNumber: row.rowNumber, ok: false, outcome: "FAILED", reason: "mentor_code_lookup_too_many_candidates" };
    }
    const codeOwners = (codeLookup.data ?? []).filter(
      (profile: any) => String(profile.mentor_code ?? "").trim().toLowerCase() === row.legacyMentorCode!.trim().toLowerCase()
    );
    if (codeOwners.some((profile: any) => String(profile.person_id) !== String(candidates[0]?.id ?? ""))) {
      return { rowNumber: row.rowNumber, ok: false, outcome: "CONFLICT", reason: "mentor_code_owned_by_another_person" };
    }
  }

  const marker = provenance(row, source, sourceSha256);
  let person = candidates[0] as Record<string, any> | undefined;
  let personCreated = false;
  if (!person) {
    const inserted = await client.from("people").insert({
      full_name: row.fullName.trim(),
      email_primary: email,
      phone_primary: row.phone || null,
      source_sheets: source,
      data_quality_flags: marker
    }).select("id,full_name,email_primary,phone_primary,source_sheets,data_quality_flags").maybeSingle();
    if (inserted.error || !inserted.data) {
      if ((inserted.error as { code?: string } | null)?.code !== "23505") {
        return { rowNumber: row.rowNumber, ok: false, outcome: "FAILED", reason: "person_insert_failed" };
      }
      // A concurrent request may have won the canonical-email insert. Re-read
      // through the same escaped lookup and reuse only one exact canonical
      // identity; any ambiguity or unrelated 23505 fails closed.
      const raceWinner = await lookupPeople();
      if (raceWinner.error || raceWinner.candidates.length !== 1) {
        return { rowNumber: row.rowNumber, ok: false, outcome: "CONFLICT", reason: "person_insert_race_unresolved" };
      }
      person = raceWinner.candidates[0] as Record<string, any>;
    } else {
      person = inserted.data as Record<string, any>;
      personCreated = true;
    }
  }
  if (!personCreated) {
    const updates: Record<string, unknown> = {
      data_quality_flags: appendProvenance(person.data_quality_flags, marker)
    };
    if (!person.phone_primary && row.phone) updates.phone_primary = row.phone;
    if (!person.source_sheets) updates.source_sheets = source;
    const updated = await client.from("people").update(updates).eq("id", person.id)
      .select("id,full_name,email_primary,phone_primary,source_sheets,data_quality_flags").maybeSingle();
    if (updated.error || !updated.data) {
      return { rowNumber: row.rowNumber, ok: false, outcome: "FAILED", reason: "person_provenance_update_failed" };
    }
    person = updated.data as Record<string, any>;
  }

  const profileLookup = await client.from("mentor_profiles").select("id,person_id,mentor_code")
    .eq("person_id", person.id).maybeSingle();
  if (profileLookup.error) {
    return { rowNumber: row.rowNumber, ok: false, outcome: "CONFLICT", reason: "mentor_profile_identity_conflict", personId: String(person.id) };
  }
  let profile = profileLookup.data as Record<string, any> | null;
  if (
    profile?.mentor_code && row.legacyMentorCode &&
    String(profile.mentor_code).trim().toLowerCase() !== row.legacyMentorCode.toLowerCase()
  ) {
    return { rowNumber: row.rowNumber, ok: false, outcome: "CONFLICT", reason: "mentor_code_conflict", personId: String(person.id), profileId: String(profile.id) };
  }
  let profileCreated = false;
  if (!profile) {
    const inserted = await client.from("mentor_profiles").insert({
      person_id: person.id,
      mentor_code: row.legacyMentorCode || null
    }).select("id,person_id,mentor_code").maybeSingle();
    if (inserted.error || !inserted.data) {
      return { rowNumber: row.rowNumber, ok: false, outcome: "FAILED", reason: "mentor_profile_insert_failed", personId: String(person.id) };
    }
    profile = inserted.data as Record<string, any>;
    profileCreated = true;
  }

  // Existing audit vocabulary is reused; provenance identifies this as a
  // candidate import/manual entry and explicitly records that no membership or
  // consent was created. Failure is surfaced so an unaudited import is not
  // reported as successful.
  const audit = await client.from("admin_audit_log").insert({
    actor_admin_user_id: actor.id,
    actor_email: actor.email ?? null,
    action: profileCreated ? "create_mentor_profile" : "update_mentor_profile",
    action_type: profileCreated ? "create_mentor_profile" : "update_mentor_profile",
    target_admin_user_id: null,
    before_data: null,
    after_data: {
      person_id: person.id,
      mentor_profile_id: profile.id,
      person_created: personCreated,
      profile_created: profileCreated
    },
    details: {
      source,
      prior_season: row.priorSeason || null,
      legacy_mentor_code: row.legacyMentorCode || null,
      source_sha256: sourceSha256 || null,
      consent_recorded: false,
      season_12_membership_created: false,
      invitation_created: false
    }
  });
  if (audit.error) {
    return {
      rowNumber: row.rowNumber,
      ok: false,
      outcome: "FAILED",
      reason: "audit_write_failed",
      personId: String(person.id),
      profileId: String(profile.id)
    };
  }
  return {
    rowNumber: row.rowNumber,
    ok: true,
    outcome: personCreated || profileCreated ? "CREATED" : "REUSED",
    reason: "pending_invitation_candidate_no_membership",
    personId: String(person.id),
    profileId: String(profile.id)
  };
}

function clientOrThrow(): DbClient {
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("LEGACY_SERVICE_UNAVAILABLE");
  return client;
}

export async function previewLegacyMentorImport(csv: string): Promise<
  LegacyMentorParseResult & { preview?: { id: string; integrity: string; expiresAt: number } }
> {
  const access = await requireLegacyMentorOperator();
  if (!access) throw new Error("LEGACY_IMPORT_FORBIDDEN");
  const client = clientOrThrow();
  const parsed = parseLegacyMentorCsv(csv, await loadLegacyMentorReference(client));
  return parsed.ok ? { ...parsed, preview: await createLegacyMentorPreview(access.actor.id, csv) } : parsed;
}

export async function applyLegacyMentorImport(
  previewId: string,
  integrity: string
): Promise<{ ok: boolean; message: string; outcomes: LegacyMentorApplyOutcome[] }> {
  const access = await requireLegacyMentorOperator();
  if (!access) return { ok: false, message: "Không có quyền import legacy mentor.", outcomes: [] };
  const consumed = await consumeLegacyMentorPreview(access.actor.id, previewId, integrity);
  if (!consumed.ok) return { ok: false, message: "Bản xem trước đã hết hạn, bị thay đổi hoặc đã được sử dụng.", outcomes: [] };
  const client = clientOrThrow();
  const parsed = parseLegacyMentorCsv(consumed.csv, await loadLegacyMentorReference(client));
  if (!parsed.ok) {
    return { ok: false, message: "Dữ liệu không còn hợp lệ; chưa áp dụng business mutation.", outcomes: [] };
  }
  const sourceSha256 = createHash("sha256").update(consumed.csv, "utf8").digest("hex");
  const outcomes: LegacyMentorApplyOutcome[] = [];
  for (const row of parsed.rows) {
    outcomes.push(await resolveLegacyMentorCandidate(client, row, "legacy_coreteam_import", access.actor, sourceSha256));
  }
  const failed = outcomes.filter((outcome) => !outcome.ok).length;
  return {
    ok: failed === 0,
    message: failed ? `Hoàn tất với ${failed} dòng cần xử lý.` : "Import legacy mentor hoàn tất; chưa tạo membership hoặc invitation.",
    outcomes
  };
}

export async function createLegacyMentorManually(input: {
  fullName: string;
  email: string;
  phone?: string;
  legacyMentorCode?: string;
  priorSeason?: string;
  notes?: string;
}): Promise<LegacyMentorApplyOutcome> {
  const access = await requireLegacyMentorOperator();
  if (!access) return { rowNumber: 1, ok: false, outcome: "FAILED", reason: "forbidden" };
  const client = clientOrThrow();
  const parsed = parseLegacyMentorCsv(
    `full_name,email,phone,legacy_mentor_code,prior_season,notes\n${[
      input.fullName,
      input.email,
      input.phone ?? "",
      input.legacyMentorCode ?? "",
      input.priorSeason ?? "",
      input.notes ?? ""
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")}\n`,
    await loadLegacyMentorReference(client)
  );
  const row = parsed.rows[0];
  if (!parsed.ok || !row) {
    return { rowNumber: 1, ok: false, outcome: "FAILED", reason: row?.reason ?? parsed.errors.join("; ") };
  }
  return resolveLegacyMentorCandidate(client, row, "legacy_manual_entry", access.actor);
}
