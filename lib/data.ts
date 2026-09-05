import { supabase } from "@/lib/supabase";
import { readAllPages, readBounded, SELECT_PAGE_SIZE, type PagedTable } from "@/lib/paged-read";
import { staffDisplayName } from "@/lib/ui-labels";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { currentMonthVN, isOperationalMonth } from "@/lib/dashboard-month";
import { computeProgramOperationsKpis } from "@/lib/operations-kpis";
import { SEASON_CONFIG } from "@/lib/season-config";
import { evaluateMentorClassifications } from "@/lib/classification";
import { intersectAuthorizedAndCohort } from "@/lib/season-cohort";
import { resolveSeasonContext } from "@/lib/season-context";
import { REVIEW_ELIGIBLE_ROLES } from "@/lib/reviewer-eligibility";
import { isApplicationReviewAssignable } from "@/lib/application-review-assignability";
import {
  canOperateSeason,
  getAdminScopeContext,
  getScopeFilter,
  type ScopeFilter
} from "@/lib/program-scope";
import type {
  ActivityCorrectionLog,
  AdminUserPublic,
  Application,
  ApplicationDecision,
  ApplicationReview,
  Event,
  EventParticipation,
  FounderIntelligenceDashboard,
  FunctionArea,
  Industry,
  IntakeBatch,
  InterviewCandidateRow,
  JsonRecord,
  Match,
  MenteeProfile,
  MentorFunctionAreaLink,
  MentorIndustryLink,
  MentorProfile,
  MentorProgramParticipation,
  MentoringRecap,
  OperationalTeamAssignment,
  OperationsWorkflowData,
  Person,
  Program,
  ReviewAssignableApplication,
  ReviewAssignmentBatch,
  ReviewEligibleReviewer,
  ReviewerPoolRow,
  ReviewProgressRow,
  Season
} from "@/lib/types";

export type QueryResult<T> = { data: T; error: string | null };

export type OperationsDashboardKpis = {
  selectedMonth: string;
  recapCount: number;
  activeMenteeCount: number;
  activeMentorCount: number;
  mentorWithoutRecapCount: number;
  eventTrainingCount: number;
  eventAttendanceCount: number;
  followUpCount: number;
};

const ALLOWED_RECAP_STATUSES = new Set(["submitted", "needs_review", "invalid", "duplicate", "excluded"]);

export type MentoringRecapCorrectionInput = {
  id: string;
  meeting_date?: string | null;
  meeting_month?: string | null;
  status?: string | null;
  issue_flag?: boolean | null;
  admin_notes?: string | null;
  reason?: string | null;
  corrected_by?: string | null;
};

const VI_ERROR = "Không thể tải dữ liệu. Vui lòng kiểm tra cấu hình Supabase và quyền đọc bảng.";
const SERVICE_ROLE_REQUIRED =
  "Thiếu SUPABASE_SERVICE_ROLE_KEY. Dữ liệu hồ sơ ứng tuyển chỉ truy cập được bằng service role.";
const SCOPE_VISIBILITY_ERROR =
  "Không xác minh được phạm vi truy cập. Vui lòng thử lại hoặc liên hệ quản trị viên.";
const IN_FILTER_CHUNK_SIZE = 200;

/**
 * Multi-row reads in this module are classified A/B/C and remediated per
 * `lib/paged-read.ts`:
 *
 *   A — structurally bounded below the PostgREST row cap (`maybeSingle`,
 *       `head: true` counts, an explicit `.limit(n)` with n well under the cap,
 *       or an `.in()` on a primary key whose list is itself bounded). Left
 *       as-is; the bound is stated at the call site.
 *   B — practically bounded but not guaranteed: `selectTable` /
 *       `readBounded`, which FAIL if the asserted bound is exceeded rather
 *       than returning a silently truncated set.
 *   C — potentially unbounded: `selectAllTable` / `selectInChunks` /
 *       `readAllPages`, which page to exhaustion under a declared unique
 *       ordering key.
 *
 * The `/operations` Production defect was a class-C read (`mentoring_recaps`
 * filtered by season) issued with neither paging nor an ordering key.
 */

/**
 * Outcome of resolving the person IDs an admin scope may see.
 *
 * `personIds === null` means unrestricted/global visibility and nothing else —
 * it must never be produced by a failure. When `error` is non-null the scope
 * could not be evaluated: `personIds` is `[]` so any caller that ignores the
 * error still fails closed, and callers must surface the error instead of
 * treating the empty set as "this person is out of scope".
 */
export type ScopedPersonIdsResult = {
  personIds: string[] | null;
  error: string | null;
};

/**
 * Outcome of resolving the intake batch IDs an admin scope may see. Three
 * downstream person-visibility sources are filtered by these IDs, so the same
 * three states must stay distinguishable: `batchIds === null` means
 * unrestricted/global and is never produced by a failure, `[]` with no error is
 * a legitimate "this scope owns no batch", and a non-null `error` means the
 * batch list could not be resolved at all. `batchIds` is `[]` on failure so a
 * caller that reads only the IDs still narrows rather than widens.
 */
export type ScopedIntakeBatchIdsResult = {
  batchIds: string[] | null;
  error: string | null;
};

/** User-safe scope failure text: names the table and nothing from the database. */
function scopeVisibilityMessage(table: string) {
  return `${SCOPE_VISIBILITY_ERROR} (${table})`;
}

/** Fail-closed scope result: no visibility, plus a user-safe error naming only the table. */
function scopeVisibilityError(table: string): ScopedPersonIdsResult {
  return { personIds: [], error: scopeVisibilityMessage(table) };
}

/** Fail-closed batch result: no batches, plus a user-safe error naming only the table. */
function scopeBatchError(table: string): ScopedIntakeBatchIdsResult {
  return { batchIds: [], error: scopeVisibilityMessage(table) };
}

/** Fail-closed result for a server-only application table with no service-role client. */
export function serviceRoleRequiredError<T>(fallback: T): QueryResult<T> {
  return { data: fallback, error: SERVICE_ROLE_REQUIRED };
}

export function envError<T>(fallback: T): QueryResult<T> {
  return {
    data: fallback,
    error: "Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local."
  };
}

/**
 * The migration-059 application workflow tables. They are server-only: RLS is
 * enabled and forced with zero policies and no PUBLIC/anon/authenticated
 * privilege, so only the service-role client can reach them. Reads of these
 * tables must never fall back to the cookie-scoped or anon client — that
 * fallback cannot succeed and would turn a configuration fault into a silent
 * empty result.
 */
export const SERVER_ONLY_APPLICATION_TABLES = [
  "applications",
  "application_answers",
  "application_reviews",
  "application_decisions",
  "review_assignment_batches"
] as const;

const SERVER_ONLY_TABLE_SET: ReadonlySet<string> = new Set(SERVER_ONLY_APPLICATION_TABLES);

export function isServerOnlyApplicationTable(table: string) {
  return SERVER_ONLY_TABLE_SET.has(table);
}

/**
 * Resolves the read client for a table. Pass the table name so application
 * workflow reads fail closed when the service-role key is absent instead of
 * degrading to an authenticated or anonymous client.
 */
async function dataClient(table?: string) {
  const serviceRole = getSupabaseServiceRoleClient();
  if (table && isServerOnlyApplicationTable(table)) return serviceRole ?? null;
  return serviceRole ?? (await getSupabaseServerClient()) ?? supabase;
}

function logDataError(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[data]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function isNextDynamicUsageError(error: unknown) {
  const err = error as { message?: string; details?: string };
  return `${err?.message ?? ""} ${err?.details ?? ""}`.includes("Dynamic server usage");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function chunkValues<T>(values: T[], size = IN_FILTER_CHUNK_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Class C. Reads every row whose `column` is in `values`.
 *
 * The `IN` list is chunked so the request URL stays within limits, and EACH
 * CHUNK IS PAGED to exhaustion under the table's declared ordering key. Both
 * halves matter and the Production defect was the missing second half: a bare
 * `.in()` returned only the first `db-max-rows` rows of the chunk, with
 * `error: null`, so a scoped Admin and an unscoped Super Admin computed
 * different aggregates from the same table.
 *
 * Failure is all-or-nothing at the caller's level: the first chunk or page that
 * errors aborts the whole read and returns that error. Callers must not present
 * the partial `data` as a result — every caller here checks `error` first.
 *
 * `refine` adds filters that must be present on EVERY page (status, round, …).
 * It is applied to a freshly built query per page, so no page can carry a
 * different filter set than any other.
 */
async function selectInChunks<T extends Record<string, any>>(
  table: PagedTable,
  column: string,
  values: string[],
  columns = "*",
  refine?: (query: any) => any
): Promise<{ data: T[]; error: unknown | null }> {
  const client = await dataClient(table);
  if (!client) {
    return {
      data: [],
      error: isServerOnlyApplicationTable(table) ? { message: SERVICE_ROLE_REQUIRED } : null
    };
  }

  const rows: T[] = [];
  for (const chunk of chunkValues(uniqueStrings(values))) {
    if (!chunk.length) continue;
    const { data, error } = await readAllPages<T>(table, columns, (projection) => {
      const query = client.from(table).select(projection).in(column, chunk);
      return refine ? refine(query) : query;
    });
    if (error) return { data: rows, error };
    rows.push(...data);
  }

  return { data: rows, error: null };
}

function mergeRowsById<T extends { id?: string | null }>(rows: T[]) {
  const byId = new Map<string, T>();
  const withoutId: T[] = [];

  for (const row of rows) {
    if (row.id) {
      byId.set(row.id, row);
    } else {
      withoutId.push(row);
    }
  }

  return Array.from(byId.values()).concat(withoutId);
}

const VALID_ACTIVITY_STATUSES = new Set(["", "submitted", "needs_review"]);

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function monthDate(month: string) {
  return new Date(`${month}-01T00:00:00Z`);
}

function isValidRecapActivity(recap: MentoringRecap) {
  return VALID_ACTIVITY_STATUSES.has(normalizeStatus(recap.status));
}

/**
 * Class B. A whole-relation read the application asserts stays below
 * `BOUNDED_READ_LIMIT` — used for reference relations (`seasons`) and
 * per-season summary views. If the assertion is ever wrong the read FAILS with
 * a named error; it never returns a silently truncated relation. Use
 * `selectAllTable` for anything that can genuinely grow.
 */
async function selectTable<T>(table: string, columns = "*", fallback: T[] = []): Promise<QueryResult<T[]>> {
  const client = await dataClient(table);
  if (!client) return isServerOnlyApplicationTable(table) ? serviceRoleRequiredError(fallback) : envError(fallback);
  const { data, error } = await readBounded<T>(table, client.from(table).select(columns));
  if (error) {
    if (isNextDynamicUsageError(error)) throw error;
    logDataError(`${table}.select`, error);
    const err = error as { message?: string };
    return { data: fallback, error: `${VI_ERROR} (${table}: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

/**
 * Class C. Reads an entire table, paged under its declared ordering key.
 * A page failure aborts the whole read: returning the pages fetched so far as
 * if they were the table is exactly the silent-truncation failure mode this
 * module exists to remove, so `data` is discarded in favour of `fallback`.
 */
async function selectAllTable<T extends Record<string, any>>(
  table: PagedTable,
  columns = "*",
  fallback: T[] = [],
  pageSize = SELECT_PAGE_SIZE
): Promise<QueryResult<T[]>> {
  const client = await dataClient(table);
  if (!client) return isServerOnlyApplicationTable(table) ? serviceRoleRequiredError(fallback) : envError(fallback);
  const { data, error } = await readAllPages<T>(
    table,
    columns,
    (projection) => client.from(table).select(projection),
    pageSize
  );
  if (error) {
    if (isNextDynamicUsageError(error)) throw error;
    logDataError(`${table}.selectAll`, error);
    const err = error as { message?: string };
    return { data: fallback, error: `${VI_ERROR} (${table}: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export async function selectAllRows<T extends Record<string, any>>(table: PagedTable, columns = "*", fallback: T[] = []) {
  return selectAllTable<T>(table, columns, fallback);
}

function hasSeasonScope(scope?: ScopeFilter) {
  return Array.isArray(scope?.allowedSeasonIds);
}

function hasProgramScope(scope?: ScopeFilter) {
  return Array.isArray(scope?.allowedProgramIds);
}

function noAllowedRows(scope?: ScopeFilter) {
  return (hasSeasonScope(scope) && scope?.allowedSeasonIds?.length === 0) || (hasProgramScope(scope) && scope?.allowedProgramIds?.length === 0);
}

async function selectScopedBySeason<T extends Record<string, any>>(
  table: PagedTable,
  columns = "*",
  scope?: ScopeFilter,
  fallback: T[] = []
): Promise<QueryResult<T[]>> {
  if (!hasSeasonScope(scope)) return selectAllTable<T>(table, columns, fallback);
  if (!scope?.allowedSeasonIds?.length) return { data: fallback, error: null };
  const { data, error } = await selectInChunks<T>(table, "season_id", scope.allowedSeasonIds, columns);
  if (error) {
    if (isNextDynamicUsageError(error)) throw error;
    logDataError(`${table}.selectScopedBySeason`, error);
    const err = error as { message?: string };
    return { data: fallback, error: `${VI_ERROR} (${table}: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

/**
 * Resolves the intake batches a scope may see. A query failure returns a typed
 * error rather than an empty list: three person-visibility sources are filtered
 * by these IDs, and silently reporting "no batches" omits real people and
 * reproduces a false "person not found". Next.js dynamic usage errors are
 * rethrown, matching `selectTable`/`getScopedPersonIds`.
 */
async function getScopedIntakeBatchIds(scope?: ScopeFilter): Promise<ScopedIntakeBatchIdsResult> {
  if (!scope) return { batchIds: null, error: null };
  if (noAllowedRows(scope)) return { batchIds: [], error: null };
  const client = await dataClient();
  // If the Supabase client cannot be initialized (e.g. missing environment
  // variables), fail closed and return the canonical environment error rather
  // than an empty batch list that looks like a legitimate restricted scope.
  if (!client) return { batchIds: [], error: envError(null).error };

  let data: JsonRecord[] = [];
  if (scope.allowedSeasonIds?.length) {
    const result = await selectInChunks<JsonRecord>("intake_batches", "season_id", scope.allowedSeasonIds, "id,season_id");
    if (result.error) {
      if (isNextDynamicUsageError(result.error)) throw result.error;
      logDataError("intake_batches.getScopedIntakeBatchIds", result.error);
      return scopeBatchError("intake_batches");
    }
    data = result.data;
  } else {
    // Class C: a program-scoped (season-unscoped) grant reads every batch. This
    // list gates three person-visibility sources, so a truncated read here
    // silently hides real people.
    const { data: rows, error } = await readAllPages<JsonRecord>("intake_batches", "id,season_id", (projection) =>
      client.from("intake_batches").select(projection)
    );
    if (error) {
      if (isNextDynamicUsageError(error)) throw error;
      logDataError("intake_batches.getScopedIntakeBatchIds", error);
      return scopeBatchError("intake_batches");
    }
    data = rows;
  }

  return {
    batchIds: data.map((row) => String(row.id)).filter(Boolean),
    error: null
  };
}

/**
 * First failed source among the scope queries, if any. Logs through the
 * canonical `logDataError` sanitizer (operation name, table, error code and
 * message only) and converts it into a user-safe string. Next.js dynamic usage
 * errors are rethrown, matching `selectTable`/`selectScopedBySeason`.
 */
function firstScopeQueryError(results: Array<{ table: string; error: unknown }>) {
  for (const { table, error } of results) {
    if (!error) continue;
    if (isNextDynamicUsageError(error)) throw error;
    logDataError(`${table}.getScopedPersonIds`, error);
    return scopeVisibilityError(table);
  }
  return null;
}

export async function getScopedPersonIds(scope?: ScopeFilter): Promise<ScopedPersonIdsResult> {
  if (!scope) return { personIds: null, error: null };
  if (noAllowedRows(scope)) return { personIds: [], error: null };

  const ids = new Set<string>();
  if (scope.allowedSeasonIds?.length) {
    const [matchesRes, recapsRes, partsRes, appsRes, membershipsRes] = await Promise.all([
      selectInChunks<JsonRecord>("matches", "season_id", scope.allowedSeasonIds, "mentor_person_id,mentee_person_id"),
      selectInChunks<JsonRecord>("mentoring_recaps", "season_id", scope.allowedSeasonIds, "mentor_person_id,mentee_person_id"),
      selectInChunks<JsonRecord>("event_participations", "season_id", scope.allowedSeasonIds, "person_id"),
      selectInChunks<JsonRecord>("applications", "season_id", scope.allowedSeasonIds, "person_id"),
      selectInChunks<JsonRecord>("person_season_memberships", "season_id", scope.allowedSeasonIds, "person_id")
    ]);
    const seasonScopeError = firstScopeQueryError([
      { table: "matches", error: matchesRes.error },
      { table: "mentoring_recaps", error: recapsRes.error },
      { table: "event_participations", error: partsRes.error },
      { table: "applications", error: appsRes.error },
      { table: "person_season_memberships", error: membershipsRes.error }
    ]);
    if (seasonScopeError) return seasonScopeError;
    for (const row of matchesRes.data) {
      if (row.mentor_person_id) ids.add(String(row.mentor_person_id));
      if (row.mentee_person_id) ids.add(String(row.mentee_person_id));
    }
    for (const row of recapsRes.data) {
      if (row.mentor_person_id) ids.add(String(row.mentor_person_id));
      if (row.mentee_person_id) ids.add(String(row.mentee_person_id));
    }
    for (const row of partsRes.data) {
      if (row.person_id) ids.add(String(row.person_id));
    }
    for (const row of appsRes.data) {
      if (row.person_id) ids.add(String(row.person_id));
    }
    for (const row of membershipsRes.data) {
      if (row.person_id) ids.add(String(row.person_id));
    }
  }

  // The batch IDs gate the three sources below, so an unresolved batch list is a
  // failed scope evaluation — not "no batches". Returning here also means those
  // three queries never start, and the season-derived IDs above are discarded
  // rather than returned as a partial union.
  const { batchIds, error: batchScopeIdsError } = await getScopedIntakeBatchIds(scope);
  if (batchScopeIdsError) return { personIds: [], error: batchScopeIdsError };
  if (batchIds?.length) {
    const [mentorProfilesRes, menteeProfilesRes, appsRes] = await Promise.all([
      selectInChunks<JsonRecord>("mentor_profiles", "intake_batch_id", batchIds, "person_id"),
      selectInChunks<JsonRecord>("mentee_profiles", "intake_batch_id", batchIds, "person_id"),
      selectInChunks<JsonRecord>("applications", "intake_batch_id", batchIds, "person_id")
    ]);
    const batchScopeError = firstScopeQueryError([
      { table: "mentor_profiles", error: mentorProfilesRes.error },
      { table: "mentee_profiles", error: menteeProfilesRes.error },
      { table: "applications", error: appsRes.error }
    ]);
    if (batchScopeError) return batchScopeError;
    for (const row of mentorProfilesRes.data) if (row.person_id) ids.add(String(row.person_id));
    for (const row of menteeProfilesRes.data) if (row.person_id) ids.add(String(row.person_id));
    for (const row of appsRes.data) if (row.person_id) ids.add(String(row.person_id));
  }

  return { personIds: Array.from(ids), error: null };
}

async function countTable(table: string, filter?: (query: any) => any): Promise<QueryResult<number>> {
  const client = await dataClient();
  if (!client) return envError(0);
  let query = client.from(table).select("id", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) {
    if (isNextDynamicUsageError(error)) throw error;
    logDataError(`${table}.count`, error);
    return { data: 0, error: `${VI_ERROR} (${table}: ${error.message})` };
  }
  return { data: count ?? 0, error: null };
}

export async function getPeople(scope?: ScopeFilter, explicitPersonIds?: string[]) {
  const { personIds, error: scopeError } = await getScopedPersonIds(scope);
  if (scopeError) return { data: [] as Person[], error: scopeError };
  const selectedPersonIds = explicitPersonIds
    ? (personIds ? intersectAuthorizedAndCohort(personIds, explicitPersonIds) : explicitPersonIds)
    : personIds;
  if (selectedPersonIds && selectedPersonIds.length === 0) return { data: [] as Person[], error: null };
  if (!selectedPersonIds) return selectAllTable<Person>("people");
  const { data, error } = await selectInChunks<Person>("people", "id", selectedPersonIds);
  if (error) {
    logDataError("people.selectScopedByPerson", error);
    const err = error as { message?: string };
    return { data: [], error: `${VI_ERROR} (people: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export async function getMentorProfiles(scope?: ScopeFilter, explicitPersonIds?: string[]) {
  const { personIds, error: scopeError } = await getScopedPersonIds(scope);
  if (scopeError) return { data: [] as MentorProfile[], error: scopeError };
  const selectedPersonIds = explicitPersonIds
    ? intersectAuthorizedAndCohort(personIds, explicitPersonIds)
    : personIds;
  if (selectedPersonIds && selectedPersonIds.length === 0) return { data: [] as MentorProfile[], error: null };
  if (!selectedPersonIds) return selectAllTable<MentorProfile>("mentor_profiles");

  // An explicit list is an official season cohort. In this mode person_id is
  // the only profile key: intake_batch_id is not cohort membership and must not
  // union non-members back into the roster.
  if (explicitPersonIds) {
    const byPerson = await selectInChunks<MentorProfile>("mentor_profiles", "person_id", selectedPersonIds);
    if (byPerson.error) {
      logDataError("mentor_profiles.selectCohort", byPerson.error);
      const err = byPerson.error as { message?: string };
      return { data: [], error: `${VI_ERROR} (mentor_profiles: ${err.message ?? "Bad Request"})` };
    }
    return { data: byPerson.data, error: null };
  }
  const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(scope);
  if (batchScopeError) return { data: [] as MentorProfile[], error: batchScopeError };
  const [byPerson, byBatch] = await Promise.all([
    selectInChunks<MentorProfile>("mentor_profiles", "person_id", selectedPersonIds),
    batchIds?.length
      ? selectInChunks<MentorProfile>("mentor_profiles", "intake_batch_id", batchIds)
      : Promise.resolve({ data: [] as MentorProfile[], error: null })
  ]);
  const error = byPerson.error ?? byBatch.error;
  if (error) {
    logDataError("mentor_profiles.selectScoped", error);
    const err = error as { message?: string };
    return { data: [], error: `${VI_ERROR} (mentor_profiles: ${err.message ?? "Bad Request"})` };
  }
  return { data: mergeRowsById([...byPerson.data, ...byBatch.data]), error: null };
}

export async function getMenteeProfiles(scope?: ScopeFilter, explicitPersonIds?: string[]) {
  const { personIds, error: scopeError } = await getScopedPersonIds(scope);
  if (scopeError) return { data: [] as MenteeProfile[], error: scopeError };
  const selectedPersonIds = explicitPersonIds
    ? intersectAuthorizedAndCohort(personIds, explicitPersonIds)
    : personIds;
  if (selectedPersonIds && selectedPersonIds.length === 0) return { data: [] as MenteeProfile[], error: null };
  if (!selectedPersonIds) return selectAllTable<MenteeProfile>("mentee_profiles");

  // See the mentor path above: cohort mode is intentionally person-only.
  if (explicitPersonIds) {
    const byPerson = await selectInChunks<MenteeProfile>("mentee_profiles", "person_id", selectedPersonIds);
    if (byPerson.error) {
      logDataError("mentee_profiles.selectCohort", byPerson.error);
      const err = byPerson.error as { message?: string };
      return { data: [], error: `${VI_ERROR} (mentee_profiles: ${err.message ?? "Bad Request"})` };
    }
    return { data: byPerson.data, error: null };
  }
  const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(scope);
  if (batchScopeError) return { data: [] as MenteeProfile[], error: batchScopeError };
  const [byPerson, byBatch] = await Promise.all([
    selectInChunks<MenteeProfile>("mentee_profiles", "person_id", selectedPersonIds),
    batchIds?.length
      ? selectInChunks<MenteeProfile>("mentee_profiles", "intake_batch_id", batchIds)
      : Promise.resolve({ data: [] as MenteeProfile[], error: null })
  ]);
  const error = byPerson.error ?? byBatch.error;
  if (error) {
    logDataError("mentee_profiles.selectScoped", error);
    const err = error as { message?: string };
    return { data: [], error: `${VI_ERROR} (mentee_profiles: ${err.message ?? "Bad Request"})` };
  }
  return { data: mergeRowsById([...byPerson.data, ...byBatch.data]), error: null };
}

// Security invariant:
// These direct bypass helpers MUST ONLY be called after the exact application is authorized via getApplication(id, scope).
// Once authorized, the application's person_id is a trusted relationship that has passed the scope check.
// Do NOT invoke getScopedPersonIds to avoid expensive global reads.
export async function getPersonByAuthorizedApplicationPersonId(personId: string) {
  const client = await dataClient("people");
  if (!client) return { data: null, error: SERVICE_ROLE_REQUIRED };
  const { data, error } = await client.from("people").select("*").eq("id", personId).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (people: ${error.message})` };
  return { data: data as Person | null, error: null };
}

export async function getMentorProfileByAuthorizedApplicationPersonId(personId: string) {
  const client = await dataClient("mentor_profiles");
  if (!client) return { data: null, error: SERVICE_ROLE_REQUIRED };
  const { data, error } = await client.from("mentor_profiles").select("*").eq("person_id", personId).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (mentor_profiles: ${error.message})` };
  return { data: data as MentorProfile | null, error: null };
}

export async function getMenteeProfileByAuthorizedApplicationPersonId(personId: string) {
  const client = await dataClient("mentee_profiles");
  if (!client) return { data: null, error: SERVICE_ROLE_REQUIRED };
  const { data, error } = await client.from("mentee_profiles").select("*").eq("person_id", personId).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (mentee_profiles: ${error.message})` };
  return { data: data as MenteeProfile | null, error: null };
}

export async function getSeasonByAuthorizedApplicationSeasonId(seasonId: string) {
  const client = await dataClient("seasons");
  if (!client) return { data: null, error: SERVICE_ROLE_REQUIRED };
  const { data, error } = await client
    .from("seasons")
    .select("id,code,name,program_id")
    .eq("id", seasonId)
    .maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (seasons: ${error.message})` };
  return { data: data as Season | null, error: null };
}

export async function getApplications(scope?: ScopeFilter) {
  if (!scope) return selectAllTable<Application>("applications");
  if (noAllowedRows(scope)) return { data: [] as Application[], error: null };
  const client = await dataClient("applications");
  if (!client) return serviceRoleRequiredError<Application[]>([]);
  const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(scope);
  if (batchScopeError) return { data: [] as Application[], error: batchScopeError };
  const filters: string[] = [];
  if (scope.allowedSeasonIds?.length) filters.push(`season_id.in.(${scope.allowedSeasonIds.join(",")})`);
  if (batchIds?.length) filters.push(`intake_batch_id.in.(${batchIds.join(",")})`);
  if (!filters.length) return { data: [], error: null };
  // Class C. An intake season routinely holds thousands of applications, and
  // this list is the scope gate for reviews, decisions and answers — a
  // truncated read here understates every downstream count.
  const or = filters.join(",");
  const { data, error } = await readAllPages<Application>("applications", "*", (projection) =>
    client.from("applications").select(projection).or(or)
  );
  if (error) {
    logDataError("applications.getApplications", error);
    const err = error as { message?: string };
    return { data: [], error: `${VI_ERROR} (applications: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export async function getMatches(scope?: ScopeFilter) {
  return selectScopedBySeason<Match>("matches", "*", scope);
}

export async function getMatchesForPerson(personId: string, seasonId: string) {
  const client = await dataClient("matches");
  if (!client) return { data: [], error: SERVICE_ROLE_REQUIRED };

  let query = client.from("matches").select("*").or(`mentor_person_id.eq.${personId},mentee_person_id.eq.${personId}`);

  if (seasonId) {
    query = query.eq("season_id", seasonId);
  }

  const { data, error } = await query;
  if (error) {
    logDataError("matches.getMatchesForPerson", error);
    return { data: [], error: `${VI_ERROR} (matches: ${error.message})` };
  }

  return { data: data as Match[], error: null };
}

export async function getPersonByAuthorizedMatchPartnerId(personId: string) {
  const client = await dataClient("people");
  if (!client) return { data: null, error: SERVICE_ROLE_REQUIRED };
  const { data, error } = await client.from("people").select("*").eq("id", personId).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (people: ${error.message})` };
  return { data: data as Person | null, error: null };
}

export async function getEvents(scope?: ScopeFilter) {
  return selectScopedBySeason<Event>("events", "*", scope);
}

export async function getSeasons(scope?: ScopeFilter) {
  if (!hasSeasonScope(scope)) return selectTable<Season>("seasons");
  if (!scope?.allowedSeasonIds?.length) return { data: [] as Season[], error: null };
  // Class C by construction rather than by volume: `id` is the primary key, so
  // the result can never exceed the granted-season list, but that list has no
  // enforced ceiling. Chunk-and-page rather than assume it stays small.
  const { data, error } = await selectInChunks<Season>("seasons", "id", scope.allowedSeasonIds, "id,code,name,program_id");
  if (error) {
    logDataError("seasons.getSeasons", error);
    const err = error as { message?: string };
    return { data: [] as Season[], error: `${VI_ERROR} (seasons: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export async function getIntakeBatches(scope?: ScopeFilter) {
  if (!scope) return selectAllTable<IntakeBatch>("intake_batches", "id,season_id,code,name,is_active");
  const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(scope);
  if (batchScopeError) return { data: [] as IntakeBatch[], error: batchScopeError };
  if (!batchIds?.length) return { data: [] as IntakeBatch[], error: null };
  const { data, error } = await selectInChunks<IntakeBatch>("intake_batches", "id", batchIds, "id,season_id,code,name,is_active");
  if (error) {
    logDataError("intake_batches.getIntakeBatches", error);
    const err = error as { message?: string };
    return { data: [] as IntakeBatch[], error: `${VI_ERROR} (intake_batches: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export async function getPrograms(scope?: ScopeFilter) {
  const programs = await selectAllTable<Program>("programs", "id,code,name,is_active");
  if (!scope?.allowedProgramIds) return programs;
  const allowed = new Set(scope.allowedProgramIds);
  return {
    ...programs,
    data: programs.data.filter((program) => allowed.has(program.id) || allowed.has(program.code))
  };
}

export async function getIndustries() {
  return selectAllTable<Industry>("industries", "id,code,name,is_active");
}

export async function getFunctionAreas() {
  return selectAllTable<FunctionArea>("function_areas", "id,code,name,is_active");
}

export async function getMentorProgramParticipations(mentorProfileIds?: string[]) {
  const result = await selectAllTable<MentorProgramParticipation>(
    "mentor_program_participations",
    "id,mentor_profile_id,program_id,status,role"
  );
  if (!mentorProfileIds) return result;
  const allowed = new Set(mentorProfileIds);
  return { ...result, data: result.data.filter((row) => allowed.has(row.mentor_profile_id)) };
}

export async function getMentorIndustryLinks(mentorProfileIds?: string[]) {
  const result = await selectAllTable<MentorIndustryLink>("mentor_industries", "mentor_profile_id,industry_id");
  if (!mentorProfileIds) return result;
  const allowed = new Set(mentorProfileIds);
  return { ...result, data: result.data.filter((row) => allowed.has(row.mentor_profile_id)) };
}

export async function getMentorFunctionAreaLinks(mentorProfileIds?: string[]) {
  const result = await selectAllTable<MentorFunctionAreaLink>(
    "mentor_function_areas",
    "mentor_profile_id,function_area_id"
  );
  if (!mentorProfileIds) return result;
  const allowed = new Set(mentorProfileIds);
  return { ...result, data: result.data.filter((row) => allowed.has(row.mentor_profile_id)) };
}

/**
 * Class B. `person_roles` holds ~1,300 rows in Production, so the previous
 * whole-table read followed by a JS filter was itself over the row cap: the
 * page could miss the very roles it was looking for. The filter now runs in the
 * database, which bounds the result to one person's roles (a handful, one per
 * season and role type). The JS filter is kept so the returned set is provably
 * identical to before. `readBounded` fails loudly if that bound is ever wrong.
 */
export async function getRolesForPerson(personId: string) {
  const client = await dataClient("person_roles");
  if (!client) return envError<JsonRecord[]>([]);
  const { data, error } = await readBounded<JsonRecord>(
    "person_roles",
    client.from("person_roles").select("*").eq("person_id", personId)
  );
  if (error) {
    if (isNextDynamicUsageError(error)) throw error;
    logDataError("person_roles.getRolesForPerson", error);
    const err = error as { message?: string };
    return { data: [] as JsonRecord[], error: `${VI_ERROR} (person_roles: ${err.message ?? "Bad Request"})` };
  }
  return { data: data.filter((role) => role.person_id === personId), error: null };
}

/**
 * Class C. Not bounded in either direction: `applicationIds` is every
 * application in scope (thousands for an intake season), and each application
 * carries one row per answered question. A single scoped call can therefore
 * return tens of thousands of rows. Chunk the IN list, page every chunk.
 */
export async function getAnswersForApplications(applicationIds: string[]): Promise<QueryResult<JsonRecord[]>> {
  const empty: JsonRecord[] = [];
  if (!applicationIds.length) return { data: empty, error: null };
  const { data, error } = await selectInChunks<JsonRecord>("application_answers", "application_id", applicationIds, "*");
  if (error) {
    logDataError("application_answers.getAnswersForApplications", error);
    const err = error as { message?: string };
    return { data: empty, error: `${VI_ERROR} (application_answers: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

/**
 * Class B. `data_issues` predates this repository and has no `create table` in
 * `supabase_migrations/`, so no ordering key can be proven for it and it is
 * deliberately absent from `PAGE_ORDER` — guessing `id` would raise a
 * PostgREST 400 rather than degrade. It currently has no caller in the app; if
 * one is added and the bound is exceeded, this fails loudly instead of
 * returning a truncated issue list.
 */
export async function getDataIssues() {
  return selectTable<JsonRecord>("data_issues");
}

export async function getPerson(id: string, scope?: ScopeFilter) {
  const { personIds, error: scopeError } = await getScopedPersonIds(scope);
  // Scope could not be evaluated: report it instead of running the person query
  // and returning the same `{ data: null, error: null }` as a genuine miss.
  if (scopeError) return { data: null as Person | null, error: scopeError };
  if (personIds && !personIds.includes(id)) return { data: null, error: null };
  const client = await dataClient();
  if (!client) return envError<Person | null>(null);
  const { data, error } = await client.from("people").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (people: ${error.message})` };
  return { data: data as Person | null, error: null };
}

export async function getApplication(id: string, scope?: ScopeFilter) {
  const client = await dataClient("applications");
  if (!client) return serviceRoleRequiredError<Application | null>(null);
  const { data, error } = await client.from("applications").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (applications: ${error.message})` };
  if (scope && data) {
    if (noAllowedRows(scope)) return { data: null, error: null };
    let isAllowed = false;
    if (scope.allowedSeasonIds?.length && data.season_id && scope.allowedSeasonIds.includes(data.season_id)) {
      isAllowed = true;
    }
    if (!isAllowed) {
      const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(scope);
      if (batchScopeError) return { data: null, error: batchScopeError };
      if (batchIds?.length && data.intake_batch_id && batchIds.includes(data.intake_batch_id)) {
        isAllowed = true;
      }
    }
    if (!isAllowed) return { data: null, error: null };
  }
  return { data: data as Application | null, error: null };
}

export async function getAnswersForApplication(applicationId: string) {
  return getAnswersForApplications([applicationId]);
}

export async function getMatch(id: string, scope?: ScopeFilter) {
  const client = await dataClient();
  if (!client) return envError<Match | null>(null);
  const { data, error } = await client.from("matches").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (matches: ${error.message})` };
  if (scope?.allowedSeasonIds && data?.season_id && !scope.allowedSeasonIds.includes(data.season_id)) {
    return { data: null, error: null };
  }
  return { data: data as Match | null, error: null };
}

/**
 * Class B. One person's recaps across every season they appear in: bounded by
 * (mentees per mentor) x (months per season) x (seasons), which is two orders
 * of magnitude below the row cap. `readBounded` fails loudly rather than
 * truncating if that ever stops holding.
 */
export async function getMentoringRecapsByMenteePersonId(personId: string, scope?: ScopeFilter) {
  const client = await dataClient();
  if (!client) return envError<MentoringRecap[]>([]);
  let query = client
    .from("mentoring_recaps")
    .select("*")
    .eq("mentee_person_id", personId)
    .order("meeting_date", { ascending: false });
  if (scope?.allowedSeasonIds) {
    if (!scope.allowedSeasonIds.length) return { data: [], error: null };
    query = query.in("season_id", scope.allowedSeasonIds);
  }
  const { data, error } = await readBounded<MentoringRecap>("mentoring_recaps", query);
  if (error) {
    logDataError("mentoring_recaps.byMentee", error);
    const err = error as { message?: string };
    return { data: [] as MentoringRecap[], error: `${VI_ERROR} (mentoring_recaps: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export async function getMentoringRecapsByMentorPersonId(personId: string, scope?: ScopeFilter) {
  const client = await dataClient();
  if (!client) return envError<MentoringRecap[]>([]);
  let query = client
    .from("mentoring_recaps")
    .select("*")
    .eq("mentor_person_id", personId)
    .order("meeting_date", { ascending: false });
  if (scope?.allowedSeasonIds) {
    if (!scope.allowedSeasonIds.length) return { data: [], error: null };
    query = query.in("season_id", scope.allowedSeasonIds);
  }
  // Class B — see getMentoringRecapsByMenteePersonId.
  const { data, error } = await readBounded<MentoringRecap>("mentoring_recaps", query);
  if (error) {
    logDataError("mentoring_recaps.byMentor", error);
    const err = error as { message?: string };
    return { data: [] as MentoringRecap[], error: `${VI_ERROR} (mentoring_recaps: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export async function getMentoringRecapById(id: string, scope?: ScopeFilter) {
  const client = await dataClient();
  if (!client) return envError<MentoringRecap | null>(null);
  const { data, error } = await client.from("mentoring_recaps").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (mentoring_recaps: ${error.message})` };
  if (scope?.allowedSeasonIds && data?.season_id && !scope.allowedSeasonIds.includes(data.season_id)) {
    return { data: null, error: null };
  }
  return { data: data as MentoringRecap | null, error: null };
}

export async function getActivityCorrectionLogs(targetTable: "mentoring_recaps" | "event_participations", targetId: string) {
  const client = await dataClient();
  if (!client) return envError<ActivityCorrectionLog[]>([]);
  const { data, error } = await client
    .from("activity_correction_log")
    .select("*")
    .eq("target_table", targetTable)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { data: [], error: `${VI_ERROR} (activity_correction_log: ${error.message})` };
  return { data: (data ?? []) as ActivityCorrectionLog[], error: null };
}

function cleanCorrectionText(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function valueForAudit(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function correctionTypeForField(field: string): ActivityCorrectionLog["correction_type"] {
  if (field === "status") return "status_change";
  if (field === "issue_flag") return "issue_flag_change";
  if (field === "admin_notes") return "admin_note";
  return "update_field";
}

export async function updateMentoringRecapCorrection(input: MentoringRecapCorrectionInput): Promise<QueryResult<MentoringRecap | null>> {
  const client = await dataClient();
  if (!client) return envError<MentoringRecap | null>(null);
  const recapId = String(input.id ?? "").trim();
  if (!recapId) return { data: null, error: "Thiếu recap id." };

  const scopeContext = await getAdminScopeContext();
  const currentScope = await getScopeFilter(scopeContext);
  const current = await getMentoringRecapById(recapId, currentScope);
  if (current.error) return { data: null, error: current.error };
  if (!current.data) return { data: null, error: "Không tìm thấy recap cần sửa." };

  if (!(await canOperateSeason(scopeContext, current.data.season_id))) {
    return { data: null, error: "Ban khong co quyen operations trong mua cua recap nay." };
  }

  const updates: Partial<MentoringRecap> = {};

  if (Object.prototype.hasOwnProperty.call(input, "meeting_date")) {
    const meetingDate = cleanCorrectionText(input.meeting_date);
    if (!meetingDate || !validateDate(meetingDate)) return { data: null, error: "meeting_date phải đúng định dạng YYYY-MM-DD." };
    updates.meeting_date = meetingDate;
    updates.meeting_month = meetingDate.slice(0, 7);
  }

  if (Object.prototype.hasOwnProperty.call(input, "meeting_month") && !Object.prototype.hasOwnProperty.call(input, "meeting_date")) {
    const meetingMonth = cleanCorrectionText(input.meeting_month);
    if (!meetingMonth || !validateMonth(meetingMonth)) return { data: null, error: "meeting_month phải đúng định dạng YYYY-MM." };
    updates.meeting_month = meetingMonth;
  }

  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    const status = cleanCorrectionText(input.status);
    if (!status || !ALLOWED_RECAP_STATUSES.has(status)) return { data: null, error: "status không hợp lệ." };
    updates.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(input, "issue_flag")) {
    if (typeof input.issue_flag !== "boolean") return { data: null, error: "issue_flag phải là boolean." };
    updates.issue_flag = input.issue_flag;
  }

  if (Object.prototype.hasOwnProperty.call(input, "admin_notes")) {
    updates.admin_notes = cleanCorrectionText(input.admin_notes);
  }

  const changedEntries = Object.entries(updates).filter(([field, nextValue]) => valueForAudit(current.data?.[field]) !== valueForAudit(nextValue));
  if (!changedEntries.length) return { data: current.data, error: null };

  const { data: updated, error: updateError } = await client
    .from("mentoring_recaps")
    .update(Object.fromEntries(changedEntries))
    .eq("id", recapId)
    .select("*")
    .maybeSingle();
  if (updateError) return { data: null, error: `${VI_ERROR} (mentoring_recaps update: ${updateError.message})` };

  const reason = cleanCorrectionText(input.reason);
  const correctedBy = cleanCorrectionText(input.corrected_by) ?? "admin";
  const logs = changedEntries.map(([field, nextValue]) => ({
    target_table: "mentoring_recaps",
    target_id: recapId,
    correction_type: correctionTypeForField(field),
    field_name: field,
    old_value: valueForAudit(current.data?.[field]),
    new_value: valueForAudit(nextValue),
    reason,
    corrected_by: correctedBy
  }));

  const { error: logError } = await client.from("activity_correction_log").insert(logs);
  if (logError) return { data: updated as MentoringRecap, error: `${VI_ERROR} (activity_correction_log insert: ${logError.message})` };

  return { data: updated as MentoringRecap, error: null };
}

export async function getEventParticipationsByPersonId(personId: string, scope?: ScopeFilter) {
  const client = await dataClient();
  if (!client) return envError<EventParticipation[]>([]);
  let query = client
    .from("event_participations")
    .select("*")
    .eq("person_id", personId)
    .order("attendance_date", { ascending: false });
  if (scope?.allowedSeasonIds) {
    if (!scope.allowedSeasonIds.length) return { data: [], error: null };
    query = query.in("season_id", scope.allowedSeasonIds);
  }
  // Class B: one person's event participations, bounded by events per season.
  const { data, error } = await readBounded<EventParticipation>("event_participations", query);
  if (error) {
    logDataError("event_participations.byPerson", error);
    const err = error as { message?: string };
    return { data: [] as EventParticipation[], error: `${VI_ERROR} (event_participations: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export async function getOperationalTeamAssignmentsByPerson(personId: string) {
  const client = await dataClient();
  if (!client) return envError<OperationalTeamAssignment[]>([]);
  // Class B: one person's operational assignments.
  const { data, error } = await readBounded<OperationalTeamAssignment>(
    "operational_team_assignments",
    client
      .from("operational_team_assignments")
      .select("id,person_id,source_role_group,operational_role,functional_team,team_name,assigned_scope,role_note,status,notes")
      .eq("person_id", personId)
      .order("source_role_group", { ascending: true })
      .order("functional_team", { ascending: true })
      .order("role_note", { ascending: true })
      .order("operational_role", { ascending: true })
  );
  if (error) {
    logDataError("operational_team_assignments.byPerson", error);
    const err = error as { message?: string };
    return { data: [] as OperationalTeamAssignment[], error: `${VI_ERROR} (operational_team_assignments: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

/**
 * Class C. The scoped branch previously chunked the person list by 500 but
 * never paged a chunk, so it carried the same silent-truncation defect as the
 * `/operations` recap read: one UEHM season resolves ~1,000 people, and a
 * person can hold several assignments, so a single chunk can exceed the cap on
 * its own. Both branches now page.
 */
export async function getOperationalTeamAssignments(scope?: ScopeFilter) {
  const columns = "id,person_id,source_role_group,operational_role,functional_team,team_name,assigned_scope,role_note,status,notes";
  if (!scope) return selectAllTable<OperationalTeamAssignment>("operational_team_assignments", columns);

  const { personIds, error: scopeError } = await getScopedPersonIds(scope);
  if (scopeError) return { data: [] as OperationalTeamAssignment[], error: scopeError };
  if (!personIds?.length) return { data: [] as OperationalTeamAssignment[], error: null };

  const { data, error } = await selectInChunks<OperationalTeamAssignment>(
    "operational_team_assignments",
    "person_id",
    personIds,
    columns
  );
  if (error) {
    logDataError("operational_team_assignments.selectScoped", error);
    const err = error as { message?: string };
    return { data: [] as OperationalTeamAssignment[], error: `${VI_ERROR} (operational_team_assignments: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

async function getOperationsDataFromRpc(seasonCode: string) {
  // This RPC uses SECURITY DEFINER and checks auth.uid() internally.
  // Must be called with the server auth client (user JWT), NOT service role (auth.uid() = NULL there).
  const client = (await getSupabaseServerClient()) ?? supabase;
  if (!client) return null;

  const { data, error } = await client.rpc("get_operations_dashboard_data", { p_season_code: seasonCode });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return null;
    }
    // auth.uid() = NULL inside RPC (session missing or wrong client); fall through to app-layer silently
    if (error.message?.includes("VAM OS admin access required")) return null;
    const empty = { data: [], error: `${VI_ERROR} (get_operations_dashboard_data: ${error.message})` };
    const emptyKpis = { data: null, error: `${VI_ERROR} (get_operations_dashboard_data: ${error.message})` };
    return {
      seasons: empty as QueryResult<Season[]>,
      people: empty as QueryResult<Person[]>,
      mentees: empty as QueryResult<MenteeProfile[]>,
      matches: empty as QueryResult<Match[]>,
      recaps: empty as QueryResult<MentoringRecap[]>,
      events: empty as QueryResult<Event[]>,
      eventParticipations: empty as QueryResult<EventParticipation[]>,
      kpis: emptyKpis as QueryResult<OperationsDashboardKpis | null>,
      latestClosedMonth: { data: [], error: null } as QueryResult<JsonRecord[]>
    };
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const hasExpectedPayloadShape =
    Array.isArray(payload.seasons) &&
    Array.isArray(payload.people) &&
    Array.isArray(payload.mentees) &&
    Array.isArray(payload.matches) &&
    Array.isArray(payload.recaps) &&
    Array.isArray(payload.events) &&
    Array.isArray(payload.eventParticipations);

  if (!hasExpectedPayloadShape) {
    return null;
  }

  const seasons = (payload.seasons ?? []) as Season[];
  const matches = (payload.matches ?? []) as Match[];
  const recaps = (payload.recaps ?? []) as MentoringRecap[];
  const events = (payload.events ?? []) as Event[];
  const eventParticipations = (payload.eventParticipations ?? []) as EventParticipation[];
  const kpis = (payload.kpis ?? computeProgramOperationsKpis({ seasons, matches, recaps, events, eventParticipations, seasonCode })) as OperationsDashboardKpis;
  const { data: latestClosedMonth, error: latestClosedMonthError } = await selectTable<JsonRecord>("v_season_latest_closed_month");
  return {
    seasons: { data: seasons, error: null },
    people: { data: (payload.people ?? []) as Person[], error: null },
    mentees: { data: (payload.mentees ?? []) as MenteeProfile[], error: null },
    matches: { data: matches, error: null },
    recaps: { data: recaps, error: null },
    events: { data: events, error: null },
    eventParticipations: { data: eventParticipations, error: null },
    kpis: { data: kpis, error: null },
    latestClosedMonth: { data: latestClosedMonth, error: latestClosedMonthError }
  };
}

import { OPS_RECAPS_SELECT } from "./data-selects";
export { OPS_RECAPS_SELECT };

export async function getOperationsData(
  scope?: ScopeFilter,
  seasonCode = SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE
) {
  const rpcData = scope ? null : await getOperationsDataFromRpc(seasonCode);
  if (rpcData) return rpcData;

  const [
    seasons,
    people,
    mentees,
    matches,
    recaps,
    events,
    eventParticipations,
    latestClosedMonth
  ] = await Promise.all([
    getSeasons(scope),
    getPeople(scope).then((res) => ({ ...res, data: res.data.map((row) => ({ id: row.id, full_name: row.full_name, email_primary: row.email_primary }) as Person) })),
    getMenteeProfiles(scope).then((res) => ({ ...res, data: res.data.map((row) => ({ id: row.id, person_id: row.person_id, mentee_code: row.mentee_code }) as MenteeProfile) })),
    selectScopedBySeason<Match>("matches", "id,season_id,status,match_type,mentor_person_id,mentee_person_id", scope),
    selectScopedBySeason<MentoringRecap>(
      "mentoring_recaps",
      OPS_RECAPS_SELECT,
      scope
    ),
    selectScopedBySeason<Event>("events", "id,legacy_event_temp_id,season_id,event_name,event_type,starts_at,source_notes", scope),
    selectScopedBySeason<EventParticipation>("event_participations", "id,event_id,season_id,person_id,role_at_event,registration_status,attendance_status,attendance_date,recap_url,excuse_reason,admin_notes,captured_by,walk_in", scope),
    selectTable<JsonRecord>("v_season_latest_closed_month")
  ]);

  return {
    seasons,
    people,
    mentees,
    matches,
    recaps,
    events,
    eventParticipations,
    kpis: {
      data: computeProgramOperationsKpis({
        seasons: seasons.data,
        matches: matches.data,
        recaps: recaps.data,
        events: events.data,
        eventParticipations: eventParticipations.data,
        seasonCode
      }),
      error: seasons.error || matches.error || recaps.error || events.error || eventParticipations.error
    },
    latestClosedMonth
  };
}

export async function getOperationsWorkflowData(seasonCode = SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE, selectedMonth?: string | null): Promise<QueryResult<OperationsWorkflowData | null>> {
  const client = await dataClient();
  if (!client) return envError<OperationsWorkflowData | null>(null);
  const { data, error } = await client.rpc("get_operations_workflow_data", {
    p_season_code: seasonCode,
    p_selected_month: selectedMonth ?? null
  });
  if (error) return { data: null, error: `${VI_ERROR} (get_operations_workflow_data: ${error.message})` };
  return { data: data as OperationsWorkflowData, error: null };
}

export async function getFounderIntelligenceDashboard(seasonCode = SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE, scope?: ScopeFilter): Promise<QueryResult<FounderIntelligenceDashboard | null>> {
  if (scope) {
    return getFounderIntelligenceDashboardFallback(seasonCode, scope);
  }
  const client = await dataClient();
  if (!client) return envError<FounderIntelligenceDashboard | null>(null);
  const { data, error } = await client.rpc("get_founder_intelligence_dashboard", {
    p_season_code: seasonCode
  });
  if (error) {
    if (!isNextDynamicUsageError(error)) {
      logDataError("get_founder_intelligence_dashboard rpc failed; using raw-read fallback", error);
    }
    return getFounderIntelligenceDashboardFallback(seasonCode);
  }
  return { data: data as FounderIntelligenceDashboard, error: null };
}

function groupRowsByCount<T extends JsonRecord>(rows: T[], key: keyof T, fallback: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[key] ?? "").trim() || fallback;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "vi"));
}

function mentorExperienceBand(value: unknown) {
  const years = Number(value ?? 0);
  if (!Number.isFinite(years) || years <= 0) return "Unknown";
  if (years <= 3) return "0-3 years";
  if (years <= 7) return "4-7 years";
  if (years <= 12) return "8-12 years";
  return "13+ years";
}

async function getFounderIntelligenceDashboardFallback(seasonCode: string, scope?: ScopeFilter): Promise<QueryResult<FounderIntelligenceDashboard | null>> {
  const [seasons, people, mentors, mentees, matches, recaps] = await Promise.all([
    getSeasons(scope),
    getPeople(scope).then((res) => ({ ...res, data: res.data.map((row) => ({ id: row.id, full_name: row.full_name, email_primary: row.email_primary }) as Person) })),
    getMentorProfiles(scope).then((res) => ({ ...res, data: res.data.map((row) => ({ id: row.id, person_id: row.person_id, mentor_code: row.mentor_code, company_current: row.company_current, title_current: row.title_current, years_experience_min: row.years_experience_min, industry: row.industry, function_area: row.function_area }) as MentorProfile) })),
    getMenteeProfiles(scope).then((res) => ({ ...res, data: res.data.map((row) => ({ id: row.id, person_id: row.person_id, mentee_code: row.mentee_code, school_code: row.school_code, school_raw: row.school_raw, major: row.major }) as MenteeProfile) })),
    selectScopedBySeason<Match>("matches", "id,season_id,status,mentor_person_id,mentee_person_id", scope),
    selectScopedBySeason<MentoringRecap>("mentoring_recaps", "id,season_id,mentor_person_id,mentee_person_id,meeting_month,status", scope)
  ]);
  const errors = [seasons.error, people.error, mentors.error, mentees.error, matches.error, recaps.error].filter(Boolean);
  if (errors.length) return { data: null, error: null };

  const peopleById = keyById(people.data);
  const season = seasons.data.find((row) => row.code === seasonCode);
  if (scope && !season) return { data: null, error: null };
  const fallbackSeasonId = (() => {
    const counts = new Map<string, number>();
    for (const row of [...matches.data, ...recaps.data]) {
      if (!row.season_id) continue;
      counts.set(row.season_id, (counts.get(row.season_id) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  })();
  const seasonId = season?.id ?? fallbackSeasonId;
  const seasonMatches = matches.data.filter((row) => (seasonId ? row.season_id === seasonId : true));
  const activeMatches = seasonMatches.filter((row) => normalizeStatus(row.status) === "active" && row.mentor_person_id && row.mentee_person_id);
  const seasonRecaps = recaps.data.filter((row) => (seasonId ? row.season_id === seasonId : true));
  const nowVN = currentMonthVN();
  const validRecaps = seasonRecaps.filter(isValidRecapActivity);
  const selectedMonth =
    validRecaps
      .map((row) => String(row.meeting_month ?? ""))
      .filter((month) => isOperationalMonth(month, nowVN))
      .sort()
      .filter((month) => month < nowVN)
      .at(-1) ??
    validRecaps
      .map((row) => String(row.meeting_month ?? ""))
      .filter((month) => isOperationalMonth(month, nowVN))
      .sort()
      .at(-1) ??
    nowVN;
  const selectedRecaps = validRecaps.filter((row) => row.meeting_month === selectedMonth);
  const selectedMenteeIds = new Set(selectedRecaps.map((row) => row.mentee_person_id).filter(Boolean));
  const activeMentorIds = new Set(activeMatches.map((row) => row.mentor_person_id).filter(Boolean));
  const activeMenteeIds = new Set(activeMatches.map((row) => row.mentee_person_id).filter(Boolean));

  const menteeCountByMentor = new Map<string, number>();
  for (const match of activeMatches) {
    if (!match.mentor_person_id) continue;
    menteeCountByMentor.set(match.mentor_person_id, (menteeCountByMentor.get(match.mentor_person_id) ?? 0) + 1);
  }
  const topMentors = mentors.data
    .map((mentor) => {
      const person = mentor.person_id ? peopleById.get(mentor.person_id) : undefined;
      return {
        mentorId: mentor.person_id,
        mentorName: person?.full_name ?? person?.email_primary ?? mentor.mentor_code ?? "Unknown",
        currentCompany: mentor.company_current ?? "Unknown",
        currentTitle: mentor.title_current ?? "Unknown",
        menteeCount: mentor.person_id ? menteeCountByMentor.get(mentor.person_id) ?? 0 : 0,
        capacityTarget: 4,
        recapCountCurrentMonth: selectedRecaps.filter((recap) => recap.mentor_person_id === mentor.person_id).length
      };
    })
    .filter((row) => row.menteeCount > 0)
    .sort((a, b) => b.menteeCount - a.menteeCount || String(a.mentorName).localeCompare(String(b.mentorName), "vi"))
    .slice(0, 20);

  const mentorCapacityDistribution = groupRowsByCount(
    mentors.data.map((mentor) => {
      const count = mentor.person_id ? menteeCountByMentor.get(mentor.person_id) ?? 0 : 0;
      const bucket = count === 0 ? "0 mentee" : count === 1 ? "1 mentee" : count === 2 ? "2 mentees" : count === 3 ? "3 mentees" : "4+ mentees";
      return { bucket };
    }),
    "bucket",
    "Unknown"
  ).map((row) => ({ bucket: row.name, count: row.count }));
  const menteeSchoolDistribution = groupRowsByCount(
    mentees.data.map((mentee) => ({ school: mentee.school_code || mentee.school_raw || "Unknown" })),
    "school",
    "Unknown"
  ).map((row) => ({ school: row.name, count: row.count }));
  const mentorCompanyDistribution = groupRowsByCount(
    mentors.data.map((mentor) => ({ company: mentor.company_current || "Unknown" })),
    "company",
    "Unknown"
  ).slice(0, 20).map((row) => ({ company: row.name, count: row.count }));
  const byMajor = groupRowsByCount(
    mentees.data.map((mentee) => ({ major: mentee.major || "Unknown" })),
    "major",
    "Unknown"
  ).map((row) => ({ major: row.name, count: row.count }));
  const byUniversity = menteeSchoolDistribution.map((row) => ({ university: row.school, count: row.count }));
  const byExperienceBand = groupRowsByCount(
    mentors.data.map((mentor) => ({ band: mentorExperienceBand(mentor.years_experience_min) })),
    "band",
    "Unknown"
  ).map((row) => ({ band: row.name, count: row.count }));
  const byIndustry = groupRowsByCount(
    mentors.data.map((mentor) => ({ industry: mentor.industry || "Chưa rõ" })),
    "industry",
    "Chưa rõ"
  ).map((row) => ({ industry: row.name, count: row.count }));
  const byFunction = groupRowsByCount(
    mentors.data.map((mentor) => ({ functionArea: mentor.function_area || "Chưa rõ" })),
    "functionArea",
    "Chưa rõ"
  ).map((row) => ({ functionArea: row.name, count: row.count }));
  const silentMentees = Array.from(activeMenteeIds).filter((id) => !selectedMenteeIds.has(id)).length;

  const data: FounderIntelligenceDashboard = {
    season_code: seasonCode,
    season_id: seasonId,
    selected_month: selectedMonth,
    total_mentors: mentors.data.length,
    total_mentees: mentees.data.length,
    active_matches: activeMatches.length,
    mentor_capacity_distribution: mentorCapacityDistribution,
    mentee_school_distribution: menteeSchoolDistribution,
    mentor_company_distribution: mentorCompanyDistribution,
    match_health_summary: {
      activeMatches: activeMatches.length,
      activeMentors: activeMentorIds.size,
      activeMentees: activeMenteeIds.size,
      silentMentees,
      recapsInSelectedMonth: selectedRecaps.length
    },
    top_mentors_by_mentee_count: topMentors,
    data_quality_flags: [
      { key: "season_row_missing", count: season ? 0 : 1 },
      { key: "recap_missing_mentee", count: seasonRecaps.filter((row) => !row.mentee_person_id).length },
      { key: "recap_missing_mentor", count: seasonRecaps.filter((row) => !row.mentor_person_id).length }
    ],
    definitions: {
      selectedMonth,
      activeMentor: "Mentor with at least one active match in selected season.",
      silentMentee: "Mentee with an active match and no valid recap in selected month.",
      overloadedMentor: "Mentor with 4+ active mentees, until explicit capacity fields are available.",
      validRecapStatuses: ["submitted", "needs_review", ""]
    },
    mentorProfile: {
      totalMentors: mentors.data.length,
      activeMentors: activeMentorIds.size,
      inactiveMentors: Math.max(0, mentors.data.length - activeMentorIds.size),
      byIndustry,
      byFunction,
      byExperienceBand,
      byVamSeniority: [],
      bySeniorityLevel: [],
      overloadedMentors: topMentors.filter((row) => row.menteeCount >= 4).map((row) => ({ ...row, industry: "Unknown" })),
      inactiveMentorsWithMentees: []
    },
    menteeProfile: {
      totalMentees: mentees.data.length,
      activeMentees: activeMenteeIds.size,
      silentMentees,
      byMajor,
      byUniversity,
      byCareerInterest: [],
      byTargetIndustry: [],
      byYearOfStudy: [],
      bySupportTeam: []
    },
    matchingIntelligence: {
      totalActiveMatches: activeMatches.length,
      mentorMenteeRatio: activeMenteeIds.size ? `${(activeMentorIds.size / activeMenteeIds.size).toFixed(2)}:1` : "0:0",
      matchesByIndustryAlignment: [],
      matchesByFunctionAlignment: [],
      unmatchedOrWeakSegments: [],
      menteesWithoutIndustryMentor: 0,
      mentorSupplyVsMenteeDemand: []
    },
    activityBySegment: {
      activeMenteeRateByMajor: [],
      recapRateBySupportTeam: [],
      activeMentorRateByIndustry: [],
      silentMenteeByCareerInterest: []
    },
    recommendedActions: []
  };

  return { data, error: null };
}

export type CreateActionItemInput = {
  season_code?: string;
  action_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  title: string;
  description?: string | null;
  priority?: string | null;
  owner_admin_user_id?: string | null;
  due_date?: string | null;
  source?: string | null;
  metadata?: JsonRecord | null;
};

export async function createWorkflowActionItem(input: CreateActionItemInput): Promise<QueryResult<JsonRecord | null>> {
  const client = await dataClient();
  if (!client) return envError<JsonRecord | null>(null);
  const seasonCode = (await resolveSeasonContext(input.season_code)).selectedSeasonCode;
  const { data, error } = await client.rpc("create_action_item", {
    p_season_code: seasonCode,
    p_action_type: input.action_type,
    p_entity_type: input.entity_type ?? null,
    p_entity_id: input.entity_id || null,
    p_title: input.title,
    p_description: input.description ?? null,
    p_priority: input.priority ?? "medium",
    p_owner_admin_user_id: input.owner_admin_user_id || null,
    p_due_date: input.due_date || null,
    p_source: input.source ?? "manual",
    p_metadata: input.metadata ?? {}
  });
  if (error) return { data: null, error: `${VI_ERROR} (create_action_item: ${error.message})` };
  return { data: data as JsonRecord, error: null };
}

export async function updateWorkflowActionItem(input: {
  id: string;
  status?: string | null;
  owner_admin_user_id?: string | null;
  priority?: string | null;
  due_date?: string | null;
  description?: string | null;
  metadata?: JsonRecord | null;
}): Promise<QueryResult<JsonRecord | null>> {
  const client = await dataClient();
  if (!client) return envError<JsonRecord | null>(null);
  const { data, error } = await client.rpc("update_action_item", {
    p_action_item_id: input.id,
    p_status: input.status ?? null,
    p_owner_admin_user_id: input.owner_admin_user_id || null,
    p_priority: input.priority ?? null,
    p_due_date: input.due_date || null,
    p_description: input.description ?? null,
    p_metadata: input.metadata ?? null
  });
  if (error) return { data: null, error: `${VI_ERROR} (update_action_item: ${error.message})` };
  return { data: data as JsonRecord, error: null };
}

export async function addWorkflowActionItemComment(input: { id: string; comment_text: string }): Promise<QueryResult<JsonRecord | null>> {
  const client = await dataClient();
  if (!client) return envError<JsonRecord | null>(null);
  const { data, error } = await client.rpc("add_action_item_comment", {
    p_action_item_id: input.id,
    p_comment_text: input.comment_text
  });
  if (error) return { data: null, error: `${VI_ERROR} (add_action_item_comment: ${error.message})` };
  return { data: data as JsonRecord, error: null };
}

export async function generateMonthlyFollowupActions(input: { season_code?: string; selected_month: string }): Promise<QueryResult<JsonRecord | null>> {
  const client = await dataClient();
  if (!client) return envError<JsonRecord | null>(null);
  const seasonCode = (await resolveSeasonContext(input.season_code)).selectedSeasonCode;
  const { data, error } = await client.rpc("generate_monthly_followup_actions", {
    p_season_code: seasonCode,
    p_selected_month: input.selected_month
  });
  if (error) return { data: null, error: `${VI_ERROR} (generate_monthly_followup_actions: ${error.message})` };
  return { data: data as JsonRecord, error: null };
}

export async function getDashboardData(scope?: ScopeFilter) {
  // Use exact count queries for KPI cards to avoid Supabase default 1000-row limit.
  const [
    people,
    mentors,
    mentees,
    applications,
    matches,
    seasons,
    recaps,
    latestClosedMonth
  ] = await Promise.all([
    getPeople(scope).then((res) => ({ ...res, data: res.data.map((row) => ({ id: row.id, full_name: row.full_name, email_primary: row.email_primary, phone_primary: row.phone_primary }) as Person) })),
    getMentorProfiles(scope).then((res) => ({ ...res, data: res.data.map((row) => ({ id: row.id, person_id: row.person_id, mentor_code: row.mentor_code, bio_url: row.bio_url, company_current: row.company_current, title_current: row.title_current }) as MentorProfile) })),
    getMenteeProfiles(scope).then((res) => ({ ...res, data: res.data.map((row) => ({ id: row.id, person_id: row.person_id, mentee_code: row.mentee_code, school_code: row.school_code }) as MenteeProfile) })),
    getApplications(scope).then((res) => ({ data: res.data.map((row) => ({ id: row.id, final_status: row.final_status }) as Application), error: null })),
    selectScopedBySeason<Match>("matches", "id,season_id,status,mentor_person_id,mentee_person_id", scope),
    getSeasons(scope),
    selectScopedBySeason<MentoringRecap>("mentoring_recaps", "id,season_id,mentor_person_id,mentee_person_id,meeting_month,meeting_date,status", scope),
    selectTable<JsonRecord>("v_season_latest_closed_month")
  ]);
  const duplicateEmails = { data: getDuplicateEmailCountFromRows(people.data), error: people.error };
  const activeMissing = {
    data: matches.data.filter((match) => normalizeStatus(match.status) === "active" && (!match.mentor_person_id || !match.mentee_person_id)).length,
    error: matches.error
  };

  return {
    people,
    mentors,
    mentees,
    applications,
    matches,
    seasons,
    recaps,
    counts: {
      people: { data: people.data.length, error: people.error },
      mentors: { data: mentors.data.length, error: mentors.error },
      mentees: { data: mentees.data.length, error: mentees.error },
      applications: { data: applications.data.length, error: applications.error },
      matches: { data: matches.data.length, error: matches.error },
      activeMatches: { data: matches.data.filter((match) => normalizeStatus(match.status) === "active").length, error: matches.error }
    },
    duplicateEmails,
    activeMissing,
    latestClosedMonth
  };
}

/** Aggregate-only dashboard payload for roles that must not receive People/CRM PII. */
export async function getRestrictedDashboardSummary(scope?: ScopeFilter) {
  const [seasons, matches, applications] = await Promise.all([
    getSeasons(scope),
    selectScopedBySeason<Match>("matches", "id,season_id,status", scope),
    selectScopedBySeason<Application>("applications", "id,season_id,status,final_status", scope)
  ]);
  return {
    seasonCount: seasons.data.length,
    matchCount: matches.data.length,
    activeMatchCount: matches.data.filter((row) => normalizeStatus(row.status) === "active").length,
    applicationCount: applications.data.length,
    error: seasons.error || matches.error || applications.error
  };
}

async function getDuplicateEmailCount(scope?: ScopeFilter) {
  const people = await getPeople(scope);
  if (people.error) return { data: 0, error: people.error };
  return { data: getDuplicateEmailCountFromRows(people.data), error: null };
}

function getDuplicateEmailCountFromRows(people: Person[]) {
  const counts = new Map<string, number>();
  for (const person of people) {
    const email = String(person.email_primary ?? "").trim().toLowerCase();
    if (email) counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  return Array.from(counts.values()).filter((count) => count > 1).length;
}

export function keyById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

// ----------------------------------------------------------------
// Application review data fetchers
// ----------------------------------------------------------------

export async function getApplicationReviewsForApplication(applicationId: string, scope?: ScopeFilter): Promise<QueryResult<ApplicationReview[]>> {
  // server-only table: service-role or nothing
  const client = await dataClient("application_reviews");
  if (!client) return serviceRoleRequiredError<ApplicationReview[]>([]);
  if (scope) {
    const app = await getApplication(applicationId, scope);
    if (app.error || !app.data) return { data: [], error: app.error };
  }
  // Class B: review rounds per application are bounded by the workflow.
  const { data, error } = await readBounded<ApplicationReview>(
    "application_reviews",
    client.from("application_reviews").select("*").eq("application_id", applicationId).order("created_at", { ascending: false })
  );
  if (error) {
    logDataError("application_reviews.forApplication", error);
    const err = error as { message?: string };
    return { data: [] as ApplicationReview[], error: `${VI_ERROR} (application_reviews: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

/**
 * Reviews assigned to a specific admin user — used for reviewer's /reviews page.
 *
 * Class C. The scoped branch filters by every application in scope, which is
 * thousands of IDs for an intake season, so the IN list must be chunked and
 * each chunk paged. `due_at` ordering is not unique and cannot drive paging;
 * it is reapplied in JS over the complete set so the rendered order is
 * unchanged.
 */
export async function getMyApplicationReviews(adminUserId: string, scope?: ScopeFilter): Promise<QueryResult<ApplicationReview[]>> {
  const client = await dataClient("application_reviews");
  if (!client) return serviceRoleRequiredError<ApplicationReview[]>([]);
  const mine = (query: any) => query.eq("reviewer_admin_user_id", adminUserId).neq("status", "cancelled");

  let result: { data: ApplicationReview[]; error: unknown | null };
  if (scope) {
    const apps = await getApplications(scope);
    const appIds = apps.data.map((app) => app.id);
    if (!appIds.length) return { data: [], error: apps.error };
    result = await selectInChunks<ApplicationReview>("application_reviews", "application_id", appIds, "*", mine);
  } else {
    result = await readAllPages<ApplicationReview>("application_reviews", "*", (projection) =>
      mine(client.from("application_reviews").select(projection))
    );
  }
  if (result.error) {
    logDataError("application_reviews.mine", result.error);
    const err = result.error as { message?: string };
    return { data: [] as ApplicationReview[], error: `${VI_ERROR} (application_reviews: ${err.message ?? "Bad Request"})` };
  }
  return { data: sortByDueAtAscending(result.data), error: null };
}

/**
 * Preserves the `.order("due_at", { ascending: true })` the paged read replaces,
 * including PostgreSQL's NULLS LAST for an ascending sort, with `id` as a
 * deterministic tiebreaker.
 */
function sortByDueAtAscending(rows: ApplicationReview[]) {
  return [...rows].sort((a, b) => {
    const left = (a as JsonRecord).due_at ?? null;
    const right = (b as JsonRecord).due_at ?? null;
    if (left === null && right === null) return String(a.id).localeCompare(String(b.id));
    if (left === null) return 1;
    if (right === null) return -1;
    return String(left).localeCompare(String(right)) || String(a.id).localeCompare(String(b.id));
  });
}

/** All reviews — used for admin/core_team /reviews page (RLS allows this). */
export async function getAllApplicationReviews(scope?: ScopeFilter): Promise<QueryResult<ApplicationReview[]>> {
  if (!scope) return selectAllTable<ApplicationReview>("application_reviews", "*");
  const apps = await getApplications(scope);
  const appIds = apps.data.map((app) => app.id);
  if (!appIds.length) return { data: [], error: apps.error };
  // Class C: one row per (application, reviewer, round) across the intake.
  // `selectInChunks` resolves its own client and fails closed when the
  // service-role credential for this server-only table is absent.
  const { data, error } = await selectInChunks<ApplicationReview>("application_reviews", "application_id", appIds, "*");
  if (error) {
    logDataError("application_reviews.all", error);
    const err = error as { message?: string };
    return { data: [], error: `${VI_ERROR} (application_reviews: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: apps.error };
}

export async function getApplicationReviewById(
  id: string,
  scope: ScopeFilter | undefined,
  reviewerAdminUserId: string | null
): Promise<QueryResult<ApplicationReview | null>> {
  const client = await dataClient("application_reviews");
  if (!client) return serviceRoleRequiredError<ApplicationReview | null>(null);
  let query = client
    .from("application_reviews")
    .select("*")
    .eq("id", id);
  // H3 fix: a reviewer's own identity constraint must also exclude
  // cancelled assignments — otherwise a cancelled/reassigned reviewer can
  // still open their old review URL by ID. Submitted reviews are
  // unaffected (status 'submitted' !== 'cancelled'), so read-only access
  // to the reviewer's own review history is preserved.
  if (reviewerAdminUserId) {
    query = query.eq("reviewer_admin_user_id", reviewerAdminUserId).neq("status", "cancelled");
  }
  const { data, error } = await query.maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (application_reviews: ${error.message})` };
  if (scope && data?.application_id) {
    const app = await getApplication(data.application_id as string, scope);
    if (app.error || !app.data) return { data: null, error: app.error };
  }
  return { data: data as ApplicationReview | null, error: null };
}

/**
 * Returns all active admin_users for the assign-reviewer dropdown.
 * Must use service-role client because admin_users RLS restricts each
 * user to reading only their own row.
 */
export async function getActiveAdminUsers(): Promise<QueryResult<AdminUserPublic[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<AdminUserPublic[]>([]);
  // Class B: staff accounts, two orders of magnitude below the row cap.
  const { data, error } = await readBounded<AdminUserPublic>(
    "admin_users",
    client.from("admin_users").select("id,email,full_name,role").eq("status", "active").order("full_name", { ascending: true })
  );
  if (error) {
    logDataError("admin_users.active", error);
    const err = error as { message?: string };
    return { data: [] as AdminUserPublic[], error: `${VI_ERROR} (admin_users: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

/** All admin decisions recorded against an application, newest first. */
export async function getApplicationDecisions(
  applicationId: string,
  scope?: ScopeFilter
): Promise<QueryResult<ApplicationDecision[]>> {
  const client = await dataClient("application_decisions");
  if (!client) return serviceRoleRequiredError<ApplicationDecision[]>([]);
  if (scope) {
    const app = await getApplication(applicationId, scope);
    if (app.error || !app.data) return { data: [], error: app.error };
  }
  // Class B: decisions recorded against one application.
  const { data, error } = await readBounded<ApplicationDecision>(
    "application_decisions",
    client.from("application_decisions").select("*").eq("application_id", applicationId).order("created_at", { ascending: false })
  );
  if (error) {
    logDataError("application_decisions.forApplication", error);
    const err = error as { message?: string };
    return { data: [] as ApplicationDecision[], error: `${VI_ERROR} (application_decisions: ${err.message ?? "Bad Request"})` };
  }
  return { data, error: null };
}

export function groupCount(rows: JsonRecord[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[key] ?? "Chưa có dữ liệu");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}

// ----------------------------------------------------------------
// Phase 044a — Bulk-assignment data fetchers (service-role only)
// ----------------------------------------------------------------

/**
 * Applications eligible for bulk profile-screening assignment.
 * Optionally filtered by intake batch and/or role applied.
 * Returns each app enriched with a count of existing non-cancelled
 * profile_screening review rows so the UI can show "already assigned" state.
 * Uses service-role client to bypass RLS on admin_users / application_reviews.
 */
export async function getReviewAssignableApplications(filters: {
  intakeBatchId?: string | null;
  roleApplied?: string | null;
  reviewRound?: "profile_screening" | "interview";
  scope?: ScopeFilter;
}): Promise<QueryResult<ReviewAssignableApplication[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewAssignableApplication[]>([]);

  // Class C: an intake batch holds thousands of applications. Filters are
  // captured in a factory so every page carries exactly the same predicate.
  let narrow: (query: any) => any = (query) => query;
  if (filters.intakeBatchId) {
    const { batchIds: scopedBatchIds, error: batchScopeError } = await getScopedIntakeBatchIds(filters.scope);
    if (batchScopeError) return { data: [], error: batchScopeError };
    if (scopedBatchIds && !scopedBatchIds.includes(filters.intakeBatchId)) {
      return { data: [], error: null };
    }
    const batchId = filters.intakeBatchId;
    narrow = (query) => query.eq("intake_batch_id", batchId);
  } else if (filters.scope?.allowedSeasonIds) {
    const seasonIds = filters.scope.allowedSeasonIds;
    if (!seasonIds.length) return { data: [], error: null };
    narrow = (query) => query.in("season_id", seasonIds);
  }
  if (filters.roleApplied) {
    const roleApplied = filters.roleApplied;
    const previous = narrow;
    narrow = (query) => previous(query).eq("role_applied", roleApplied);
  }

  const { data: pagedApps, error: appsErr } = await readAllPages<JsonRecord>(
    "applications",
    "id,full_name,email_primary,role_applied,status,submitted_at,intake_batch_id,season_id",
    (projection) => narrow(client.from("applications").select(projection))
  );
  if (appsErr) {
    logDataError("getReviewAssignableApplications.apps", appsErr);
    const err = appsErr as { message?: string };
    return { data: [], error: `${VI_ERROR} (applications: ${err.message ?? "Bad Request"})` };
  }

  const appList = (pagedApps as unknown as {
    id: string;
    full_name: string | null;
    email_primary: string | null;
    role_applied: string | null;
    status: string | null;
    submitted_at: string | null;
    intake_batch_id: string | null;
  }[])
    // Restores the `.order("submitted_at").order("id")` the paged read replaces.
    .sort((a, b) => String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")) || String(a.id).localeCompare(String(b.id)));

  const appIds = appList.map((a) => a.id);
  const reviewRound = filters.reviewRound ?? "profile_screening";
  
  // Fetch ALL reviews for these applications to evaluate needs_more_review provenance
  // and active assignments for the target round.
  // Argument order is (table, filterColumn, values, projection). Swapping the
  // last two silently projects only `application_id`, so `status` and
  // `review_round` come back undefined, every application reports
  // existing_review_count = 0, and the UI offers rows the database has already
  // assigned. __tests__/manual-bulk-assignment-data.test.ts pins this.
  const { data: reviewRows, error: reviewErr } = await selectInChunks<JsonRecord>(
    "application_reviews",
    "application_id",
    appIds,
    "application_id,reviewer_admin_user_id,status,review_round"
  );
  if (reviewErr) {
    logDataError("getReviewAssignableApplications.reviews", reviewErr);
    const err = reviewErr as { message?: string };
    return { data: [], error: `${VI_ERROR} (application_reviews: ${err.message ?? "Bad Request"})` };
  }

  const reviewCountByAppId = new Map<string, number>();
  const reviewerIdByAppId = new Map<string, string>();
  const hasAnyInterviewByAppId = new Set<string>();

  for (const row of reviewRows) {
    const id = row.application_id as string | null;
    const revId = row.reviewer_admin_user_id as string | null;
    const round = row.review_round as string | null;
    const status = row.status as string | null;
    
    if (id) {
      // Any interview row (even cancelled) counts for needs_more_review provenance
      if (round === "interview") {
        hasAnyInterviewByAppId.add(id);
      }
      
      // Active assignments for the TARGET round disable the checkbox
      if (round === reviewRound && status !== "cancelled") {
        reviewCountByAppId.set(id, (reviewCountByAppId.get(id) ?? 0) + 1);
        if (revId) reviewerIdByAppId.set(id, revId);
      }
    }
  }

  const validApps = appList.filter((a) => {
    return isApplicationReviewAssignable({
      status: a.status,
      reviewRound,
      hasAnyInterviewReview: hasAnyInterviewByAppId.has(a.id)
    });
  });

  const data: ReviewAssignableApplication[] = validApps.map((a) => ({
    ...a,
    existing_review_count: reviewCountByAppId.get(a.id) ?? 0,
    existing_reviewer_id: reviewerIdByAppId.get(a.id) ?? null
  }));

  return { data, error: null };
}

/**
 * Admin users eligible to be assigned as reviewers, enriched with their
 * current active profile_screening workload count.
 * Uses service-role client because admin_users RLS restricts row visibility.
 */
export async function getReviewEligibleReviewers(
  seasonId: string,
  reviewRound: "profile_screening" | "interview"
): Promise<QueryResult<ReviewEligibleReviewer[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewEligibleReviewer[]>([]);

  // Class B: staff accounts.
  const { data: adminRows, error: adminErr } = await client.rpc(
    "vam084_list_recruitment_participants",
    { p_season_id: seasonId, p_review_stage: reviewRound }
  );

  if (adminErr) {
    logDataError("getReviewEligibleReviewers.admin_users", adminErr);
    const err = adminErr as { message?: string };
    return { data: [], error: `${VI_ERROR} (admin_users: ${err.message ?? "Bad Request"})` };
  }

  const reviewers = (adminRows as unknown as {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
  }[]);

  if (!reviewers.length) return { data: [], error: null };

  // Class C: total profile-screening reviews across all reviewers scales with
  // the intake, so this read exceeds the cap well before the reviewer list does.
  const reviewerIds = reviewers.map((r) => r.id);
  const { data: workloadRows, error: workloadErr } = await selectInChunks<JsonRecord>(
    "application_reviews",
    "reviewer_admin_user_id",
    reviewerIds,
    "reviewer_admin_user_id",
    (query) => query.eq("review_round", reviewRound).neq("status", "cancelled")
  );
  if (workloadErr) {
    logDataError("getReviewEligibleReviewers.workload", workloadErr);
    const err = workloadErr as { message?: string };
    return { data: [], error: `${VI_ERROR} (application_reviews: ${err.message ?? "Bad Request"})` };
  }

  const workloadById = new Map<string, number>();
  for (const row of workloadRows) {
    const id = row.reviewer_admin_user_id as string | null;
    if (id) workloadById.set(id, (workloadById.get(id) ?? 0) + 1);
  }

  const data: ReviewEligibleReviewer[] = reviewers.map((r) => ({
    ...r,
    current_workload: workloadById.get(r.id) ?? 0
  }));

  return { data, error: null };
}

/**
 * Audit log of all bulk-assignment batch operations, newest first.
 * Used in the assignment history panel.
 */
export async function getReviewAssignmentBatches(): Promise<QueryResult<ReviewAssignmentBatch[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewAssignmentBatch[]>([]);

  // Class C: one row per bulk-assignment operation, unbounded over time.
  // `created_at` is not unique, so paging keys on `id` and the newest-first
  // order the panel renders is reapplied over the complete set.
  const { data, error } = await readAllPages<ReviewAssignmentBatch>("review_assignment_batches", "*", (projection) =>
    client.from("review_assignment_batches").select(projection)
  );

  if (error) {
    logDataError("getReviewAssignmentBatches", error);
    const err = error as { message?: string };
    return { data: [], error: `${VI_ERROR} (review_assignment_batches: ${err.message ?? "Bad Request"})` };
  }

  const rows = [...data].sort(
    (a, b) =>
      String((b as JsonRecord).created_at ?? "").localeCompare(String((a as JsonRecord).created_at ?? "")) ||
      String(b.id).localeCompare(String(a.id))
  );
  return { data: rows, error: null };
}

/**
 * Per-reviewer review progress, optionally scoped to one intake batch and/or
 * review round (defaults to profile_screening).
 *
 * Three-query pattern:
 *   1. If intakeBatchId is provided, fetch matching app IDs from applications.
 *   2. Fetch application_reviews rows (filtered by round + optional app IDs).
 *   3. Fetch reviewer names/emails from admin_users.
 * Counts are aggregated in JS.
 *
 * Column semantics:
 *   assigned_count  — total review rows for this reviewer (all statuses)
 *   pending_count   — status = 'assigned' (not yet opened)
 *   in_progress_count — status = 'in_progress'
 *   submitted_count — status = 'submitted'
 *   cancelled_count — status = 'cancelled'
 */
export async function getReviewAssignmentProgress(filters: {
  intakeBatchId?: string | null;
  reviewRound?: string | null;
  scope?: ScopeFilter;
}): Promise<QueryResult<ReviewProgressRow[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewProgressRow[]>([]);

  const reviewRound = filters.reviewRound?.trim() || "profile_screening";

  // Step 1: resolve app IDs if batch filter is active
  let appIdFilter: string[] | null = null;
  if (filters.intakeBatchId) {
    const { batchIds: scopedBatchIds, error: batchScopeError } = await getScopedIntakeBatchIds(filters.scope);
    if (batchScopeError) return { data: [], error: batchScopeError };
    if (scopedBatchIds && !scopedBatchIds.includes(filters.intakeBatchId)) {
      return { data: [], error: null };
    }
    // Class C: every application in one intake batch.
    const batchId = filters.intakeBatchId;
    const { data: appRows, error: appErr } = await readAllPages<JsonRecord>("applications", "id", (projection) =>
      client.from("applications").select(projection).eq("intake_batch_id", batchId)
    );
    if (appErr) {
      logDataError("getReviewAssignmentProgress.apps", appErr);
      const err = appErr as { message?: string };
      return { data: [], error: `${VI_ERROR} (applications: ${err.message ?? "Bad Request"})` };
    }
    appIdFilter = appRows.map((a) => a.id as string);
    if (!appIdFilter.length) return { data: [], error: null };
  } else if (filters.scope) {
    const apps = await getApplications(filters.scope);
    if (apps.error || !apps.data.length) return { data: [], error: apps.error };
    appIdFilter = apps.data.map((app) => app.id);
  }

  // Step 2: fetch review rows. Class C — one row per (application, reviewer)
  // for the round, which is a multiple of the intake size.
  const forRound = (query: any) => query.eq("review_round", reviewRound);
  const reviewsColumns = "reviewer_admin_user_id,status,submitted_at,application_id";
  const { data: reviewRows, error: reviewErr } = appIdFilter
    ? await selectInChunks<JsonRecord>("application_reviews", "application_id", appIdFilter, reviewsColumns, forRound)
    : await readAllPages<JsonRecord>("application_reviews", reviewsColumns, (projection) =>
        forRound(client.from("application_reviews").select(projection))
      );
  if (reviewErr) {
    logDataError("getReviewAssignmentProgress.reviews", reviewErr);
    const err = reviewErr as { message?: string };
    return { data: [], error: `${VI_ERROR} (application_reviews: ${err.message ?? "Bad Request"})` };
  }

  const reviews = (reviewRows as unknown as {
    reviewer_admin_user_id: string | null;
    status: string;
    submitted_at: string | null;
    application_id: string;
  }[]);

  if (!reviews.length) return { data: [], error: null };

  // Step 3: fetch reviewer names and emails. Class A — `id` is the primary key,
  // so the result cannot exceed the reviewer list, which `admin_users` bounds.
  const reviewerIds = Array.from(
    new Set(reviews.map((r) => r.reviewer_admin_user_id).filter((id): id is string => Boolean(id)))
  );

  const { data: adminRows, error: adminErr } = await selectInChunks<JsonRecord>(
    "admin_users",
    "id",
    reviewerIds,
    "id,full_name,email"
  );
  if (adminErr) {
    logDataError("getReviewAssignmentProgress.admin_users", adminErr);
    const err = adminErr as { message?: string };
    return { data: [], error: `${VI_ERROR} (admin_users: ${err.message ?? "Bad Request"})` };
  }

  const nameById = new Map<string, string | null>(
    adminRows.map((r) => [r.id as string, (r.full_name as string | null) ?? null])
  );
  const emailById = new Map<string, string | null>(
    adminRows.map((r) => [r.id as string, (r.email as string | null) ?? null])
  );

  // Aggregate counts per reviewer
  type Stats = {
    assigned_count: number;
    submitted_count: number;
    in_progress_count: number;
    pending_count: number;
    cancelled_count: number;
    latest_submitted_at: string | null;
  };

  const statsMap = new Map<string, Stats>();

  for (const review of reviews) {
    const id = review.reviewer_admin_user_id ?? "__unassigned__";
    if (!statsMap.has(id)) {
      statsMap.set(id, {
        assigned_count: 0,
        submitted_count: 0,
        in_progress_count: 0,
        pending_count: 0,
        cancelled_count: 0,
        latest_submitted_at: null
      });
    }
    const stats = statsMap.get(id)!;
    stats.assigned_count += 1;
    const s = (review.status ?? "").toLowerCase();
    if (s === "submitted") {
      stats.submitted_count += 1;
      if (!stats.latest_submitted_at || (review.submitted_at && review.submitted_at > stats.latest_submitted_at)) {
        stats.latest_submitted_at = review.submitted_at;
      }
    } else if (s === "in_progress") {
      stats.in_progress_count += 1;
    } else if (s === "assigned") {
      stats.pending_count += 1;
    } else if (s === "cancelled") {
      stats.cancelled_count += 1;
    }
  }

  const data: ReviewProgressRow[] = Array.from(statsMap.entries())
    .map(([id, stats]) => {
      const realId = id === "__unassigned__" ? null : id;
      return {
        reviewer_admin_user_id: realId,
        reviewer_name: realId ? (nameById.get(realId) ?? null) : null,
        reviewer_email: realId ? (emailById.get(realId) ?? null) : null,
        ...stats
      };
    })
    .sort((a, b) => {
      const nameA = a.reviewer_name ?? a.reviewer_email ?? "";
      const nameB = b.reviewer_name ?? b.reviewer_email ?? "";
      return nameA.localeCompare(nameB, "vi");
    });

  return { data, error: null };
}

// ----------------------------------------------------------------
// Phase 044A-2 — Reviewer pool fetcher (service-role)
// ----------------------------------------------------------------

/**
 * All mentor profiles enriched with their current reviewer/admin account status.
 *
 * Three-query pattern:
 *   1. mentor_profiles (id, person_id, mentor_code, intake_batch_id)
 *   2. people (id, full_name, email_primary) — only those linked to mentors
 *   3. admin_users (id, email, role, status) — full set, joined in JS by email
 *
 * Optionally filtered by intake_batch_id for scoping to one season.
 * Rows without email_primary are excluded (cannot create an account without email).
 */
export async function getReviewerPool(filters?: {
  intakeBatchId?: string | null;
  scope?: ScopeFilter;
}): Promise<QueryResult<ReviewerPoolRow[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewerPoolRow[]>([]);

  // --- Query 1: mentor profiles (conditionally filtered)
  // Class C: Production holds well over a thousand mentor profiles, so the
  // unfiltered pool read was already past the cap. Filters live in a factory so
  // every page carries the same predicate.
  let narrow: (query: any) => any = (query) => query.not("person_id", "is", null);

  if (filters?.intakeBatchId) {
    const { batchIds: scopedBatchIds, error: batchScopeError } = await getScopedIntakeBatchIds(filters.scope);
    if (batchScopeError) return { data: [], error: batchScopeError };
    if (scopedBatchIds && !scopedBatchIds.includes(filters.intakeBatchId)) {
      return { data: [], error: null };
    }
    const batchId = filters.intakeBatchId;
    narrow = (query) => query.not("person_id", "is", null).eq("intake_batch_id", batchId);
  } else {
    const { batchIds: scopedBatchIds, error: batchScopeError } = await getScopedIntakeBatchIds(filters?.scope);
    if (batchScopeError) return { data: [], error: batchScopeError };
    if (scopedBatchIds) {
      if (!scopedBatchIds.length) return { data: [], error: null };
      narrow = (query) => query.not("person_id", "is", null).in("intake_batch_id", scopedBatchIds);
    }
  }

  const [mentorRes, adminRes] = await Promise.all([
    readAllPages<JsonRecord>("mentor_profiles", "id,person_id,mentor_code,intake_batch_id", (projection) =>
      narrow(client.from("mentor_profiles").select(projection))
    ),
    // Class B: staff accounts.
    readBounded<JsonRecord>("admin_users", client.from("admin_users").select("id,email,full_name,role,status,auth_user_id"))
  ]);

  if (mentorRes.error) {
    logDataError("getReviewerPool.mentor_profiles", mentorRes.error);
    const err = mentorRes.error as { message?: string };
    return { data: [], error: `${VI_ERROR} (mentor_profiles: ${err.message ?? "Bad Request"})` };
  }
  if (adminRes.error) {
    logDataError("getReviewerPool.admin_users", adminRes.error);
    const err = adminRes.error as { message?: string };
    return { data: [], error: `${VI_ERROR} (admin_users: ${err.message ?? "Bad Request"})` };
  }

  const mentors = (mentorRes.data as unknown as {
    id: string;
    person_id: string | null;
    mentor_code: string | null;
    intake_batch_id: string | null;
  }[])
    // Restores the `.order("id")` the paged read subsumes.
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  if (!mentors.length) return { data: [], error: null };

  // --- Query 2: people (only linked person_ids)
  // Class C: one person id per mentor profile, so this list tracks Query 1.
  const personIds = Array.from(
    new Set(mentors.map((m) => m.person_id).filter((id): id is string => Boolean(id)))
  );

  const eligibleAdminRoles = new Set(["core_team", "admin", "super_admin", "reviewer"]);
  // Active-account policy: only an ACTIVE staff account may be surfaced as a
  // grantable Reviewer/Interviewer candidate. An inactive (suspended) account
  // must never be offered for a recruitment-participation grant.
  const isEligibleAdmin = (a: JsonRecord) =>
    eligibleAdminRoles.has(String(a.role)) && String(a.status ?? "").trim().toLowerCase() === "active";
  const eligibleAdminEmails = Array.from(
    new Set(
      adminRes.data
        .filter(isEligibleAdmin)
        .map((a) => String((a as any).email ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );

  const [peopleByIdRes, peopleByEmailRes] = await Promise.all([
    selectInChunks<JsonRecord>(
      "people",
      "id",
      personIds,
      "id,full_name,email_primary"
    ),
    selectInChunks<JsonRecord>(
      "people",
      "email_primary",
      eligibleAdminEmails,
      "id,full_name,email_primary"
    )
  ]);

  if (peopleByIdRes.error) {
    logDataError("getReviewerPool.people_by_id", peopleByIdRes.error);
    const err = peopleByIdRes.error as { message?: string };
    return { data: [], error: `${VI_ERROR} (people: ${err.message ?? "Bad Request"})` };
  }
  if (peopleByEmailRes.error) {
    logDataError("getReviewerPool.people_by_email", peopleByEmailRes.error);
    const err = peopleByEmailRes.error as { message?: string };
    return { data: [], error: `${VI_ERROR} (people: ${err.message ?? "Bad Request"})` };
  }

  const allPeopleRows = [...peopleByIdRes.data, ...peopleByEmailRes.data];

  const peopleById = new Map<string, { id: string; full_name: string | null; email_primary: string | null }>();
  const peopleByEmailPrimary = new Map<string, string>(); // normalized email -> person_id

  for (const p of allPeopleRows) {
    const id = p.id as string;
    const email = String((p as any).email_primary ?? "").trim().toLowerCase();
    peopleById.set(id, p as unknown as { id: string; full_name: string | null; email_primary: string | null });
    if (email) peopleByEmailPrimary.set(email, id);
  }


  // --- Build email → admin_user map from Query 3
  const adminByEmail = new Map(
    adminRes.data.map((a) => [
      String((a as { email?: string }).email ?? "").toLowerCase(),
      a as unknown as { id: string; email: string; role: string | null; status: string | null; auth_user_id: string | null }
    ])
  );

  // --- Join and return
  const processedPersonIds = new Set<string>();

  const rows: ReviewerPoolRow[] = mentors
    .map((mentor) => {
      if (mentor.person_id) processedPersonIds.add(mentor.person_id);
      const person = mentor.person_id ? peopleById.get(mentor.person_id) : undefined;
      const email = String(person?.email_primary ?? "").trim().toLowerCase();
      const adminUser = email ? adminByEmail.get(email) : undefined;
      const displayName = staffDisplayName({
        peopleFullName: person?.full_name,
        adminFullName: (adminUser as JsonRecord | undefined)?.full_name as string | undefined,
        email: person?.email_primary
      });
      return {
        mentor_profile_id: mentor.id,
        person_id: mentor.person_id,
        full_name: displayName || null,
        email_primary: person?.email_primary ?? null,
        mentor_code: mentor.mentor_code,
        intake_batch_id: mentor.intake_batch_id,
        admin_user_id: adminUser?.id ?? null,
        admin_user_role: adminUser?.role ?? null,
        admin_user_status: adminUser?.status ?? null
      };
    })
    .filter((row) => Boolean(row.email_primary));

  // Append eligible admin_users who resolve to a people row by email
  // but were not already included via mentor_profiles.
  for (const adminUser of adminRes.data) {
    if (!isEligibleAdmin(adminUser)) continue;
    
    const email = String((adminUser as any).email ?? "").trim().toLowerCase();
    if (!email) continue;
    
    const personId = peopleByEmailPrimary.get(email);
    if (!personId || processedPersonIds.has(personId)) continue;
    
    processedPersonIds.add(personId);
    const person = peopleById.get(personId);
    
    rows.push({
      mentor_profile_id: null,
      person_id: personId,
      full_name:
        staffDisplayName({
          peopleFullName: person?.full_name,
          adminFullName: (adminUser as JsonRecord).full_name as string | undefined,
          email: person?.email_primary ?? (adminUser as JsonRecord).email as string | undefined
        }) || null,
      email_primary: person?.email_primary ?? null,
      mentor_code: null,
      intake_batch_id: null,
      admin_user_id: adminUser.id as string,
      admin_user_role: adminUser.role as string,
      admin_user_status: adminUser.status as string
    });
  }

  return { data: rows, error: null };
}

// ----------------------------------------------------------------
// Phase 044B — Interview candidates fetcher (service-role)
// ----------------------------------------------------------------

/** Application statuses that make a candidate eligible to be interviewed. */
const INTERVIEW_POOL_STATUSES = [
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress",
  "interview_completed",
  "ready_for_final_decision",
  "needs_more_review"
] as const;

/**
 * Applications that are in an interview-eligible status, enriched with their
 * first active (non-cancelled) interview review row.
 *
 * Two-query pattern:
 *   1. applications filtered by status + optional intakeBatchId/roleApplied.
 *   2. application_reviews (interview round, non-cancelled) for those app IDs.
 * Merged in JS: interview review attached to each row.
 *
 * Defaults: roleApplied = "mentee", includeCompleted = true.
 */
export async function getInterviewCandidates(filters?: {
  intakeBatchId?: string | null;
  roleApplied?: string | null;
  includeCompleted?: boolean;
  scope?: ScopeFilter;
  actor: { role: string | null; adminUserId: string };
}): Promise<QueryResult<InterviewCandidateRow[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<InterviewCandidateRow[]>([]);

  // Status set — optionally exclude interview_completed
  const statuses =
    filters?.includeCompleted === false
      ? (INTERVIEW_POOL_STATUSES.slice(0, 3) as unknown as string[])
      : (INTERVIEW_POOL_STATUSES as unknown as string[]);

  // Class C: an interview pool spans a whole intake batch.
  let narrow: (query: any) => any = (query) => query.in("status", statuses);

  if (filters?.intakeBatchId) {
    const { batchIds: scopedBatchIds, error: batchScopeError } = await getScopedIntakeBatchIds(filters.scope);
    if (batchScopeError) return { data: [], error: batchScopeError };
    if (scopedBatchIds && !scopedBatchIds.includes(filters.intakeBatchId)) {
      return { data: [], error: null };
    }
    const batchId = filters.intakeBatchId;
    narrow = (query) => query.in("status", statuses).eq("intake_batch_id", batchId);
  } else if (filters?.scope) {
    const { batchIds: scopedBatchIds, error: batchScopeError } = await getScopedIntakeBatchIds(filters.scope);
    if (batchScopeError) return { data: [], error: batchScopeError };
    if (!scopedBatchIds?.length) return { data: [], error: null };
    narrow = (query) => query.in("status", statuses).in("intake_batch_id", scopedBatchIds);
  }

  // Default to mentee unless explicitly overridden
  const roleApplied = filters?.roleApplied ?? "mentee";
  const byStatusAndBatch = narrow;
  narrow = (query) => byStatusAndBatch(query).eq("role_applied", roleApplied);

  const reviewerQueue = filters?.actor.role === "reviewer";
  const applicationProjection = reviewerQueue
    ? "id,full_name,status,intake_batch_id,role_applied,sbd,submitted_at"
    : "id,full_name,email_primary,phone_primary,status,intake_batch_id,role_applied,sbd,submitted_at";
  const { data: appRows, error: appsErr } = await readAllPages<JsonRecord>(
    "applications",
    applicationProjection,
    (projection) => narrow(client.from("applications").select(projection))
  );
  if (appsErr) {
    logDataError("getInterviewCandidates.applications", appsErr);
    const err = appsErr as { message?: string };
    return { data: [], error: `${VI_ERROR} (applications: ${err.message ?? "Bad Request"})` };
  }

  const appList = (appRows as unknown as {
    id: string;
    full_name: string | null;
    email_primary?: string | null;
    phone_primary?: string | null;
    status: string | null;
    intake_batch_id: string | null;
    role_applied: string | null;
    sbd: string | null;
    submitted_at: string | null;
  }[])
    // Restores the `.order("submitted_at").order("id")` the paged read replaces.
    .sort((a, b) => String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")) || String(a.id).localeCompare(String(b.id)));

  if (!appList.length) return { data: [], error: null };

  // Fetch active interview reviews for these applications. Class C.
  const appIds = appList.map((a) => a.id);
  const { data: reviewRows, error: reviewErr } = await selectInChunks<JsonRecord>(
    "application_reviews",
    "application_id",
    appIds,
    "id,application_id,status,reviewer_admin_user_id,created_at",
    (query) => query.eq("review_round", "interview").neq("status", "cancelled")
  );
  if (reviewErr) {
    logDataError("getInterviewCandidates.reviews", reviewErr);
    const err = reviewErr as { message?: string };
    return { data: [], error: `${VI_ERROR} (application_reviews: ${err.message ?? "Bad Request"})` };
  }

  // Oldest first → the same consistent "primary" review the `.order("created_at")`
  // used to pick, now applied over the complete paged set. `id` breaks ties so
  // the choice is deterministic rather than dependent on arrival order.
  const orderedReviews = [...reviewRows].sort(
    (a, b) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id))
  );

  // Map application_id → first active interview review
  const reviewByAppId = new Map<
    string,
    { id: string; status: string; reviewer_admin_user_id: string | null }
  >();
  for (const row of orderedReviews) {
    const appId = row.application_id as string;
    if (!reviewByAppId.has(appId)) {
      reviewByAppId.set(appId, {
        id: String(row.id),
        status: String(row.status ?? ""),
        reviewer_admin_user_id: (row.reviewer_admin_user_id as string | null) ?? null
      });
    }
  }

  // A reviewer receives contact details only after ownership exists. The
  // unowned queue query above never selects contact or private application
  // data, so those fields cannot accidentally cross the server/client boundary.
  const ownedReviewByAppId = new Map<string, { id: string; status: string; reviewer_admin_user_id: string | null }>();
  if (reviewerQueue) {
    for (const row of orderedReviews) {
      if (row.reviewer_admin_user_id !== filters?.actor.adminUserId) continue;
      const appId = String(row.application_id);
      if (!ownedReviewByAppId.has(appId)) {
        ownedReviewByAppId.set(appId, {
          id: String(row.id),
          status: String(row.status ?? ""),
          reviewer_admin_user_id: filters.actor.adminUserId
        });
      }
    }
  }

  const ownedAppIds = Array.from(ownedReviewByAppId.keys());
  const ownedContacts = reviewerQueue && ownedAppIds.length
    ? await selectInChunks<JsonRecord>(
        "applications",
        "id",
        ownedAppIds,
        "id,email_primary,phone_primary"
      )
    : { data: [] as JsonRecord[], error: null };
  if (ownedContacts.error) {
    logDataError("getInterviewCandidates.ownedContacts", ownedContacts.error);
    const err = ownedContacts.error as { message?: string };
    return { data: [], error: `${VI_ERROR} (applications: ${err.message ?? "Bad Request"})` };
  }
  const contactByAppId = new Map(ownedContacts.data.map((row) => [String(row.id), row]));

  const visibleApps = reviewerQueue
    ? appList.filter((application) => ownedReviewByAppId.has(application.id))
    : appList;
  const data: InterviewCandidateRow[] = visibleApps.map((a) => {
    const activeReview = reviewByAppId.get(a.id) ?? null;
    const ownedReview = ownedReviewByAppId.get(a.id) ?? null;
    const review = reviewerQueue ? ownedReview : activeReview;
    const contact = contactByAppId.get(a.id);
    return {
      ...a,
      ...(contact
        ? {
            email_primary: (contact.email_primary as string | null) ?? null,
            phone_primary: (contact.phone_primary as string | null) ?? null
          }
        : {}),
      has_active_interview_review: Boolean(activeReview || ownedReview),
      interview_review_id: review?.id ?? null,
      interview_review_status: review?.status ?? null,
      interview_reviewer_admin_user_id: review?.reviewer_admin_user_id ?? null
    };
  });

  return { data, error: null };
}

export async function getS12ApplicationReviewQueue(options: {
  scope: ScopeFilter | undefined;
  role: "mentor" | "mentee";
  page: number;
  pageSize: number;
  search?: string;
}): Promise<{ data: Application[]; count: number; error: string | null }> {
  const { scope, role, page, pageSize, search } = options;
  const client = await dataClient("applications");
  if (!client) return { data: [], count: 0, error: SERVICE_ROLE_REQUIRED };

  // Resolve current S12 season UUID
  const { data: targetSeason, error: seasonError } = await client
    .from("seasons")
    .select("id, code")
    .eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE)
    .maybeSingle();

  if (seasonError) return { data: [], count: 0, error: `${VI_ERROR} (seasons: ${seasonError.message})` };
  if (!targetSeason) return { data: [], count: 0, error: "Missing S12 season configuration" };
  const s12SeasonId = targetSeason.id;

  // Bounded projection containing only required fields for list rendering & detail links
  const projection = "id, person_id, season_id, intake_batch_id, full_name, email_primary, role_applied, status, final_status, sbd, submitted_at, consent_data_storage, consent_pdpa, source";

  let query = client.from("applications").select(projection, { count: "exact" })
    .eq("role_applied", role)
    .eq("status", "submitted")
    .eq("season_id", s12SeasonId)
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false }); // deterministic tie-breaker

  if (search) {
    const trimmed = search.trim();
    // Safely check if it's a UUID before sanitization strips hyphens (though we don't strip hyphens here).
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    
    // Sanitize search string for safe PostgREST embedding.
    // Commas, parentheses, and quotes are reserved in PostgREST filter syntax.
    // Percent and underscore are SQL wildcards which we strip to prevent arbitrary wildcard searches.
    const sanitized = trimmed.replace(/[,()"'%_]/g, " ").replace(/\s+/g, " ").trim();
    
    if (sanitized || isUUID) {
      const searchFilter = [];
      if (sanitized) {
        searchFilter.push(`full_name.ilike.%${sanitized}%`);
        searchFilter.push(`email_primary.ilike.%${sanitized}%`);
        searchFilter.push(`sbd.ilike.%${sanitized}%`);
      }
      if (isUUID) {
        searchFilter.push(`id.eq.${trimmed}`); // Use exact raw trimmed for UUID
      }
      if (searchFilter.length > 0) {
        query = query.or(searchFilter.join(","));
      }
    }
  }

  if (scope) {
    if (noAllowedRows(scope)) return { data: [], count: 0, error: null };
    const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(scope);
    if (batchScopeError) return { data: [], count: 0, error: batchScopeError };

    const filters: string[] = [];
    if (scope.allowedSeasonIds?.length) filters.push(`season_id.in.(${scope.allowedSeasonIds.join(",")})`);
    if (batchIds?.length) filters.push(`intake_batch_id.in.(${batchIds.join(",")})`);
    
    if (filters.length > 0) {
      query = query.or(filters.join(","));
    } else {
      return { data: [], count: 0, error: null };
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    logDataError("applications.getS12ApplicationReviewQueue", error);
    return { data: [], count: 0, error: `${VI_ERROR} (applications: ${error.message})` };
  }

  return { data: data as Application[], count: count ?? 0, error: null };
}

export async function classifyS12Mentors(
  applications: Pick<Application, "id" | "person_id" | "email_primary">[]
): Promise<Map<string, "Mentor cũ quay lại" | "Mentor mới" | "Chưa xác định">> {
  const result = new Map<string, "Mentor cũ quay lại" | "Mentor mới" | "Chưa xác định">();
  if (!applications || applications.length === 0) return result;

  const client = await dataClient("people");
  if (!client) return result;

  const appIdsWithPerson = applications.filter((a) => a.person_id).map((a) => a.person_id as string);
  const nullPersonEmails = applications
    .filter((a) => !a.person_id && a.email_primary)
    .map((a) => String(a.email_primary).trim().toLowerCase());

  let people: Pick<Person, "id" | "email_primary">[] = [];
  let peopleQueryFailed = false;
  if (nullPersonEmails.length > 0) {
    const { data: pData, error: pError } = await client
      .from("people")
      .select("id, email_primary")
      .in("email_primary", nullPersonEmails);
    if (pError) peopleQueryFailed = true;
    if (pData) people = pData;
  }

  // Gather all person_ids we care about
  const allPersonIds = new Set<string>(appIdsWithPerson);
  for (const p of people) {
    if (p.id) allPersonIds.add(p.id);
  }

  let profiles: Pick<MentorProfile, "person_id" | "source_application_id">[] = [];
  let profilesQueryFailed = false;
  if (allPersonIds.size > 0) {
    const { data: profData, error: profError } = await client
      .from("mentor_profiles")
      .select("person_id, source_application_id")
      .in("person_id", Array.from(allPersonIds));
    if (profError) profilesQueryFailed = true;
    if (profData) profiles = profData;
  }

  return evaluateMentorClassifications(applications, people, profiles, peopleQueryFailed, profilesQueryFailed);
}
