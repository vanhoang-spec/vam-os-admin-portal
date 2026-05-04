import { supabase } from "@/lib/supabase";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
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

const ALLOWED_RECAP_STATUSES = new Set(["submitted", "needs_review", "invalid", "duplicate"]);

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

export function envError<T>(fallback: T): QueryResult<T> {
  return {
    data: fallback,
    error: "Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local."
  };
}

function dataClient() {
  return getSupabaseServerClient() ?? supabase;
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

const OPERATIONAL_MONTH_START = "2025-10";
const OPERATIONAL_MONTH_END = "2026-06";
const VALID_ACTIVITY_STATUSES = new Set(["", "submitted", "needs_review"]);

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function monthDate(month: string) {
  return new Date(`${month}-01T00:00:00Z`);
}

function addMonths(month: string, delta: number) {
  const date = monthDate(month);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

function operationalMonths() {
  const months: string[] = [];
  for (let month = OPERATIONAL_MONTH_START; month <= OPERATIONAL_MONTH_END; month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthFromDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 7);
}

function isOperationalMonth(month: unknown) {
  const value = String(month ?? "").trim();
  return /^\d{4}-\d{2}$/.test(value) && value >= OPERATIONAL_MONTH_START && value <= OPERATIONAL_MONTH_END;
}

function isValidRecapActivity(recap: MentoringRecap) {
  return VALID_ACTIVITY_STATUSES.has(normalizeStatus(recap.status));
}

function computeOperationsDashboardKpis(input: {
  seasons: Season[];
  matches: Match[];
  recaps: MentoringRecap[];
  events: Event[];
  eventParticipations: EventParticipation[];
  seasonCode?: string;
}): OperationsDashboardKpis {
  const validRecaps = input.recaps.filter(isValidRecapActivity);
  const seasonMonths = operationalMonths();
  const validOperationalRecaps = validRecaps.filter((recap) => isOperationalMonth(recap.meeting_month));
  const validEventMonths = input.events.map((event) => monthFromDate(event.starts_at)).filter((month): month is string => isOperationalMonth(month));
  const monthsWithOperationalData = new Set([
    ...validOperationalRecaps.map((recap) => recap.meeting_month).filter((month): month is string => Boolean(month)),
    ...validEventMonths
  ]);
  const availableMonths = seasonMonths.filter((month) => monthsWithOperationalData.has(month)).sort((a, b) => b.localeCompare(a));
  const nowMonth = currentMonth();
  const latestNonFutureMonth = availableMonths.find((month) => month <= nowMonth);
  const currentOperationalMonth = isOperationalMonth(nowMonth) ? nowMonth : null;
  const selectedMonth = latestNonFutureMonth ?? currentOperationalMonth ?? availableMonths[0] ?? OPERATIONAL_MONTH_START;
  const previousMonth = addMonths(selectedMonth, -1);
  const season = input.seasons.find((row) => row.code === (input.seasonCode ?? "UEHM-S11"));

  const activeMatches = input.matches.filter((match) => {
    if (normalizeStatus(match.status) !== "active") return false;
    if (season?.id) return match.season_id === season.id;
    return true;
  });
  const activeMatchesWithPeople = activeMatches.filter((match) => match.mentor_person_id && match.mentee_person_id);
  const activeMenteeIds = new Set(activeMatchesWithPeople.map((match) => match.mentee_person_id).filter(Boolean));
  const activeMentorIds = new Set(activeMatchesWithPeople.map((match) => match.mentor_person_id).filter(Boolean));

  const selectedRecaps = validRecaps.filter((recap) => recap.meeting_month === selectedMonth);
  const previousRecaps = validRecaps.filter((recap) => recap.meeting_month === previousMonth);
  const selectedMenteeIds = new Set(selectedRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));
  const selectedMentorIds = new Set(selectedRecaps.map((recap) => recap.mentor_person_id).filter(Boolean));
  const previousMenteeIds = new Set(previousRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));

  const eventsInMonth = input.events.filter((event) => monthFromDate(event.starts_at) === selectedMonth);
  const eventIdsInMonth = new Set(eventsInMonth.map((event) => event.id));
  const eventParticipationsInMonth = input.eventParticipations.filter((row) => row.event_id && eventIdsInMonth.has(row.event_id));

  return {
    selectedMonth,
    recapCount: selectedRecaps.length,
    activeMenteeCount: selectedMenteeIds.size,
    activeMentorCount: selectedMentorIds.size,
    mentorWithoutRecapCount: Array.from(activeMentorIds).filter((id) => !selectedMentorIds.has(id)).length,
    eventTrainingCount: eventsInMonth.length,
    eventAttendanceCount: eventParticipationsInMonth.filter((row) => normalizeStatus(row.attendance_status) === "attended").length,
    followUpCount: Array.from(activeMenteeIds).filter((id) => !selectedMenteeIds.has(id) && !previousMenteeIds.has(id)).length
  };
}

async function selectTable<T>(table: string, columns = "*", fallback: T[] = []): Promise<QueryResult<T[]>> {
  const client = dataClient();
  if (!client) return envError(fallback);
  const { data, error } = await client.from(table).select(columns);
  if (error) {
    if (isNextDynamicUsageError(error)) throw error;
    logDataError(`${table}.select`, error);
    return { data: fallback, error: `${VI_ERROR} (${table}: ${error.message})` };
  }
  return { data: (data ?? []) as T[], error: null };
}

async function selectAllTable<T>(table: string, columns = "*", fallback: T[] = [], pageSize = 1000): Promise<QueryResult<T[]>> {
  const client = dataClient();
  if (!client) return envError(fallback);
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from(table).select(columns).range(from, to);
    if (error) {
      if (isNextDynamicUsageError(error)) throw error;
      logDataError(`${table}.selectAll`, error);
      return { data: rows.length ? rows : fallback, error: `${VI_ERROR} (${table}: ${error.message})` };
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows, error: null };
}

export async function selectAllRows<T>(table: string, columns = "*", fallback: T[] = []) {
  return selectAllTable<T>(table, columns, fallback);
}

async function countTable(table: string, filter?: (query: any) => any): Promise<QueryResult<number>> {
  const client = dataClient();
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

export async function getPeople() {
  return selectAllTable<Person>("people");
}

export async function getMentorProfiles() {
  return selectTable<MentorProfile>("mentor_profiles");
}

export async function getMenteeProfiles() {
  return selectTable<MenteeProfile>("mentee_profiles");
}

export async function getApplications() {
  return selectAllTable<Application>("applications");
}

export async function getMatches() {
  return selectTable<Match>("matches");
}

export async function getEvents() {
  return selectTable<Event>("events");
}

export async function getSeasons() {
  return selectTable<Season>("seasons");
}

export async function getIntakeBatches() {
  return selectAllTable<IntakeBatch>("intake_batches", "id,season_id,code,name,is_active");
}

export async function getPrograms() {
  return selectAllTable<Program>("programs", "id,code,name,is_active");
}

export async function getIndustries() {
  return selectAllTable<Industry>("industries", "id,code,name,is_active");
}

export async function getFunctionAreas() {
  return selectAllTable<FunctionArea>("function_areas", "id,code,name,is_active");
}

export async function getMentorProgramParticipations() {
  return selectAllTable<MentorProgramParticipation>(
    "mentor_program_participations",
    "id,mentor_profile_id,program_id,status,role"
  );
}

export async function getMentorIndustryLinks() {
  return selectAllTable<MentorIndustryLink>("mentor_industries", "mentor_profile_id,industry_id");
}

export async function getMentorFunctionAreaLinks() {
  return selectAllTable<MentorFunctionAreaLink>(
    "mentor_function_areas",
    "mentor_profile_id,function_area_id"
  );
}

export async function getRolesForPerson(personId: string) {
  return selectTable<JsonRecord>("person_roles", "*").then((res) => ({
    ...res,
    data: res.data.filter((role) => role.person_id === personId)
  }));
}

export async function getAnswersForApplications(applicationIds: string[]) {
  const empty: JsonRecord[] = [];
  if (!applicationIds.length) return { data: empty, error: null };
  const client = dataClient();
  if (!client) return envError(empty);
  const { data, error } = await client.from("application_answers").select("*").in("application_id", applicationIds);
  if (error) return { data: empty, error: `${VI_ERROR} (application_answers: ${error.message})` };
  return { data: data ?? empty, error: null };
}

export async function getDataIssues() {
  return selectTable<JsonRecord>("data_issues");
}

export async function getPerson(id: string) {
  const client = dataClient();
  if (!client) return envError<Person | null>(null);
  const { data, error } = await client.from("people").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (people: ${error.message})` };
  return { data: data as Person | null, error: null };
}

export async function getApplication(id: string) {
  const client = dataClient();
  if (!client) return envError<Application | null>(null);
  const { data, error } = await client.from("applications").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (applications: ${error.message})` };
  return { data: data as Application | null, error: null };
}

export async function getAnswersForApplication(applicationId: string) {
  return getAnswersForApplications([applicationId]);
}

export async function getMatch(id: string) {
  const client = dataClient();
  if (!client) return envError<Match | null>(null);
  const { data, error } = await client.from("matches").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (matches: ${error.message})` };
  return { data: data as Match | null, error: null };
}

export async function getMentoringRecapsByMenteePersonId(personId: string) {
  const client = dataClient();
  if (!client) return envError<MentoringRecap[]>([]);
  const { data, error } = await client
    .from("mentoring_recaps")
    .select("*")
    .eq("mentee_person_id", personId)
    .order("meeting_date", { ascending: false });
  if (error) return { data: [], error: `${VI_ERROR} (mentoring_recaps: ${error.message})` };
  return { data: (data ?? []) as MentoringRecap[], error: null };
}

export async function getMentoringRecapsByMentorPersonId(personId: string) {
  const client = dataClient();
  if (!client) return envError<MentoringRecap[]>([]);
  const { data, error } = await client
    .from("mentoring_recaps")
    .select("*")
    .eq("mentor_person_id", personId)
    .order("meeting_date", { ascending: false });
  if (error) return { data: [], error: `${VI_ERROR} (mentoring_recaps: ${error.message})` };
  return { data: (data ?? []) as MentoringRecap[], error: null };
}

export async function getMentoringRecapById(id: string) {
  const client = dataClient();
  if (!client) return envError<MentoringRecap | null>(null);
  const { data, error } = await client.from("mentoring_recaps").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (mentoring_recaps: ${error.message})` };
  return { data: data as MentoringRecap | null, error: null };
}

export async function getActivityCorrectionLogs(targetTable: "mentoring_recaps" | "event_participations", targetId: string) {
  const client = dataClient();
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
  const client = dataClient();
  if (!client) return envError<MentoringRecap | null>(null);
  const recapId = String(input.id ?? "").trim();
  if (!recapId) return { data: null, error: "Thiếu recap id." };

  const current = await getMentoringRecapById(recapId);
  if (current.error) return { data: null, error: current.error };
  if (!current.data) return { data: null, error: "Không tìm thấy recap cần sửa." };

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

export async function getEventParticipationsByPersonId(personId: string) {
  const client = dataClient();
  if (!client) return envError<EventParticipation[]>([]);
  const { data, error } = await client
    .from("event_participations")
    .select("*")
    .eq("person_id", personId)
    .order("attendance_date", { ascending: false });
  if (error) return { data: [], error: `${VI_ERROR} (event_participations: ${error.message})` };
  return { data: (data ?? []) as EventParticipation[], error: null };
}

export async function getOperationalTeamAssignmentsByPerson(personId: string) {
  const client = dataClient();
  if (!client) return envError<OperationalTeamAssignment[]>([]);
  const { data, error } = await client
    .from("operational_team_assignments")
    .select("id,person_id,source_role_group,operational_role,functional_team,team_name,assigned_scope,role_note,status,notes")
    .eq("person_id", personId)
    .order("source_role_group", { ascending: true })
    .order("functional_team", { ascending: true })
    .order("role_note", { ascending: true })
    .order("operational_role", { ascending: true });
  if (error) return { data: [], error: `${VI_ERROR} (operational_team_assignments: ${error.message})` };
  return { data: (data ?? []) as OperationalTeamAssignment[], error: null };
}

async function getOperationsDataFromRpc() {
  const client = dataClient();
  if (!client) return null;

  const { data, error } = await client.rpc("get_operations_dashboard_data", { p_season_code: "UEHM-S11" });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return null;
    }
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
  const kpis = (payload.kpis ?? computeOperationsDashboardKpis({ seasons, matches, recaps, events, eventParticipations })) as OperationsDashboardKpis;
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

export async function getOperationsData() {
  const rpcData = await getOperationsDataFromRpc();
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
    selectAllTable<Season>("seasons", "id,code,name"),
    selectAllTable<Person>("people", "id,full_name,email_primary"),
    selectAllTable<MenteeProfile>("mentee_profiles", "id,person_id,mentee_code"),
    selectAllTable<Match>("matches", "id,season_id,status,match_type,mentor_person_id,mentee_person_id"),
    selectAllTable<MentoringRecap>(
      "mentoring_recaps",
      "id,season_id,match_id,mentor_person_id,mentee_person_id,meeting_date,meeting_month,recap_url,recap_source,recap_note,meeting_type,captured_by,issue_flag,status,admin_notes"
    ),
    selectAllTable<Event>("events", "id,legacy_event_temp_id,season_id,event_name,event_type,starts_at,source_notes"),
    selectAllTable<EventParticipation>("event_participations", "id,event_id,season_id,person_id,role_at_event,registration_status,attendance_status,attendance_date,recap_url,excuse_reason,admin_notes,captured_by,walk_in"),
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
      data: computeOperationsDashboardKpis({
        seasons: seasons.data,
        matches: matches.data,
        recaps: recaps.data,
        events: events.data,
        eventParticipations: eventParticipations.data
      }),
      error: seasons.error || matches.error || recaps.error || events.error || eventParticipations.error
    },
    latestClosedMonth
  };
}

export async function getOperationsWorkflowData(seasonCode = "UEHM-S11", selectedMonth?: string | null): Promise<QueryResult<OperationsWorkflowData | null>> {
  const client = dataClient();
  if (!client) return envError<OperationsWorkflowData | null>(null);
  const { data, error } = await client.rpc("get_operations_workflow_data", {
    p_season_code: seasonCode,
    p_selected_month: selectedMonth ?? null
  });
  if (error) return { data: null, error: `${VI_ERROR} (get_operations_workflow_data: ${error.message})` };
  return { data: data as OperationsWorkflowData, error: null };
}

export async function getFounderIntelligenceDashboard(seasonCode = "UEHM-S11"): Promise<QueryResult<FounderIntelligenceDashboard | null>> {
  const client = dataClient();
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

async function getFounderIntelligenceDashboardFallback(seasonCode: string): Promise<QueryResult<FounderIntelligenceDashboard | null>> {
  const [seasons, people, mentors, mentees, matches, recaps] = await Promise.all([
    selectAllTable<Season>("seasons", "id,code,name"),
    selectAllTable<Person>("people", "id,full_name,email_primary"),
    selectAllTable<MentorProfile>("mentor_profiles", "id,person_id,mentor_code,company_current,title_current,years_experience_min,industry,function_area"),
    selectAllTable<MenteeProfile>("mentee_profiles", "id,person_id,mentee_code,school_code,school_raw,major"),
    selectAllTable<Match>("matches", "id,season_id,status,mentor_person_id,mentee_person_id"),
    selectAllTable<MentoringRecap>("mentoring_recaps", "id,season_id,mentor_person_id,mentee_person_id,meeting_month,status")
  ]);
  const errors = [seasons.error, people.error, mentors.error, mentees.error, matches.error, recaps.error].filter(Boolean);
  if (errors.length) return { data: null, error: null };

  const peopleById = keyById(people.data);
  const season = seasons.data.find((row) => row.code === seasonCode);
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
  const validRecaps = seasonRecaps.filter(isValidRecapActivity);
  const selectedMonth =
    validRecaps
      .map((row) => String(row.meeting_month ?? ""))
      .filter(isOperationalMonth)
      .sort()
      .filter((month) => month < currentMonth())
      .at(-1) ??
    validRecaps
      .map((row) => String(row.meeting_month ?? ""))
      .filter(isOperationalMonth)
      .sort()
      .at(-1) ??
    currentMonth();
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
  const client = dataClient();
  if (!client) return envError<JsonRecord | null>(null);
  const { data, error } = await client.rpc("create_action_item", {
    p_season_code: input.season_code ?? "UEHM-S11",
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
  const client = dataClient();
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
  const client = dataClient();
  if (!client) return envError<JsonRecord | null>(null);
  const { data, error } = await client.rpc("add_action_item_comment", {
    p_action_item_id: input.id,
    p_comment_text: input.comment_text
  });
  if (error) return { data: null, error: `${VI_ERROR} (add_action_item_comment: ${error.message})` };
  return { data: data as JsonRecord, error: null };
}

export async function generateMonthlyFollowupActions(input: { season_code?: string; selected_month: string }): Promise<QueryResult<JsonRecord | null>> {
  const client = dataClient();
  if (!client) return envError<JsonRecord | null>(null);
  const { data, error } = await client.rpc("generate_monthly_followup_actions", {
    p_season_code: input.season_code ?? "UEHM-S11",
    p_selected_month: input.selected_month
  });
  if (error) return { data: null, error: `${VI_ERROR} (generate_monthly_followup_actions: ${error.message})` };
  return { data: data as JsonRecord, error: null };
}

export async function getDashboardData() {
  // Use exact count queries for KPI cards to avoid Supabase default 1000-row limit.
  const [
    totalPeople,
    totalMentors,
    totalMentees,
    totalApplications,
    totalMatches,
    totalActiveMatches,
    people,
    mentors,
    mentees,
    applications,
    matches,
    seasons,
    recaps,
    latestClosedMonth
  ] = await Promise.all([
    countTable("people"),
    countTable("mentor_profiles"),
    countTable("mentee_profiles"),
    countTable("applications").then((res) => ({ data: res.data, error: null })),
    countTable("matches"),
    countTable("matches", (q) => q.eq("status", "active")),
    selectAllTable<Person>("people", "id,full_name,email_primary,phone_primary"),
    selectTable<MentorProfile>("mentor_profiles", "id,person_id,mentor_code,bio_url,company_current,title_current"),
    selectTable<MenteeProfile>("mentee_profiles", "id,person_id,mentee_code,school_code"),
    selectTable<Application>("applications", "id,final_status").then((res) => ({ data: res.data, error: null })),
    selectTable<Match>("matches", "id,season_id,status,mentor_person_id,mentee_person_id"),
    selectAllTable<Season>("seasons", "id,code,name"),
    selectAllTable<MentoringRecap>("mentoring_recaps", "id,season_id,mentor_person_id,mentee_person_id,meeting_month,meeting_date,status"),
    selectTable<JsonRecord>("v_season_latest_closed_month")
  ]);
  const duplicateEmails = { data: getDuplicateEmailCountFromRows(people.data), error: people.error };
  const activeMissing = await countTable("matches", (q) => q.eq("status", "active").or("mentor_person_id.is.null,mentee_person_id.is.null"));

  return {
    people,
    mentors,
    mentees,
    applications,
    matches,
    seasons,
    recaps,
    counts: {
      people: totalPeople,
      mentors: totalMentors,
      mentees: totalMentees,
      applications: totalApplications,
      matches: totalMatches,
      activeMatches: totalActiveMatches
    },
    duplicateEmails,
    activeMissing,
    latestClosedMonth
  };
}

async function getDuplicateEmailCount() {
  const people = await getPeople();
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

export async function getApplicationReviewsForApplication(applicationId: string): Promise<QueryResult<ApplicationReview[]>> {
  const client = dataClient(); // RLS: admin sees all, reviewer sees own
  if (!client) return envError<ApplicationReview[]>([]);
  const { data, error } = await client
    .from("application_reviews")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: `${VI_ERROR} (application_reviews: ${error.message})` };
  return { data: (data ?? []) as ApplicationReview[], error: null };
}

/** Reviews assigned to a specific admin user — used for reviewer's /reviews page. */
export async function getMyApplicationReviews(adminUserId: string): Promise<QueryResult<ApplicationReview[]>> {
  const client = dataClient();
  if (!client) return envError<ApplicationReview[]>([]);
  const { data, error } = await client
    .from("application_reviews")
    .select("*")
    .eq("reviewer_admin_user_id", adminUserId)
    .neq("status", "cancelled")
    .order("due_at", { ascending: true });
  if (error) return { data: [], error: `${VI_ERROR} (application_reviews: ${error.message})` };
  return { data: (data ?? []) as ApplicationReview[], error: null };
}

/** All reviews — used for admin/core_team /reviews page (RLS allows this). */
export async function getAllApplicationReviews(): Promise<QueryResult<ApplicationReview[]>> {
  return selectTable<ApplicationReview>("application_reviews", "*");
}

export async function getApplicationReviewById(id: string): Promise<QueryResult<ApplicationReview | null>> {
  const client = dataClient();
  if (!client) return envError<ApplicationReview | null>(null);
  const { data, error } = await client
    .from("application_reviews")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (application_reviews: ${error.message})` };
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
  const { data, error } = await client
    .from("admin_users")
    .select("id,email,full_name,role")
    .eq("status", "active")
    .order("full_name", { ascending: true });
  if (error) return { data: [], error: `${VI_ERROR} (admin_users: ${error.message})` };
  return { data: (data ?? []) as AdminUserPublic[], error: null };
}

/** All admin decisions recorded against an application, newest first. */
export async function getApplicationDecisions(
  applicationId: string
): Promise<QueryResult<ApplicationDecision[]>> {
  const client = dataClient();
  if (!client) return envError<ApplicationDecision[]>([]);
  const { data, error } = await client
    .from("application_decisions")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) {
    return { data: [], error: `${VI_ERROR} (application_decisions: ${error.message})` };
  }
  return { data: (data ?? []) as ApplicationDecision[], error: null };
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
}): Promise<QueryResult<ReviewAssignableApplication[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewAssignableApplication[]>([]);

  let appsQuery = client
    .from("applications")
    .select("id,full_name,email_primary,role_applied,status,submitted_at,intake_batch_id")
    .order("submitted_at", { ascending: true })
    .order("id", { ascending: true });

  if (filters.intakeBatchId) {
    appsQuery = appsQuery.eq("intake_batch_id", filters.intakeBatchId);
  }
  if (filters.roleApplied) {
    appsQuery = appsQuery.eq("role_applied", filters.roleApplied);
  }

  const { data: appRows, error: appsErr } = await appsQuery;
  if (appsErr) {
    logDataError("getReviewAssignableApplications.apps", appsErr);
    return { data: [], error: `${VI_ERROR} (applications: ${appsErr.message})` };
  }

  const appList = (appRows ?? []) as {
    id: string;
    full_name: string | null;
    email_primary: string | null;
    role_applied: string | null;
    status: string | null;
    submitted_at: string | null;
    intake_batch_id: string | null;
  }[];

  if (!appList.length) return { data: [], error: null };

  const appIds = appList.map((a) => a.id);
  const { data: reviewRows } = await client
    .from("application_reviews")
    .select("application_id")
    .eq("review_round", "profile_screening")
    .neq("status", "cancelled")
    .in("application_id", appIds);

  const reviewCountByAppId = new Map<string, number>();
  for (const row of reviewRows ?? []) {
    const id = row.application_id as string | null;
    if (id) reviewCountByAppId.set(id, (reviewCountByAppId.get(id) ?? 0) + 1);
  }

  const data: ReviewAssignableApplication[] = appList.map((a) => ({
    ...a,
    existing_review_count: reviewCountByAppId.get(a.id) ?? 0
  }));

  return { data, error: null };
}

/**
 * Admin users eligible to be assigned as reviewers, enriched with their
 * current active profile_screening workload count.
 * Uses service-role client because admin_users RLS restricts row visibility.
 */
export async function getReviewEligibleReviewers(): Promise<QueryResult<ReviewEligibleReviewer[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewEligibleReviewer[]>([]);

  const { data: adminRows, error: adminErr } = await client
    .from("admin_users")
    .select("id,email,full_name,role")
    .in("role", ["super_admin", "admin", "core_team", "reviewer"])
    .eq("status", "active")
    .order("full_name", { ascending: true });

  if (adminErr) {
    logDataError("getReviewEligibleReviewers.admin_users", adminErr);
    return { data: [], error: `${VI_ERROR} (admin_users: ${adminErr.message})` };
  }

  const reviewers = (adminRows ?? []) as {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
  }[];

  if (!reviewers.length) return { data: [], error: null };

  const reviewerIds = reviewers.map((r) => r.id);
  const { data: workloadRows } = await client
    .from("application_reviews")
    .select("reviewer_admin_user_id")
    .eq("review_round", "profile_screening")
    .neq("status", "cancelled")
    .in("reviewer_admin_user_id", reviewerIds);

  const workloadById = new Map<string, number>();
  for (const row of workloadRows ?? []) {
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

  const { data, error } = await client
    .from("review_assignment_batches")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    logDataError("getReviewAssignmentBatches", error);
    return { data: [], error: `${VI_ERROR} (review_assignment_batches: ${error.message})` };
  }

  return { data: (data ?? []) as ReviewAssignmentBatch[], error: null };
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
}): Promise<QueryResult<ReviewProgressRow[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewProgressRow[]>([]);

  const reviewRound = filters.reviewRound?.trim() || "profile_screening";

  // Step 1: resolve app IDs if batch filter is active
  let appIdFilter: string[] | null = null;
  if (filters.intakeBatchId) {
    const { data: appRows, error: appErr } = await client
      .from("applications")
      .select("id")
      .eq("intake_batch_id", filters.intakeBatchId);
    if (appErr) {
      logDataError("getReviewAssignmentProgress.apps", appErr);
      return { data: [], error: `${VI_ERROR} (applications: ${appErr.message})` };
    }
    appIdFilter = (appRows ?? []).map((a) => a.id as string);
    if (!appIdFilter.length) return { data: [], error: null };
  }

  // Step 2: fetch review rows
  let reviewsQuery = client
    .from("application_reviews")
    .select("reviewer_admin_user_id,status,submitted_at,application_id")
    .eq("review_round", reviewRound);

  if (appIdFilter) {
    reviewsQuery = reviewsQuery.in("application_id", appIdFilter);
  }

  const { data: reviewRows, error: reviewErr } = await reviewsQuery;
  if (reviewErr) {
    logDataError("getReviewAssignmentProgress.reviews", reviewErr);
    return { data: [], error: `${VI_ERROR} (application_reviews: ${reviewErr.message})` };
  }

  const reviews = (reviewRows ?? []) as {
    reviewer_admin_user_id: string | null;
    status: string;
    submitted_at: string | null;
    application_id: string;
  }[];

  if (!reviews.length) return { data: [], error: null };

  // Step 3: fetch reviewer names and emails
  const reviewerIds = Array.from(
    new Set(reviews.map((r) => r.reviewer_admin_user_id).filter((id): id is string => Boolean(id)))
  );

  const { data: adminRows } = await client
    .from("admin_users")
    .select("id,full_name,email")
    .in("id", reviewerIds);

  const nameById = new Map<string, string | null>(
    (adminRows ?? []).map((r) => [r.id as string, (r.full_name as string | null) ?? null])
  );
  const emailById = new Map<string, string | null>(
    (adminRows ?? []).map((r) => [r.id as string, (r.email as string | null) ?? null])
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
}): Promise<QueryResult<ReviewerPoolRow[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<ReviewerPoolRow[]>([]);

  // --- Query 1: mentor profiles (conditionally filtered)
  let mentorQuery = client
    .from("mentor_profiles")
    .select("id,person_id,mentor_code,intake_batch_id")
    .not("person_id", "is", null)
    .order("id");

  if (filters?.intakeBatchId) {
    mentorQuery = mentorQuery.eq("intake_batch_id", filters.intakeBatchId);
  }

  const [mentorRes, adminRes] = await Promise.all([
    mentorQuery,
    client.from("admin_users").select("id,email,role,status,auth_user_id")
  ]);

  if (mentorRes.error) {
    logDataError("getReviewerPool.mentor_profiles", mentorRes.error);
    return { data: [], error: `${VI_ERROR} (mentor_profiles: ${mentorRes.error.message})` };
  }

  const mentors = (mentorRes.data ?? []) as {
    id: string;
    person_id: string | null;
    mentor_code: string | null;
    intake_batch_id: string | null;
  }[];

  if (!mentors.length) return { data: [], error: null };

  // --- Query 2: people (only linked person_ids)
  const personIds = Array.from(
    new Set(mentors.map((m) => m.person_id).filter((id): id is string => Boolean(id)))
  );

  const { data: peopleRows } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .in("id", personIds);

  const peopleById = new Map(
    (peopleRows ?? []).map((p) => [
      p.id as string,
      p as { id: string; full_name: string | null; email_primary: string | null }
    ])
  );

  // --- Build email → admin_user map from Query 3
  const adminByEmail = new Map(
    (adminRes.data ?? []).map((a) => [
      String((a as { email: string }).email ?? "").toLowerCase(),
      a as { id: string; email: string; role: string | null; status: string | null; auth_user_id: string | null }
    ])
  );

  // --- Join and return
  const rows: ReviewerPoolRow[] = mentors
    .map((mentor) => {
      const person = mentor.person_id ? peopleById.get(mentor.person_id) : undefined;
      const email = String(person?.email_primary ?? "").trim().toLowerCase();
      const adminUser = email ? adminByEmail.get(email) : undefined;
      return {
        mentor_profile_id: mentor.id,
        person_id: mentor.person_id,
        full_name: person?.full_name ?? null,
        email_primary: person?.email_primary ?? null,
        mentor_code: mentor.mentor_code,
        intake_batch_id: mentor.intake_batch_id,
        admin_user_id: adminUser?.id ?? null,
        admin_user_role: adminUser?.role ?? null,
        admin_user_status: adminUser?.status ?? null
      };
    })
    .filter((row) => Boolean(row.email_primary));

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
  "interview_completed"
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
}): Promise<QueryResult<InterviewCandidateRow[]>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return envError<InterviewCandidateRow[]>([]);

  // Status set — optionally exclude interview_completed
  const statuses =
    filters?.includeCompleted === false
      ? (INTERVIEW_POOL_STATUSES.slice(0, 3) as unknown as string[])
      : (INTERVIEW_POOL_STATUSES as unknown as string[]);

  let appsQuery = client
    .from("applications")
    .select("id,full_name,email_primary,phone_primary,status,intake_batch_id,role_applied,sbd,submitted_at")
    .in("status", statuses)
    .order("submitted_at", { ascending: true })
    .order("id", { ascending: true });

  if (filters?.intakeBatchId) {
    appsQuery = appsQuery.eq("intake_batch_id", filters.intakeBatchId);
  }

  // Default to mentee unless explicitly overridden
  const roleApplied = filters?.roleApplied ?? "mentee";
  appsQuery = appsQuery.eq("role_applied", roleApplied);

  const { data: appRows, error: appsErr } = await appsQuery;
  if (appsErr) {
    logDataError("getInterviewCandidates.applications", appsErr);
    return { data: [], error: `${VI_ERROR} (applications: ${appsErr.message})` };
  }

  const appList = (appRows ?? []) as {
    id: string;
    full_name: string | null;
    email_primary: string | null;
    phone_primary: string | null;
    status: string | null;
    intake_batch_id: string | null;
    role_applied: string | null;
    sbd: string | null;
    submitted_at: string | null;
  }[];

  if (!appList.length) return { data: [], error: null };

  // Fetch active interview reviews for these applications
  const appIds = appList.map((a) => a.id);
  const { data: reviewRows } = await client
    .from("application_reviews")
    .select("id,application_id,status,reviewer_admin_user_id")
    .eq("review_round", "interview")
    .neq("status", "cancelled")
    .in("application_id", appIds)
    .order("created_at", { ascending: true }); // oldest first → consistent "primary" review

  // Map application_id → first active interview review
  const reviewByAppId = new Map<
    string,
    { id: string; status: string; reviewer_admin_user_id: string | null }
  >();
  for (const row of reviewRows ?? []) {
    const appId = row.application_id as string;
    if (!reviewByAppId.has(appId)) {
      reviewByAppId.set(appId, {
        id: String(row.id),
        status: String(row.status ?? ""),
        reviewer_admin_user_id: (row.reviewer_admin_user_id as string | null) ?? null
      });
    }
  }

  const data: InterviewCandidateRow[] = appList.map((a) => {
    const review = reviewByAppId.get(a.id) ?? null;
    return {
      ...a,
      interview_review_id: review?.id ?? null,
      interview_review_status: review?.status ?? null,
      interview_reviewer_admin_user_id: review?.reviewer_admin_user_id ?? null
    };
  });

  return { data, error: null };
}
