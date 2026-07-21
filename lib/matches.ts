import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageMatches } from "@/lib/permissions";
import { canAccessSeason, canOperateAnyScope, getAdminScopeContext, getAllowedSeasonIds, type ScopeFilter } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { JsonRecord, Match, MenteeProfile, MentorProfile, Person } from "@/lib/types";

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
  mentor_profile_code: string | null;
  mentee_profile_code: string | null;
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

export type MatchRelatedDisplayData = {
  mentor: Person | null;
  mentee: Person | null;
  mentorProfile: MentorProfile | null;
  menteeProfile: MenteeProfile | null;
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

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

async function selectPeopleByIds(client: any, ids: string[]) {
  const rows: JsonRecord[] = [];
  const step = 200;
  for (let index = 0; index < ids.length; index += step) {
    const chunk = ids.slice(index, index + step);
    if (!chunk.length) continue;
    const { data, error } = await client.from("people").select("id,full_name,email_primary,phone_primary").in("id", chunk);
    if (error) {
      log("people chunk lookup failed", error);
      continue;
    }
    rows.push(...((data ?? []) as JsonRecord[]));
  }
  return rows;
}

async function selectRowsByColumn(client: any, table: string, columns: string, column: string, values: string[]) {
  const rows: JsonRecord[] = [];
  const step = 200;
  for (let index = 0; index < values.length; index += step) {
    const chunk = values.slice(index, index + step);
    if (!chunk.length) continue;
    const { data, error } = await client.from(table).select(columns).in(column, chunk);
    if (error) {
      log(`${table} chunk lookup failed`, error);
      continue;
    }
    rows.push(...((data ?? []) as JsonRecord[]));
  }
  return rows;
}

function profileKey(personId: string | null | undefined, batchId: string | null | undefined) {
  return `${personId ?? ""}::${batchId ?? ""}`;
}

function buildProfileMaps(rows: JsonRecord[]) {
  const byPersonAndBatch = new Map<string, JsonRecord>();
  const byPerson = new Map<string, JsonRecord>();

  for (const row of rows) {
    const personId = clean(row.person_id);
    if (!personId) continue;
    const batchId = clean(row.intake_batch_id);
    if (batchId) byPersonAndBatch.set(profileKey(personId, batchId), row);
    if (!byPerson.has(personId)) byPerson.set(personId, row);
  }

  return { byPersonAndBatch, byPerson };
}

function resolveProfile(
  maps: ReturnType<typeof buildProfileMaps>,
  personId: string | null | undefined,
  batchId: string | null | undefined
) {
  if (!personId) return undefined;
  return maps.byPersonAndBatch.get(profileKey(personId, batchId)) ?? maps.byPerson.get(personId);
}

async function requireMatchAdmin() {
  const admin = await getCurrentAdminUser();
  if (!canManageMatches(admin?.role)) {
    return { ok: false as const, message: "Bạn không có quyền quản lý matching." };
  }
  const ctx = await getAdminScopeContext();
  if (!canOperateAnyScope(ctx)) {
    return { ok: false as const, message: "Ban khong co quyen operations trong pham vi chuong trinh." };
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
  scope?: ScopeFilter;
}): Promise<MatchListResult> {
  const { client, error } = clientResult();
  if (!client) return { ok: false, error, data: [] };

  let batchSeasonId: string | null = null;
  if (filters?.intakeBatchId) {
    const { data: batch, error: batchError } = await client
      .from("intake_batches")
      .select("id,season_id")
      .eq("id", filters.intakeBatchId)
      .maybeSingle();
    if (batchError) {
      log("getMatchList batch lookup failed", batchError);
      return { ok: false, error: batchError.message, data: [] };
    }
    batchSeasonId = (batch as JsonRecord | null)?.season_id ?? null;
    if (!batchSeasonId) return { ok: true, error: null, data: [] };
    if (filters.scope?.allowedSeasonIds && !filters.scope.allowedSeasonIds.includes(batchSeasonId)) {
      return { ok: true, error: null, data: [] };
    }
  }

  let query = client.from("matches").select(
    "id,season_id,mentor_person_id,mentee_person_id,status,match_type," +
    "match_source_raw,matched_at,notes,match_confidence"
  ).order("matched_at", { ascending: false }).order("id", { ascending: false });

  if (batchSeasonId) {
    query = query.eq("season_id", batchSeasonId);
  }
  if (filters?.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters?.scope?.allowedSeasonIds) {
    if (!filters.scope.allowedSeasonIds.length) return { ok: true, error: null, data: [] };
    query = query.in("season_id", filters.scope.allowedSeasonIds);
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
  const seasonIds = new Set<string>();
  for (const m of matches) {
    if (m.intake_batch_id) batchIds.add(m.intake_batch_id);
    if (m.season_id) seasonIds.add(m.season_id);
  }

  const [mentorProfilesRows, menteeProfilesRows, explicitBatchesRes, seasonBatchesRows] = await Promise.all([
    personIds.size > 0
      ? selectRowsByColumn(client, "mentor_profiles", "id,person_id,mentor_code,intake_batch_id", "person_id", Array.from(personIds))
      : Promise.resolve([]),
    personIds.size > 0
      ? selectRowsByColumn(client, "mentee_profiles", "id,person_id,mentee_code,intake_batch_id", "person_id", Array.from(personIds))
      : Promise.resolve([]),
    batchIds.size > 0
      ? client.from("intake_batches").select("id,code").in("id", Array.from(batchIds))
      : Promise.resolve({ data: [], error: null }),
    seasonIds.size > 0
      ? selectRowsByColumn(client, "intake_batches", "id,season_id,code", "season_id", Array.from(seasonIds))
      : Promise.resolve([])
  ]);

  const mentorProfiles = buildProfileMaps(mentorProfilesRows);
  const menteeProfiles = buildProfileMaps(menteeProfilesRows);

  const peopleRows = personIds.size > 0
    ? await selectPeopleByIds(client, Array.from(personIds))
    : [];

  const peopleById = new Map(peopleRows.map((p: JsonRecord) => [p.id as string, p]));
  const batchById = new Map((explicitBatchesRes.data ?? []).map((b: JsonRecord) => [b.id as string, b]));
  const batchBySeasonId = new Map<string, JsonRecord>();
  for (const batch of seasonBatchesRows) {
    const seasonId = clean(batch.season_id);
    if (seasonId && !batchBySeasonId.has(seasonId)) batchBySeasonId.set(seasonId, batch);
  }

  const enriched: EnrichedMatch[] = matches.map((m) => {
    const mentorPersonId = m.mentor_person_id ?? null;
    const menteePersonId = m.mentee_person_id ?? null;
    const mentorProfile = resolveProfile(mentorProfiles, mentorPersonId, m.intake_batch_id);
    const menteeProfile = resolveProfile(menteeProfiles, menteePersonId, m.intake_batch_id);
    const mentor = mentorPersonId ? peopleById.get(mentorPersonId) : undefined;
    const mentee = menteePersonId ? peopleById.get(menteePersonId) : undefined;
    const batch = m.intake_batch_id ? batchById.get(m.intake_batch_id) : m.season_id ? batchBySeasonId.get(m.season_id) : undefined;
    return {
      ...m,
      mentor_profile_code: (mentorProfile?.mentor_code as string | null) ?? null,
      mentee_profile_code: (menteeProfile?.mentee_code as string | null) ?? null,
      mentor_person_id: mentorPersonId,
      mentee_person_id: menteePersonId,
      mentor_name: (mentor?.full_name as string | null) ?? ((mentorProfile?.mentor_code as string | null) ?? null),
      mentor_email: (mentor?.email_primary as string | null) ?? null,
      mentee_name: (mentee?.full_name as string | null) ?? ((menteeProfile?.mentee_code as string | null) ?? null),
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
export async function getManualMatchingCandidates(intakeBatchId: string, scope?: ScopeFilter): Promise<MatchCandidates> {
  const empty: MatchCandidates = { ok: false, error: null, mentors: [], mentees: [] };
  const { client, error } = clientResult();
  if (!client) return { ...empty, error };

  if (scope?.allowedSeasonIds) {
    const { data: batch, error: batchError } = await client
      .from("intake_batches")
      .select("season_id")
      .eq("id", intakeBatchId)
      .maybeSingle();
    if (batchError) return { ...empty, error: batchError.message };
    const seasonId = (batch as JsonRecord | null)?.season_id as string | null;
    if (!seasonId || !scope.allowedSeasonIds.includes(seasonId)) {
      return { ok: true, error: null, mentors: [], mentees: [] };
    }
  }
  const { data: selectedBatch, error: selectedBatchError } = await client
    .from("intake_batches")
    .select("season_id")
    .eq("id", intakeBatchId)
    .maybeSingle();
  if (selectedBatchError) return { ...empty, error: SAFE_ERROR };
  const selectedSeasonId = (selectedBatch as JsonRecord | null)?.season_id as string | null;
  if (!selectedSeasonId) return { ok: true, error: null, mentors: [], mentees: [] };

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
      .select("mentor_person_id,mentee_person_id")
      .eq("season_id", selectedSeasonId)
      .eq("status", "active")
  ]);

  if (mentorProfilesRes.error) {
    log("mentor_profiles fetch failed", mentorProfilesRes.error);
    return { ...empty, ok: false, error: SAFE_ERROR };
  }
  if (menteeProfilesRes.error) {
    log("mentee_profiles fetch failed", menteeProfilesRes.error);
    return { ...empty, ok: false, error: SAFE_ERROR };
  }
  if (activeMatchesRes.error) {
    log("active matches fetch failed", activeMatchesRes.error);
    return { ...empty, ok: false, error: SAFE_ERROR };
  }

  const activeMatches = (activeMatchesRes.data ?? []) as Array<{ mentor_person_id: string | null; mentee_person_id: string | null }>;

  // Count active matches per mentor person in the selected batch.
  const mentorMatchCountByPersonId = new Map<string, number>();
  for (const m of activeMatches) {
    if (m.mentor_person_id) {
      mentorMatchCountByPersonId.set(m.mentor_person_id, (mentorMatchCountByPersonId.get(m.mentor_person_id) ?? 0) + 1);
    }
  }

  // Set of mentee people with an active match in the selected batch.
  const activelyMatchedMenteePersonIds = new Set<string>(
    activeMatches.map((m) => m.mentee_person_id).filter((id): id is string => Boolean(id))
  );

  // Resolve person_ids to names/emails
  const allPersonIds = new Set<string>();
  for (const mp of mentorProfilesRes.data ?? []) {
    if ((mp as JsonRecord).person_id) allPersonIds.add((mp as JsonRecord).person_id as string);
  }
  for (const mp of menteeProfilesRes.data ?? []) {
    if ((mp as JsonRecord).person_id) allPersonIds.add((mp as JsonRecord).person_id as string);
  }

  const peopleRows = allPersonIds.size > 0
    ? await selectPeopleByIds(client, Array.from(allPersonIds))
    : [];

  const peopleById = new Map(peopleRows.map((p: JsonRecord) => [p.id as string, p]));

  const mentors: MentorCandidate[] = (mentorProfilesRes.data ?? []).map((mp: JsonRecord) => {
    const person = mp.person_id ? peopleById.get(mp.person_id as string) : undefined;
    const personId = (mp.person_id as string | null) ?? null;
    const count = personId ? (mentorMatchCountByPersonId.get(personId) ?? 0) : 0;
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
      has_active_match: Boolean(mp.person_id && activelyMatchedMenteePersonIds.has(mp.person_id as string))
    };
  }).sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "vi"));

  return { ok: true, error: null, mentors, mentees };
}

export async function getMatchRelatedDisplayData(match: Match | null | undefined): Promise<MatchRelatedDisplayData> {
  const empty: MatchRelatedDisplayData = {
    mentor: null,
    mentee: null,
    mentorProfile: null,
    menteeProfile: null
  };
  if (!match) return empty;
  const { client } = clientResult();
  if (!client) return empty;

  const mentorPersonId = match.mentor_person_id ?? null;
  const menteePersonId = match.mentee_person_id ?? null;
  const personIds = uniqueStrings([mentorPersonId, menteePersonId]);
  const [mentorProfileRows, menteeProfileRows, peopleRows] = await Promise.all([
    mentorPersonId
      ? selectRowsByColumn(client, "mentor_profiles", "id,person_id,mentor_code,bio_url,company_current,title_current,intake_batch_id", "person_id", [mentorPersonId])
      : Promise.resolve([]),
    menteePersonId
      ? selectRowsByColumn(client, "mentee_profiles", "id,person_id,mentee_code,school_code,major,mssv,intake_batch_id", "person_id", [menteePersonId])
      : Promise.resolve([]),
    personIds.length ? selectPeopleByIds(client, personIds) : Promise.resolve([])
  ]);
  const mentorProfileMaps = buildProfileMaps(mentorProfileRows);
  const menteeProfileMaps = buildProfileMaps(menteeProfileRows);
  const mentorProfile = (resolveProfile(mentorProfileMaps, mentorPersonId, match.intake_batch_id) as MentorProfile | undefined) ?? null;
  const menteeProfile = (resolveProfile(menteeProfileMaps, menteePersonId, match.intake_batch_id) as MenteeProfile | undefined) ?? null;
  const peopleById = new Map(peopleRows.map((person: JsonRecord) => [person.id as string, person as Person]));

  return {
    mentor: mentorPersonId ? peopleById.get(mentorPersonId) ?? null : null,
    mentee: menteePersonId ? peopleById.get(menteePersonId) ?? null : null,
    mentorProfile,
    menteeProfile
  };
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

  const mentorPersonId = (mp.person_id as string | null) ?? null;
  const menteePersonId = (mpe.person_id as string | null) ?? null;
  if (!mentorPersonId || !menteePersonId) {
    return { ok: false, message: "Há»“ sÆ¡ mentor/mentee thiáº¿u person_id nĂªn khĂ´ng thá»ƒ táº¡o match." };
  }

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
  const ctx = await getAdminScopeContext();
  const allowedSeasonIds = await getAllowedSeasonIds(ctx);
  if (!canAccessSeason(ctx, seasonId as string | null, allowedSeasonIds)) {
    return { ok: false, message: "Ban khong co quyen tao match trong mua nay." };
  }

  // Rule: mentee can have at most one active match
  const { data: existingMenteeMatch, error: menteeMatchErr } = await client
    .from("matches")
    .select("id")
    .eq("mentee_person_id", menteePersonId)
    .eq("season_id", seasonId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (menteeMatchErr) {
    log("check mentee active match failed", menteeMatchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (existingMenteeMatch) {
    return { ok: false, message: "Mentee này đã có mentor đang active. Hủy match cũ trước khi tạo match mới." };
  }

  // Rule: mentor can have at most 3 active mentees
  const { count: mentorActiveCount, error: mentorCountErr } = await client
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("mentor_person_id", mentorPersonId)
    .eq("season_id", seasonId)
    .eq("status", "active");
  if (mentorCountErr) {
    log("count mentor active matches failed", mentorCountErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if ((mentorActiveCount ?? 0) >= MAX_MENTOR_ACTIVE_MATCHES) {
    return {
      ok: false,
      message: `Mentor này đã có ${mentorActiveCount}/${MAX_MENTOR_ACTIVE_MATCHES} mentee. Không thể thêm mentee mới.`
    };
  }

  // Insert match
  const payload: JsonRecord = {
    season_id: seasonId,
    mentor_person_id: mentorPersonId,
    mentee_person_id: menteePersonId,
    status: "active",
    match_source_raw: "manual",
    match_type: "primary",
    matched_at: new Date().toISOString().slice(0, 10),
    notes: clean(input.adminNotes)
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
    return { ok: false, message: SAFE_ERROR };
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
    return { ok: false, message: SAFE_ERROR };
  }
  if (!before) return { ok: false, message: "Không tìm thấy match." };

  const ctx = await getAdminScopeContext();
  const allowedSeasonIds = await getAllowedSeasonIds(ctx);
  if (!canAccessSeason(ctx, (before as JsonRecord).season_id as string | null, allowedSeasonIds)) {
    return { ok: false, message: "Ban khong co quyen huy match trong mua nay." };
  }

  const beforeRecord = before as JsonRecord;
  if (beforeRecord.status === "dropped") {
    return { ok: true, message: "Match này đã được hủy / dừng trước đó." };
  }

  const { data: after, error: updateErr } = await client
    .from("matches")
    .update({
      status: "dropped",
      notes: clean(input.endReason) ?? beforeRecord.notes ?? null
    })
    .eq("id", matchId)
    .select("id,status")
    .maybeSingle();

  if (updateErr) {
    log("cancel match failed", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeAdminAudit(client, {
    actionType: "cancel_match",
    beforeData: before,
    afterData: after,
    details: { end_reason: clean(input.endReason) }
  });

  return { ok: true, message: "Đã hủy match.", matchId };
}
