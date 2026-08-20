import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canTriageCrossRequest } from "@/lib/permissions";
import {
  fieldsFromApplication,
  normalizeFields,
  type FieldKind
} from "@/lib/cross-fields-core";

/**
 * lib/mentor-cross-fields.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What a mentor masters, this season.
 *
 * This is the list the invitation sweep reads. Everything about it is shaped by
 * one question — "which mentors can take a session about finance?" — and by two
 * facts found in the existing code rather than assumed.
 *
 * IT IS NOT `mentor_industries`. That table is emptied and rewritten every time
 * an organiser saves the mentor edit form (lib/people-create.ts:320), keyed on
 * `mentor_profile_id` alone, with no column that could tell a mentor's own
 * answer from an operator's. A declaration stored there would survive until the
 * first time somebody opened that screen.
 *
 * IT IS NOT COLLECTED ON THE SEASON CONFIRMATION FORM. That page locks as soon
 * as a mentor has an active match (lib/mentor-confirmations-core.ts), and
 * cross-mentoring runs after matching — so the mentors this exists for are
 * exactly the ones who would find it read-only. They declare in the portal
 * instead, and their application answer fills in for them until they do.
 */

const SAFE_ERROR = "Không lưu được lĩnh vực. Vui lòng thử lại.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[mentor-cross-fields]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

export type DeclaredFields = {
  industries: string[];
  functions: string[];
  /** Where the rows on file came from, for a line on the screen. */
  source: "self" | "application" | "admin" | null;
};

const EMPTY: DeclaredFields = { industries: [], functions: [], source: null };

// ── Reading ──────────────────────────────────────────────────────────────────

/** What one mentor has on file for one season. */
export async function getMentorFields(input: {
  personId: string;
  seasonId: string;
}): Promise<DeclaredFields> {
  if (!isValidUuid(input.personId) || !isValidUuid(input.seasonId)) return EMPTY;

  const client = getSupabaseServiceRoleClient();
  if (!client) return EMPTY;

  const { data, error } = await client
    .from("mentor_cross_fields")
    .select("field_kind,field_code,source")
    .eq("person_id", input.personId)
    .eq("season_id", input.seasonId);

  if (error) {
    log("read fields", error);
    return EMPTY;
  }

  const rows = (data ?? []) as Array<{ field_kind: string; field_code: string; source: string }>;
  if (!rows.length) return EMPTY;

  // A mentor who has edited anything owns the whole set; the carried-forward
  // answer only describes rows nobody has touched.
  const source = rows.some((row) => row.source === "self")
    ? "self"
    : rows.some((row) => row.source === "admin")
      ? "admin"
      : "application";

  return {
    industries: normalizeFields(
      "industry",
      rows.filter((row) => row.field_kind === "industry").map((row) => row.field_code)
    ),
    functions: normalizeFields(
      "function",
      rows.filter((row) => row.field_kind === "function").map((row) => row.field_code)
    ),
    source
  };
}

/**
 * The mentors who master a field this season.
 *
 * The one query the whole feature turns on, and the reason
 * `mentor_cross_fields` carries a season and an index on (season, kind, code).
 */
export async function getMentorsForField(input: {
  seasonId: string;
  fieldKind: FieldKind;
  fieldCode: string;
}): Promise<string[]> {
  if (!isValidUuid(input.seasonId)) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const { data, error } = await client
    .from("mentor_cross_fields")
    .select("person_id")
    .eq("season_id", input.seasonId)
    .eq("field_kind", input.fieldKind)
    .eq("field_code", input.fieldCode);

  if (error) {
    log("read mentors for field", error);
    return [];
  }

  return Array.from(
    new Set(((data ?? []) as Array<{ person_id: string }>).map((row) => row.person_id))
  );
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Replace one mentor's declaration for one season.
 *
 * Delete-then-insert, like every other set-valued write in this codebase — but
 * scoped to one person and one season, so nothing another person declared can
 * be caught by it. That scoping is the whole difference from
 * `replaceMentorIndustryLinks`, which deletes by profile and takes everything.
 */
export async function setMentorFields(input: {
  personId: string;
  seasonId: string;
  industries?: unknown;
  functions?: unknown;
  source?: "self" | "admin";
  declaredBy?: string | null;
}): Promise<MutationResult> {
  if (!isValidUuid(input.personId)) return { ok: false, message: "Không xác định được mentor." };
  if (!isValidUuid(input.seasonId)) return { ok: false, message: "Không xác định được mùa." };

  const industries = normalizeFields("industry", input.industries);
  const functions = normalizeFields("function", input.functions);

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const source = input.source ?? "self";

  const { error: deleteErr } = await client
    .from("mentor_cross_fields")
    .delete()
    .eq("person_id", input.personId)
    .eq("season_id", input.seasonId);

  if (deleteErr) {
    log("clear fields", deleteErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const rows = [
    ...industries.map((code) => ({ field_kind: "industry", field_code: code })),
    ...functions.map((code) => ({ field_kind: "function", field_code: code }))
  ].map((row) => ({
    ...row,
    person_id: input.personId,
    season_id: input.seasonId,
    source,
    declared_by: source === "admin" ? input.declaredBy ?? null : null
  }));

  if (!rows.length) {
    return { ok: true, message: "Đã xoá toàn bộ lĩnh vực. Anh/chị sẽ không nhận thư mời cross-mentoring." };
  }

  const { error: insertErr } = await client.from("mentor_cross_fields").insert(rows);
  if (insertErr) {
    log("insert fields", insertErr);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: `Đã lưu ${rows.length} lĩnh vực.` };
}

/** An organiser recording fields on a mentor's behalf. */
export async function setMentorFieldsAsAdmin(input: {
  personId?: unknown;
  seasonId?: unknown;
  industries?: unknown;
  functions?: unknown;
}): Promise<MutationResult> {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canTriageCrossRequest(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa lĩnh vực của mentor." };
  }

  return setMentorFields({
    personId: String(input.personId ?? ""),
    seasonId: String(input.seasonId ?? ""),
    industries: input.industries,
    functions: input.functions,
    source: "admin",
    declaredBy: admin.id
  });
}

/**
 * Carry a mentor's application answers onto their season, at approval time.
 *
 * Called from the approval path, so a mentor who never opens the portal still
 * appears in the sweep. Writes nothing when the mentor has already said
 * something for themselves — an old form must not overwrite a newer answer —
 * and is non-fatal throughout, because failing to seed a field must never fail
 * an approval.
 */
export async function seedMentorFieldsFromApplication(
  client: ServiceClient,
  input: {
    personId: string;
    seasonId: string;
    rawPayload: Record<string, unknown> | null;
  }
): Promise<void> {
  try {
    if (!isValidUuid(input.personId) || !isValidUuid(input.seasonId) || !input.rawPayload) return;

    const { industries, functions } = fieldsFromApplication(input.rawPayload);
    if (!industries.length && !functions.length) return;

    const { data: existing, error: readErr } = await client
      .from("mentor_cross_fields")
      .select("id")
      .eq("person_id", input.personId)
      .eq("season_id", input.seasonId)
      .limit(1);

    if (readErr) {
      log("check existing fields (non-fatal)", readErr);
      return;
    }
    if ((existing ?? []).length) return;

    const rows = [
      ...industries.map((code) => ({ field_kind: "industry", field_code: code })),
      ...functions.map((code) => ({ field_kind: "function", field_code: code }))
    ].map((row) => ({
      ...row,
      person_id: input.personId,
      season_id: input.seasonId,
      source: "application"
    }));

    const { error: insertErr } = await client.from("mentor_cross_fields").insert(rows);
    if (insertErr) log("seed fields (non-fatal)", insertErr);
  } catch (err) {
    log("seed fields crashed (non-fatal)", err);
  }
}
