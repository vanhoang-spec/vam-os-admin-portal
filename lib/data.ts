import { supabase } from "@/lib/supabase";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type {
  ActivityCorrectionLog,
  Application,
  Event,
  EventParticipation,
  FounderIntelligenceDashboard,
  JsonRecord,
  Match,
  MenteeProfile,
  MentorProfile,
  MentoringRecap,
  OperationalTeamAssignment,
  OperationsWorkflowData,
  Person,
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
  if (error) return { data: fallback, error: `${VI_ERROR} (${table}: ${error.message})` };
  return { data: (data ?? []) as T[], error: null };
}

async function selectAllTable<T>(table: string, columns = "*", fallback: T[] = [], pageSize = 1000): Promise<QueryResult<T[]>> {
  const client = dataClient();
  if (!client) return envError(fallback);
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from(table).select(columns).range(from, to);
    if (error) return { data: rows.length ? rows : fallback, error: `${VI_ERROR} (${table}: ${error.message})` };
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
  if (error) return { data: 0, error: `${VI_ERROR} (${table}: ${error.message})` };
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
      console.warn("[operations] get_operations_dashboard_data unavailable; using temporary raw-read fallback.");
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
      kpis: emptyKpis as QueryResult<OperationsDashboardKpis | null>
    };
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  console.info("[operations] get_operations_dashboard_data RPC used.");
  const seasons = (payload.seasons ?? []) as Season[];
  const matches = (payload.matches ?? []) as Match[];
  const recaps = (payload.recaps ?? []) as MentoringRecap[];
  const events = (payload.events ?? []) as Event[];
  const eventParticipations = (payload.eventParticipations ?? []) as EventParticipation[];
  const kpis = (payload.kpis ?? computeOperationsDashboardKpis({ seasons, matches, recaps, events, eventParticipations })) as OperationsDashboardKpis;
  return {
    seasons: { data: seasons, error: null },
    people: { data: (payload.people ?? []) as Person[], error: null },
    mentees: { data: (payload.mentees ?? []) as MenteeProfile[], error: null },
    matches: { data: matches, error: null },
    recaps: { data: recaps, error: null },
    events: { data: events, error: null },
    eventParticipations: { data: eventParticipations, error: null },
    kpis: { data: kpis, error: null }
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
    eventParticipations
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
    selectAllTable<EventParticipation>("event_participations", "id,event_id,season_id,person_id,role_at_event,registration_status,attendance_status,attendance_date,recap_url,excuse_reason,admin_notes,captured_by,walk_in")
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
    }
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
  if (error) return { data: null, error: `${VI_ERROR} (get_founder_intelligence_dashboard: ${error.message})` };
  return { data: data as FounderIntelligenceDashboard, error: null };
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
    seasons
  ] = await Promise.all([
    countTable("people"),
    countTable("mentor_profiles"),
    countTable("mentee_profiles"),
    countTable("applications"),
    countTable("matches"),
    countTable("matches", (q) => q.eq("status", "active")),
    selectAllTable<Person>("people", "id,full_name,email_primary,phone_primary"),
    selectTable<MentorProfile>("mentor_profiles", "id,person_id,mentor_code,bio_url,company_current,title_current"),
    selectTable<MenteeProfile>("mentee_profiles", "id,person_id,mentee_code,school_code"),
    selectTable<Application>("applications", "id,final_status"),
    selectTable<Match>("matches", "id,status,mentor_person_id,mentee_person_id"),
    getSeasons()
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
    counts: {
      people: totalPeople,
      mentors: totalMentors,
      mentees: totalMentees,
      applications: totalApplications,
      matches: totalMatches,
      activeMatches: totalActiveMatches
    },
    duplicateEmails,
    activeMissing
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

export function groupCount(rows: JsonRecord[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[key] ?? "Chưa có dữ liệu");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}
