import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import {
  ATTENDANCE_STATUS_VALUES,
  EVENT_ROLE_VALUES,
  EVENT_TYPE_VALUES,
  REGISTRATION_STATUS_VALUES,
  type AttendanceStatusValue,
  type EventRoleValue,
  type EventTypeValue,
  type RegistrationStatusValue
} from "@/lib/event-constants";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { Event, EventParticipation, JsonRecord, MenteeProfile, MentorProfile, Person, Season } from "@/lib/types";

export type {
  AttendanceStatusValue,
  EventRoleValue,
  EventTypeValue,
  RegistrationStatusValue
} from "@/lib/event-constants";

const DEFAULT_SEASON_CODE = "UEHM-S11";
const SAFE_ERROR = "Không thể thực hiện tác vụ. Vui lòng kiểm tra cấu hình Supabase và server logs.";

export type EventListData = {
  ok: boolean;
  error: string | null;
  events: Event[];
  participations: EventParticipation[];
  seasons: Season[];
  people: Person[];
};

export type EventDetailData = {
  ok: boolean;
  error: string | null;
  event: Event | null;
  participations: EventParticipation[];
  seasons: Season[];
  people: Person[];
  mentorProfiles: MentorProfile[];
  menteeProfiles: MenteeProfile[];
};

export type MutationResult = {
  ok: boolean;
  message: string;
  data?: JsonRecord | null;
};

export type EventInput = {
  event_name?: unknown;
  event_type?: unknown;
  season_code?: unknown;
  /** Phase 045A: UUID of intake_batches row, or null/empty to leave unlinked. */
  intake_batch_id?: unknown;
  starts_at?: unknown;
  source_notes?: unknown;
  legacy_event_temp_id?: unknown;
};

export type ParticipationInput = {
  event_id?: unknown;
  person_id?: unknown;
  role_at_event?: unknown;
  attendance_status?: unknown;
  registration_status?: unknown;
  attendance_date?: unknown;
  admin_notes?: unknown;
  excuse_reason?: unknown;
  walk_in?: unknown;
};

export type ParticipationUpdateInput = ParticipationInput & {
  id?: unknown;
};

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[events]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function clientResult() {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { client: null, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY trên server." as string | null };
  return { client, error: null as string | null };
}

async function requireEventAdmin(): Promise<{ ok: true; admin: Awaited<ReturnType<typeof getCurrentAdminUser>> } | { ok: false; message: string }> {
  const admin = await getCurrentAdminUser();
  if (!canEditRecaps(admin)) return { ok: false, message: "Bạn không có quyền quản lý sự kiện." };
  return { ok: true, admin };
}

function validEventType(value: unknown): EventTypeValue | null {
  const text = String(value ?? "").trim();
  return EVENT_TYPE_VALUES.has(text as EventTypeValue) ? (text as EventTypeValue) : null;
}

function validAttendanceStatus(value: unknown): AttendanceStatusValue {
  const text = String(value ?? "").trim();
  return ATTENDANCE_STATUS_VALUES.has(text as AttendanceStatusValue) ? (text as AttendanceStatusValue) : "registered_absent";
}

function validRegistrationStatus(value: unknown): RegistrationStatusValue {
  const text = String(value ?? "").trim();
  return REGISTRATION_STATUS_VALUES.has(text as RegistrationStatusValue) ? (text as RegistrationStatusValue) : "registered";
}

function validRole(value: unknown): EventRoleValue | null {
  const text = String(value ?? "").trim();
  return EVENT_ROLE_VALUES.has(text as EventRoleValue) ? (text as EventRoleValue) : null;
}

function validateDate(value: string | null) {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return UUID_REGEX.test(value);
}

function parseDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function selectAll<T>(client: any, table: string, columns = "*") {
  let allData: T[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await client.from(table).select(columns).range(from, from + step - 1);
    if (error) {
      log(`${table} select failed`, error);
      return { data: allData, error: error.message as string };
    }
    if (!data || data.length === 0) break;
    allData = allData.concat(data as T[]);
    if (data.length < step) break;
    from += step;
  }
  return { data: allData, error: null as string | null };
}

async function writeAdminAudit(client: any, input: {
  actionType: string;
  beforeData?: unknown;
  afterData?: unknown;
  details?: unknown;
}) {
  try {
    const admin = await getCurrentAdminUser();
    const { error } = await client.from("admin_audit_log").insert({
      actor_admin_user_id: admin?.id ?? null,
      action_type: input.actionType,
      target_admin_user_id: null,
      before_data: input.beforeData ?? null,
      after_data: input.afterData ?? null,
      details: input.details ?? null
    });
    if (error) log("admin_audit_log insert failed", error);
  } catch (error) {
    log("admin audit crashed", error);
  }
}

async function writeParticipationAudit(client: any, input: {
  targetId: string;
  correctionType: "manual_review" | "update_field" | "status_change" | "admin_note" | "other";
  fieldName?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}) {
  const admin = await getCurrentAdminUser();
  const correctedBy = admin?.full_name ? `${admin.full_name} <${admin.email}>` : admin?.email ?? "admin";
  const { error } = await client.from("activity_correction_log").insert({
    target_table: "event_participations",
    target_id: input.targetId,
    correction_type: input.correctionType,
    field_name: input.fieldName ?? null,
    old_value: input.oldValue === undefined || input.oldValue === null ? null : String(input.oldValue),
    new_value: input.newValue === undefined || input.newValue === null ? null : String(input.newValue),
    reason: input.reason ?? null,
    corrected_by: correctedBy
  });
  if (error) log("activity_correction_log insert failed", error);
}

async function resolveSeasonId(client: any, seasonCode: string | null): Promise<{ seasonId: string | null; error: string | null }> {
  const code = seasonCode ?? DEFAULT_SEASON_CODE;
  const { data, error } = await client.from("seasons").select("id,code").eq("code", code).maybeSingle();
  if (error) return { seasonId: null, error: error.message };
  return { seasonId: data?.id ?? null, error: null };
}

export async function getEventListData(): Promise<EventListData> {
  const { client, error } = clientResult();
  if (!client) return { ok: false, error, events: [], participations: [], seasons: [], people: [] };

  const [events, participations, seasons, people] = await Promise.all([
    selectAll<Event>(client, "events", "id,legacy_event_temp_id,season_id,intake_batch_id,status,event_name,event_type,starts_at,source_notes"),
    selectAll<EventParticipation>(client, "event_participations", "id,event_id,season_id,person_id,role_at_event,registration_status,attendance_status,attendance_date,recap_url,excuse_reason,admin_notes,captured_by,walk_in"),
    selectAll<Season>(client, "seasons", "id,code,name"),
    selectAll<Person>(client, "people", "id,full_name,email_primary")
  ]);

  const errors = [events.error, participations.error, seasons.error, people.error].filter(Boolean);
  return {
    ok: !errors.length,
    error: errors.join(" | ") || null,
    events: events.data,
    participations: participations.data,
    seasons: seasons.data,
    people: people.data
  };
}

export async function getEventDetailData(eventId: string): Promise<EventDetailData> {
  const empty = { event: null, participations: [], seasons: [], people: [], mentorProfiles: [], menteeProfiles: [] };
  const { client, error } = clientResult();
  if (!client) return { ok: false, error, ...empty };

  const id = clean(eventId);
  if (!id) return { ok: false, error: "Thiếu event id.", ...empty };
  if (!isValidUuid(id)) {
    return { ok: false, error: "ID sự kiện không hợp lệ.", ...empty };
  }

  const [eventRes, seasonsRes, peopleRes, mentorsRes, menteesRes] = await Promise.all([
    client.from("events").select("id,legacy_event_temp_id,season_id,intake_batch_id,status,event_name,event_type,starts_at,source_notes").eq("id", id).maybeSingle(),
    selectAll<Season>(client, "seasons", "id,code,name"),
    selectAll<Person>(client, "people", "id,full_name,email_primary"),
    // Phase 045B: include intake_batch_id so combobox can prioritise batch members
    selectAll<MentorProfile>(client, "mentor_profiles", "id,person_id,mentor_code,company_current,title_current,intake_batch_id"),
    selectAll<MenteeProfile>(client, "mentee_profiles", "id,person_id,mentee_code,school_code,school_raw,major,intake_batch_id")
  ]);

  if (eventRes.error) {
    log("event load failed", eventRes.error);
    return { ok: false, error: eventRes.error.message, event: null, participations: [], seasons: seasonsRes.data, people: peopleRes.data, mentorProfiles: mentorsRes.data, menteeProfiles: menteesRes.data };
  }

  // Phase 045A: scope participations to this event only (was: load all then filter in JS)
  const { data: partsData, error: partsErr } = await client
    .from("event_participations")
    .select("id,event_id,season_id,person_id,role_at_event,registration_status,attendance_status,attendance_date,recap_url,excuse_reason,admin_notes,captured_by,walk_in")
    .eq("event_id", id);
  if (partsErr) {
    log("event_participations load failed", partsErr);
  }
  const partsRes = { data: (partsData ?? []) as EventParticipation[], error: partsErr ? partsErr.message : null };

  const errors = [partsRes.error, seasonsRes.error, peopleRes.error, mentorsRes.error, menteesRes.error].filter(Boolean);
  return {
    ok: !errors.length,
    error: errors.join(" | ") || null,
    event: (eventRes.data as Event) ?? null,
    participations: partsRes.data,
    seasons: seasonsRes.data,
    people: peopleRes.data,
    mentorProfiles: mentorsRes.data,
    menteeProfiles: menteesRes.data
  };
}

export async function createEvent(input: EventInput): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const eventName = clean(input.event_name);
  if (!eventName) return { ok: false, message: "Thiếu tên sự kiện." };

  const eventType = validEventType(input.event_type) ?? "training";

  const startsAtRaw = clean(input.starts_at);
  const startsAt = parseDateTime(startsAtRaw);
  if (!startsAt) return { ok: false, message: "Thời điểm sự kiện không hợp lệ." };

  const seasonCode = clean(input.season_code) ?? DEFAULT_SEASON_CODE;
  const { seasonId, error: seasonError } = await resolveSeasonId(client, seasonCode);
  if (seasonError) return { ok: false, message: `${SAFE_ERROR} (seasons: ${seasonError})` };
  if (!seasonId) return { ok: false, message: `Không tìm thấy season ${seasonCode}.` };

  // Phase 045A: resolve optional intake_batch_id
  const intakeBatchIdRaw = clean(input.intake_batch_id);
  const intakeBatchId =
    intakeBatchIdRaw && isValidUuid(intakeBatchIdRaw) ? intakeBatchIdRaw : null;

  const payload: JsonRecord = {
    season_id: seasonId,
    intake_batch_id: intakeBatchId,
    event_name: eventName,
    event_type: eventType,
    starts_at: startsAt,
    source_notes: clean(input.source_notes),
    legacy_event_temp_id: clean(input.legacy_event_temp_id)
  };

  const { data, error: insertError } = await client.from("events").insert(payload).select("*").maybeSingle();
  if (insertError) {
    log("create event failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (${insertError.message})` };
  }
  await writeAdminAudit(client, { actionType: "create_event", afterData: data });
  return { ok: true, message: "Đã tạo sự kiện.", data };
}

export async function updateEvent(input: EventInput & { id?: unknown }): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };
  const id = clean(input.id);
  if (!id) return { ok: false, message: "Thiếu event id." };
  if (!isValidUuid(id)) return { ok: false, message: "ID sự kiện không hợp lệ." };

  const { data: before, error: beforeError } = await client.from("events").select("*").eq("id", id).maybeSingle();
  if (beforeError) {
    log("load event failed", beforeError);
    return { ok: false, message: `${SAFE_ERROR} (${beforeError.message})` };
  }
  if (!before) return { ok: false, message: "Không tìm thấy sự kiện." };

  const updates: JsonRecord = {};

  const eventName = clean(input.event_name);
  if (eventName === null) return { ok: false, message: "Thiếu tên sự kiện." };
  updates.event_name = eventName;

  const eventType = validEventType(input.event_type);
  if (!eventType) return { ok: false, message: "Loại sự kiện không hợp lệ." };
  updates.event_type = eventType;

  const startsAtRaw = clean(input.starts_at);
  const startsAt = parseDateTime(startsAtRaw);
  if (!startsAt) return { ok: false, message: "Thời điểm sự kiện không hợp lệ." };
  updates.starts_at = startsAt;

  const seasonCode = clean(input.season_code) ?? DEFAULT_SEASON_CODE;
  const { seasonId, error: seasonError } = await resolveSeasonId(client, seasonCode);
  if (seasonError) return { ok: false, message: `${SAFE_ERROR} (seasons: ${seasonError})` };
  if (!seasonId) return { ok: false, message: `Không tìm thấy season ${seasonCode}.` };
  updates.season_id = seasonId;

  updates.source_notes = clean(input.source_notes);
  if (Object.prototype.hasOwnProperty.call(input, "legacy_event_temp_id")) {
    updates.legacy_event_temp_id = clean(input.legacy_event_temp_id);
  }

  // Phase 045A: intake_batch_id (nullable — empty string clears it)
  if (Object.prototype.hasOwnProperty.call(input, "intake_batch_id")) {
    const raw = clean(input.intake_batch_id);
    updates.intake_batch_id = raw && isValidUuid(raw) ? raw : null;
  }

  const { data: after, error: updateError } = await client.from("events").update(updates).eq("id", id).select("*").maybeSingle();
  if (updateError) {
    log("update event failed", updateError);
    return { ok: false, message: `${SAFE_ERROR} (${updateError.message})` };
  }
  await writeAdminAudit(client, { actionType: "update_event", beforeData: before, afterData: after });
  return { ok: true, message: "Đã cập nhật sự kiện.", data: after };
}

export async function addParticipation(input: ParticipationInput): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const eventId = clean(input.event_id);
  if (!eventId) return { ok: false, message: "Thiếu event id." };
  if (!isValidUuid(eventId)) return { ok: false, message: "ID sự kiện không hợp lệ." };
  const personId = clean(input.person_id);
  if (!personId) return { ok: false, message: "Thiếu person id." };
  if (!isValidUuid(personId)) return { ok: false, message: "ID người tham gia không hợp lệ." };

  const role = validRole(input.role_at_event);
  if (!role) return { ok: false, message: "Vai trò không hợp lệ." };

  const { data: event, error: eventError } = await client.from("events").select("id,season_id").eq("id", eventId).maybeSingle();
  if (eventError) {
    log("load event for participation failed", eventError);
    return { ok: false, message: `${SAFE_ERROR} (${eventError.message})` };
  }
  if (!event) return { ok: false, message: "Sự kiện không tồn tại." };

  const { data: person, error: personError } = await client.from("people").select("id").eq("id", personId).maybeSingle();
  if (personError) {
    log("load person for participation failed", personError);
    return { ok: false, message: `${SAFE_ERROR} (${personError.message})` };
  }
  if (!person) return { ok: false, message: "Người tham gia không tồn tại." };

  const { data: existing, error: existingError } = await client
    .from("event_participations")
    .select("id")
    .eq("event_id", eventId)
    .eq("person_id", personId)
    .limit(1)
    .maybeSingle();
  if (existingError) {
    log("check duplicate participation failed", existingError);
    return { ok: false, message: `${SAFE_ERROR} (${existingError.message})` };
  }
  if (existing) {
    return { ok: false, message: "Người này đã được thêm vào sự kiện." };
  }

  const attendanceStatus = validAttendanceStatus(input.attendance_status);
  const registrationStatus = validRegistrationStatus(input.registration_status);
  const attendanceDateRaw = clean(input.attendance_date);
  if (attendanceDateRaw && !validateDate(attendanceDateRaw)) {
    return { ok: false, message: "attendance_date phải đúng định dạng YYYY-MM-DD." };
  }

  const payload: JsonRecord = {
    event_id: eventId,
    season_id: event.season_id ?? null,
    person_id: personId,
    role_at_event: role,
    attendance_status: attendanceStatus,
    registration_status: registrationStatus,
    attendance_date: attendanceDateRaw,
    admin_notes: clean(input.admin_notes),
    excuse_reason: clean(input.excuse_reason),
    walk_in: String(input.walk_in ?? "false") === "true",
    captured_by: access.admin?.email ?? "admin"
  };

  const { data, error: insertError } = await client.from("event_participations").insert(payload).select("*").maybeSingle();
  if (insertError) {
    log("add participation failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (${insertError.message})` };
  }
  await writeParticipationAudit(client, {
    targetId: data.id,
    correctionType: "manual_review",
    fieldName: "insert",
    newValue: JSON.stringify(payload),
    reason: "Thêm người tham gia từ Admin Event Workflow"
  });
  await writeAdminAudit(client, { actionType: "add_event_participation", afterData: data });
  return { ok: true, message: "Đã thêm người tham gia.", data };
}

export async function updateParticipation(input: ParticipationUpdateInput): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const id = clean(input.id);
  if (!id) return { ok: false, message: "Thiếu participation id." };
  if (!isValidUuid(id)) return { ok: false, message: "ID người tham gia không hợp lệ." };

  const { data: before, error: beforeError } = await client.from("event_participations").select("*").eq("id", id).maybeSingle();
  if (beforeError) {
    log("load participation failed", beforeError);
    return { ok: false, message: `${SAFE_ERROR} (${beforeError.message})` };
  }
  if (!before) return { ok: false, message: "Không tìm thấy người tham gia." };

  const updates: JsonRecord = {};

  if (Object.prototype.hasOwnProperty.call(input, "attendance_status")) {
    updates.attendance_status = validAttendanceStatus(input.attendance_status);
  }
  if (Object.prototype.hasOwnProperty.call(input, "registration_status")) {
    updates.registration_status = validRegistrationStatus(input.registration_status);
  }
  if (Object.prototype.hasOwnProperty.call(input, "role_at_event")) {
    const role = validRole(input.role_at_event);
    if (!role) return { ok: false, message: "Vai trò không hợp lệ." };
    updates.role_at_event = role;
  }
  if (Object.prototype.hasOwnProperty.call(input, "attendance_date")) {
    const attendanceDateRaw = clean(input.attendance_date);
    if (attendanceDateRaw && !validateDate(attendanceDateRaw)) {
      return { ok: false, message: "attendance_date phải đúng định dạng YYYY-MM-DD." };
    }
    updates.attendance_date = attendanceDateRaw;
  }
  if (Object.prototype.hasOwnProperty.call(input, "admin_notes")) {
    updates.admin_notes = clean(input.admin_notes);
  }
  if (Object.prototype.hasOwnProperty.call(input, "excuse_reason")) {
    updates.excuse_reason = clean(input.excuse_reason);
  }
  if (Object.prototype.hasOwnProperty.call(input, "walk_in")) {
    updates.walk_in = String(input.walk_in ?? "false") === "true";
  }

  if (!Object.keys(updates).length) return { ok: true, message: "Không có thay đổi." };

  const { data: after, error: updateError } = await client.from("event_participations").update(updates).eq("id", id).select("*").maybeSingle();
  if (updateError) {
    log("update participation failed", updateError);
    return { ok: false, message: `${SAFE_ERROR} (${updateError.message})` };
  }

  for (const [field, nextValue] of Object.entries(updates)) {
    const oldValue = (before as JsonRecord)[field];
    const correctionType: "status_change" | "admin_note" | "update_field" =
      field === "attendance_status" || field === "registration_status" ? "status_change" : field === "admin_notes" ? "admin_note" : "update_field";
    await writeParticipationAudit(client, {
      targetId: id,
      correctionType,
      fieldName: field,
      oldValue,
      newValue: nextValue,
      reason: "Cập nhật từ Admin Event Workflow"
    });
  }
  await writeAdminAudit(client, { actionType: "update_event_participation", beforeData: before, afterData: after });
  return { ok: true, message: "Đã cập nhật người tham gia.", data: after };
}

export async function removeParticipation(input: { id?: unknown; reason?: unknown }): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const id = clean(input.id);
  if (!id) return { ok: false, message: "Thiếu participation id." };
  if (!isValidUuid(id)) return { ok: false, message: "ID người tham gia không hợp lệ." };

  const { data: before, error: beforeError } = await client.from("event_participations").select("*").eq("id", id).maybeSingle();
  if (beforeError || !before) {
    if (beforeError) log("load participation for delete failed", beforeError);
    return { ok: false, message: beforeError ? `${SAFE_ERROR} (${beforeError.message})` : "Không tìm thấy người tham gia." };
  }

  const { error: deleteError } = await client.from("event_participations").delete().eq("id", id);
  if (deleteError) {
    log("delete participation failed", deleteError);
    return { ok: false, message: `${SAFE_ERROR} (${deleteError.message})` };
  }

  await writeParticipationAudit(client, {
    targetId: id,
    correctionType: "other",
    fieldName: "delete",
    oldValue: JSON.stringify(before),
    newValue: null,
    reason: clean(input.reason) ?? "Xoá người tham gia từ Admin Event Workflow"
  });
  await writeAdminAudit(client, { actionType: "remove_event_participation", beforeData: before });
  return { ok: true, message: "Đã xoá người tham gia." };
}

// ---------------------------------------------------------------------------
// Phase 045A — Cancel event
// ---------------------------------------------------------------------------

export async function cancelEvent(input: { id?: unknown; reason?: unknown }): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const id = clean(input.id);
  if (!id) return { ok: false, message: "Thiếu event id." };
  if (!isValidUuid(id)) return { ok: false, message: "ID sự kiện không hợp lệ." };

  const { data: before, error: beforeError } = await client
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (beforeError) {
    log("load event for cancel failed", beforeError);
    return { ok: false, message: `${SAFE_ERROR} (${beforeError.message})` };
  }
  if (!before) return { ok: false, message: "Không tìm thấy sự kiện." };
  if ((before as JsonRecord).status === "cancelled") {
    return { ok: true, message: "Sự kiện đã ở trạng thái đã hủy." };
  }

  const { data: after, error: updateError } = await client
    .from("events")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    log("cancel event failed", updateError);
    return { ok: false, message: `${SAFE_ERROR} (${updateError.message})` };
  }

  await writeAdminAudit(client, {
    actionType: "cancel_event",
    beforeData: before,
    afterData: after,
    details: { reason: clean(input.reason) }
  });
  return { ok: true, message: "Đã hủy sự kiện.", data: after };
}

// ---------------------------------------------------------------------------
// Phase 045B — Bulk add participants from a batch
// ---------------------------------------------------------------------------

export type BulkAddGroup = "approved_mentees_in_batch" | "approved_mentors_in_batch";

export type BulkAddResult = MutationResult & {
  addedCount?: number;
  skippedCount?: number;
};

export async function bulkAddEventParticipants(input: {
  event_id?: unknown;
  group?: unknown;
}): Promise<BulkAddResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const eventId = clean(input.event_id);
  if (!eventId) return { ok: false, message: "Thiếu event id." };
  if (!isValidUuid(eventId)) return { ok: false, message: "ID sự kiện không hợp lệ." };

  const group = String(input.group ?? "").trim() as BulkAddGroup;
  if (group !== "approved_mentees_in_batch" && group !== "approved_mentors_in_batch") {
    return { ok: false, message: "Nhóm không hợp lệ." };
  }

  // Load event for intake_batch_id + season_id
  const { data: event, error: eventError } = await client
    .from("events")
    .select("id,season_id,intake_batch_id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) {
    log("load event for bulk add failed", eventError);
    return { ok: false, message: `${SAFE_ERROR} (${eventError.message})` };
  }
  if (!event) return { ok: false, message: "Không tìm thấy sự kiện." };

  const intakeBatchId = (event as JsonRecord).intake_batch_id as string | null;
  if (!intakeBatchId) {
    return {
      ok: false,
      message: "Sự kiện này chưa được gắn với Intake Batch. Vui lòng sửa sự kiện và chọn batch trước."
    };
  }

  // Load profiles for this batch
  const profileTable = group === "approved_mentees_in_batch" ? "mentee_profiles" : "mentor_profiles";
  const roleValue: EventRoleValue = group === "approved_mentees_in_batch" ? "mentee" : "mentor";

  const { data: profiles, error: profileError } = await client
    .from(profileTable)
    .select("id,person_id")
    .eq("intake_batch_id", intakeBatchId);
  if (profileError) {
    log(`load ${profileTable} for bulk add failed`, profileError);
    return { ok: false, message: `${SAFE_ERROR} (${profileError.message})` };
  }

  const profileList = (profiles ?? []) as Array<{ id: string; person_id: string | null }>;
  const candidatePersonIds = profileList
    .map((p) => p.person_id)
    .filter((id): id is string => Boolean(id) && isValidUuid(id));

  if (!candidatePersonIds.length) {
    return {
      ok: true,
      message: "Không có hồ sơ nào trong batch này.",
      addedCount: 0,
      skippedCount: 0
    };
  }

  // Load existing participations for this event to detect duplicates
  const { data: existing, error: existingError } = await client
    .from("event_participations")
    .select("person_id")
    .eq("event_id", eventId);
  if (existingError) {
    log("load existing participations for bulk add failed", existingError);
    return { ok: false, message: `${SAFE_ERROR} (${existingError.message})` };
  }

  const alreadyIn = new Set(
    (existing ?? []).map((r: JsonRecord) => r.person_id as string).filter(Boolean)
  );
  const newPersonIds = candidatePersonIds.filter((id) => !alreadyIn.has(id));
  const skippedCount = candidatePersonIds.length - newPersonIds.length;

  if (!newPersonIds.length) {
    return {
      ok: true,
      message: `Tất cả ${candidatePersonIds.length} người trong batch đã có trong sự kiện.`,
      addedCount: 0,
      skippedCount
    };
  }

  const capturedBy = access.admin?.email ?? "admin";
  const eventSeasonId = (event as JsonRecord).season_id as string | null;
  const rows: JsonRecord[] = newPersonIds.map((personId) => ({
    event_id: eventId,
    season_id: eventSeasonId,
    person_id: personId,
    role_at_event: roleValue,
    attendance_status: "registered_absent",
    registration_status: "registered",
    captured_by: capturedBy,
    walk_in: false
  }));

  const { error: insertError } = await client.from("event_participations").insert(rows);
  if (insertError) {
    log("bulk add event_participations failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (${insertError.message})` };
  }

  await writeAdminAudit(client, {
    actionType: "bulk_add_event_participants",
    afterData: {
      event_id: eventId,
      group,
      intake_batch_id: intakeBatchId,
      added: newPersonIds.length,
      skipped: skippedCount
    }
  });

  return {
    ok: true,
    message: `Đã thêm ${newPersonIds.length} người. Bỏ qua ${skippedCount} người đã có trong sự kiện.`,
    addedCount: newPersonIds.length,
    skippedCount
  };
}

export {
  ATTENDANCE_STATUS_OPTIONS,
  EVENT_ROLE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  REGISTRATION_STATUS_OPTIONS
} from "@/lib/event-constants";
