import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canViewCrossProgramReports } from "@/lib/participant-auth-core";
import {
  buildTotals,
  emptyCell,
  normalizeMetrics,
  resolveDateRange,
  withinRange,
  type MetricKey,
  type ProgramColumn,
  type ReportCell,
  type ReportTable
} from "@/lib/cross-program-report-core";

/**
 * lib/cross-program-report.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Counting the programme, across programmes and across time.
 *
 * Everything here is read-only and aggregate. No name, no address, no
 * individual row ever leaves this module — the reporting role exists precisely
 * so somebody can see how the whole thing is going without being handed the
 * records of eleven hundred people.
 *
 * IT COUNTS WHAT IS THERE, NOT WHAT SHOULD BE. Season membership on production
 * is empty, so participation is counted from `matches`, which is the only
 * reliable record of who was actually paired in which season. When the backfill
 * populates the membership table the numbers do not change — they are the same
 * pairs, counted the same way.
 */

const SAFE_ERROR = "Không tổng hợp được báo cáo. Vui lòng thử lại.";

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[cross-program-report]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

/** Event types that count as training, and as a company visit. */
const TRAINING_TYPES = new Set(["training", "orientation"]);
const COMPANY_VISIT_TYPES = new Set(["company_tour", "job_shadowing"]);

export type ReportView = {
  ok: boolean;
  error: string | null;
  /** Every programme, for the selector. */
  availablePrograms: ProgramColumn[];
  selectedProgramIds: string[];
  table: ReportTable | null;
};

export type ReportRequest = {
  programIds?: unknown;
  metrics?: unknown;
  from?: unknown;
  to?: unknown;
};

// ── Entry point ──────────────────────────────────────────────────────────────

export async function getCrossProgramReport(request: ReportRequest): Promise<ReportView> {
  const admin = await getCurrentAdminUser();
  if (!canViewCrossProgramReports(admin?.role)) {
    return {
      ok: false,
      error: "Bạn không có quyền xem báo cáo toàn hệ thống.",
      availablePrograms: [],
      selectedProgramIds: [],
      table: null
    };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { ok: false, error: SAFE_ERROR, availablePrograms: [], selectedProgramIds: [], table: null };
  }

  const availablePrograms = await loadPrograms(client);
  const metrics = normalizeMetrics(request.metrics);
  const range = resolveDateRange({ from: request.from, to: request.to });

  const requested = toIdList(request.programIds);
  // No selection means all of them — the cumulative view this role exists for.
  const columns = requested.length
    ? availablePrograms.filter((program) => requested.includes(program.programId))
    : availablePrograms;

  if (!columns.length) {
    return {
      ok: true,
      error: null,
      availablePrograms,
      selectedProgramIds: requested,
      table: { columns: [], metrics, byProgram: {}, totals: null, range, totalCaveats: [] }
    };
  }

  const byProgram = await countEverything(client, columns, metrics, range);
  const { totals, totalCaveats } = buildTotals(byProgram, columns, metrics);

  return {
    ok: true,
    error: null,
    availablePrograms,
    selectedProgramIds: columns.map((column) => column.programId),
    table: { columns, metrics, byProgram, totals, range, totalCaveats }
  };
}

// ── Counting ─────────────────────────────────────────────────────────────────

async function countEverything(
  client: ServiceClient,
  columns: ProgramColumn[],
  metrics: MetricKey[],
  range: ReturnType<typeof resolveDateRange>
): Promise<Record<string, ReportCell>> {
  const byProgram: Record<string, ReportCell> = {};
  for (const column of columns) byProgram[column.programId] = emptyCell();

  const seasons = await loadSeasons(client, columns.map((column) => column.programId));
  if (!seasons.size) return byProgram;

  const seasonIds = Array.from(seasons.keys());

  const needsPairs = metrics.some((metric) =>
    ["mentors", "mentees", "mentor_participations", "mentee_participations"].includes(metric)
  );
  const needsRecaps = metrics.some((metric) =>
    ["mentoring_sessions", "cross_mentoring_sessions"].includes(metric)
  );
  const needsEvents = metrics.some((metric) =>
    ["training_events", "company_visits"].includes(metric)
  );

  if (needsPairs) await countPairs(client, seasonIds, seasons, byProgram, range);
  if (needsRecaps) await countRecaps(client, seasonIds, seasons, byProgram, range);
  if (needsEvents) await countEvents(client, seasonIds, seasons, byProgram, range);

  return byProgram;
}

/**
 * People and participations, from the pairs.
 *
 * A pair carries its season, and a season carries its programme, so both
 * questions are answered from one read: distinct person ids give the headcount,
 * distinct person-and-season pairs give the participations.
 */
async function countPairs(
  client: ServiceClient,
  seasonIds: string[],
  seasons: Map<string, string>,
  byProgram: Record<string, ReportCell>,
  range: ReturnType<typeof resolveDateRange>
) {
  const { data, error } = await client
    .from("matches")
    .select("season_id,mentor_person_id,mentee_person_id,matched_at,status")
    .in("season_id", seasonIds);

  if (error) {
    log("count pairs", error);
    return;
  }

  const mentorsByProgram = new Map<string, Set<string>>();
  const menteesByProgram = new Map<string, Set<string>>();
  const mentorSeasonsByProgram = new Map<string, Set<string>>();
  const menteeSeasonsByProgram = new Map<string, Set<string>>();

  for (const row of (data ?? []) as Array<{
    season_id: string | null;
    mentor_person_id: string | null;
    mentee_person_id: string | null;
    matched_at: string | null;
    status: string | null;
  }>) {
    if (!row.season_id) continue;
    const programId = seasons.get(row.season_id);
    if (!programId || !byProgram[programId]) continue;

    // A window filters on when the pair was made. A pair with no date is only
    // counted when no window was asked for — inventing a date to keep it would
    // put it in whichever period somebody happened to be looking at.
    const hasWindow = Boolean(range.from || range.to);
    if (hasWindow && !withinRange(row.matched_at, range)) continue;

    if (row.mentor_person_id) {
      addTo(mentorsByProgram, programId, row.mentor_person_id);
      addTo(mentorSeasonsByProgram, programId, `${row.mentor_person_id}:${row.season_id}`);
    }
    if (row.mentee_person_id) {
      addTo(menteesByProgram, programId, row.mentee_person_id);
      addTo(menteeSeasonsByProgram, programId, `${row.mentee_person_id}:${row.season_id}`);
    }
  }

  for (const programId of Object.keys(byProgram)) {
    byProgram[programId].mentors = mentorsByProgram.get(programId)?.size ?? 0;
    byProgram[programId].mentees = menteesByProgram.get(programId)?.size ?? 0;
    byProgram[programId].mentor_participations = mentorSeasonsByProgram.get(programId)?.size ?? 0;
    byProgram[programId].mentee_participations = menteeSeasonsByProgram.get(programId)?.size ?? 0;
  }
}

async function countRecaps(
  client: ServiceClient,
  seasonIds: string[],
  seasons: Map<string, string>,
  byProgram: Record<string, ReportCell>,
  range: ReturnType<typeof resolveDateRange>
) {
  const { data, error } = await client
    .from("mentoring_recaps")
    .select("season_id,meeting_type,meeting_date,status")
    .in("season_id", seasonIds);

  if (error) {
    log("count recaps", error);
    return;
  }

  for (const row of (data ?? []) as Array<{
    season_id: string | null;
    meeting_type: string | null;
    meeting_date: string | null;
    status: string | null;
  }>) {
    if (!row.season_id) continue;
    const programId = seasons.get(row.season_id);
    if (!programId || !byProgram[programId]) continue;

    // A recap marked invalid or duplicate is not a meeting that happened.
    const status = String(row.status ?? "submitted").toLowerCase();
    if (status === "invalid" || status === "duplicate") continue;

    const hasWindow = Boolean(range.from || range.to);
    if (hasWindow && !withinRange(row.meeting_date, range)) continue;

    if (row.meeting_type === "1on1_cross") byProgram[programId].cross_mentoring_sessions++;
    else if (row.meeting_type === "1on1_primary") byProgram[programId].mentoring_sessions++;
  }
}

async function countEvents(
  client: ServiceClient,
  seasonIds: string[],
  seasons: Map<string, string>,
  byProgram: Record<string, ReportCell>,
  range: ReturnType<typeof resolveDateRange>
) {
  const { data, error } = await client
    .from("events")
    .select("season_id,event_type,starts_at")
    .in("season_id", seasonIds);

  if (error) {
    log("count events", error);
    return;
  }

  for (const row of (data ?? []) as Array<{
    season_id: string | null;
    event_type: string | null;
    starts_at: string | null;
  }>) {
    if (!row.season_id) continue;
    const programId = seasons.get(row.season_id);
    if (!programId || !byProgram[programId]) continue;

    const hasWindow = Boolean(range.from || range.to);
    if (hasWindow && !withinRange(row.starts_at, range)) continue;

    const type = String(row.event_type ?? "").toLowerCase();
    if (TRAINING_TYPES.has(type)) byProgram[programId].training_events++;
    else if (COMPANY_VISIT_TYPES.has(type)) byProgram[programId].company_visits++;
  }
}

function addTo(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

// ── Catalog ──────────────────────────────────────────────────────────────────

async function loadPrograms(client: ServiceClient): Promise<ProgramColumn[]> {
  const { data, error } = await client
    .from("programs")
    .select("id,code,name,is_active")
    .order("name", { ascending: true });

  if (error) {
    log("load programs", error);
    return [];
  }

  return ((data ?? []) as Array<{ id: string; code: string; name: string; is_active: boolean | null }>)
    .filter((row) => row.is_active !== false)
    .map((row) => ({ programId: row.id, programCode: row.code, programName: row.name }));
}

/** season id → programme id, for attributing every row to a column. */
async function loadSeasons(
  client: ServiceClient,
  programIds: string[]
): Promise<Map<string, string>> {
  const bySeason = new Map<string, string>();
  if (!programIds.length) return bySeason;

  const { data, error } = await client
    .from("seasons")
    .select("id,program_id")
    .in("program_id", programIds);

  if (error) {
    log("load seasons", error);
    return bySeason;
  }

  for (const row of (data ?? []) as Array<{ id: string; program_id: string | null }>) {
    if (row.program_id) bySeason.set(row.id, row.program_id);
  }
  return bySeason;
}

function toIdList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean)));
}
