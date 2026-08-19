import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { canOperateAnyScope, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { SEASON_CONFIG } from "@/lib/season-config";
import {
  monthFromDate,
  normalizeStudentId,
  preparePayload,
  type PreparedItem
} from "@/lib/recap-import-core";

/**
 * lib/recap-import.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Receiving collected Facebook posts, matching them to mentees, and turning the
 * approved ones into recaps.
 *
 * COLLECTED IS NOT IMPORTED. The endpoint writes to the staging table and
 * nothing else. A post becomes a row in mentoring_recaps only when an organiser
 * presses approve, because the parser is reading somebody else's HTML and will
 * sometimes be wrong — that should cost a click, not a corrupted record.
 *
 * A POST ENTERS ONCE. Before inserting anything, whatever is already staged or
 * already imported is filtered out, so scanning an overlapping window is free.
 * This is what lets the twice-monthly rhythm be a reminder rather than a rule.
 */

const SAFE_ERROR = "Không thể xử lý dữ liệu recap. Vui lòng thử lại hoặc liên hệ admin.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Supabase rejects very large `in` lists; chunk the dedupe lookups. */
const LOOKUP_CHUNK = 100;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[recap-import]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

async function requireRecapOperator() {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false as const, message: "Bạn chưa đăng nhập." };
  if (!canEditRecaps(admin)) {
    return { ok: false as const, message: "Bạn không có quyền quản lý recap." };
  }
  const ctx = await getAdminScopeContext();
  if (!canOperateAnyScope(ctx)) {
    return { ok: false as const, message: "Bạn không có quyền vận hành trong mùa nào." };
  }
  return { ok: true as const, admin, adminId: admin.id };
}

// ── Receiving a batch ────────────────────────────────────────────────────────

export type ReceiveBatchResult =
  | {
      ok: true;
      batchId: string;
      received: number;
      duplicates: number;
      matched: number;
      needsReview: number;
      skipped: string[];
      message: string;
    }
  | { ok: false; message: string };

/**
 * Store one collection run.
 *
 * Called by the token-authenticated route handler, so it does no session check
 * of its own — the caller has already proved it holds the import token.
 */
export async function receiveImportBatch(input: {
  payload: unknown;
  periodStart?: string | null;
  periodEnd?: string | null;
  groupLabel?: string | null;
  source?: "extension" | "csv";
  createdBy?: string | null;
}): Promise<ReceiveBatchResult> {
  const prepared = preparePayload(input.payload);
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // A post enters once, ever — across batches and against what is already a recap.
  const known = await loadKnownPermalinks(client, prepared.items.map((item) => item.permalink));
  const fresh = prepared.items.filter((item) => !known.has(item.permalink));
  const duplicates = prepared.items.length - fresh.length;

  if (!fresh.length) {
    return {
      ok: false,
      message: `Tất cả ${prepared.items.length} bài trong lượt này đã được thu thập trước đó. Không có gì mới để duyệt.`
    };
  }

  const { data: batchRow, error: batchErr } = await client
    .from("recap_import_batches")
    .insert({
      group_id: prepared.groupId,
      group_label: input.groupLabel ?? null,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      source: input.source ?? "extension",
      status: "received",
      item_count: fresh.length,
      duplicate_count: duplicates,
      created_by: input.createdBy ?? null
    })
    .select("id")
    .maybeSingle();

  if (batchErr || !batchRow) {
    log("open batch", batchErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const batchId = (batchRow as { id: string }).id;

  const { error: insertErr } = await client
    .from("recap_import_items")
    .insert(fresh.map((item) => ({ ...item, batch_id: batchId, status: "pending" })));

  if (insertErr) {
    log("insert items", insertErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const matched = await matchImportItems(client, batchId);

  return {
    ok: true,
    batchId,
    received: fresh.length,
    duplicates,
    matched: matched.matched,
    needsReview: matched.needsReview,
    skipped: prepared.skipped,
    message: `Đã nhận ${fresh.length} bài mới${duplicates ? `, bỏ qua ${duplicates} bài đã có` : ""}. Khớp tự động ${matched.matched}, cần xem lại ${matched.needsReview}.`
  };
}

async function loadKnownPermalinks(
  client: ServiceClient,
  permalinks: string[]
): Promise<Set<string>> {
  const known = new Set<string>();

  for (let index = 0; index < permalinks.length; index += LOOKUP_CHUNK) {
    const chunk = permalinks.slice(index, index + LOOKUP_CHUNK);

    const [stagedRes, recapRes] = await Promise.all([
      client.from("recap_import_items").select("permalink").in("permalink", chunk),
      // Already a recap: an earlier batch was approved, or somebody typed it in.
      client.from("mentoring_recaps").select("recap_url").in("recap_url", chunk)
    ]);

    if (stagedRes.error) log("dedupe against staging (non-fatal)", stagedRes.error);
    if (recapRes.error) log("dedupe against recaps (non-fatal)", recapRes.error);

    for (const row of (stagedRes.data ?? []) as Array<{ permalink: string }>) {
      known.add(row.permalink);
    }
    for (const row of (recapRes.data ?? []) as Array<{ recap_url: string }>) {
      known.add(row.recap_url);
    }
  }

  return known;
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * Identify the mentee behind each staged post.
 *
 * The student id in the post header is the only signal trusted enough to match
 * on: it is unique, the programme asks for it, and the mentee typed it. A name
 * that merely looks similar is left for a person to confirm.
 */
export async function matchImportItems(
  client: ServiceClient,
  batchId: string
): Promise<{ matched: number; needsReview: number }> {
  const { data: itemRows, error } = await client
    .from("recap_import_items")
    .select("id,mssv_raw,meeting_date")
    .eq("batch_id", batchId)
    .eq("status", "pending");

  if (error) {
    log("load items for matching", error);
    return { matched: 0, needsReview: 0 };
  }

  const items = (itemRows ?? []) as Array<{
    id: string;
    mssv_raw: string | null;
    meeting_date: string | null;
  }>;
  if (!items.length) return { matched: 0, needsReview: 0 };

  const menteeByStudentId = await loadMenteeIndex(client);
  const matchByMentee = await loadActiveMatches(client);

  let matched = 0;
  let needsReview = 0;

  for (const item of items) {
    const key = normalizeStudentId(item.mssv_raw);
    const mentee = key ? menteeByStudentId.get(key) : undefined;
    const pair = mentee ? matchByMentee.get(mentee.personId) : undefined;

    // Two active pairs for one mentee is a data problem, not something to guess at.
    if (mentee && pair && !pair.ambiguous) {
      const { error: updateErr } = await client
        .from("recap_import_items")
        .update({
          status: "matched",
          match_confidence: "mssv",
          season_id: pair.seasonId,
          mentee_person_id: mentee.personId,
          mentor_person_id: pair.mentorPersonId,
          match_id: pair.matchId
        })
        .eq("id", item.id);
      if (updateErr) {
        log("mark matched (non-fatal)", updateErr);
        continue;
      }
      matched++;
      continue;
    }

    // A student id we know, but no single active pair: still worth showing.
    const { error: reviewErr } = await client
      .from("recap_import_items")
      .update({
        status: "needs_review",
        match_confidence: "none",
        mentee_person_id: mentee?.personId ?? null
      })
      .eq("id", item.id);
    if (reviewErr) log("mark needs_review (non-fatal)", reviewErr);
    needsReview++;
  }

  await client
    .from("recap_import_batches")
    .update({ matched_count: matched, status: "reviewing" })
    .eq("id", batchId);

  return { matched, needsReview };
}

/** The season the operations screens default to, used only as a last resort. */
async function resolveOperatingSeason(client: ServiceClient): Promise<string | null> {
  const { data } = await client
    .from("seasons")
    .select("id")
    .eq("code", SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Student id → mentee person, built once per batch rather than per row. */
async function loadMenteeIndex(
  client: ServiceClient
): Promise<Map<string, { personId: string }>> {
  const index = new Map<string, { personId: string }>();

  const { data, error } = await client
    .from("mentee_profiles")
    .select("person_id,mssv,mentee_code");

  if (error) {
    log("load mentee index", error);
    return index;
  }

  for (const row of (data ?? []) as Array<{
    person_id: string | null;
    mssv: string | null;
    mentee_code: string | null;
  }>) {
    if (!row.person_id) continue;
    // Posts carry either the student id or the programme code; accept both.
    for (const candidate of [row.mssv, row.mentee_code]) {
      const key = normalizeStudentId(candidate);
      if (key && !index.has(key)) index.set(key, { personId: row.person_id });
    }
  }

  return index;
}

type ActivePair = {
  matchId: string;
  mentorPersonId: string | null;
  seasonId: string | null;
  /** More than one active pair for this mentee — a person has to choose. */
  ambiguous: boolean;
};

/**
 * Every active pair, across seasons and programmes.
 *
 * Not filtered to the operating season on purpose: UEHM and HAM post to
 * different groups and run on different season codes, and a recap should file
 * itself in whichever season the pair actually belongs to.
 */
async function loadActiveMatches(client: ServiceClient): Promise<Map<string, ActivePair>> {
  const byMentee = new Map<string, ActivePair>();

  const { data, error } = await client
    .from("matches")
    .select("id,season_id,mentor_person_id,mentee_person_id")
    .eq("status", "active");

  if (error) {
    log("load active matches", error);
    return byMentee;
  }

  for (const row of (data ?? []) as Array<{
    id: string;
    season_id: string | null;
    mentor_person_id: string | null;
    mentee_person_id: string | null;
  }>) {
    if (!row.mentee_person_id) continue;
    const existing = byMentee.get(row.mentee_person_id);
    if (existing) {
      existing.ambiguous = true;
      continue;
    }
    byMentee.set(row.mentee_person_id, {
      matchId: row.id,
      mentorPersonId: row.mentor_person_id,
      seasonId: row.season_id,
      ambiguous: false
    });
  }

  return byMentee;
}

// ── Reading, for the review screen ───────────────────────────────────────────

export type ImportBatchRow = {
  id: string;
  group_id: string;
  group_label: string | null;
  period_start: string | null;
  period_end: string | null;
  source: string;
  status: string;
  item_count: number;
  matched_count: number;
  imported_count: number;
  duplicate_count: number;
  created_at: string;
};

export type ImportItemRow = {
  id: string;
  permalink: string;
  meeting_date: string | null;
  author_name: string | null;
  mssv_raw: string | null;
  meeting_type: string | null;
  topic: string | null;
  mentor_names: string | null;
  mentee_names: string | null;
  content_full: string | null;
  content_truncated: boolean;
  match_confidence: string;
  status: string;
  mentee_person_id: string | null;
  mentee_name: string | null;
  mentor_name: string | null;
  review_note: string | null;
};

export type MenteeOption = {
  id: string;
  label: string;
};

export type ImportBatchView = {
  ok: boolean;
  error: string | null;
  batches: ImportBatchRow[];
  batch: ImportBatchRow | null;
  items: ImportItemRow[];
  menteeOptions: MenteeOption[];
};

export async function getRecapImportView(input: {
  batchId?: string | null;
}): Promise<ImportBatchView> {
  const empty: ImportBatchView = {
    ok: true,
    error: null,
    batches: [],
    batch: null,
    items: [],
    menteeOptions: []
  };

  const admin = await getCurrentAdminUser();
  if (!canEditRecaps(admin)) {
    return { ...empty, ok: false, error: "Bạn không có quyền xem dữ liệu recap thu thập." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ...empty, ok: false, error: SAFE_ERROR };

  const { data: batchRows, error: batchErr } = await client
    .from("recap_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (batchErr) {
    log("list batches", batchErr);
    return { ...empty, ok: false, error: SAFE_ERROR };
  }

  const batches = (batchRows ?? []) as unknown as ImportBatchRow[];
  const selected =
    (input.batchId && isValidUuid(input.batchId)
      ? batches.find((row) => row.id === input.batchId)
      : batches[0]) ?? null;

  if (!selected) return { ...empty, batches };

  const { data: itemRows, error: itemErr } = await client
    .from("recap_import_items")
    .select(
      "id,permalink,meeting_date,author_name,mssv_raw,meeting_type,topic,mentor_names,mentee_names,content_full,content_truncated,match_confidence,status,mentee_person_id,mentor_person_id,review_note"
    )
    .eq("batch_id", selected.id)
    .order("meeting_date", { ascending: false });

  if (itemErr) {
    log("list items", itemErr);
    return { ...empty, ok: false, error: SAFE_ERROR, batches, batch: selected };
  }

  const rows = (itemRows ?? []) as Array<Record<string, unknown>>;
  const personIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.mentee_person_id, row.mentor_person_id])
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    )
  );

  const nameById = new Map<string, string | null>();
  if (personIds.length) {
    const { data: peopleRows } = await client
      .from("people")
      .select("id,full_name")
      .in("id", personIds);
    for (const person of (peopleRows ?? []) as Array<{ id: string; full_name: string | null }>) {
      nameById.set(person.id, person.full_name);
    }
  }

  const items: ImportItemRow[] = rows.map((row) => ({
    id: String(row.id),
    permalink: String(row.permalink),
    meeting_date: (row.meeting_date as string | null) ?? null,
    author_name: (row.author_name as string | null) ?? null,
    mssv_raw: (row.mssv_raw as string | null) ?? null,
    meeting_type: (row.meeting_type as string | null) ?? null,
    topic: (row.topic as string | null) ?? null,
    mentor_names: (row.mentor_names as string | null) ?? null,
    mentee_names: (row.mentee_names as string | null) ?? null,
    content_full: (row.content_full as string | null) ?? null,
    content_truncated: Boolean(row.content_truncated),
    match_confidence: String(row.match_confidence ?? "none"),
    status: String(row.status ?? "pending"),
    mentee_person_id: (row.mentee_person_id as string | null) ?? null,
    mentee_name: row.mentee_person_id ? nameById.get(String(row.mentee_person_id)) ?? null : null,
    mentor_name: row.mentor_person_id ? nameById.get(String(row.mentor_person_id)) ?? null : null,
    review_note: (row.review_note as string | null) ?? null
  }));

  // Only offered when something actually needs a person to choose.
  const menteeOptions = items.some((item) => item.status === "needs_review")
    ? await loadMenteeOptions(client)
    : [];

  return { ok: true, error: null, batches, batch: selected, items, menteeOptions };
}

/**
 * The mentees an organiser can pick from when the post carried no student id.
 *
 * Drawn from active pairs only, and labelled with the student id, because two
 * students in one season really can share a name.
 */
async function loadMenteeOptions(client: ServiceClient): Promise<MenteeOption[]> {
  const pairs = await loadActiveMatches(client);
  const personIds = Array.from(pairs.keys());
  if (!personIds.length) return [];

  const [peopleRes, profileRes] = await Promise.all([
    client.from("people").select("id,full_name").in("id", personIds),
    client.from("mentee_profiles").select("person_id,mssv,mentee_code").in("person_id", personIds)
  ]);

  if (peopleRes.error) {
    log("load mentee options", peopleRes.error);
    return [];
  }

  const codeByPerson = new Map<string, string>();
  for (const row of (profileRes.data ?? []) as Array<{
    person_id: string | null;
    mssv: string | null;
    mentee_code: string | null;
  }>) {
    const code = row.mssv ?? row.mentee_code;
    if (row.person_id && code) codeByPerson.set(row.person_id, code);
  }

  return ((peopleRes.data ?? []) as Array<{ id: string; full_name: string | null }>)
    .map((person) => {
      const code = codeByPerson.get(person.id);
      const name = person.full_name ?? "(chưa có tên)";
      return { id: person.id, label: code ? `${name} — ${code}` : name };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "vi"));
}

// ── Deciding ─────────────────────────────────────────────────────────────────

/**
 * Turn approved items into recaps.
 *
 * Writes the permalink as recap_url — the field the Season 11 import lost for
 * 258 of its 286 rows, and the reason this whole path exists.
 */
export async function approveImportItems(input: {
  itemIds?: unknown;
}): Promise<MutationResult> {
  const ids = toIdList(input.itemIds);
  if (!ids.length) return { ok: false, message: "Chưa chọn bài nào để duyệt." };

  const guard = await requireRecapOperator();
  if (!guard.ok) return { ok: false, message: guard.message };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: itemRows, error } = await client
    .from("recap_import_items")
    .select(
      "id,batch_id,permalink,meeting_date,meeting_type,content_full,season_id,mentee_person_id,mentor_person_id,match_id,status"
    )
    .in("id", ids);

  if (error) {
    log("load items for approval", error);
    return { ok: false, message: SAFE_ERROR };
  }

  const items = (itemRows ?? []) as Array<{
    id: string;
    batch_id: string;
    permalink: string;
    meeting_date: string | null;
    meeting_type: string | null;
    content_full: string | null;
    season_id: string | null;
    mentee_person_id: string | null;
    mentor_person_id: string | null;
    match_id: string | null;
    status: string;
  }>;

  let imported = 0;
  let refused = 0;
  const batchIds = new Set<string>();

  for (const item of items) {
    if (item.status === "imported") continue;

    // A recap has to know when it happened and who it belongs to.
    const meetingMonth = monthFromDate(item.meeting_date);
    if (!item.meeting_date || !meetingMonth || !item.mentee_person_id) {
      refused++;
      continue;
    }

    const { data: recapRow, error: insertErr } = await client
      .from("mentoring_recaps")
      .insert({
        season_id: item.season_id,
        match_id: item.match_id,
        mentor_person_id: item.mentor_person_id,
        mentee_person_id: item.mentee_person_id,
        meeting_date: item.meeting_date,
        meeting_month: meetingMonth,
        recap_url: item.permalink,
        recap_source: "facebook_group",
        recap_note: item.content_full,
        meeting_type: item.meeting_type ?? "unknown",
        status: "submitted",
        captured_by: guard.admin.full_name ?? guard.admin.email ?? null
      })
      .select("id")
      .maybeSingle();

    if (insertErr) {
      log("insert recap", insertErr);
      refused++;
      continue;
    }

    await client
      .from("recap_import_items")
      .update({
        status: "imported",
        imported_recap_id: (recapRow as { id?: string } | null)?.id ?? null,
        decided_by: guard.adminId,
        decided_at: new Date().toISOString()
      })
      .eq("id", item.id);

    batchIds.add(item.batch_id);
    imported++;
  }

  for (const batchId of Array.from(batchIds)) await refreshBatchCounts(client, batchId);

  if (!imported) {
    return {
      ok: false,
      message: "Không duyệt được bài nào: thiếu ngày gặp hoặc chưa xác định được mentee."
    };
  }

  return {
    ok: true,
    message: `Đã tạo ${imported} recap${refused ? `, ${refused} bài chưa đủ dữ liệu` : ""}.`
  };
}

/** Set aside a post that is not a recap, or is not worth importing. */
export async function skipImportItems(input: {
  itemIds?: unknown;
  reason?: unknown;
}): Promise<MutationResult> {
  const ids = toIdList(input.itemIds);
  if (!ids.length) return { ok: false, message: "Chưa chọn bài nào." };

  const guard = await requireRecapOperator();
  if (!guard.ok) return { ok: false, message: guard.message };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { error } = await client
    .from("recap_import_items")
    .update({
      status: "skipped",
      review_note: String(input.reason ?? "").trim().slice(0, 300) || null,
      decided_by: guard.adminId,
      decided_at: new Date().toISOString()
    })
    .in("id", ids)
    .neq("status", "imported");

  if (error) {
    log("skip items", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: `Đã bỏ qua ${ids.length} bài.` };
}

/** A person decides which mentee a post belongs to when the id was missing. */
export async function assignImportItem(input: {
  itemId?: unknown;
  menteePersonId?: unknown;
}): Promise<MutationResult> {
  const itemId = String(input.itemId ?? "").trim();
  const menteePersonId = String(input.menteePersonId ?? "").trim();
  if (!isValidUuid(itemId)) return { ok: false, message: "Bài viết không hợp lệ." };
  if (!isValidUuid(menteePersonId)) return { ok: false, message: "Vui lòng chọn mentee." };

  const guard = await requireRecapOperator();
  if (!guard.ok) return { ok: false, message: guard.message };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const pair = (await loadActiveMatches(client)).get(menteePersonId);
  const usablePair = pair && !pair.ambiguous ? pair : null;
  // No pair on file: still record the recap, against the season being operated.
  const seasonId = usablePair?.seasonId ?? (await resolveOperatingSeason(client));

  const { error } = await client
    .from("recap_import_items")
    .update({
      mentee_person_id: menteePersonId,
      mentor_person_id: usablePair?.mentorPersonId ?? null,
      match_id: usablePair?.matchId ?? null,
      season_id: seasonId,
      match_confidence: "manual",
      status: "matched"
    })
    .eq("id", itemId)
    .neq("status", "imported");

  if (error) {
    log("assign item", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return {
    ok: true,
    message: usablePair
      ? "Đã gán mentee. Bài này sẵn sàng để duyệt."
      : "Đã gán mentee, nhưng bạn này chưa có cặp ghép active duy nhất — recap sẽ không gắn match."
  };
}

async function refreshBatchCounts(client: ServiceClient, batchId: string) {
  const { data } = await client
    .from("recap_import_items")
    .select("status")
    .eq("batch_id", batchId);

  const rows = (data ?? []) as Array<{ status: string }>;
  const imported = rows.filter((row) => row.status === "imported").length;
  const pending = rows.filter((row) => ["pending", "matched", "needs_review"].includes(row.status));

  await client
    .from("recap_import_batches")
    .update({
      imported_count: imported,
      status: pending.length === 0 ? "completed" : "reviewing"
    })
    .eq("id", batchId);
}

function toIdList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(
    new Set(raw.map((item) => String(item ?? "").trim()).filter((item) => isValidUuid(item)))
  );
}
