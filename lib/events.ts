import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getMenteeProfiles, getMentorProfiles, getPeople, getSeasons } from "@/lib/data";
import { canAccessSeason, canOperateAnyScope, canOperateSeason, getAdminScopeContext, getAllowedSeasonIds, type ScopeFilter } from "@/lib/program-scope";
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
import type { CheckinActionStatus, RegistrationActionStatus } from "@/lib/event-action-types";
import type {
  Event,
  EventLink,
  EventParticipation,
  EventRegistration,
  JsonRecord,
  MenteeProfile,
  MentorProfile,
  Person,
  Season
} from "@/lib/types";

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
  registrationLink: EventLink | null;
  checkinLink: EventLink | null;
  registrations: EventRegistration[];
  seasons: Season[];
  people: Person[];
  mentorProfiles: MentorProfile[];
  menteeProfiles: MenteeProfile[];
};

export type RegistrationDetailData = {
  ok: boolean;
  error: string | null;
  registration: EventRegistration | null;
  event: Event | null;
};

export type PublicRegistrationStatus = "ready" | "not_found" | "inactive" | "not_open" | "closed" | "cancelled" | "error";

export type PublicRegistrationData = {
  ok: boolean;
  status: PublicRegistrationStatus;
  message: string;
  event: Event | null;
  eventLink: Pick<EventLink, "id" | "event_id" | "token" | "opens_at" | "closes_at" | "is_active"> | null;
};

export type PublicCheckinData = PublicRegistrationData;

export type MutationResult = {
  ok: boolean;
  message: string;
  data?: JsonRecord | null;
};

export type PublicRegistrationResult = MutationResult & {
  status: Exclude<RegistrationActionStatus, "idle">;
  eventName?: string | null;
};

export type PublicCheckinResult = MutationResult & {
  status: Exclude<CheckinActionStatus, "idle">;
  eventName?: string | null;
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
  registration_required?: unknown;
  approval_required?: unknown;
  capacity_limit_enabled?: unknown;
  capacity_limit?: unknown;
  waitlist_enabled?: unknown;
  allow_walk_in?: unknown;
  checkin_mode?: unknown;
  checkin_window_enabled?: unknown;
  checkin_opens_at?: unknown;
  checkin_closes_at?: unknown;
  proof_required?: unknown;
  proof_label?: unknown;
  proof_description?: unknown;
  proof_required_for_registration?: unknown;
  proof_required_for_checkin?: unknown;
  question_collection_enabled?: unknown;
  speaker_question_label?: unknown;
  no_show_policy_enabled?: unknown;
  no_show_policy_text?: unknown;
  fee_required?: unknown;
  fee_amount?: unknown;
  fee_currency?: unknown;
  fee_description?: unknown;
  payment_instruction?: unknown;
  payment_proof_required?: unknown;
  event_description?: unknown;
  show_student_id_field?: unknown;
  student_id_required?: unknown;
  show_mentee_code_field?: unknown;
  mentee_code_required?: unknown;
  show_school_field?: unknown;
  show_program_field?: unknown;
  show_role_text_field?: unknown;
  show_notes_field?: unknown;
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

export type PublicRegistrationInput = {
  token?: unknown;
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  student_id?: unknown;
  school?: unknown;
  program_of_study?: unknown;
  role_text?: unknown;
  notes?: unknown;
  consent_given?: unknown;
  mentee_code?: unknown;
  proof_url?: unknown;
  proof_note?: unknown;
  speaker_question?: unknown;
  payment_proof_url?: unknown;
  payment_proof_note?: unknown;
};

export type PublicCheckinInput = {
  token?: unknown;
  email?: unknown;
  full_name?: unknown;
  phone?: unknown;
  student_id?: unknown;
  notes?: unknown;
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
  const ctx = await getAdminScopeContext();
  if (!canOperateAnyScope(ctx)) return { ok: false, message: "Ban khong co quyen operations trong pham vi chuong trinh." };
  return { ok: true, admin };
}

function validEventType(value: unknown): EventTypeValue | null {
  const text = String(value ?? "").trim();
  return EVENT_TYPE_VALUES.has(text as EventTypeValue) ? (text as EventTypeValue) : null;
}

function validAttendanceStatus(value: unknown): AttendanceStatusValue {
  const text = String(value ?? "").trim();
  return ATTENDANCE_STATUS_VALUES.has(text as AttendanceStatusValue) ? (text as AttendanceStatusValue) : "unknown";
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

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function publicLinkWindowStatus(link: Pick<EventLink, "is_active" | "opens_at" | "closes_at">) {
  if (!link.is_active) return { status: "inactive" as const, message: "Liên kết đăng ký hiện không hoạt động." };
  const now = Date.now();
  if (link.opens_at) {
    const opensAt = new Date(link.opens_at).getTime();
    if (!Number.isNaN(opensAt) && now < opensAt) {
      return { status: "not_open" as const, message: "Đăng ký sự kiện chưa mở." };
    }
  }
  if (link.closes_at) {
    const closesAt = new Date(link.closes_at).getTime();
    if (!Number.isNaN(closesAt) && now > closesAt) {
      return { status: "closed" as const, message: "Đăng ký sự kiện đã đóng." };
    }
  }
  return { status: "ready" as const, message: "Sẵn sàng đăng ký." };
}

async function selectAllScopedBySeason<T>(client: any, table: string, columns: string, allowedSeasonIds?: string[]) {
  if (!allowedSeasonIds) return selectAll<T>(client, table, columns);
  if (allowedSeasonIds.length === 0) return { data: [] as T[], error: null as string | null };
  const { data, error } = await client.from(table).select(columns).in("season_id", allowedSeasonIds);
  if (error) {
    log(`${table} scoped select failed`, error);
    return { data: [] as T[], error: error.message as string };
  }
  return { data: (data ?? []) as T[], error: null as string | null };
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
      after_data: input.afterData ?? null
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

export async function getEventListData(scope?: ScopeFilter): Promise<EventListData> {
  const { client, error } = clientResult();
  if (!client) return { ok: false, error, events: [], participations: [], seasons: [], people: [] };

  const allowedSeasonIds = scope?.allowedSeasonIds;
  const [events, participations, seasons, people] = await Promise.all([
    selectAllScopedBySeason<Event>(client, "events", "id,legacy_event_temp_id,season_id,intake_batch_id,status,event_name,event_type,starts_at,source_notes", allowedSeasonIds),
    selectAllScopedBySeason<EventParticipation>(client, "event_participations", "id,event_id,season_id,person_id,role_at_event,registration_status,attendance_status,attendance_date,recap_url,excuse_reason,admin_notes,captured_by,walk_in", allowedSeasonIds),
    allowedSeasonIds
      ? allowedSeasonIds.length
        ? client.from("seasons").select("id,code,name").in("id", allowedSeasonIds).then((res: any) => ({ data: (res.data ?? []) as Season[], error: res.error?.message ?? null }))
        : Promise.resolve({ data: [] as Season[], error: null })
      : selectAll<Season>(client, "seasons", "id,code,name"),
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

export async function getEventDetailData(eventId: string, scope?: ScopeFilter): Promise<EventDetailData> {
  const empty = {
    event: null,
    participations: [],
    registrationLink: null,
    checkinLink: null,
    registrations: [],
    seasons: [],
    people: [],
    mentorProfiles: [],
    menteeProfiles: []
  };
  const { client, error } = clientResult();
  if (!client) return { ok: false, error, ...empty };

  const id = clean(eventId);
  if (!id) return { ok: false, error: "Thiếu event id.", ...empty };
  if (!isValidUuid(id)) {
    return { ok: false, error: "ID sự kiện không hợp lệ.", ...empty };
  }

  const eventRes = await client
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const scopedLookups = await Promise.all([
    getSeasons(scope),
    getPeople(scope),
    getMentorProfiles(scope),
    getMenteeProfiles(scope)
  ]);
  const [seasonsRes, peopleRes, mentorsRes, menteesRes] = scopedLookups;

  if (eventRes.error) {
    log("event load failed", eventRes.error);
    return {
      ok: false,
      error: eventRes.error.message,
      event: null,
      participations: [],
      registrationLink: null,
      checkinLink: null,
      registrations: [],
      seasons: seasonsRes.data,
      people: peopleRes.data,
      mentorProfiles: mentorsRes.data,
      menteeProfiles: menteesRes.data
    };
  }
  if (scope?.allowedSeasonIds && eventRes.data?.season_id && !scope.allowedSeasonIds.includes(eventRes.data.season_id)) {
    return {
      ok: false,
      error: null,
      event: null,
      participations: [],
      registrationLink: null,
      checkinLink: null,
      registrations: [],
      seasons: seasonsRes.data,
      people: [],
      mentorProfiles: [],
      menteeProfiles: []
    };
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

  const [{ data: linkData, error: linkErr }, { data: registrationData, error: registrationErr }] = await Promise.all([
    client
      .from("event_links")
      .select("id,event_id,link_type,token,is_active,opens_at,closes_at,created_by,created_at,updated_at")
      .eq("event_id", id)
      .in("link_type", ["registration", "checkin"]),
    client
      .from("event_registrations")
      .select("id,event_id,event_link_id,linked_person_id,full_name,email,phone,student_id,school,program_of_study,role_text,notes,consent_given,registration_source,registration_status,attendance_status,is_walk_in,registered_at,checked_in_at,checkin_source,match_method,match_review_status,matched_at,created_at,updated_at,mentee_code,proof_url,proof_note,proof_status,review_status,review_note,confirmed_at,waitlisted_at,rejected_at,payment_status,payment_proof_url,no_show_flagged,blacklist_flag")
      .eq("event_id", id)
      .order("registered_at", { ascending: false })
  ]);
  if (linkErr) log("event_links load failed", linkErr);
  if (registrationErr) log("event_registrations load failed", registrationErr);

  const errors = [
    partsRes.error,
    linkErr?.message,
    registrationErr?.message,
    seasonsRes.error,
    peopleRes.error,
    mentorsRes.error,
    menteesRes.error
  ].filter(Boolean);
  return {
    ok: !errors.length,
    error: errors.join(" | ") || null,
    event: (eventRes.data as Event) ?? null,
    participations: partsRes.data,
    registrationLink: ((linkData ?? []) as EventLink[]).find((link) => link.link_type === "registration") ?? null,
    checkinLink: ((linkData ?? []) as EventLink[]).find((link) => link.link_type === "checkin") ?? null,
    registrations: (registrationData ?? []) as EventRegistration[],
    seasons: seasonsRes.data,
    people: peopleRes.data,
    mentorProfiles: mentorsRes.data,
    menteeProfiles: menteesRes.data
  };
}

/**
 * Fetch a single registration record (all columns via "*") and its parent event.
 * Used by the admin registration detail / review page.
 */
export async function getRegistrationDetail(
  eventId: string,
  registrationId: string,
  scope?: ScopeFilter
): Promise<RegistrationDetailData> {
  const { client, error } = clientResult();
  if (!client) return { ok: false, error, registration: null, event: null };

  const [regRes, eventRes] = await Promise.all([
    client
      .from("event_registrations")
      .select("*")
      .eq("id", registrationId)
      .eq("event_id", eventId)
      .maybeSingle(),
    client
      .from("events")
      .select("id,event_name,starts_at,season_id,event_type")
      .eq("id", eventId)
      .maybeSingle()
  ]);

  if (regRes.error) {
    log("registration detail load failed", regRes.error);
    return { ok: false, error: regRes.error.message, registration: null, event: eventRes.data as Event | null };
  }

  // Scope guard: ensure event belongs to an allowed season
  if (
    scope?.allowedSeasonIds &&
    eventRes.data?.season_id &&
    !scope.allowedSeasonIds.includes(eventRes.data.season_id)
  ) {
    return { ok: false, error: null, registration: null, event: null };
  }

  return {
    ok: true,
    error: eventRes.error?.message ?? null,
    registration: (regRes.data as EventRegistration) ?? null,
    event: (eventRes.data as Event) ?? null
  };
}

export async function getPublicRegistrationData(token: string): Promise<PublicRegistrationData> {
  return getPublicEventLinkData(token, "registration");
}

export async function getPublicCheckinData(token: string): Promise<PublicCheckinData> {
  return getPublicEventLinkData(token, "checkin");
}

async function getPublicEventLinkData(token: string, linkType: "registration" | "checkin"): Promise<PublicRegistrationData> {
  const { client, error } = clientResult();
  if (!client) {
    return {
      ok: false,
      status: "error",
      message: error ?? SAFE_ERROR,
      event: null,
      eventLink: null
    };
  }

  const cleanToken = clean(token);
  if (!cleanToken || !isValidUuid(cleanToken)) {
    return {
      ok: false,
      status: "not_found",
      message: linkType === "checkin" ? "Không tìm thấy liên kết check-in." : "Không tìm thấy liên kết đăng ký.",
      event: null,
      eventLink: null
    };
  }

  const { data, error: linkError } = await client
    .from("event_links")
    .select("id,event_id,link_type,token,is_active,opens_at,closes_at,events(*)")
    .eq("token", cleanToken)
    .eq("link_type", linkType)
    .maybeSingle();

  if (linkError) {
    log("public registration link load failed", linkError);
    return {
      ok: false,
      status: "error",
      message: linkType === "checkin" ? "Không thể tải liên kết check-in." : "Không thể tải liên kết đăng ký.",
      event: null,
      eventLink: null
    };
  }
  if (!data) {
    return {
      ok: false,
      status: "not_found",
      message: linkType === "checkin" ? "Không tìm thấy liên kết check-in." : "Không tìm thấy liên kết đăng ký.",
      event: null,
      eventLink: null
    };
  }

  const event = Array.isArray((data as JsonRecord).events)
    ? ((data as JsonRecord).events[0] as Event | undefined)
    : ((data as JsonRecord).events as Event | undefined);
  const link = data as unknown as Pick<EventLink, "id" | "event_id" | "token" | "opens_at" | "closes_at" | "is_active">;
  if (!event) {
    return {
      ok: false,
      status: "not_found",
      message: "Không tìm thấy sự kiện cho liên kết này.",
      event: null,
      eventLink: link
    };
  }
  if (event.status === "cancelled") {
    return {
      ok: false,
      status: "cancelled",
      message: "Sự kiện này đã hủy đăng ký.",
      event,
      eventLink: link
    };
  }

  const window = publicLinkWindowStatus(link);
  return {
    ok: window.status === "ready",
    status: window.status,
    message: window.message,
    event,
    eventLink: link
  };
}

export async function registerForEvent(input: PublicRegistrationInput): Promise<PublicRegistrationResult> {
  const token = clean(input.token);
  if (!token || !isValidUuid(token)) {
    return { ok: false, status: "link_error", message: "Liên kết đăng ký không hợp lệ." };
  }

  const fullName = clean(input.full_name);
  const emailRaw = clean(input.email);
  const email = normalizeEmail(emailRaw);
  const consentGiven = input.consent_given === true || String(input.consent_given ?? "").trim() === "on";

  if (!fullName) return { ok: false, status: "validation_error", message: "Vui lòng nhập họ và tên." };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: "validation_error", message: "Vui lòng nhập email hợp lệ." };
  }
  if (!consentGiven) {
    return { ok: false, status: "validation_error", message: "Vui lòng xác nhận đồng ý trước khi đăng ký." };
  }

  const registrationData = await getPublicRegistrationData(token);
  if (!registrationData.ok || !registrationData.event || !registrationData.eventLink) {
    return { ok: false, status: "link_error", message: registrationData.message, eventName: registrationData.event?.event_name ?? null };
  }

  const { client, error } = clientResult();
  if (!client) return { ok: false, status: "server_error", message: "Không thể hoàn tất đăng ký lúc này.", eventName: registrationData.event.event_name ?? null };

  const eventId = registrationData.event.id;
  const { data: existingRows, error: existingError } = await client
    .from("event_registrations")
    .select("id,email,registration_status")
    .eq("event_id", eventId)
    .neq("registration_status", "cancelled");

  if (existingError) {
    log("public registration duplicate check failed", existingError);
    return { ok: false, status: "server_error", message: "Không thể hoàn tất đăng ký lúc này.", eventName: registrationData.event.event_name ?? null };
  }

  const duplicate = ((existingRows ?? []) as Array<{ email: string | null }>).some((row) => normalizeEmail(row.email) === email);
  if (duplicate) {
    return { ok: true, status: "already_registered", message: "Bạn đã đăng ký sự kiện này rồi", eventName: registrationData.event.event_name ?? null };
  }

  const { data: peopleData, error: peopleError } = await client
    .from("people")
    .select("id,email_primary")
    .ilike("email_primary", email);
  if (peopleError) {
    log("public registration people match failed", peopleError);
    return { ok: false, status: "server_error", message: "Không thể hoàn tất đăng ký lúc này.", eventName: registrationData.event.event_name ?? null };
  }

  const matchedPerson = ((peopleData ?? []) as Array<{ id: string; email_primary: string | null }>).find(
    (person) => normalizeEmail(person.email_primary) === email
  );
  const nowIso = matchedPerson ? new Date().toISOString() : null;

  const cfg = readEventConfig(registrationData.event as JsonRecord);

  // SF-3: server-side proof / payment validation (HTML `required` alone is bypassable)
  if (registrationData.event.proof_required_for_registration && !clean(input.proof_url)) {
    return { ok: false, status: "validation_error", message: "Vui lòng cung cấp đường dẫn minh chứng.", eventName: registrationData.event.event_name ?? null };
  }
  if (registrationData.event.payment_proof_required && !clean(input.payment_proof_url)) {
    return { ok: false, status: "validation_error", message: "Vui lòng cung cấp đường dẫn ảnh chuyển khoản.", eventName: registrationData.event.event_name ?? null };
  }

  const activeRegistrationsCount = (existingRows ?? []).length;
  const isFull = cfg.capacity_limit_enabled && cfg.capacity_limit != null && activeRegistrationsCount >= cfg.capacity_limit;

  if (isFull && !cfg.waitlist_enabled) {
    return { ok: false, status: "capacity_full", message: "Sự kiện đã đủ chỗ. Đăng ký đã đóng.", eventName: registrationData.event.event_name ?? null };
  }

  const baseStatus = isFull ? "waitlisted" : (cfg.approval_required ? "pending_review" : "registered");
  const proofUrl = clean(input.proof_url);
  const paymentProofUrl = clean(input.payment_proof_url);

  const payload: JsonRecord = {
    event_id: eventId,
    event_link_id: registrationData.eventLink.id,
    linked_person_id: matchedPerson?.id ?? null,
    full_name: fullName,
    email,
    phone: clean(input.phone),
    student_id: clean(input.student_id),
    school: clean(input.school),
    program_of_study: clean(input.program_of_study),
    role_text: clean(input.role_text),
    notes: clean(input.notes),
    consent_given: true,
    registration_source: "public_form",
    registration_status: baseStatus,
    attendance_status: "pending",
    is_walk_in: false,
    match_method: matchedPerson ? "exact_email" : "unlinked",
    match_review_status: matchedPerson ? "auto_linked" : "pending_review",
    matched_at: nowIso,
    mentee_code: clean(input.mentee_code),
    proof_url: proofUrl,
    proof_note: clean(input.proof_note),
    speaker_question: clean(input.speaker_question),
    payment_proof_url: paymentProofUrl,
    payment_proof_note: clean(input.payment_proof_note),
    proof_status: proofUrl ? "submitted" : "not_required",
    payment_status: paymentProofUrl ? "submitted" : (registrationData.event.fee_required ? "pending" : "not_required"),
    review_status: cfg.approval_required ? "pending" : "not_required"
  };

  const { data, error: insertError } = await client
    .from("event_registrations")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return { ok: true, status: "already_registered", message: "Bạn đã đăng ký sự kiện này rồi", eventName: registrationData.event.event_name ?? null };
    }
    log("public registration insert failed", insertError);
    return { ok: false, status: "server_error", message: "Không thể hoàn tất đăng ký lúc này.", eventName: registrationData.event.event_name ?? null };
  }

  return {
    ok: true,
    status: "success",
    message: "Đăng ký thành công",
    eventName: registrationData.event.event_name ?? null,
    data
  };
}

async function syncCheckedInParticipation(client: any, input: {
  eventId: string;
  seasonId: string | null;
  personId: string | null;
}) {
  if (!input.personId) return { ok: true };

  const { data: existing, error: existingError } = await client
    .from("event_participations")
    .select("id")
    .eq("event_id", input.eventId)
    .eq("person_id", input.personId);
  if (existingError) {
    log("check event_participations for check-in sync failed", existingError);
    return { ok: false };
  }

  const existingIds = ((existing ?? []) as Array<{ id: string }>).map((row) => row.id).filter(Boolean);
  if (existingIds.length) {
    const { error: updateError } = await client
      .from("event_participations")
      .update({
        attendance_status: "attended",
        registration_status: "registered",
        attendance_date: new Date().toISOString().slice(0, 10)
      })
      .in("id", existingIds);
    if (updateError) {
      log("update event_participations for check-in sync failed", updateError);
      return { ok: false };
    }
    return { ok: true };
  }

  const { error: insertError } = await client.from("event_participations").insert({
    event_id: input.eventId,
    season_id: input.seasonId,
    person_id: input.personId,
    role_at_event: "unknown",
    registration_status: "registered",
    attendance_status: "attended",
    attendance_date: new Date().toISOString().slice(0, 10),
    captured_by: "self_qr",
    walk_in: false
  });
  if (insertError) {
    log("insert event_participations for check-in sync failed", insertError);
    return { ok: false };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 2A: check-in rules engine helpers
// ---------------------------------------------------------------------------

type EventConfig = {
  season_id: string | null;
  checkin_mode: string;
  checkin_window_enabled: boolean;
  checkin_opens_at: string | null;
  checkin_closes_at: string | null;
  allow_walk_in: boolean;
  registration_required: boolean;
  approval_required: boolean;
  capacity_limit_enabled: boolean;
  capacity_limit: number | null;
  waitlist_enabled: boolean;
};

function readEventConfig(ev: JsonRecord): EventConfig {
  return {
    season_id:              (ev.season_id as string | null) ?? null,
    checkin_mode:           String(ev.checkin_mode ?? "open").trim() || "open",
    checkin_window_enabled: ev.checkin_window_enabled === true,
    checkin_opens_at:       (ev.checkin_opens_at as string | null) ?? null,
    checkin_closes_at:      (ev.checkin_closes_at as string | null) ?? null,
    allow_walk_in:          ev.allow_walk_in !== false,   // default true
    registration_required:  ev.registration_required === true,
    approval_required:      ev.approval_required === true,
    capacity_limit_enabled: ev.capacity_limit_enabled === true,
    capacity_limit:         ev.capacity_limit != null ? Number(ev.capacity_limit) : null,
    waitlist_enabled:       ev.waitlist_enabled === true,
  };
}

/**
 * Determine whether an existing registration grants access in confirmed_only mode.
 * Returns true when the admin has explicitly confirmed the registration, OR when
 * the event does not require approval (in which case 'registered' is implicitly confirmed).
 */
function isConfirmedForCheckin(regStatus: string, approvalRequired: boolean): boolean {
  if (regStatus === "confirmed") return true;
  if (!approvalRequired && regStatus === "registered") return true;
  return false;
}

export async function checkInForEvent(input: PublicCheckinInput): Promise<PublicCheckinResult> {
  // ── 1. Basic input validation ─────────────────────────────────────────────
  const token = clean(input.token);
  if (!token || !isValidUuid(token)) {
    return { ok: false, status: "link_error", message: "Liên kết check-in không hợp lệ." };
  }

  const email = normalizeEmail(input.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: "validation_error", message: "Vui lòng nhập email hợp lệ." };
  }

  // ── 2. Validate public link (time window, active flag, event status) ───────
  const linkData = await getPublicCheckinData(token);
  if (!linkData.ok || !linkData.event || !linkData.eventLink) {
    return {
      ok: false,
      status: "link_error",
      message: linkData.message,
      eventName: linkData.event?.event_name ?? null
    };
  }

  const { client, error } = clientResult();
  if (!client) {
    return {
      ok: false,
      status: "server_error",
      message: "Không thể check-in lúc này.",
      eventName: linkData.event.event_name ?? null
    };
  }

  const eventId = linkData.event.id;
  const displayName = linkData.event.event_name ?? null;

  // ── 3. Load event with Phase 2 config fields ──────────────────────────────
  const { data: eventRow, error: eventError } = await client
    .from("events")
    .select([
      "id", "season_id",
      // Phase 2 config
      "checkin_mode", "checkin_window_enabled", "checkin_opens_at", "checkin_closes_at",
      "allow_walk_in", "registration_required", "approval_required",
      "capacity_limit_enabled", "capacity_limit"
    ].join(","))
    .eq("id", eventId)
    .maybeSingle();

  if (eventError || !eventRow) {
    if (eventError) log("load event config for check-in failed", eventError);
    return { ok: false, status: "server_error", message: "Không thể check-in lúc này.", eventName: displayName };
  }

  const cfg = readEventConfig(eventRow as JsonRecord);

  // ── 4. Rule: manual_admin_only blocks all public self-check-in ────────────
  if (cfg.checkin_mode === "manual_admin_only") {
    return {
      ok: false,
      status: "self_checkin_disabled",
      message: "Sự kiện này không hỗ trợ tự check-in. Vui lòng liên hệ ban tổ chức tại sự kiện.",
      eventName: displayName
    };
  }

  // ── 5. Rule: check-in window (secondary time gate) ────────────────────────
  if (cfg.checkin_window_enabled) {
    const now = Date.now();
    if (cfg.checkin_opens_at) {
      const opensAt = new Date(cfg.checkin_opens_at).getTime();
      if (!Number.isNaN(opensAt) && now < opensAt) {
        return {
          ok: false,
          status: "checkin_not_open",
          message: "Check-in chưa bắt đầu. Vui lòng quay lại đúng giờ.",
          eventName: displayName
        };
      }
    }
    if (cfg.checkin_closes_at) {
      const closesAt = new Date(cfg.checkin_closes_at).getTime();
      if (!Number.isNaN(closesAt) && now > closesAt) {
        return {
          ok: false,
          status: "checkin_closed",
          message: "Thời gian check-in đã kết thúc.",
          eventName: displayName
        };
      }
    }
  }

  // ── 6. Load all registrations for this event (all statuses) ──────────────
  // We load all (including cancelled) so we can return specific messages for
  // cancelled / rejected / waitlisted registrants instead of "not registered".
  const { data: allRows, error: allRowsError } = await client
    .from("event_registrations")
    .select("id,email,attendance_status,linked_person_id,registration_status,is_walk_in,review_status")
    .eq("event_id", eventId);

  if (allRowsError) {
    log("check existing registration for check-in failed", allRowsError);
    return { ok: false, status: "server_error", message: "Không thể check-in lúc này.", eventName: displayName };
  }

  const allRegistrations = (allRows ?? []) as EventRegistration[];

  // Find the best-matching registration for this email:
  //   prefer non-cancelled (could be any Phase 2 status), fall back to cancelled.
  const activeReg = allRegistrations.find(
    (r) => normalizeEmail(r.email) === email && r.registration_status !== "cancelled"
  ) ?? null;
  const cancelledReg = !activeReg
    ? (allRegistrations.find((r) => normalizeEmail(r.email) === email && r.registration_status === "cancelled") ?? null)
    : null;

  // ── 7. Mode-specific rules for participants who have a registration ────────
  if (activeReg) {
    const regStatus = String(activeReg.registration_status ?? "registered").trim();

    // confirmed_only: must be explicitly confirmed (or implicitly via no approval required)
    if (cfg.checkin_mode === "confirmed_only") {
      if (!isConfirmedForCheckin(regStatus, cfg.approval_required)) {
        if (regStatus === "pending_review") {
          return {
            ok: false,
            status: "pending_approval",
            message: "Đăng ký của bạn đang chờ xác nhận từ ban tổ chức. Vui lòng chờ thông báo.",
            eventName: displayName
          };
        }
        if (regStatus === "waitlisted") {
          return {
            ok: false,
            status: "registration_waitlisted",
            message: "Bạn đang trong danh sách dự phòng. Vui lòng liên hệ ban tổ chức để biết thêm thông tin.",
            eventName: displayName
          };
        }
        if (regStatus === "rejected") {
          return {
            ok: false,
            status: "registration_rejected",
            message: "Đăng ký của bạn đã bị từ chối. Vui lòng liên hệ ban tổ chức nếu bạn có thắc mắc.",
            eventName: displayName
          };
        }
        return {
          ok: false,
          status: "not_confirmed",
          message: "Đăng ký của bạn chưa được xác nhận. Vui lòng liên hệ ban tổ chức.",
          eventName: displayName
        };
      }
    }

    // Duplicate check-in (must come after mode checks so we give the right error first)
    if (activeReg.attendance_status === "checked_in") {
      return {
        ok: true,
        status: "already_checked_in",
        message: "Bạn đã check-in sự kiện này rồi.",
        eventName: displayName
      };
    }

    // ── 8. Update attendance for pre-registered participant ────────────────
    const { data: updated, error: updateError } = await client
      .from("event_registrations")
      .update({
        attendance_status: "checked_in",
        checked_in_at: new Date().toISOString(),
        checkin_source: "self_qr"
      })
      .eq("id", activeReg.id)
      .select("id,linked_person_id")
      .maybeSingle();

    if (updateError) {
      log("update registration check-in failed", updateError);
      return { ok: false, status: "server_error", message: "Không thể check-in lúc này.", eventName: displayName };
    }

    const linkedPersonId = (updated as JsonRecord | null)?.linked_person_id as string | null;
    await syncCheckedInParticipation(client, {
      eventId,
      seasonId: cfg.season_id,
      personId: linkedPersonId
    });

    return { ok: true, status: "success", message: "Check-in thành công!", eventName: displayName };
  }

  // ── 9. No active registration found — walk-in path ───────────────────────

  // If there is a cancelled registration, provide a specific message for
  // restricted modes rather than the generic "not registered".
  if (cancelledReg && (cfg.checkin_mode === "registration_required" || cfg.checkin_mode === "confirmed_only")) {
    return {
      ok: false,
      status: "registration_cancelled_status",
      message: "Đăng ký của bạn đã bị hủy. Vui lòng liên hệ ban tổ chức.",
      eventName: displayName
    };
  }

  // registration_required and confirmed_only block all walk-ins
  if (cfg.checkin_mode === "registration_required" || cfg.checkin_mode === "confirmed_only") {
    return {
      ok: false,
      status: "not_registered",
      message: "Email của bạn chưa có trong danh sách đăng ký sự kiện này. Vui lòng đăng ký trước.",
      eventName: displayName
    };
  }

  // allow_walk_in = false blocks walk-in (open mode only reaches here)
  if (!cfg.allow_walk_in) {
    return {
      ok: false,
      status: "walk_in_blocked",
      message: "Sự kiện này không nhận walk-in. Vui lòng đăng ký trước hoặc liên hệ ban tổ chức.",
      eventName: displayName
    };
  }

  // Capacity check for walk-ins (existing registrants hold their slot regardless)
  if (cfg.capacity_limit_enabled && cfg.capacity_limit != null) {
    const activeCount = allRegistrations.filter((r) => r.registration_status !== "cancelled").length;
    if (activeCount >= cfg.capacity_limit) {
      return {
        ok: false,
        status: "event_full",
        message: "Sự kiện đã đủ chỗ. Không thể check-in walk-in.",
        eventName: displayName
      };
    }
  }

  // ── 10. Create walk-in registration ───────────────────────────────────────
  const fullName = clean(input.full_name);
  if (!fullName) {
    return {
      ok: false,
      status: "validation_error",
      message: "Vui lòng nhập họ và tên để check-in walk-in.",
      eventName: displayName
    };
  }

  const { data: peopleData, error: peopleError } = await client
    .from("people")
    .select("id,email_primary")
    .ilike("email_primary", email);
  if (peopleError) {
    log("people match for walk-in check-in failed", peopleError);
    return { ok: false, status: "server_error", message: "Không thể check-in lúc này.", eventName: displayName };
  }

  const matchedPerson = ((peopleData ?? []) as Array<{ id: string; email_primary: string | null }>).find(
    (person) => normalizeEmail(person.email_primary) === email
  );
  const nowIso = new Date().toISOString();

  const payload: JsonRecord = {
    event_id: eventId,
    event_link_id: linkData.eventLink.id,
    linked_person_id: matchedPerson?.id ?? null,
    full_name: fullName,
    email,
    phone: clean(input.phone),
    student_id: clean(input.student_id),
    school: null,
    program_of_study: null,
    role_text: null,
    notes: clean(input.notes),
    consent_given: false,
    registration_source: "walk_in",
    registration_status: "registered",
    attendance_status: "checked_in",
    is_walk_in: true,
    checked_in_at: nowIso,
    checkin_source: "self_qr",
    match_method: matchedPerson ? "exact_email" : "unlinked",
    match_review_status: matchedPerson ? "auto_linked" : "pending_review",
    matched_at: matchedPerson ? nowIso : null
  };

  const { data: inserted, error: insertError } = await client
    .from("event_registrations")
    .insert(payload)
    .select("id,linked_person_id")
    .maybeSingle();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return { ok: true, status: "already_checked_in", message: "Bạn đã check-in sự kiện này rồi.", eventName: displayName };
    }
    log("insert walk-in check-in failed", insertError);
    return { ok: false, status: "server_error", message: "Không thể check-in lúc này.", eventName: displayName };
  }

  const linkedPersonId = (inserted as JsonRecord | null)?.linked_person_id as string | null;
  await syncCheckedInParticipation(client, {
    eventId,
    seasonId: cfg.season_id,
    personId: linkedPersonId
  });

  return { ok: true, status: "success", message: "Check-in thành công!", eventName: displayName };
}

async function createEventLinkForEvent(eventId: unknown, linkType: "registration" | "checkin"): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const id = clean(eventId);
  if (!id) return { ok: false, message: "Thiếu event id." };
  if (!isValidUuid(id)) return { ok: false, message: "ID sự kiện không hợp lệ." };

  const { data: event, error: eventError } = await client
    .from("events")
    .select("id,season_id")
    .eq("id", id)
    .maybeSingle();
  if (eventError) {
    log("load event for registration link failed", eventError);
    return { ok: false, message: `${SAFE_ERROR} (${eventError.message})` };
  }
  if (!event) return { ok: false, message: "Không tìm thấy sự kiện." };

  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, clean((event as JsonRecord).season_id)))) {
    return { ok: false, message: "Ban khong co quyen operations trong mua cua su kien nay." };
  }

  const { data: existing, error: existingError } = await client
    .from("event_links")
    .select("id,event_id,link_type,token,is_active,opens_at,closes_at,created_by,created_at,updated_at")
    .eq("event_id", id)
    .eq("link_type", linkType)
    .maybeSingle();
  if (existingError) {
    log("load existing registration link failed", existingError);
    return { ok: false, message: `${SAFE_ERROR} (${existingError.message})` };
  }
  if (existing) {
    return { ok: true, message: linkType === "checkin" ? "Liên kết check-in đã tồn tại." : "Liên kết đăng ký đã tồn tại.", data: existing as EventLink };
  }

  const { data, error: insertError } = await client
    .from("event_links")
    .insert({
      event_id: id,
      link_type: linkType,
      created_by: access.admin?.id ?? null
    })
    .select("id,event_id,link_type,token,is_active,opens_at,closes_at,created_by,created_at,updated_at")
    .maybeSingle();
  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      const { data: retry } = await client
        .from("event_links")
        .select("id,event_id,link_type,token,is_active,opens_at,closes_at,created_by,created_at,updated_at")
        .eq("event_id", id)
        .eq("link_type", linkType)
        .maybeSingle();
      if (retry) {
        return { ok: true, message: linkType === "checkin" ? "Liên kết check-in đã tồn tại." : "Liên kết đăng ký đã tồn tại.", data: retry as EventLink };
      }
    }
    log("create registration link failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (${insertError.message})` };
  }

  await writeAdminAudit(client, {
    actionType: linkType === "checkin" ? "create_event_checkin_link" : "create_event_registration_link",
    afterData: { event_id: id, link_type: linkType }
  });
  return { ok: true, message: linkType === "checkin" ? "Đã tạo liên kết check-in." : "Đã tạo liên kết đăng ký.", data: data as EventLink };
}

export async function createRegistrationLinkForEvent(eventId: unknown): Promise<MutationResult> {
  return createEventLinkForEvent(eventId, "registration");
}

export async function createCheckinLinkForEvent(eventId: unknown): Promise<MutationResult> {
  return createEventLinkForEvent(eventId, "checkin");
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

  const ctx = await getAdminScopeContext();
  const allowedSeasonIds = await getAllowedSeasonIds(ctx);
  if (!canAccessSeason(ctx, seasonId, allowedSeasonIds) || !(await canOperateSeason(ctx, seasonId))) {
    return { ok: false, message: "Ban khong co quyen tao su kien trong mua nay." };
  }
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
    legacy_event_temp_id: clean(input.legacy_event_temp_id),
    registration_required: String(input.registration_required) === "true",
    approval_required: String(input.approval_required) === "true",
    capacity_limit_enabled: String(input.capacity_limit_enabled) === "true",
    capacity_limit: input.capacity_limit ? Number(input.capacity_limit) : null,
    waitlist_enabled: String(input.waitlist_enabled) === "true",
    allow_walk_in: String(input.allow_walk_in) !== "false",
    checkin_mode: clean(input.checkin_mode) ?? "open",
    checkin_window_enabled: String(input.checkin_window_enabled) === "true",
    checkin_opens_at: parseDateTime(clean(input.checkin_opens_at)),
    checkin_closes_at: parseDateTime(clean(input.checkin_closes_at)),
    proof_required: String(input.proof_required) === "true",
    proof_label: clean(input.proof_label),
    proof_description: clean(input.proof_description),
    proof_required_for_registration: String(input.proof_required_for_registration) === "true",
    proof_required_for_checkin: String(input.proof_required_for_checkin) === "true",
    question_collection_enabled: String(input.question_collection_enabled) === "true",
    speaker_question_label: clean(input.speaker_question_label),
    no_show_policy_enabled: String(input.no_show_policy_enabled) === "true",
    no_show_policy_text: clean(input.no_show_policy_text),
    fee_required: String(input.fee_required) === "true",
    fee_amount: input.fee_amount ? Number(input.fee_amount) : null,
    fee_currency: clean(input.fee_currency) || "VND",
    fee_description: clean(input.fee_description),
    payment_instruction: clean(input.payment_instruction),
    payment_proof_required: String(input.payment_proof_required) === "true",
    event_description: clean(input.event_description),
    show_student_id_field: String(input.show_student_id_field) !== "false",
    student_id_required: String(input.student_id_required) === "true",
    show_mentee_code_field: String(input.show_mentee_code_field) === "true",
    mentee_code_required: String(input.mentee_code_required) === "true",
    show_school_field: String(input.show_school_field) === "true",
    show_program_field: String(input.show_program_field) === "true",
    show_role_text_field: String(input.show_role_text_field) === "true",
    show_notes_field: String(input.show_notes_field) === "true"
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

  const participationScopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(participationScopeContext, clean(before.season_id)))) {
    return { ok: false, message: "Ban khong co quyen operations trong mua cua su kien nay." };
  }

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
  const ctx = await getAdminScopeContext();
  const allowedSeasonIds = await getAllowedSeasonIds(ctx);
  if (
    !canAccessSeason(ctx, seasonId, allowedSeasonIds) ||
    !canAccessSeason(ctx, clean(before.season_id), allowedSeasonIds) ||
    !(await canOperateSeason(ctx, seasonId)) ||
    !(await canOperateSeason(ctx, clean(before.season_id)))
  ) {
    return { ok: false, message: "Ban khong co quyen sua su kien trong mua nay." };
  }
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

  const checkFields = [
    "registration_required", "approval_required", "capacity_limit_enabled", "waitlist_enabled",
    "checkin_window_enabled", "proof_required", "proof_required_for_registration",
    "proof_required_for_checkin", "question_collection_enabled", "no_show_policy_enabled",
    "fee_required", "payment_proof_required", "show_mentee_code_field", "mentee_code_required",
    "show_school_field", "show_program_field", "show_role_text_field", "show_notes_field", "student_id_required"
  ];
  checkFields.forEach(f => {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      updates[f] = String(input[f as keyof EventInput]) === "true";
    }
  });

  if (Object.prototype.hasOwnProperty.call(input, "allow_walk_in")) {
    updates.allow_walk_in = String(input.allow_walk_in) !== "false";
  }
  if (Object.prototype.hasOwnProperty.call(input, "show_student_id_field")) {
    updates.show_student_id_field = String(input.show_student_id_field) !== "false";
  }

  const textFields = [
    "checkin_mode", "proof_label", "proof_description", "speaker_question_label",
    "no_show_policy_text", "fee_currency", "fee_description", "payment_instruction",
    "event_description"
  ];
  textFields.forEach(f => {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      updates[f] = clean(input[f as keyof EventInput]);
    }
  });

  // NOT NULL columns: guard against null from hidden/conditional form sections
  if ("fee_currency" in updates && !updates.fee_currency) updates.fee_currency = "VND";
  if ("checkin_mode" in updates && !updates.checkin_mode) updates.checkin_mode = "open";

  const numFields = ["capacity_limit", "fee_amount"];
  numFields.forEach(f => {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      const v = input[f as keyof EventInput];
      updates[f] = v ? Number(v) : null;
    }
  });

  const dateFields = ["checkin_opens_at", "checkin_closes_at"];
  dateFields.forEach(f => {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      updates[f] = parseDateTime(clean(input[f as keyof EventInput]));
    }
  });

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

  const eventScopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(eventScopeContext, clean(event.season_id)))) {
    return { ok: false, message: "Ban khong co quyen operations trong mua cua su kien nay." };
  }

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

  const participationScopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(participationScopeContext, clean(before.season_id)))) {
    return { ok: false, message: "Ban khong co quyen operations trong mua cua su kien nay." };
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

  const eventScopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(eventScopeContext, clean((before as JsonRecord).season_id)))) {
    return { ok: false, message: "Ban khong co quyen operations trong mua cua su kien nay." };
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

  const eventScopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(eventScopeContext, clean((event as JsonRecord).season_id)))) {
    return { ok: false, message: "Ban khong co quyen operations trong mua cua su kien nay." };
  }

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
    attendance_status: "unknown",
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
  isEventAbsenceStatus,
  isEventAttendedStatus,
  REGISTRATION_STATUS_OPTIONS
} from "@/lib/event-constants";
