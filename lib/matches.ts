import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageMatches } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { JsonRecord, Match } from "@/lib/types";

// ── Constants ────────────────────────────────────────────────────────────────

const SAFE_ERROR = "Không thể thực hiện tác vụ. Vui lòng kiểm tra cấu hình Supabase và server logs.";
const MAX_MENTOR_ACTIVE_MATCHES = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MutationResult = {
  ok: boolean;
  message: string;
  matchId?: string | null;
};

export type MentorCandidate = {
  profile_id: string;
  person_id: string | null;
  full_name: string | null;
  email_primary: string | null;
  mentor_code: string | null;
  company_current: string | null;
  title_current: string | null;
  active_match_count: number;
};

export type MenteeCandidate = {
  profile_id: string;
  person_id: string | null;
  full_name: string | null;
  email_primary: string | null;
  mentee_code: string | null;
  school_code: string | null;
  major: string | null;
  has_active_match: boolean;
};

export type MatchCandidates = {
  ok: boolean;
  error: string | null;
  mentors: MentorCandidate[];
  mentees: MenteeCandidate[];
};

export type EnrichedMatch = Match & {
  mentor_name: string | null;
  mentor_email: string | null;
  mentee_name: string | null;
  mentee_email: string | null;
  batch_code: string | null;
};

export type MatchListResult = {
  ok: boolean;
  error: string | null;
  data: EnrichedMatch[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[matches]", scope, { code: err?.code, message: err?.message ?? String(error) });
}

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function clientResult() {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { client: null, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY trên server." as string | null };
  return { client, error: null as string | null };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

async function requireMatchAdmin() {
  const admin = await getCurrentAdminUser();
  if (!canManageMatches(admin?.role)) {
    return { ok: false as const, message: "Bạn không có quyền quản lý matching." };
  }
  return { ok: true as const, admin };
}

async function writeAdminAudit(client: ReturnType<typeof getSupabaseServiceRoleClient>, input: {
  actionType: string;
  beforeData?: unknown;
  afterData?: unknown;
  details?: unknown;
}) {
  if (!client) return;
  try {
    const admin = await getCurrentAdminUser();
    await client.from("admin_audit_log").insert({
      actor_admin_user_id: admin?.id ?? null,
      action_type: input.actionType,
      target_admin_user_id: null,
      before_data: input.beforeData ?? null,
      after_data: input.afterData ?? null,
      details: input.details ?? null
    });
  } catch (err) {
    log("admin audit crashed", err);
  }
}

// ── Data queries ──────────────────────────────────────────────────────────────

/**
 * Load matches with optional batch + status filters.
 * Enriches each row with mentor/mentee names and batch code (joined in JS).
 */
export async function getMatchList(filters?: {
  intakeBatchId?: string | null;
  status?: string | null;
}): Promise<MatchListResult> {
  const { client, error } = clientResult();
  if (!client) return { ok: false, error, data: [] };

  let query = client.from("matches").select(
    "id,season_id,mentor_person_id,mentee_person_id,mentor_profile_id,mentee_profile_id," +
    "intake_batch_id,status,match_type,match_source,match_source_raw,matched_at,ended_at," +
    "end_reason,admin_notes,notes,match_confidence"
  ).order("matched_at", { ascending: false }).order("id", { ascending: false });

  if (filters?.intakeBatchId) {
    query = query.eq("intake_batch_id", filters.intakeBatchId);
  }
  if (filters?.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const { data: matchRows, error: matchErr } = await query;
  if (matchErr) {
    log("getMatchList failed", matchErr);
    return { ok: false, error: matchErr.message, data: [] };
  }

  const matches = (matchRows ?? []) as unknown as Match[];

  // Collect person IDs to resolve names
  const personIds = new Set<string>();
  for (const m of matches) {
    if (m.mentor_person_id) personIds.add(m.mentor_person_id);
    if (m.mentee_person_id) personIds.add(m.mentee_person_id);
  }

  // Collect batch IDs to resolve codes
  const batchIds = new Set<string>();
  for (const m of matches) {
    if (m.intake_batch_id) batchIds.add(m.intake_batch_id);
  }

  const [peopleRes, batchesRes] = await Promise.all([
    personIds.size > 0
      ? client.from("people").select("id,full_name,email_primary").in("id", Array.from(personIds))
      : Promise.resolve({ data: [], error: null }),
    batchIds.size > 0
      ? client.from("intake_batches").select("id,code").in("id", Array.from(batchIds))
      : Promise.resolve({ data: [], error: null })
  ]);

  const peopleById = new Map((peopleRes.data ?? []).map((p: JsonRecord) => [p.id as string, p]));
  const batchById = new Map((batchesRes.data ?? []).map((b: JsonRecord) => [b.id as string, b]));

  const enriched: EnrichedMatch[] = matches.map((m) => {
    const mentor = m.mentor_person_id ? peopleById.get(m.mentor_person_id) : undefined;
    const mentee = m.mentee_person_id ? peopleById.get(m.mentee_person_id) : undefined;
    const batch = m.intake_batch_id ? batchById.get(m.intake_batch_id) : undefined;
    return {
      ...m,
      mentor_name: (mentor?.full_name as string | null) ?? null,
      mentor_email: (mentor?.email_primary as string | null) ?? null,
      mentee_name: (mentee?.full_name as string | null) ?? null,
      mentee_email: (mentee?.email_primary as string | null) ?? null,
      batch_code: (batch?.code as string | null) ?? null
    };
  });

  return { ok: true, error: null, data: enriched };
}

/**
 * Returns approved mentors and mentees in a batch, enriched with match load.
 * "Approved" = has a profile row with intake_batch_id set (profiles are only
 * created for accepted applicants in Phase 041/043).
 */
export async function getManualMatchingCandidates(intakeBatchId: string): Promise<MatchCandidates> {
  const empty: MatchCandidates = { ok: false, error: null, mentors: [], mentees: [] };
  const { client, error } = clientResult();
  if (!client) return { ...empty, error };

  const [mentorProfilesRes, menteeProfilesRes, activeMatchesRes] = await Promise.all([
    client
      .from("mentor_profiles")
      .select("id,person_id,mentor_code,company_current,title_current")
      .eq("intake_batch_id", intakeBatchId),
    client
      .from("mentee_profiles")
      .select("id,person_id,mentee_code,school_code,major")
      .eq("intake_batch_id", intakeBatchId),
    client
      .from("matches")
      .select("mentor_profile_id,mentee_profile_id")
      .eq("intake_batch_id", intakeBatchId)
      .eq("status", "active")
  ]);

  if (mentorProfilesRes.error) {
    log("mentor_profiles fetch failed", mentorProfilesRes.error);
    return { ...empty, ok: false, error: mentorProfilesRes.error.message };
  }
  if (menteeProfilesRes.error) {
    log("mentee_profiles fetch failed", menteeProfilesRes.error);
    return { ...empty, ok: false, error: menteeProfilesRes.error.message };
  }

  const activeMatches = (activeMatchesRes.data ?? []) as Array<{ mentor_profile_id: string | null; mentee_profile_id: string | null }>;

  // Count active matches per mentor profile
  const mentorMatchCount = new Map<string, number>();
  for (const m of activeMatches) {
    if (m.mentor_profile_id) {
      mentorMatchCount.set(m.mentor_profile_id, (mentorMatchCount.get(m.mentor_profile_id) ?? 0) + 1);
    }
  }

  // Set of mentee profiles with an active match
  const activelyMatchedMenteeIds = new Set<string>(
    activeMatches.map((m) => m.mentee_profile_id).filter((id): id is string => Boolean(id))
  );

  // Resolve person_ids to names/emails
  const allPersonIds = new Set<string>();
  for (const mp of mentorProfilesRes.data ?? []) {
    if ((mp as JsonRecord).person_id) allPersonIds.add((mp as JsonRecord).person_id as string);
  }
  for (const mp of menteeProfilesRes.data ?? []) {
    if ((mp as JsonRecord).person_id) allPersonIds.add((mp as JsonRecord).person_id as string);
  }

  const peopleRes = allPersonIds.size > 0
    ? await client.from("people").select("id,full_name,email_primary").in("id", Array.from(allPersonIds))
    : { data: [], error: null };

  const peopleById = new Map((peopleRes.data ?? []).map((p: JsonRecord) => [p.id as string, p]));

  const mentors: MentorCandidate[] = (mentorProfilesRes.data ?? []).map((mp: JsonRecord) => {
    const person = mp.person_id ? peopleById.get(mp.person_id as string) : undefined;
    const count = mentorMatchCount.get(mp.id as string) ?? 0;
    return {
      profile_id: mp.id as string,
      person_id: (mp.person_id as string | null) ?? null,
      full_name: (person?.full_name as string | null) ?? null,
      email_primary: (person?.email_primary as string | null) ?? null,
      mentor_code: (mp.mentor_code as string | null) ?? null,
      company_current: (mp.company_current as string | null) ?? null,
      title_current: (mp.title_current as string | null) ?? null,
      active_match_count: count
    };
  }).sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "vi"));

  const mentees: MenteeCandidate[] = (menteeProfilesRes.data ?? []).map((mp: JsonRecord) => {
    const person = mp.person_id ? peopleById.get(mp.person_id as string) : undefined;
    return {
      profile_id: mp.id as string,
      person_id: (mp.person_id as string | null) ?? null,
      full_name: (person?.full_name as string | null) ?? null,
      email_primary: (person?.email_primary as string | null) ?? null,
      mentee_code: (mp.mentee_code as string | null) ?? null,
      school_code: (mp.school_code as string | null) ?? null,
      major: (mp.major as string | null) ?? null,
      has_active_match: activelyMatchedMenteeIds.has(mp.id as string)
    };
  }).sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "vi"));

  return { ok: true, error: null, mentors, mentees };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createManualMatch(input: {
  mentorProfileId?: unknown;
  menteeProfileId?: unknown;
  intakeBatchId?: unknown;
  adminNotes?: unknown;
}): Promise<MutationResult> {
  const access = await requireMatchAdmin();
  if (!access.ok) return { ok: false, message: access.message };

  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const mentorProfileId = clean(input.mentorProfileId);
  const menteeProfileId = clean(input.menteeProfileId);
  const intakeBatchId = clean(input.intakeBatchId);

  if (!mentorProfileId || !isValidUuid(mentorProfileId))
    return { ok: false, message: "Vui lòng chọn mentor." };
  if (!menteeProfileId || !isValidUuid(menteeProfileId))
    return { ok: false, message: "Vui lòng chọn mentee." };
  if (!intakeBatchId || !isValidUuid(intakeBatchId))
    return { ok: false, message: "Vui lòng chọn intake batch." };

  // Load mentor profile + person
  const { data: mentorProfile, error: mpErr } = await client
    .from("mentor_profiles")
    .select("id,person_id,mentor_code,intake_batch_id")
    .eq("id", mentorProfileId)
    .maybeSingle();
  if (mpErr || !mentorProfile) {
    if (mpErr) log("load mentor_profile failed", mpErr);
    return { ok: false, message: "Không tìm thấy hồ sơ mentor." };
  }

  // Load mentee profile + person
  const { data: menteeProfile, error: mpeErr } = await client
    .from("mentee_profiles")
    .select("id,person_id,mentee_code,intake_batch_id")
    .eq("id", menteeProfileId)
    .maybeSingle();
  if (mpeErr || !menteeProfile) {
    if (mpeErr) log("load mentee_profile failed", mpeErr);
    return { ok: false, message: "Không tìm thấy hồ sơ mentee." };
  }

  const mp = mentorProfile as JsonRecord;
  const mpe = menteeProfile as JsonRecord;

  // Verify batch membership (both profiles must belong to this batch)
  if (mp.intake_batch_id && mp.intake_batch_id !== intakeBatchId) {
    return { ok: false, message: "Mentor không thuộc batch đã chọn." };
  }
  if (mpe.intake_batch_id && mpe.intake_batch_id !== intakeBatchId) {
    return { ok: false, message: "Mentee không thuộc batch đã chọn." };
  }

  // Rule: mentee can have at most one active match
  const { data: existingMenteeMatch, error: menteeMatchErr } = await client
    .from("matches")
    .select("id")
    .eq("mentee_profile_id", menteeProfileId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (menteeMatchErr) {
    log("check mentee active match failed", menteeMatchErr);
    return { ok: false, message: `${SAFE_ERROR} (${menteeMatchErr.message})` };
  }
  if (existingMenteeMatch) {
    return { ok: false, message: "Mentee này đã có mentor đang active. Hủy match cũ trước khi tạo match mới." };
  }

  // Rule: mentor can have at most 3 active mentees
  const { count: mentorActiveCount, error: mentorCountErr } = await client
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("mentor_profile_id", mentorProfileId)
    .eq("status", "active");
  if (mentorCountErr) {
    log("count mentor active matches failed", mentorCountErr);
    return { ok: false, message: `${SAFE_ERROR} (${mentorCountErr.message})` };
  }
  if ((mentorActiveCount ?? 0) >= MAX_MENTOR_ACTIVE_MATCHES) {
    return {
      ok: false,
      message: `Mentor này đã có ${mentorActiveCount}/${MAX_MENTOR_ACTIVE_MATCHES} mentee. Không thể thêm mentee mới.`
    };
  }

  // Resolve person_ids for mentor/mentee
  const mentorPersonId = (mp.person_id as string | null) ?? null;
  const menteePersonId = (mpe.person_id as string | null) ?? null;

  // Resolve season_id from batch
  const { data: batch, error: batchErr } = await client
    .from("intake_batches")
    .select("id,season_id")
    .eq("id", intakeBatchId)
    .maybeSingle();
  if (batchErr) {
    log("load intake_batch for match failed", batchErr);
  }
  const seasonId = (batch as JsonRecord | null)?.season_id ?? null;

  // Insert match
  const payload: JsonRecord = {
    season_id: seasonId,
    mentor_person_id: mentorPersonId,
    mentee_person_id: menteePersonId,
    mentor_profile_id: mentorProfileId,
    mentee_profile_id: menteeProfileId,
    intake_batch_id: intakeBatchId,
    status: "active",
    match_source: "manual",
    match_source_raw: "manual",
    match_type: "primary",
    matched_by: access.admin?.id ?? null,
    matched_at: new Date().toISOString(),
    admin_notes: clean(input.adminNotes)
  };

  const { data: inserted, error: insertErr } = await client
    .from("matches")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    log("create manual match failed", insertErr);
    // Surface the unique-constraint error clearly
    if (insertErr.code === "23505") {
      return { ok: false, message: "Mentee này đã có match active (lỗi constraint). Hủy match cũ trước." };
    }
    return { ok: false, message: `${SAFE_ERROR} (${insertErr.message})` };
  }

  await writeAdminAudit(client, {
    actionType: "create_manual_match",
    afterData: payload,
    details: { mentor_profile_id: mentorProfileId, mentee_profile_id: menteeProfileId, intake_batch_id: intakeBatchId }
  });

  return {
    ok: true,
    message: "Đã tạo match thành công.",
    matchId: (inserted as JsonRecord | null)?.id as string | null
  };
}

export async function cancelMatch(input: {
  matchId?: unknown;
  endReason?: unknown;
}): Promise<MutationResult> {
  const access = await requireMatchAdmin();
  if (!access.ok) return { ok: false, message: access.message };

  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const matchId = clean(input.matchId);
  if (!matchId || !isValidUuid(matchId))
    return { ok: false, message: "ID match không hợp lệ." };

  const { data: before, error: loadErr } = await client
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();
  if (loadErr) {
    log("load match for cancel failed", loadErr);
    return { ok: false, message: `${SAFE_ERROR} (${loadErr.message})` };
  }
  if (!before) return { ok: false, message: "Không tìm thấy match." };

  const beforeRecord = before as JsonRecord;
  if (beforeRecord.status === "cancelled" || beforeRecord.status === "inactive") {
    return { ok: true, message: "Match này đã được hủy trước đó." };
  }

  const { data: after, error: updateErr } = await client
    .from("matches")
    .update({
      status: "cancelled",
      ended_at: new Date().toISOString(),
      end_reason: clean(input.endReason)
    })
    .eq("id", matchId)
    .select("id,status")
    .maybeSingle();

  if (updateErr) {
    log("cancel match failed", updateErr);
    return { ok: false, message: `${SAFE_ERROR} (${updateErr.message})` };
  }

  await writeAdminAudit(client, {
    actionType: "cancel_match",
    beforeData: before,
    afterData: after,
    details: { end_reason: clean(input.endReason) }
  });

  return { ok: true, message: "Đã hủy match.", matchId };
}
