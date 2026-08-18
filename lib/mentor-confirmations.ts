import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendMentorConfirmationLink } from "@/lib/email";
import { isValidUuid } from "@/lib/events";
import { canRecordMentorConfirmation } from "@/lib/permissions";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { JsonRecord } from "@/lib/types";
import {
  buildConfirmUrl,
  defaultTokenExpiry,
  evaluatePublicLinkState,
  parseConfirmationAnswer,
  resolveMentorCap,
  summarizeConfirmations,
  type ConfirmationSource,
  type ConfirmationSummary,
  type PublicLinkState
} from "@/lib/mentor-confirmations-core";

/**
 * lib/mentor-confirmations.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Season participation for mentors: does this mentor continue, and for how many
 * mentees? One row per (person, season) in mentor_season_confirmations
 * (migration 064), written through exactly two channels:
 *
 *   * the mentor, from the tokenised public page /confirm/<token>
 *   * an operator, from /mentors/season-confirmations after a phone call
 *
 * Authorization lives here, not in the server action (CLAUDE.md): every write
 * from the admin console requires `canRecordMentorConfirmation` AND
 * `canOperateSeason` for that season. The public path has no admin identity at
 * all — the token IS the capability, so it is validated as a UUID, checked for
 * expiry, and refused once an operator has recorded the answer or matching has
 * begun for that mentor.
 *
 * Concurrency: both channels write with a conditional UPDATE. The public form
 * carries the row's `updated_at` and the admin form carries `expected_status`;
 * a mismatch means somebody else answered first, and the caller is told to
 * reload rather than silently overwriting a decided row.
 *
 * The vam062/vam063 RPCs are NOT installed on production, so this module writes
 * its tables directly with the service-role client, exactly like lib/matches.ts.
 */

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ ban tổ chức.";
const SAFE_PUBLIC_ERROR = "Không thể ghi nhận phản hồi. Vui lòng thử lại hoặc liên hệ ban tổ chức.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[mentor-confirmations]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function clientResult() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { client: null, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY trên server." as string | null };
  }
  return { client, error: null as string | null };
}

export type MutationResult = { ok: boolean; message: string };

// ── Guards ────────────────────────────────────────────────────────────────────

/**
 * Admin-side guard: global role AND operations scope on this specific season.
 * Returns the acting admin so callers can stamp it on the row and the log.
 */
async function requireConfirmationOperator(seasonId: string) {
  const admin = await getCurrentAdminUser();
  if (!canRecordMentorConfirmation(admin?.role)) {
    return { ok: false as const, message: "Bạn không có quyền ghi nhận xác nhận mentor." };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, seasonId))) {
    return { ok: false as const, message: "Bạn không có quyền vận hành mùa này." };
  }
  return { ok: true as const, admin };
}

// ── Row shapes ────────────────────────────────────────────────────────────────

export type MentorConfirmationRow = {
  id: string;
  person_id: string;
  mentor_profile_id: string | null;
  season_id: string;
  status: string;
  max_mentees: number | null;
  extra_slots: number;
  agree_to_review: boolean | null;
  agree_to_interview: boolean | null;
  note: string | null;
  response_source: string | null;
  responded_at: string | null;
  responded_by_admin_user_id: string | null;
  token: string;
  token_expires_at: string | null;
  contact_email: string | null;
  link_sent_at: string | null;
  link_send_error: string | null;
  updated_at: string;
};

export type MentorConfirmationListRow = MentorConfirmationRow & {
  full_name: string | null;
  email_primary: string | null;
  mentor_code: string | null;
  active_match_count: number;
  effective_cap: number;
  confirm_url: string | null;
};

const ROW_COLUMNS =
  "id,person_id,mentor_profile_id,season_id,status,max_mentees,extra_slots," +
  "agree_to_review,agree_to_interview,note,response_source,responded_at," +
  "responded_by_admin_user_id,token,token_expires_at,contact_email," +
  "link_sent_at,link_send_error,updated_at";

// ── Audit log ─────────────────────────────────────────────────────────────────

async function writeConfirmationLog(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  input: {
    confirmationId: string;
    personId: string;
    seasonId: string;
    oldStatus?: string | null;
    newStatus: string;
    oldMaxMentees?: number | null;
    newMaxMentees?: number | null;
    oldExtraSlots?: number | null;
    newExtraSlots?: number | null;
    changeType:
      | "created"
      | "status_change"
      | "capacity_change"
      | "extra_slots_change"
      | "link_issued"
      | "link_sent"
      | "token_reissued"
      | "expiry_extended";
    responseSource?: string | null;
    reason?: string | null;
    actorAdminUserId?: string | null;
  }
) {
  try {
    const { error } = await client.from("mentor_season_confirmation_log").insert({
      confirmation_id: input.confirmationId,
      person_id: input.personId,
      season_id: input.seasonId,
      old_status: input.oldStatus ?? null,
      new_status: input.newStatus,
      old_max_mentees: input.oldMaxMentees ?? null,
      new_max_mentees: input.newMaxMentees ?? null,
      old_extra_slots: input.oldExtraSlots ?? null,
      new_extra_slots: input.newExtraSlots ?? null,
      change_type: input.changeType,
      response_source: input.responseSource ?? null,
      reason: input.reason ? input.reason.slice(0, 500) : null,
      changed_by_admin_user_id: input.actorAdminUserId ?? null
    });
    if (error) log("confirmation log insert failed", error);
  } catch (err) {
    log("confirmation log crashed", err);
  }
}

// ── Season resolution ─────────────────────────────────────────────────────────

export type SeasonRef = { id: string; code: string; name: string | null; program_id: string | null };

/** Resolve a season by id or code (the app passes codes like "UEHM-S12" around). */
export async function resolveSeason(seasonIdOrCode: string): Promise<SeasonRef | null> {
  const { client } = clientResult();
  if (!client) return null;
  const key = String(seasonIdOrCode ?? "").trim();
  if (!key) return null;

  const column = isValidUuid(key) ? "id" : "code";
  const { data, error } = await client
    .from("seasons")
    .select("id,code,name,program_id")
    .eq(column, key)
    .maybeSingle();

  if (error) {
    log("season lookup failed", error);
    return null;
  }
  return (data as SeasonRef | null) ?? null;
}

// ── Active match counts ───────────────────────────────────────────────────────

async function loadActiveMatchCounts(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  seasonId: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await client
    .from("matches")
    .select("mentor_person_id")
    .eq("season_id", seasonId)
    .eq("status", "active");

  if (error) {
    log("active match count failed", error);
    return counts;
  }

  for (const row of (data ?? []) as Array<{ mentor_person_id: string | null }>) {
    if (!row.mentor_person_id) continue;
    counts.set(row.mentor_person_id, (counts.get(row.mentor_person_id) ?? 0) + 1);
  }
  return counts;
}

// ── Population ────────────────────────────────────────────────────────────────

export type EnsureRowsResult = {
  ok: boolean;
  message: string;
  created: number;
  existing: number;
};

/**
 * Create a pending confirmation row for every mentor who should be asked about
 * `targetSeason`, without touching rows that already exist (so a re-run never
 * rotates a token that has already been emailed).
 *
 * Who gets asked: mentors of `sourceSeason` — that is, a mentor_profiles row
 * whose intake batch belongs to that season, or a person who mentored an active
 * match in it. Mentors already approved into the target season are included too,
 * so the page shows one complete roster.
 */
export async function ensureConfirmationRows(input: {
  targetSeasonIdOrCode: string;
  sourceSeasonIdOrCode: string;
  tokenTtlDays?: number;
}): Promise<EnsureRowsResult> {
  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR, created: 0, existing: 0 };

  const targetSeason = await resolveSeason(input.targetSeasonIdOrCode);
  if (!targetSeason) {
    return { ok: false, message: "Không tìm thấy mùa đích.", created: 0, existing: 0 };
  }

  const guard = await requireConfirmationOperator(targetSeason.id);
  if (!guard.ok) return { ok: false, message: guard.message, created: 0, existing: 0 };

  const sourceSeason = await resolveSeason(input.sourceSeasonIdOrCode);
  if (!sourceSeason) {
    return { ok: false, message: "Không tìm thấy mùa nguồn.", created: 0, existing: 0 };
  }

  // 1. Mentors whose profile sits in a batch of either season.
  const seasonIds = Array.from(new Set([sourceSeason.id, targetSeason.id]));
  const { data: batchRows, error: batchError } = await client
    .from("intake_batches")
    .select("id,season_id")
    .in("season_id", seasonIds);
  if (batchError) {
    log("intake batch lookup failed", batchError);
    return { ok: false, message: SAFE_ERROR, created: 0, existing: 0 };
  }
  const batchIds = ((batchRows ?? []) as Array<{ id: string }>).map((row) => row.id).filter(Boolean);

  const profilesByPerson = new Map<string, string>();
  if (batchIds.length) {
    const { data: profileRows, error: profileError } = await client
      .from("mentor_profiles")
      .select("id,person_id,intake_batch_id")
      .in("intake_batch_id", batchIds);
    if (profileError) {
      log("mentor profile lookup failed", profileError);
      return { ok: false, message: SAFE_ERROR, created: 0, existing: 0 };
    }
    for (const row of (profileRows ?? []) as Array<{ id: string; person_id: string | null }>) {
      // One row per person even when a person carries several profiles.
      if (row.person_id && !profilesByPerson.has(row.person_id)) {
        profilesByPerson.set(row.person_id, row.id);
      }
    }
  }

  // 2. Mentors who actually mentored in the source season.
  const { data: matchRows, error: matchError } = await client
    .from("matches")
    .select("mentor_person_id")
    .eq("season_id", sourceSeason.id)
    .eq("status", "active");
  if (matchError) {
    log("source season match lookup failed", matchError);
    return { ok: false, message: SAFE_ERROR, created: 0, existing: 0 };
  }
  for (const row of (matchRows ?? []) as Array<{ mentor_person_id: string | null }>) {
    if (row.mentor_person_id && !profilesByPerson.has(row.mentor_person_id)) {
      profilesByPerson.set(row.mentor_person_id, "");
    }
  }

  if (profilesByPerson.size === 0) {
    return { ok: true, message: "Không tìm thấy mentor nào để tạo link.", created: 0, existing: 0 };
  }

  // 3. Skip people who already have a row for the target season.
  const personIds = Array.from(profilesByPerson.keys());
  const { data: existingRows, error: existingError } = await client
    .from("mentor_season_confirmations")
    .select("person_id")
    .eq("season_id", targetSeason.id)
    .in("person_id", personIds);
  if (existingError) {
    log("existing confirmation lookup failed", existingError);
    return { ok: false, message: SAFE_ERROR, created: 0, existing: 0 };
  }
  const existing = new Set(
    ((existingRows ?? []) as Array<{ person_id: string }>).map((row) => row.person_id)
  );

  const expiresAt = defaultTokenExpiry(new Date(), input.tokenTtlDays);
  const payload = personIds
    .filter((personId) => !existing.has(personId))
    .map((personId) => ({
      person_id: personId,
      mentor_profile_id: profilesByPerson.get(personId) || null,
      season_id: targetSeason.id,
      status: "pending",
      token_expires_at: expiresAt,
      created_by: guard.admin?.id ?? null
    }));

  if (payload.length === 0) {
    return {
      ok: true,
      message: `Tất cả ${existing.size} mentor đã có link xác nhận.`,
      created: 0,
      existing: existing.size
    };
  }

  const { data: inserted, error: insertError } = await client
    .from("mentor_season_confirmations")
    .insert(payload)
    .select("id,person_id,season_id");

  if (insertError) {
    log("confirmation insert failed", insertError);
    return { ok: false, message: SAFE_ERROR, created: 0, existing: existing.size };
  }

  for (const row of (inserted ?? []) as Array<{ id: string; person_id: string; season_id: string }>) {
    await writeConfirmationLog(client, {
      confirmationId: row.id,
      personId: row.person_id,
      seasonId: row.season_id,
      newStatus: "pending",
      changeType: "link_issued",
      actorAdminUserId: guard.admin?.id ?? null
    });
  }

  const created = (inserted ?? []).length;
  return {
    ok: true,
    message: `Đã tạo ${created} link xác nhận mới (${existing.size} mentor đã có sẵn).`,
    created,
    existing: existing.size
  };
}

// ── Admin read ────────────────────────────────────────────────────────────────

export type ConfirmationListResult = {
  ok: boolean;
  error: string | null;
  rows: MentorConfirmationListRow[];
  summary: ConfirmationSummary;
  season: SeasonRef | null;
};

const EMPTY_SUMMARY: ConfirmationSummary = {
  total: 0,
  confirmed: 0,
  declined: 0,
  pending: 0,
  totalCapacity: 0,
  respondedPct: 0
};

/** Roster for the admin page: one row per mentor, with load and personal link. */
export async function listMentorSeasonConfirmations(input: {
  seasonIdOrCode: string;
  baseUrl?: string | null;
}): Promise<ConfirmationListResult> {
  const { client, error: clientError } = clientResult();
  if (!client) {
    return { ok: false, error: clientError, rows: [], summary: EMPTY_SUMMARY, season: null };
  }

  const season = await resolveSeason(input.seasonIdOrCode);
  if (!season) {
    return { ok: false, error: "Không tìm thấy mùa.", rows: [], summary: EMPTY_SUMMARY, season: null };
  }

  // Read access is scope-based; the write guard is applied separately per action.
  const ctx = await getAdminScopeContext();
  if (!(await canReadSeason(ctx, season.id))) {
    return {
      ok: false,
      error: "Bạn không có quyền xem dữ liệu của mùa này.",
      rows: [],
      summary: EMPTY_SUMMARY,
      season
    };
  }

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("season_id", season.id)
    .order("created_at", { ascending: true });

  if (error) {
    log("confirmation list failed", error);
    return { ok: false, error: SAFE_ERROR, rows: [], summary: EMPTY_SUMMARY, season };
  }

  const rows = (data ?? []) as unknown as MentorConfirmationRow[];
  if (rows.length === 0) {
    return { ok: true, error: null, rows: [], summary: EMPTY_SUMMARY, season };
  }

  const personIds = Array.from(new Set(rows.map((row) => row.person_id)));
  const profileIds = Array.from(
    new Set(rows.map((row) => row.mentor_profile_id).filter((value): value is string => Boolean(value)))
  );

  const [peopleRes, profileRes, matchCounts] = await Promise.all([
    client.from("people").select("id,full_name,email_primary").in("id", personIds),
    profileIds.length
      ? client.from("mentor_profiles").select("id,mentor_code").in("id", profileIds)
      : Promise.resolve({ data: [], error: null } as { data: JsonRecord[]; error: null }),
    loadActiveMatchCounts(client, season.id)
  ]);

  if (peopleRes.error) log("people lookup failed", peopleRes.error);
  if (profileRes.error) log("mentor profile lookup failed", profileRes.error);

  const peopleById = new Map(
    ((peopleRes.data ?? []) as Array<{ id: string; full_name: string | null; email_primary: string | null }>).map(
      (row) => [row.id, row]
    )
  );
  const codeByProfileId = new Map(
    ((profileRes.data ?? []) as Array<{ id: string; mentor_code: string | null }>).map((row) => [
      row.id,
      row.mentor_code
    ])
  );

  const base = String(input.baseUrl ?? "").trim();
  const enriched: MentorConfirmationListRow[] = rows.map((row) => {
    const person = peopleById.get(row.person_id);
    return {
      ...row,
      full_name: person?.full_name ?? null,
      email_primary: person?.email_primary ?? null,
      mentor_code: row.mentor_profile_id ? codeByProfileId.get(row.mentor_profile_id) ?? null : null,
      active_match_count: matchCounts.get(row.person_id) ?? 0,
      effective_cap: resolveMentorCap(row),
      confirm_url: base ? buildConfirmUrl(base, row.token) : null
    };
  });

  return { ok: true, error: null, rows: enriched, summary: summarizeConfirmations(rows), season };
}

// ── Public read ───────────────────────────────────────────────────────────────

export type PublicConfirmationView = {
  state: PublicLinkState;
  mentorName: string | null;
  seasonLabel: string | null;
  status: string;
  maxMentees: number | null;
  agreeToReview: boolean | null;
  agreeToInterview: boolean | null;
  note: string | null;
  updatedAt: string | null;
  respondedAt: string | null;
};

const NOT_FOUND_VIEW: PublicConfirmationView = {
  state: "not_found",
  mentorName: null,
  seasonLabel: null,
  status: "pending",
  maxMentees: null,
  agreeToReview: null,
  agreeToInterview: null,
  note: null,
  updatedAt: null,
  respondedAt: null
};

/**
 * Read a confirmation row by its public token. Never throws and never reveals
 * why a token failed beyond the four coarse states, so the page cannot be used
 * to probe which tokens exist.
 */
export async function getPublicConfirmationByToken(token: string): Promise<PublicConfirmationView> {
  if (!isValidUuid(token)) return NOT_FOUND_VIEW;

  const { client } = clientResult();
  if (!client) return { ...NOT_FOUND_VIEW, state: "not_found" };

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("token", token)
    .maybeSingle();

  if (error) {
    log("public token lookup failed", error);
    return NOT_FOUND_VIEW;
  }
  const row = (data as MentorConfirmationRow | null) ?? null;
  if (!row) return NOT_FOUND_VIEW;

  const matchCounts = await loadActiveMatchCounts(client, row.season_id);
  const state = evaluatePublicLinkState({
    row,
    activeMatchCount: matchCounts.get(row.person_id) ?? 0,
    now: new Date()
  });

  const [personRes, seasonRes] = await Promise.all([
    client.from("people").select("full_name").eq("id", row.person_id).maybeSingle(),
    client.from("seasons").select("code,name").eq("id", row.season_id).maybeSingle()
  ]);

  const person = (personRes.data as { full_name: string | null } | null) ?? null;
  const season = (seasonRes.data as { code: string | null; name: string | null } | null) ?? null;

  return {
    state,
    mentorName: person?.full_name ?? null,
    seasonLabel: season?.name || season?.code || null,
    status: row.status,
    maxMentees: row.max_mentees,
    agreeToReview: row.agree_to_review,
    agreeToInterview: row.agree_to_interview,
    note: row.note,
    updatedAt: row.updated_at,
    respondedAt: row.responded_at
  };
}

// ── Public write ──────────────────────────────────────────────────────────────

/**
 * Record a mentor's own answer, submitted from /confirm/<token>.
 *
 * The token is the only credential, so everything else is re-derived here:
 * the row, its season, whether the link is still usable, and whether somebody
 * else has answered since the page was rendered (`updatedAtSnapshot`).
 */
export async function submitMentorConfirmation(input: {
  token: string;
  decision: unknown;
  maxMentees?: unknown;
  agreeToReview?: unknown;
  agreeToInterview?: unknown;
  note?: unknown;
  updatedAtSnapshot?: string | null;
}): Promise<MutationResult & { state?: PublicLinkState }> {
  if (!isValidUuid(input.token)) {
    return { ok: false, message: "Đường dẫn không hợp lệ.", state: "not_found" };
  }

  const parsed = parseConfirmationAnswer({
    decision: input.decision,
    maxMentees: input.maxMentees,
    agreeToReview: input.agreeToReview,
    agreeToInterview: input.agreeToInterview,
    note: input.note
  });
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const { client } = clientResult();
  if (!client) return { ok: false, message: SAFE_PUBLIC_ERROR };

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("token", input.token)
    .maybeSingle();

  if (error) {
    log("public submit lookup failed", error);
    return { ok: false, message: SAFE_PUBLIC_ERROR };
  }
  const row = (data as MentorConfirmationRow | null) ?? null;
  if (!row) return { ok: false, message: "Đường dẫn không hợp lệ.", state: "not_found" };

  const matchCounts = await loadActiveMatchCounts(client, row.season_id);
  const state = evaluatePublicLinkState({
    row,
    activeMatchCount: matchCounts.get(row.person_id) ?? 0,
    now: new Date()
  });

  if (state === "expired") {
    return {
      ok: false,
      message: "Đường dẫn đã hết hạn. Vui lòng liên hệ ban tổ chức để được hỗ trợ.",
      state
    };
  }
  if (state === "locked") {
    return {
      ok: false,
      message: "Phản hồi của anh/chị đã được ban tổ chức ghi nhận. Vui lòng liên hệ ban tổ chức nếu cần thay đổi.",
      state
    };
  }

  const now = new Date().toISOString();
  let update = client
    .from("mentor_season_confirmations")
    .update({
      status: parsed.status,
      max_mentees: parsed.maxMentees,
      agree_to_review: parsed.agreeToReview,
      agree_to_interview: parsed.agreeToInterview,
      note: parsed.note,
      response_source: "form" satisfies ConfirmationSource,
      responded_at: now
    })
    .eq("id", row.id);

  // Optimistic concurrency: only write if nobody has touched the row since the
  // page was rendered. A stale tab must not overwrite a newer answer.
  if (input.updatedAtSnapshot) {
    update = update.eq("updated_at", input.updatedAtSnapshot);
  }

  const { data: updated, error: updateError } = await update.select("id").maybeSingle();

  if (updateError) {
    log("public submit update failed", updateError);
    return { ok: false, message: SAFE_PUBLIC_ERROR };
  }
  if (!updated) {
    return {
      ok: false,
      message: "Thông tin đã được cập nhật ở nơi khác. Vui lòng tải lại trang và thử lại."
    };
  }

  await writeConfirmationLog(client, {
    confirmationId: row.id,
    personId: row.person_id,
    seasonId: row.season_id,
    oldStatus: row.status,
    newStatus: parsed.status,
    oldMaxMentees: row.max_mentees,
    newMaxMentees: parsed.maxMentees,
    changeType: "status_change",
    responseSource: "form"
  });

  return {
    ok: true,
    message:
      parsed.status === "confirmed"
        ? "Cảm ơn anh/chị đã xác nhận đồng hành cùng chương trình."
        : "Cảm ơn anh/chị đã phản hồi. Ban tổ chức đã ghi nhận."
  };
}

// ── Admin write ───────────────────────────────────────────────────────────────

/** Record an answer collected by phone, on the mentor's behalf. */
export async function recordMentorConfirmation(input: {
  confirmationId: string;
  decision: unknown;
  maxMentees?: unknown;
  agreeToReview?: unknown;
  agreeToInterview?: unknown;
  note?: unknown;
  source?: "manual" | "phone";
  expectedStatus?: string | null;
}): Promise<MutationResult> {
  if (!isValidUuid(input.confirmationId)) {
    return { ok: false, message: "Thiếu hoặc sai mã bản ghi." };
  }

  const parsed = parseConfirmationAnswer({
    decision: input.decision,
    maxMentees: input.maxMentees,
    agreeToReview: input.agreeToReview,
    agreeToInterview: input.agreeToInterview,
    note: input.note
  });
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR };

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("id", input.confirmationId)
    .maybeSingle();

  if (error) {
    log("admin record lookup failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const row = (data as MentorConfirmationRow | null) ?? null;
  if (!row) return { ok: false, message: "Không tìm thấy bản ghi xác nhận." };

  const guard = await requireConfirmationOperator(row.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  if (input.expectedStatus && input.expectedStatus !== row.status) {
    return {
      ok: false,
      message: "Trạng thái đã thay đổi ở nơi khác. Vui lòng tải lại trang và thử lại."
    };
  }

  const source: ConfirmationSource = input.source === "phone" ? "phone" : "manual";
  const now = new Date().toISOString();

  let update = client
    .from("mentor_season_confirmations")
    .update({
      status: parsed.status,
      max_mentees: parsed.maxMentees,
      agree_to_review: parsed.agreeToReview,
      agree_to_interview: parsed.agreeToInterview,
      note: parsed.note,
      response_source: source,
      responded_at: now,
      responded_by_admin_user_id: guard.admin?.id ?? null
    })
    .eq("id", row.id);

  if (input.expectedStatus) {
    update = update.eq("status", input.expectedStatus);
  }

  const { data: updated, error: updateError } = await update.select("id").maybeSingle();

  if (updateError) {
    log("admin record update failed", updateError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!updated) {
    return {
      ok: false,
      message: "Trạng thái đã thay đổi ở nơi khác. Vui lòng tải lại trang và thử lại."
    };
  }

  await writeConfirmationLog(client, {
    confirmationId: row.id,
    personId: row.person_id,
    seasonId: row.season_id,
    oldStatus: row.status,
    newStatus: parsed.status,
    oldMaxMentees: row.max_mentees,
    newMaxMentees: parsed.maxMentees,
    changeType: "status_change",
    responseSource: source,
    actorAdminUserId: guard.admin?.id ?? null
  });

  return {
    ok: true,
    message:
      parsed.status === "confirmed"
        ? `Đã ghi nhận: tiếp tục mùa này, tối đa ${parsed.maxMentees} mentee.`
        : "Đã ghi nhận: mentor không tiếp tục mùa này."
  };
}

/** Grant a mentor one or more extra mentee slots beyond their declared capacity. */
export async function grantExtraSlots(input: {
  confirmationId: string;
  extraSlots: unknown;
  reason?: unknown;
}): Promise<MutationResult> {
  if (!isValidUuid(input.confirmationId)) {
    return { ok: false, message: "Thiếu hoặc sai mã bản ghi." };
  }

  // An empty field must not be read as 0 — that would silently revoke slots the
  // operator already granted. Absent means "no value submitted", not "zero".
  const raw = String(input.extraSlots ?? "").trim();
  const parsed = raw === "" ? Number.NaN : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    return { ok: false, message: "Số slot bổ sung phải từ 0 đến 3." };
  }

  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR };

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("id", input.confirmationId)
    .maybeSingle();

  if (error) {
    log("extra slots lookup failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const row = (data as MentorConfirmationRow | null) ?? null;
  if (!row) return { ok: false, message: "Không tìm thấy bản ghi xác nhận." };

  const guard = await requireConfirmationOperator(row.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  if (row.status !== "confirmed") {
    return { ok: false, message: "Chỉ cấp thêm slot cho mentor đã xác nhận tiếp tục." };
  }

  const { data: updated, error: updateError } = await client
    .from("mentor_season_confirmations")
    .update({ extra_slots: parsed })
    .eq("id", row.id)
    .eq("extra_slots", row.extra_slots)
    .select("id")
    .maybeSingle();

  if (updateError) {
    log("extra slots update failed", updateError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!updated) {
    return { ok: false, message: "Số slot đã thay đổi ở nơi khác. Vui lòng tải lại trang." };
  }

  await writeConfirmationLog(client, {
    confirmationId: row.id,
    personId: row.person_id,
    seasonId: row.season_id,
    oldStatus: row.status,
    newStatus: row.status,
    oldExtraSlots: row.extra_slots,
    newExtraSlots: parsed,
    changeType: "extra_slots_change",
    reason: typeof input.reason === "string" ? input.reason : null,
    actorAdminUserId: guard.admin?.id ?? null
  });

  const cap = resolveMentorCap({ ...row, extra_slots: parsed });
  return { ok: true, message: `Đã cập nhật: mentor có thể nhận tối đa ${cap} mentee.` };
}

/** Issue a fresh token (invalidating the old link) or push the expiry out. */
export async function reissueConfirmationLink(input: {
  confirmationId: string;
  mode: "reissue" | "extend";
  tokenTtlDays?: number;
}): Promise<MutationResult & { token?: string }> {
  if (!isValidUuid(input.confirmationId)) {
    return { ok: false, message: "Thiếu hoặc sai mã bản ghi." };
  }

  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR };

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("id", input.confirmationId)
    .maybeSingle();

  if (error) {
    log("reissue lookup failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const row = (data as MentorConfirmationRow | null) ?? null;
  if (!row) return { ok: false, message: "Không tìm thấy bản ghi xác nhận." };

  const guard = await requireConfirmationOperator(row.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  const expiresAt = defaultTokenExpiry(new Date(), input.tokenTtlDays);
  const payload: JsonRecord =
    input.mode === "reissue"
      ? { token: crypto.randomUUID(), token_expires_at: expiresAt, link_sent_at: null, link_send_error: null }
      : { token_expires_at: expiresAt };

  const { data: updated, error: updateError } = await client
    .from("mentor_season_confirmations")
    .update(payload)
    .eq("id", row.id)
    .select("token")
    .maybeSingle();

  if (updateError) {
    log("reissue update failed", updateError);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeConfirmationLog(client, {
    confirmationId: row.id,
    personId: row.person_id,
    seasonId: row.season_id,
    oldStatus: row.status,
    newStatus: row.status,
    changeType: input.mode === "reissue" ? "token_reissued" : "expiry_extended",
    actorAdminUserId: guard.admin?.id ?? null
  });

  return {
    ok: true,
    message: input.mode === "reissue" ? "Đã cấp link mới cho mentor." : "Đã gia hạn link cho mentor.",
    token: (updated as { token?: string } | null)?.token
  };
}

// ── Sending ───────────────────────────────────────────────────────────────────

export type SendLinksResult = {
  ok: boolean;
  message: string;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
};

/**
 * Email the personal confirmation link to mentors who have not answered yet.
 *
 * Bounded per call (`limit`, at most 50) because the provider's free tier is
 * 100 messages a day: operators send in rounds and the page shows what is left.
 * Mentors who already answered are never mailed again.
 */
export async function sendConfirmationLinks(input: {
  seasonIdOrCode: string;
  baseUrl: string;
  limit?: number;
}): Promise<SendLinksResult> {
  const empty = { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR, ...empty };

  const season = await resolveSeason(input.seasonIdOrCode);
  if (!season) return { ok: false, message: "Không tìm thấy mùa.", ...empty };

  const guard = await requireConfirmationOperator(season.id);
  if (!guard.ok) return { ok: false, message: guard.message, ...empty };

  const base = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    return {
      ok: false,
      message: "Chưa cấu hình VAM_OS_PUBLIC_BASE_URL nên không tạo được đường dẫn.",
      ...empty
    };
  }

  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 50);

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("season_id", season.id)
    .eq("status", "pending")
    .is("link_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    log("send links lookup failed", error);
    return { ok: false, message: SAFE_ERROR, ...empty };
  }

  const rows = (data ?? []) as unknown as MentorConfirmationRow[];
  if (rows.length === 0) {
    return { ok: true, message: "Không còn mentor nào cần gửi link.", ...empty };
  }

  const personIds = Array.from(new Set(rows.map((row) => row.person_id)));
  const { data: peopleRows, error: peopleError } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .in("id", personIds);
  if (peopleError) {
    log("send links people lookup failed", peopleError);
    return { ok: false, message: SAFE_ERROR, ...empty };
  }
  const peopleById = new Map(
    ((peopleRows ?? []) as Array<{ id: string; full_name: string | null; email_primary: string | null }>).map(
      (row) => [row.id, row]
    )
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const seasonLabel = season.name || season.code;
  const deadlineLabel = rows[0]?.token_expires_at
    ? new Date(rows[0].token_expires_at).toLocaleDateString("vi-VN")
    : null;

  for (const row of rows) {
    const person = peopleById.get(row.person_id);
    const email = person?.email_primary ?? row.contact_email ?? null;
    if (!email) {
      failed++;
      await client
        .from("mentor_season_confirmations")
        .update({ link_send_error: "Mentor chưa có email trong hệ thống." })
        .eq("id", row.id);
      continue;
    }

    const result = await sendMentorConfirmationLink({
      toEmail: email,
      mentorName: person?.full_name ?? "",
      seasonLabel,
      confirmUrl: buildConfirmUrl(base, row.token),
      deadlineLabel,
      confirmationId: row.id
    });

    if (result.ok && !result.skipped) {
      sent++;
      await client
        .from("mentor_season_confirmations")
        .update({
          link_sent_at: new Date().toISOString(),
          link_send_error: null,
          contact_email: email,
          provider_message_id: result.providerMessageId ?? null
        })
        .eq("id", row.id);
      await writeConfirmationLog(client, {
        confirmationId: row.id,
        personId: row.person_id,
        seasonId: row.season_id,
        oldStatus: row.status,
        newStatus: row.status,
        changeType: "link_sent",
        actorAdminUserId: guard.admin?.id ?? null
      });
    } else if (result.skipped) {
      skipped++;
      await client
        .from("mentor_season_confirmations")
        .update({ contact_email: email, link_send_error: result.reason ?? "Gửi email đang tắt." })
        .eq("id", row.id);
    } else {
      failed++;
      await client
        .from("mentor_season_confirmations")
        .update({ contact_email: email, link_send_error: result.reason ?? "Không gửi được email." })
        .eq("id", row.id);
    }
  }

  const parts = [`Đã gửi ${sent}/${rows.length} email`];
  if (skipped) parts.push(`${skipped} bị bỏ qua (gửi email đang tắt)`);
  if (failed) parts.push(`${failed} lỗi`);

  return {
    ok: true,
    message: `${parts.join(", ")}.`,
    attempted: rows.length,
    sent,
    skipped,
    failed
  };
}

// ── Matching support ──────────────────────────────────────────────────────────

/**
 * Confirmation rows for a season, keyed by person id, for the matching layer.
 * Returns null when the season has no confirmation rows at all — the caller
 * treats that as "this season predates the confirmation regime" and keeps the
 * legacy cap (see resolveMentorCap).
 */
export async function loadSeasonConfirmationMap(
  seasonId: string
): Promise<Map<string, MentorConfirmationRow> | null> {
  const { client } = clientResult();
  if (!client || !isValidUuid(seasonId)) return null;

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("season_id", seasonId);

  if (error) {
    log("season confirmation map failed", error);
    return null;
  }

  const rows = (data ?? []) as unknown as MentorConfirmationRow[];
  if (rows.length === 0) return null;

  return new Map(rows.map((row) => [row.person_id, row]));
}

// ── Reviewer pool ─────────────────────────────────────────────────────────────

export type SeasonReviewerCandidate = {
  confirmation_id: string;
  person_id: string;
  full_name: string | null;
  email_primary: string | null;
  mentor_code: string | null;
  status: string;
  max_mentees: number | null;
  agree_to_review: boolean | null;
  agree_to_interview: boolean | null;
  /** admin_users row matched by email, when the mentor already has an account. */
  admin_user_id: string | null;
  admin_user_role: string | null;
  admin_user_status: string | null;
};

export type SeasonReviewerPoolResult = {
  ok: boolean;
  error: string | null;
  rows: SeasonReviewerCandidate[];
  season: SeasonRef | null;
};

/**
 * Mentors who confirmed for a season, with the account state needed to turn the
 * ones who agreed to score applications into reviewers.
 *
 * This is season-based on purpose. The older batch-based pool in lib/data.ts
 * lists mentors by the intake batch their profile sits in, which excludes every
 * returning mentor — exactly the people who volunteer to review.
 */
export async function listSeasonReviewerCandidates(input: {
  seasonIdOrCode: string;
}): Promise<SeasonReviewerPoolResult> {
  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, error: clientError, rows: [], season: null };

  const season = await resolveSeason(input.seasonIdOrCode);
  if (!season) return { ok: false, error: "Không tìm thấy mùa.", rows: [], season: null };

  const ctx = await getAdminScopeContext();
  if (!(await canReadSeason(ctx, season.id))) {
    return { ok: false, error: "Bạn không có quyền xem dữ liệu của mùa này.", rows: [], season };
  }

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select(ROW_COLUMNS)
    .eq("season_id", season.id)
    .eq("status", "confirmed")
    .order("created_at", { ascending: true });

  if (error) {
    log("reviewer candidate list failed", error);
    return { ok: false, error: SAFE_ERROR, rows: [], season };
  }

  const rows = (data ?? []) as unknown as MentorConfirmationRow[];
  if (rows.length === 0) return { ok: true, error: null, rows: [], season };

  const personIds = Array.from(new Set(rows.map((row) => row.person_id)));
  const profileIds = Array.from(
    new Set(rows.map((row) => row.mentor_profile_id).filter((value): value is string => Boolean(value)))
  );

  const [peopleRes, profileRes, adminRes] = await Promise.all([
    client.from("people").select("id,full_name,email_primary").in("id", personIds),
    profileIds.length
      ? client.from("mentor_profiles").select("id,mentor_code").in("id", profileIds)
      : Promise.resolve({ data: [], error: null } as { data: JsonRecord[]; error: null }),
    client.from("admin_users").select("id,email,role,status")
  ]);

  if (peopleRes.error) log("reviewer candidate people lookup failed", peopleRes.error);
  if (adminRes.error) log("reviewer candidate admin lookup failed", adminRes.error);

  const peopleById = new Map(
    ((peopleRes.data ?? []) as Array<{ id: string; full_name: string | null; email_primary: string | null }>).map(
      (row) => [row.id, row]
    )
  );
  const codeByProfileId = new Map(
    ((profileRes.data ?? []) as Array<{ id: string; mentor_code: string | null }>).map((row) => [
      row.id,
      row.mentor_code
    ])
  );
  const adminByEmail = new Map(
    ((adminRes.data ?? []) as Array<{ id: string; email: string; role: string | null; status: string | null }>).map(
      (row) => [String(row.email ?? "").trim().toLowerCase(), row]
    )
  );

  const candidates: SeasonReviewerCandidate[] = rows.map((row) => {
    const person = peopleById.get(row.person_id);
    const email = String(person?.email_primary ?? "").trim().toLowerCase();
    const account = email ? adminByEmail.get(email) : undefined;
    return {
      confirmation_id: row.id,
      person_id: row.person_id,
      full_name: person?.full_name ?? null,
      email_primary: person?.email_primary ?? null,
      mentor_code: row.mentor_profile_id ? codeByProfileId.get(row.mentor_profile_id) ?? null : null,
      status: row.status,
      max_mentees: row.max_mentees,
      agree_to_review: row.agree_to_review,
      agree_to_interview: row.agree_to_interview,
      admin_user_id: account?.id ?? null,
      admin_user_role: account?.role ?? null,
      admin_user_status: account?.status ?? null
    };
  });

  return { ok: true, error: null, rows: candidates, season };
}
