import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getMenteeProfiles, getMentorProfiles, getPeople, getSeasons } from "@/lib/data";
import { readAllPages, readBounded, type PagedTable } from "@/lib/paged-read";
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
import { SEASON_CONFIG } from "@/lib/season-config";
import type { CheckinActionStatus, RegistrationActionStatus } from "@/lib/event-action-types";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { parseVietnamDateTime } from "@/lib/event-datetime";
import { checkinCodeUrl } from "@/lib/event-checkin-code";
import { chooseSession } from "@/lib/event-session-choice";
import { ensureCheckinCode } from "@/lib/event-checkin";
import { resolveMapUrl } from "@/lib/event-location";
import { resolveEmailBaseUrl, sendEventRegistrationConfirmation } from "@/lib/email";
import { getPublicOrigin } from "@/lib/public-url";
import { formatDate, formatDateTime, formatTime } from "@/lib/utils";
import {
  generateOccurrences,
  isEndMode,
  isMonthlyMode,
  isRecurrenceFrequency,
  type RecurrenceRule
} from "@/lib/event-recurrence";
import {
  isEventFormat,
  needsJoinUrl,
  needsVenue,
  normalizeJoinUrl,
  normalizeMapUrl,
  type EventFormat
} from "@/lib/event-location";
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

const DEFAULT_SEASON_CODE = SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE;
const SAFE_ERROR = "Không thể thực hiện tác vụ. Vui lòng kiểm tra cấu hình Supabase và server logs.";

export type EventListData = {
  ok: boolean;
  error: string | null;
  events: Event[];
  participations: EventParticipation[];
  seasons: Season[];
  people: Person[];
  registrationRows: { event_id: string; registration_status: string | null }[];
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

/**
 * Một buổi người đăng ký có thể chọn.
 *
 * `seatsLeft` là null khi buổi đó không giới hạn số lượng — khác hẳn 0, và
 * hiện "còn 0 chỗ" cho một buổi không giới hạn là nói ngược hoàn toàn.
 */
export type SessionOption = {
  id: string;
  seriesIndex: number | null;
  startsAt: string | null;
  endsAt: string | null;
  seatsLeft: number | null;
  full: boolean;
  waitlistEnabled: boolean;
};

export type PublicRegistrationData = {
  ok: boolean;
  status: PublicRegistrationStatus;
  message: string;
  event: Event | null;
  eventLink: Pick<EventLink, "id" | "event_id" | "token" | "opens_at" | "closes_at" | "is_active"> | null;
  /**
   * Các buổi để chọn, khi link nhận đăng ký cho cả chuỗi.
   *
   * Null với link thường — và null KHÁC mảng rỗng: null nghĩa là "không có gì
   * để chọn, cứ đăng ký buổi này", rỗng nghĩa là "chuỗi này không còn buổi nào
   * mở", hai câu trả lời khác nhau cho người đang đứng trước form.
   */
  sessions?: SessionOption[] | null;
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
  /** Returned only on status === "success"; used to verify the redirect URL server-side. */
  registrationId?: string | null;
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
  ends_at?: unknown;
  event_format?: unknown;
  location_name?: unknown;
  location_address?: unknown;
  location_map_url?: unknown;
  online_join_url?: unknown;
  /** Chuỗi lặp lại — chỉ do createEventSeries đặt, form không gửi trực tiếp. */
  series_id?: unknown;
  series_index?: unknown;
  series_total?: unknown;
  /** Quy tắc lặp, chỉ đọc lúc tạo chuỗi. */
  recurrence_frequency?: unknown;
  recurrence_interval?: unknown;
  recurrence_monthly_mode?: unknown;
  recurrence_end_mode?: unknown;
  recurrence_ends_on?: unknown;
  recurrence_count?: unknown;
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
  // ── Phase 2B: optional meal add-on ───────────────────────────────────────
  meal_option_enabled?: unknown;
  meal_label?: unknown;
  meal_fee_amount?: unknown;
  meal_fee_currency?: unknown;
  meal_payment_instruction?: unknown;
  meal_payment_proof_required?: unknown;
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
  /**
   * Buổi người đăng ký chọn, khi link nhận đăng ký cho cả chuỗi.
   *
   * Bị bỏ qua với link thường: buổi đã do link quyết định, và nhận thêm một
   * giá trị ở đó là mở một đường đăng ký sang buổi khác.
   */
  session_event_id?: unknown;
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
  meal_selected?: unknown;
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

/**
 * Uy quyen cho lib/event-datetime.
 *
 * Ban cu goi thang new Date(), va mot chuoi tu o datetime-local khong mang mui
 * gio nen no duoc hieu theo gio MAY DANG CHAY. May chu Vercel chay UTC, nen 8
 * gio sang nguoi dung go thanh 8 gio sang UTC — lech bay tieng, va moi lan
 * luu lai lech them mot lan nua.
 */
function parseDateTime(value: string | null): string | null {
  return parseVietnamDateTime(value);
}

/**
 * Class C. Reads an entire table under the pagination contract in
 * `lib/paged-read.ts`.
 *
 * The previous loop paged by offset with NO ORDER BY, so page boundaries were
 * undefined and rows could repeat or vanish between pages, and it stopped on a
 * short page, which silently truncates if the server cap is below the step.
 */
async function selectAll<T extends Record<string, any>>(client: any, table: PagedTable, columns = "*") {
  const { data, error } = await readAllPages<T>(table, columns, (projection) => client.from(table).select(projection));
  if (error) {
    log(`${table} select failed`, error);
    const err = error as { message?: string };
    return { data: [] as T[], error: (err.message ?? "Bad Request") as string };
  }
  return { data, error: null as string | null };
}

/**
 * Class C, filtered. Same contract as `selectAll`, for the reads that carry
 * their own `WHERE` clause (one event, one batch, a set of event ids).
 *
 * `filter` is applied INSIDE the per-page factory, so every page of the read
 * carries byte-identical filters — the event/capacity/status predicates cannot
 * drift between page 1 and page 2 by construction rather than by convention.
 *
 * The returned `error` is non-null if ANY page failed. Callers must branch on
 * it BEFORE touching `data`: a later-page failure returns the rows gathered so
 * far, and treating that prefix as a complete result set is precisely the bug
 * this module exists to prevent. There is no partial success here.
 */
async function selectAllWhere<T extends Record<string, any>>(
  client: any,
  table: PagedTable,
  columns: string,
  filter: (query: any) => any,
  scope = `${table} filtered select failed`
) {
  const { data, error } = await readAllPages<T>(table, columns, (projection) =>
    filter(client.from(table).select(projection))
  );
  if (error) {
    log(scope, error);
    const err = error as { message?: string };
    return { data: [] as T[], error: (err.message ?? "Bad Request") as string };
  }
  return { data, error: null as string | null };
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

/**
 * Class C. The scoped branch carried the same defect as the `/operations` recap
 * read: a bare `.in("season_id", …)` with no `.range()`, while the unscoped
 * branch paged. PostgREST capped it at `db-max-rows` with `error: null`, so a
 * scoped admin and an unscoped super admin saw different event data for the
 * same season. Both branches now page under the same ordering key.
 */
async function selectAllScopedBySeason<T extends Record<string, any>>(
  client: any,
  table: PagedTable,
  columns: string,
  allowedSeasonIds?: string[]
) {
  if (!allowedSeasonIds) return selectAll<T>(client, table, columns);
  if (allowedSeasonIds.length === 0) return { data: [] as T[], error: null as string | null };
  const { data, error } = await readAllPages<T>(table, columns, (projection) =>
    client.from(table).select(projection).in("season_id", allowedSeasonIds)
  );
  if (error) {
    log(`${table} scoped select failed`, error);
    const err = error as { message?: string };
    return { data: [] as T[], error: (err.message ?? "Bad Request") as string };
  }
  return { data, error: null as string | null };
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
  if (!client) return { ok: false, error, events: [], participations: [], seasons: [], people: [], registrationRows: [] };

  const allowedSeasonIds = scope?.allowedSeasonIds;

  // Phase 1: load events first to get IDs for registration count query
  const events = await selectAllScopedBySeason<Event>(client, "events", "id,legacy_event_temp_id,season_id,intake_batch_id,status,event_name,event_type,starts_at,source_notes", allowedSeasonIds);
  const eventIds = events.data.map((e) => e.id);

  // Phase 2: load everything else in parallel
  const [participations, seasons, people, registrations] = await Promise.all([
    selectAllScopedBySeason<EventParticipation>(client, "event_participations", "id,event_id,season_id,person_id,role_at_event,registration_status,attendance_status,attendance_date,recap_url,excuse_reason,admin_notes,captured_by,walk_in", allowedSeasonIds),
    allowedSeasonIds
      ? allowedSeasonIds.length
        ? client.from("seasons").select("id,code,name").in("id", allowedSeasonIds).then((res: any) => ({ data: (res.data ?? []) as Season[], error: res.error?.message ?? null }))
        : Promise.resolve({ data: [] as Season[], error: null })
      : selectAll<Season>(client, "seasons", "id,code,name"),
    selectAll<Person>(client, "people", "id,full_name,email_primary"),
    // Class C. One row per registration across EVERY event in scope, so this is
    // the largest read on the page — a workspace with a few hundred events is
    // far past the 1000-row cap. Truncation here understates the registration
    // totals on the event list, and does so identically to a genuinely quiet
    // workspace, so it cannot be noticed from the rendered page.
    eventIds.length
      ? selectAllWhere<{ event_id: string; registration_status: string | null }>(
          client,
          "event_registrations",
          "event_id,registration_status",
          (query) => query.in("event_id", eventIds),
          "event list registration totals select failed"
        )
      : Promise.resolve({ data: [] as { event_id: string; registration_status: string | null }[], error: null as string | null })
  ]);

  const errors = [events.error, participations.error, seasons.error, people.error, registrations.error].filter(Boolean);
  return {
    ok: !errors.length,
    error: errors.join(" | ") || null,
    events: events.data,
    participations: participations.data,
    seasons: seasons.data,
    people: people.data,
    registrationRows: registrations.data
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
      error: SAFE_ERROR,
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

  // Phase 045A: scope participations to this event only (was: load all then filter in JS).
  // Class C: scoping to one event bounds this by the event's attendance, not by
  // anything below the row cap — a plenary session is exactly the event whose
  // roster passes 1000 and exactly the one whose roster must be complete.
  const partsRes = await selectAllWhere<EventParticipation>(
    client,
    "event_participations",
    "id,event_id,season_id,person_id,role_at_event,registration_status,attendance_status,attendance_date,recap_url,excuse_reason,admin_notes,captured_by,walk_in",
    (query) => query.eq("event_id", id),
    "event_participations load failed"
  );

  const [linksRes, registrationsRes] = await Promise.all([
    // Class B: `unique (event_id, link_type)` in migration 051 with a two-value
    // CHECK on link_type bounds this at 2 rows. `readBounded` fails loudly if
    // that constraint is ever dropped instead of quietly reading a prefix.
    readBounded<EventLink>(
      "event_links",
      client
        .from("event_links")
        .select("id,event_id,link_type,token,is_active,opens_at,closes_at,created_by,created_at,updated_at")
        .eq("event_id", id)
        .in("link_type", ["registration", "checkin"])
    ),
    // Class C: one row per public registration for this event.
    selectAllWhere<EventRegistration>(
      client,
      "event_registrations",
      "id,event_id,event_link_id,linked_person_id,full_name,email,phone,student_id,school,program_of_study,role_text,notes,consent_given,registration_source,registration_status,attendance_status,is_walk_in,registered_at,checked_in_at,checkin_source,match_method,match_review_status,matched_at,created_at,updated_at,mentee_code,proof_url,proof_note,proof_status,review_status,review_note,confirmed_at,waitlisted_at,rejected_at,payment_status,payment_proof_url,no_show_flagged,blacklist_flag,meal_selected,meal_fee_amount,meal_fee_currency",
      (query) => query.eq("event_id", id),
      "event_registrations load failed"
    )
  ]);
  const linkErr = linksRes.error as { message?: string } | null;
  if (linkErr) log("event_links load failed", linkErr);
  const linkData = linksRes.data;

  // Paging orders by the `id` cursor, so the newest-first order the table renders
  // is re-established here across the whole result rather than per page. Rows with
  // no `registered_at` sort last, as they did under the SQL `order`.
  const registrationData = [...registrationsRes.data].sort((a, b) => {
    const left = a.registered_at ? Date.parse(String(a.registered_at)) : Number.NEGATIVE_INFINITY;
    const right = b.registered_at ? Date.parse(String(b.registered_at)) : Number.NEGATIVE_INFINITY;
    if (left === right) return String(a.id).localeCompare(String(b.id));
    return right - left;
  });

  const errors = [
    partsRes.error,
    linkErr?.message,
    registrationsRes.error,
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
    return { ok: false, error: SAFE_ERROR, registration: null, event: eventRes.data as Event | null };
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

/**
 * Server-side check: confirm that `registrationId` exists in event_registrations
 * AND belongs to the event linked by `token`. Returns false for any invalid input.
 * Used by the public registration page to guard the success banner.
 */
export async function verifyPublicRegistrationId(token: string, registrationId: string): Promise<boolean> {
  if (!isValidUuid(token) || !isValidUuid(registrationId)) return false;
  const { client } = clientResult();
  if (!client) return false;

  // Resolve event_id from the registration link token
  const { data: linkData } = await client
    .from("event_links")
    .select("event_id")
    .eq("token", token)
    .eq("link_type", "registration")
    .maybeSingle();

  const eventId = (linkData as { event_id?: string } | null)?.event_id;
  if (!eventId) return false;

  // Confirm the registration row exists and belongs to this event
  const { data: regData } = await client
    .from("event_registrations")
    .select("id")
    .eq("id", registrationId)
    .eq("event_id", eventId)
    .maybeSingle();

  return !!(regData as { id?: string } | null)?.id;
}

/**
 * Các buổi mà một link nhận-cả-chuỗi cho phép chọn.
 *
 * Chỉ trả về buổi CHƯA HUỶ. Buổi đã qua vẫn giữ lại: một người mở link vào
 * sáng buổi 2 vẫn cần thấy buổi 2, và ẩn buổi đã qua đi thì danh sách "Buổi 1,
 * Buổi 2" tự nhiên mất một dòng mà không giải thích gì.
 *
 * Số chỗ còn lại đếm bằng MỘT truy vấn cho tất cả các buổi, không phải một
 * truy vấn mỗi buổi: form công khai này là thứ hàng trăm người mở cùng lúc khi
 * bài đăng vừa lên.
 */
async function loadSeriesSessions(
  client: any,
  seriesId: string
): Promise<SessionOption[]> {
  const { data: rows, error } = await client
    .from("events")
    .select("id,series_index,starts_at,ends_at,capacity_limit_enabled,capacity_limit,waitlist_enabled,status")
    .eq("series_id", seriesId)
    .neq("status", "cancelled")
    .order("series_index", { ascending: true });

  if (error) {
    log("series sessions load failed", error);
    return [];
  }

  const sessions = (rows ?? []) as JsonRecord[];
  if (!sessions.length) return [];

  const ids = sessions.map((row) => String(row.id));
  const { data: taken, error: takenError } = await client
    .from("event_registrations")
    .select("event_id,registration_status")
    .in("event_id", ids)
    .neq("registration_status", "cancelled");

  if (takenError) log("series seat count failed", takenError);

  // Ghế đang chiếm, cùng định nghĩa với đường đăng ký một buổi: danh sách chờ
  // và đơn bị từ chối KHÔNG chiếm ghế.
  const held = new Map<string, number>();
  for (const row of ((taken ?? []) as JsonRecord[])) {
    const status = String(row.registration_status ?? "");
    if (status === "waitlisted" || status === "rejected") continue;
    const key = String(row.event_id);
    held.set(key, (held.get(key) ?? 0) + 1);
  }

  return sessions.map((row) => {
    const limited = row.capacity_limit_enabled === true && typeof row.capacity_limit === "number";
    const limit = limited ? Number(row.capacity_limit) : null;
    const used = held.get(String(row.id)) ?? 0;
    return {
      id: String(row.id),
      seriesIndex: typeof row.series_index === "number" ? row.series_index : null,
      startsAt: clean(row.starts_at),
      endsAt: clean(row.ends_at),
      seatsLeft: limit === null ? null : Math.max(0, limit - used),
      full: limit !== null && used >= limit,
      waitlistEnabled: row.waitlist_enabled === true
    };
  });
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
    .select("id,event_id,link_type,token,is_active,opens_at,closes_at,covers_series,series_id,events(*)")
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

  const raw = data as JsonRecord;
  const coversSeries = raw.covers_series === true;
  const seriesId = clean(raw.series_id);
  const sessions = coversSeries && seriesId ? await loadSeriesSessions(client, seriesId) : null;

  const window = publicLinkWindowStatus(link);
  return {
    ok: window.status === "ready",
    status: window.status,
    message: window.message,
    event,
    eventLink: link,
    sessions
  };
}

/**
 * Buổi mà một đơn đăng ký thuộc về.
 *
 * Với link thường: chính buổi mà link trỏ tới, và ô chọn buổi bị bỏ qua.
 *
 * Với link nhận cả chuỗi: buổi người dùng chọn — sau khi kiểm nó nằm trong
 * danh sách buổi mà LINK NÀY phục vụ. Không tin con số gửi lên: một form công
 * khai nhận được bất kỳ giá trị nào, và tin nó nghĩa là gửi thẳng một event_id
 * bất kỳ là đăng ký được vào sự kiện có link đang đóng, hoặc sự kiện mùa khác.
 */
async function resolveChosenSession(
  data: PublicRegistrationData,
  rawChoice: unknown
): Promise<{ ok: true; event: Event } | { ok: false; message: string }> {
  const anchor = data.event as Event;

  // Phép kiểm nằm trong `lib/event-session-choice.ts`: nó là phép kiểm bảo mật
  // của một form công khai, và ở đó nó kiểm được mà không cần database.
  const picked = chooseSession({
    sessions: data.sessions ?? null,
    anchorId: String(anchor.id),
    choice: rawChoice
  });
  if (!picked.ok) return { ok: false, message: picked.message };

  // Buổi neo — khỏi đọc lại.
  if (picked.sessionId === anchor.id) return { ok: true, event: anchor };

  const { client } = clientResult();
  if (!client) return { ok: false, message: "Không thể hoàn tất đăng ký lúc này." };

  const { data: row, error } = await client
    .from("events")
    .select("*")
    .eq("id", picked.sessionId)
    .maybeSingle();

  if (error || !row) {
    log("chosen session load failed", error);
    return { ok: false, message: "Không tải được buổi bạn chọn." };
  }
  if ((row as Event).status === "cancelled") {
    return { ok: false, message: "Buổi bạn chọn đã bị huỷ." };
  }

  return { ok: true, event: row as Event };
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

  // Buổi người đăng ký chọn.
  //
  // Kiểm nó có thuộc chuỗi mà LINK NÀY phục vụ không, chứ không tin con số gửi
  // lên: nếu không, gửi thẳng một event_id bất kỳ là đăng ký được vào một sự
  // kiện có link đang đóng, hoặc một sự kiện của mùa khác.
  const chosen = await resolveChosenSession(registrationData, input.session_event_id);
  if (!chosen.ok) {
    return {
      ok: false,
      status: "validation_error",
      message: chosen.message,
      eventName: registrationData.event.event_name ?? null
    };
  }

  const targetEvent = chosen.event;
  const eventId = targetEvent.id;
  // Load all non-cancelled registrations for duplicate check AND capacity count.
  // 'rejected' rows are excluded from duplicate check so a previously-rejected person
  // could re-register, but currently they remain in this list (neq cancelled only).
  //
  // Class C, and the read that two write decisions rest on. Truncated at 1000
  // rows, BOTH decisions below invert for anyone whose row fell off the end:
  // `duplicate` reads false for an existing registrant, and `activeSeatsCount`
  // saturates at the cap so a full event keeps accepting seats. The duplicate
  // half has a database backstop — `event_registrations_event_lower_email_active_uidx`
  // (051) makes the insert fail 23505, which is handled as `already_registered`
  // — but the capacity half has none: overselling is a clean INSERT.
  const { data: existingRows, error: existingError } = await selectAllWhere<{
    id: string;
    email: string | null;
    registration_status: string | null;
  }>(
    client,
    "event_registrations",
    "id,email,registration_status",
    (query) => query.eq("event_id", eventId).neq("registration_status", "cancelled"),
    "public registration duplicate check failed"
  );

  if (existingError) {
    return { ok: false, status: "server_error", message: "Không thể hoàn tất đăng ký lúc này.", eventName: targetEvent.event_name ?? null };
  }

  const duplicate = existingRows.some((row) => normalizeEmail(row.email) === email);
  if (duplicate) {
    return { ok: true, status: "already_registered", message: "Bạn đã đăng ký sự kiện này rồi", eventName: targetEvent.event_name ?? null };
  }

  // Class B: a lookup of one email address against `people.email_primary`. The
  // result is a handful of rows even with duplicate person records; `readBounded`
  // turns a violated assumption into an error rather than a silent prefix.
  const { data: peopleData, error: peopleError } = await readBounded<{ id: string; email_primary: string | null }>(
    "people email match",
    client.from("people").select("id,email_primary").ilike("email_primary", email)
  );
  if (peopleError) {
    log("public registration people match failed", peopleError);
    return { ok: false, status: "server_error", message: "Không thể hoàn tất đăng ký lúc này.", eventName: targetEvent.event_name ?? null };
  }

  const matchedPerson = peopleData.find((person) => normalizeEmail(person.email_primary) === email);
  const nowIso = matchedPerson ? new Date().toISOString() : null;

  const cfg = readEventConfig(targetEvent as JsonRecord);

  // SF-3: server-side proof / payment validation (HTML `required` alone is bypassable)
  if (targetEvent.proof_required_for_registration && !clean(input.proof_url)) {
    return { ok: false, status: "validation_error", message: "Vui lòng cung cấp đường dẫn minh chứng.", eventName: targetEvent.event_name ?? null };
  }
  // Phase 2B: meal selection drives payment proof requirement
  const mealSelected = String(input.meal_selected ?? "").trim() === "true";
  const mealPaymentProofRequired =
    targetEvent.meal_option_enabled === true &&
    mealSelected &&
    targetEvent.meal_payment_proof_required !== false;
  if ((targetEvent.payment_proof_required || mealPaymentProofRequired) && !clean(input.payment_proof_url)) {
    return { ok: false, status: "validation_error", message: "Vui lòng cung cấp đường dẫn ảnh chuyển khoản.", eventName: targetEvent.event_name ?? null };
  }

  // Active seats = registered + pending_review + confirmed (not waitlisted, not rejected).
  // Waitlisted registrations do not occupy a confirmed seat; rejected ones are vacated.
  const SEAT_STATUSES = new Set(["registered", "pending_review", "confirmed"]);
  const activeSeatsCount = existingRows.filter(
    (row) => SEAT_STATUSES.has(String(row.registration_status ?? ""))
  ).length;
  const isFull = cfg.capacity_limit_enabled && cfg.capacity_limit != null && activeSeatsCount >= cfg.capacity_limit;

  if (isFull && !cfg.waitlist_enabled) {
    return {
      ok: false,
      status: "capacity_full",
      message: "Sự kiện đã đủ số lượng đăng ký. Vui lòng liên hệ BTC nếu cần hỗ trợ.",
      eventName: targetEvent.event_name ?? null
    };
  }

  const baseStatus = isFull ? "waitlisted" : (cfg.approval_required ? "pending_review" : "registered");
  const proofUrl = clean(input.proof_url);
  const paymentProofUrl = clean(input.payment_proof_url);

  const payload: JsonRecord = {
    event_id: eventId,
    // Sao xuống từ buổi. Dữ liệu lặp có chủ ý: ràng buộc "một email một chuỗi"
    // là một unique index, và unique index không bắc qua được phép nối bảng.
    series_id: clean(targetEvent.series_id),
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
    payment_status: paymentProofUrl ? "submitted" : ((targetEvent.fee_required || mealSelected) ? "pending" : "not_required"),
    review_status: cfg.approval_required ? "pending" : "not_required",
    // Phase 2B: denormalize meal config into registration record
    meal_selected: mealSelected,
    meal_label: mealSelected ? (clean(targetEvent.meal_label) ?? null) : null,
    meal_fee_amount: mealSelected ? (targetEvent.meal_fee_amount ?? null) : null,
    meal_fee_currency: mealSelected ? (clean(targetEvent.meal_fee_currency) ?? "VND") : null
  };

  const { data, error: insertError } = await client
    .from("event_registrations")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      // Hai ràng buộc duy nhất cùng ném 23505, và người đọc cần biết là cái
      // nào: "bạn đã đăng ký buổi này rồi" khác hẳn "bạn đã giữ chỗ ở một buổi
      // khác của chuỗi này" — câu thứ hai còn phải nói họ làm gì tiếp theo.
      const hitSeries = String((insertError as { message?: string }).message ?? "").includes(
        "event_registrations_series_lower_email_active_uidx"
      );
      return {
        ok: true,
        status: "already_registered",
        message: hitSeries
          ? "Bạn đã giữ chỗ ở một buổi khác của chuỗi sự kiện này. Mỗi người chỉ đăng ký một buổi — vui lòng liên hệ ban tổ chức nếu cần đổi buổi."
          : "Bạn đã đăng ký sự kiện này rồi",
        eventName: targetEvent.event_name ?? null
      };
    }
    log("public registration insert failed", insertError);
    return { ok: false, status: "server_error", message: "Không thể hoàn tất đăng ký lúc này.", eventName: targetEvent.event_name ?? null };
  }

  const registrationId = (data as { id?: string } | null)?.id ?? null;

  // Vé và thư xác nhận. Cả hai đều KHÔNG được làm hỏng việc đăng ký nếu chúng
  // hỏng: người đó đã đăng ký, chỗ ngồi đã giữ, và báo "đăng ký không thành
  // công" vì một lỗi SMTP là nói dối họ về điều quan trọng hơn. Thư hỏng để
  // lại một dòng trong sổ thư đi và BTC gửi lại được.
  if (registrationId) {
    await issueTicketAndConfirm({
      registrationId,
      event: targetEvent,
      toEmail: email,
      fullName,
      pendingApproval: baseStatus !== "registered"
    });
  }

  return {
    ok: true,
    status: "success",
    message: "Đăng ký thành công",
    eventName: targetEvent.event_name ?? null,
    registrationId
  };
}

/**
 * Cấp vé cho một đăng ký và gửi thư xác nhận.
 *
 * Nuốt mọi lỗi có chủ ý — xem chú thích ở nơi gọi. Lỗi được ghi ra console để
 * còn lần ra, còn người đăng ký thì thấy đúng điều đã xảy ra: họ đã đăng ký.
 */
/**
 * Ảnh QR của một tấm vé, dạng base64 để đính vào thư.
 *
 * Kích thước 480px: đủ lớn để quét được từ một màn hình điện thoại đang ở độ
 * sáng thấp, và vẫn chỉ vài kilobyte. `margin: 2` là vùng trắng quanh mã —
 * máy quét cần nó, và một ảnh sát mép thường không đọc được.
 *
 * Hỏng thì trả null: thư vẫn đi, vẫn có đường dẫn vé và mã dự phòng. Chặn cả
 * lá thư vì không vẽ được một ảnh là đổi một bất tiện lấy một hỏng hóc.
 */
async function renderTicketQrBase64(ticketUrl: string): Promise<string | null> {
  try {
    const buffer = await QRCode.toBuffer(ticketUrl, {
      type: "png",
      margin: 2,
      width: 480,
      errorCorrectionLevel: "M"
    });
    return buffer.toString("base64");
  } catch (error) {
    log("ticket QR render failed", error);
    return null;
  }
}

async function issueTicketAndConfirm(input: {
  registrationId: string;
  event: JsonRecord;
  toEmail: string;
  fullName: string;
  pendingApproval: boolean;
}): Promise<void> {
  try {
    const { code, shortCode } = await ensureCheckinCode(input.registrationId);
    if (!code) return;

    const origin = (await getPublicOrigin()) ?? resolveEmailBaseUrl();
    if (!origin) return;

    const ticketUrl = checkinCodeUrl(origin, code);
    const event = input.event as Event;
    const format = isEventFormat(event.event_format) ? event.event_format : "offline";
    const placeLabel = needsVenue(format)
      ? [event.location_name, event.location_address]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
          .join(" — ") || null
      : null;

    await sendEventRegistrationConfirmation({
      toEmail: input.toEmail,
      recipientName: input.fullName,
      eventName: String(event.event_name ?? "").trim() || "sự kiện",
      whenLabel: formatEventWhenLabel(event),
      placeLabel,
      mapUrl: needsVenue(format)
        ? resolveMapUrl({ mapUrl: event.location_map_url, address: event.location_address })
        : null,
      joinUrl: needsJoinUrl(format) ? clean(event.online_join_url) : null,
      ticketUrl: ticketUrl,
      ticketCode: code,
      shortCode,
      qrPngBase64: await renderTicketQrBase64(ticketUrl),
      pendingApproval: input.pendingApproval,
      registrationId: input.registrationId
    });
  } catch (error) {
    log("issueTicketAndConfirm failed", error);
  }
}

/** Khoảng thời gian của một sự kiện, dạng người đọc trong thư. */
function formatEventWhenLabel(event: Event): string {
  const start = formatDateTime(event.starts_at);
  if (!event.ends_at) return start;
  const sameDay = formatDate(event.starts_at) === formatDate(event.ends_at);
  return sameDay ? `${start} – ${formatTime(event.ends_at)}` : `${start} – ${formatDateTime(event.ends_at)}`;
}

async function syncCheckedInParticipation(client: any, input: {
  eventId: string;
  seasonId: string | null;
  personId: string | null;
}) {
  if (!input.personId) return { ok: true };

  // Class B: rows for ONE person at ONE event. Migration 051 notes there is no
  // `unique(event_id, person_id)` constraint, so the bound is the application's
  // own select-then-insert discipline rather than the schema — which is exactly
  // the case `readBounded` exists to assert rather than assume.
  const { data: existing, error: existingError } = await readBounded<{ id: string }>(
    "event_participations check-in sync",
    client
      .from("event_participations")
      .select("id")
      .eq("event_id", input.eventId)
      .eq("person_id", input.personId)
  );
  if (existingError) {
    log("check event_participations for check-in sync failed", existingError);
    return { ok: false };
  }

  const existingIds = existing.map((row) => row.id).filter(Boolean);
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
  //
  // Class C, and the read every branch below depends on. Truncated, a registrant
  // whose row fell off the end is told "chưa có trong danh sách đăng ký" in the
  // restricted modes, and in open mode is silently re-created as a WALK-IN — a
  // write, against an event whose `activeCount` capacity check was computed from
  // the same truncated list. The DB's active-email unique index catches the
  // duplicate insert, but only after the user has been told they were not
  // registered.
  const { data: allRegistrations, error: allRowsError } = await selectAllWhere<EventRegistration>(
    client,
    "event_registrations",
    "id,email,attendance_status,linked_person_id,registration_status,is_walk_in,review_status",
    (query) => query.eq("event_id", eventId),
    "check existing registration for check-in failed"
  );

  if (allRowsError) {
    return { ok: false, status: "server_error", message: "Không thể check-in lúc này.", eventName: displayName };
  }

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

  // Class B, as in `registerForEvent`: one email address against people.email_primary.
  const { data: peopleData, error: peopleError } = await readBounded<{ id: string; email_primary: string | null }>(
    "people email match",
    client.from("people").select("id,email_primary").ilike("email_primary", email)
  );
  if (peopleError) {
    log("people match for walk-in check-in failed", peopleError);
    return { ok: false, status: "server_error", message: "Không thể check-in lúc này.", eventName: displayName };
  }

  const matchedPerson = peopleData.find((person) => normalizeEmail(person.email_primary) === email);
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

async function createEventLinkForEvent(
  eventId: unknown,
  linkType: "registration" | "checkin",
  /**
   * Link đăng ký nhận cho CẢ CHUỖI của buổi này, người đăng ký chọn buổi trên
   * form. Chỉ có nghĩa với link đăng ký, và chỉ khi buổi này thuộc một chuỗi.
   */
  coversSeries = false
): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const id = clean(eventId);
  if (!id) return { ok: false, message: "Thiếu event id." };
  if (!isValidUuid(id)) return { ok: false, message: "ID sự kiện không hợp lệ." };

  const { data: event, error: eventError } = await client
    .from("events")
    .select("id,season_id,series_id")
    .eq("id", id)
    .maybeSingle();
  if (eventError) {
    log("load event for registration link failed", eventError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!event) return { ok: false, message: "Không tìm thấy sự kiện." };

  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, clean((event as JsonRecord).season_id)))) {
    return { ok: false, message: "Ban khong co quyen operations trong mua cua su kien nay." };
  }

  // Một buổi đơn lẻ không có chuỗi để nhận thay. Chặn ở đây với câu nói rõ
  // vì sao, thay vì để ràng buộc CHECK ném ra một thông báo của Postgres.
  const seriesId = clean((event as JsonRecord).series_id);
  const wantsSeries = coversSeries && linkType === "registration";
  if (wantsSeries && !seriesId) {
    return {
      ok: false,
      message: "Buổi này không thuộc chuỗi lặp lại nào, nên link không nhận đăng ký cho cả chuỗi được."
    };
  }

  const { data: existing, error: existingError } = await client
    .from("event_links")
    .select("id,event_id,link_type,token,is_active,opens_at,closes_at,created_by,created_at,updated_at")
    .eq("event_id", id)
    .eq("link_type", linkType)
    .maybeSingle();
  if (existingError) {
    log("load existing registration link failed", existingError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (existing) {
    return { ok: true, message: linkType === "checkin" ? "Liên kết check-in đã tồn tại." : "Liên kết đăng ký đã tồn tại.", data: existing as EventLink };
  }

  const { data, error: insertError } = await client
    .from("event_links")
    .insert({
      event_id: id,
      link_type: linkType,
      covers_series: wantsSeries,
      series_id: wantsSeries ? seriesId : null,
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
    return { ok: false, message: SAFE_ERROR };
  }

  await writeAdminAudit(client, {
    actionType: linkType === "checkin" ? "create_event_checkin_link" : "create_event_registration_link",
    afterData: { event_id: id, link_type: linkType }
  });
  return { ok: true, message: linkType === "checkin" ? "Đã tạo liên kết check-in." : "Đã tạo liên kết đăng ký.", data: data as EventLink };
}

export async function createRegistrationLinkForEvent(
  eventId: unknown,
  coversSeries = false
): Promise<MutationResult> {
  return createEventLinkForEvent(eventId, "registration", coversSeries);
}

export async function createCheckinLinkForEvent(eventId: unknown): Promise<MutationResult> {
  return createEventLinkForEvent(eventId, "checkin");
}

/**
 * Toggle the is_active flag on an event's registration link.
 * When is_active = false, publicLinkWindowStatus() returns "inactive" and
 * public registration is blocked server-side.
 * No schema changes required — is_active already exists on event_links.
 */
export async function setRegistrationLinkActive(
  eventId: unknown,
  isActive: boolean
): Promise<MutationResult> {
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
    log("load event for link toggle failed", eventError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!event) return { ok: false, message: "Không tìm thấy sự kiện." };

  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, clean((event as JsonRecord).season_id)))) {
    return { ok: false, message: "Ban khong co quyen operations trong mua cua su kien nay." };
  }

  const { data: link, error: linkError } = await client
    .from("event_links")
    .select("id")
    .eq("event_id", id)
    .eq("link_type", "registration")
    .maybeSingle();
  if (linkError) {
    log("load registration link for toggle failed", linkError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!link) return { ok: false, message: "Chưa có link đăng ký cho sự kiện này." };

  const { error: updateError } = await client
    .from("event_links")
    .update({ is_active: isActive })
    .eq("id", (link as EventLink).id);
  if (updateError) {
    log("toggle registration link is_active failed", updateError);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeAdminAudit(client, {
    actionType: isActive ? "open_event_registration" : "close_event_registration",
    afterData: { event_id: id, is_active: isActive }
  });
  return {
    ok: true,
    message: isActive ? "Đã mở đăng ký sự kiện." : "Đã đóng đăng ký sự kiện."
  };
}


type RegistrationOperationInput = {
  event_id?: unknown;
  registration_id?: unknown;
  note?: unknown;
};

type LoadedRegistrationOperation = {
  client: any;
  adminId: string | null;
  registration: JsonRecord;
  event: JsonRecord;
};

const ACTIVE_REGISTRATION_STATUSES = new Set(["registered", "pending_review", "confirmed", "waitlisted"]);
const CONFIRMABLE_REGISTRATION_STATUSES = new Set(["registered", "pending_review", "waitlisted"]);
const WAITLISTABLE_REGISTRATION_STATUSES = new Set(["registered", "pending_review", "confirmed"]);
const TERMINAL_REGISTRATION_STATUSES = new Set(["rejected", "cancelled"]);
const CAPACITY_CONSUMING_REGISTRATION_STATUSES = new Set(["registered", "pending_review", "confirmed"]);
const PAYMENT_CONFIRMABLE_STATUSES = new Set(["pending", "submitted", "rejected"]);
const PAYMENT_REJECTABLE_STATUSES = new Set(["pending", "submitted", "confirmed"]);
const PROOF_REVIEWABLE_STATUSES = new Set(["submitted", "accepted", "rejected"]);

function operationNote(value: unknown) {
  return String(value ?? "").trim();
}

function safeOperationError(scope: string, error: unknown) {
  log(scope, error);
  return "Không thể lưu thay đổi lúc này. Vui lòng thử lại.";
}

async function loadRegistrationOperation(input: RegistrationOperationInput): Promise<
  | { ok: true; data: LoadedRegistrationOperation }
  | { ok: false; message: string }
> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const eventId = clean(input.event_id);
  const registrationId = clean(input.registration_id);
  if (!eventId || !registrationId) return { ok: false, message: "Thiếu thông tin đăng ký." };
  if (!isValidUuid(eventId) || !isValidUuid(registrationId)) {
    return { ok: false, message: "ID đăng ký hoặc sự kiện không hợp lệ." };
  }

  const [{ data: registration, error: regError }, { data: event, error: eventError }] = await Promise.all([
    client.from("event_registrations").select("*").eq("id", registrationId).eq("event_id", eventId).maybeSingle(),
    client.from("events").select("id,season_id,capacity_limit_enabled,capacity_limit,event_name").eq("id", eventId).maybeSingle()
  ]);

  if (regError) return { ok: false, message: safeOperationError("load registration operation row failed", regError) };
  if (eventError) return { ok: false, message: safeOperationError("load registration operation event failed", eventError) };
  if (!registration || !event) return { ok: false, message: "Không tìm thấy đăng ký trong sự kiện này." };

  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, clean((event as JsonRecord).season_id)))) {
    return { ok: false, message: "Bạn không có quyền thao tác trên mùa của sự kiện này." };
  }

  return {
    ok: true,
    data: {
      client,
      adminId: access.admin?.id ?? null,
      registration: registration as JsonRecord,
      event: event as JsonRecord
    }
  };
}

async function ensureRegistrationCapacityForConfirm(
  client: any,
  event: JsonRecord,
  registration: JsonRecord
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (CAPACITY_CONSUMING_REGISTRATION_STATUSES.has(String(registration.registration_status ?? ""))) {
    return { ok: true };
  }

  if (event.capacity_limit_enabled !== true) return { ok: true };
  if (event.capacity_limit === null || event.capacity_limit === undefined) return { ok: true };
  const capacity = Number(event.capacity_limit);
  if (!Number.isFinite(capacity) || capacity <= 0) return { ok: true };

  // Class C. This count IS the capacity gate: an admin confirmation is allowed
  // or refused on its value, so a truncated read saturates `consumingCount` at
  // the row cap and lets an over-capacity event keep confirming seats. The
  // status filter is rebuilt per page inside the factory, so page 2 counts the
  // same statuses as page 1.
  const { data, error } = await selectAllWhere<{ id: string; registration_status: string | null }>(
    client,
    "event_registrations",
    "id,registration_status",
    (query) =>
      query
        .eq("event_id", event.id)
        .in("registration_status", Array.from(CAPACITY_CONSUMING_REGISTRATION_STATUSES)),
    "registration capacity check failed"
  );

  if (error) return { ok: false, message: safeOperationError("registration capacity check failed", error) };

  const currentRegistrationId = String(registration.id ?? "");
  const consumingCount = data.filter(
    (row) => row.id !== currentRegistrationId && CAPACITY_CONSUMING_REGISTRATION_STATUSES.has(String(row.registration_status ?? ""))
  ).length;

  if (consumingCount >= capacity) {
    return {
      ok: false,
      message: "Không thể xác nhận đăng ký vì sự kiện đã đủ chỗ. Hãy chuyển người đăng ký vào danh sách chờ hoặc kiểm tra lại sức chứa."
    };
  }
  return { ok: true };
}

async function updateRegistrationRow(
  client: any,
  registrationId: string,
  updates: JsonRecord,
  audit: { actionType: string; afterData: JsonRecord }
): Promise<MutationResult> {
  const { data, error } = await client
    .from("event_registrations")
    .update(updates)
    .eq("id", registrationId)
    .select("id,registration_status,payment_status,proof_status,review_status,updated_at")
    .maybeSingle();

  if (error) return { ok: false, message: safeOperationError("update registration operation failed", error) };
  if (!data) return { ok: false, message: "Không tìm thấy đăng ký để cập nhật." };
  await writeAdminAudit(client, { actionType: audit.actionType, afterData: audit.afterData });
  return { ok: true, message: "Đã lưu thay đổi đăng ký.", data: data as JsonRecord };
}

export async function confirmEventRegistration(input: RegistrationOperationInput): Promise<MutationResult> {
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const currentStatus = String(registration.registration_status ?? "");
  if (TERMINAL_REGISTRATION_STATUSES.has(currentStatus)) {
    return { ok: false, message: "Không thể kích hoạt lại đăng ký đã bị từ chối hoặc đã hủy trong sprint này." };
  }
  if (!CONFIRMABLE_REGISTRATION_STATUSES.has(currentStatus)) {
    return { ok: false, message: "Trạng thái hiện tại không hỗ trợ xác nhận đăng ký." };
  }

  const capacity = await ensureRegistrationCapacityForConfirm(client, event, registration);
  if (!capacity.ok) return { ok: false, message: capacity.message };

  const now = new Date().toISOString();
  const updates: JsonRecord = {
    registration_status: "confirmed",
    review_status: "approved",
    confirmed_at: now,
    confirmed_by: adminId
  };
  if (currentStatus === "waitlisted") {
    updates.waitlisted_at = null;
    updates.waitlisted_by = null;
    updates.waitlist_position = null;
  }
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "confirm_event_registration",
    afterData: { id: registration.id, event_id: event.id, registration_status: "confirmed", confirmed_at: now, confirmed_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã xác nhận đăng ký." } : result;
}

export async function waitlistEventRegistration(input: RegistrationOperationInput): Promise<MutationResult> {
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const currentStatus = String(registration.registration_status ?? "");
  if (TERMINAL_REGISTRATION_STATUSES.has(currentStatus)) {
    return { ok: false, message: "Không thể chuyển đăng ký đã kết thúc vào danh sách chờ." };
  }
  if (!WAITLISTABLE_REGISTRATION_STATUSES.has(currentStatus)) {
    return { ok: false, message: "Trạng thái hiện tại không hỗ trợ chuyển vào danh sách chờ." };
  }

  const now = new Date().toISOString();
  const updates: JsonRecord = {
    registration_status: "waitlisted",
    review_status: "pending",
    waitlisted_at: now,
    waitlisted_by: adminId
  };
  if (currentStatus === "confirmed") {
    updates.confirmed_at = null;
    updates.confirmed_by = null;
  }
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "waitlist_event_registration",
    afterData: { id: registration.id, event_id: event.id, registration_status: "waitlisted", waitlisted_at: now, waitlisted_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã chuyển đăng ký vào danh sách chờ." } : result;
}

export async function rejectEventRegistration(input: RegistrationOperationInput): Promise<MutationResult> {
  const reason = operationNote(input.note);
  if (!reason) return { ok: false, message: "Vui lòng nhập lý do từ chối đăng ký." };
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const currentStatus = String(registration.registration_status ?? "");
  if (!ACTIVE_REGISTRATION_STATUSES.has(currentStatus)) {
    return { ok: false, message: "Chỉ có thể từ chối đăng ký đang hoạt động." };
  }

  const now = new Date().toISOString();
  const updates: JsonRecord = {
    registration_status: "rejected",
    review_status: "rejected",
    rejected_at: now,
    rejected_by: adminId,
    reject_reason: reason
  };
  if (currentStatus === "confirmed") {
    updates.confirmed_at = null;
    updates.confirmed_by = null;
  } else if (currentStatus === "waitlisted") {
    updates.waitlisted_at = null;
    updates.waitlisted_by = null;
    updates.waitlist_position = null;
  }
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "reject_event_registration",
    afterData: { id: registration.id, event_id: event.id, registration_status: "rejected", rejected_at: now, rejected_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã từ chối đăng ký." } : result;
}

export async function cancelEventRegistration(input: RegistrationOperationInput): Promise<MutationResult> {
  const reason = operationNote(input.note);
  if (!reason) return { ok: false, message: "Vui lòng nhập lý do hủy đăng ký." };
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const currentStatus = String(registration.registration_status ?? "");
  if (!ACTIVE_REGISTRATION_STATUSES.has(currentStatus)) {
    return { ok: false, message: "Chỉ có thể hủy đăng ký đang hoạt động." };
  }

  const now = new Date().toISOString();
  const updates: JsonRecord = {
    registration_status: "cancelled",
    review_status: "rejected",
    cancelled_at: now,
    cancelled_by: adminId,
    cancel_reason: reason
  };
  if (currentStatus === "confirmed") {
    updates.confirmed_at = null;
    updates.confirmed_by = null;
  } else if (currentStatus === "waitlisted") {
    updates.waitlisted_at = null;
    updates.waitlisted_by = null;
    updates.waitlist_position = null;
  }
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "cancel_event_registration",
    afterData: { id: registration.id, event_id: event.id, registration_status: "cancelled", cancelled_at: now, cancelled_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã hủy đăng ký." } : result;
}

export async function confirmRegistrationPayment(input: RegistrationOperationInput): Promise<MutationResult> {
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const paymentStatus = String(registration.payment_status ?? "not_required");
  if (!PAYMENT_CONFIRMABLE_STATUSES.has(paymentStatus)) {
    return { ok: false, message: "Trạng thái thanh toán hiện tại không hỗ trợ xác nhận." };
  }

  const now = new Date().toISOString();
  const updates: JsonRecord = {
    payment_status: "confirmed",
    payment_confirmed_at: now,
    payment_confirmed_by: adminId,
    payment_rejected_at: null,
    payment_rejected_by: null,
    payment_rejection_note: null
  };
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "confirm_registration_payment",
    afterData: { id: registration.id, event_id: event.id, payment_status: "confirmed", payment_confirmed_at: now, payment_confirmed_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã xác nhận thanh toán." } : result;
}

export async function rejectRegistrationPayment(input: RegistrationOperationInput): Promise<MutationResult> {
  const note = operationNote(input.note);
  if (!note) return { ok: false, message: "Vui lòng nhập lý do từ chối thanh toán." };
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const paymentStatus = String(registration.payment_status ?? "not_required");
  if (!PAYMENT_REJECTABLE_STATUSES.has(paymentStatus)) {
    return { ok: false, message: "Trạng thái thanh toán hiện tại không hỗ trợ từ chối." };
  }

  const now = new Date().toISOString();
  const updates: JsonRecord = {
    payment_status: "rejected",
    payment_rejected_at: now,
    payment_rejected_by: adminId,
    payment_rejection_note: note,
    payment_confirmed_at: null,
    payment_confirmed_by: null
  };
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "reject_registration_payment",
    afterData: { id: registration.id, event_id: event.id, payment_status: "rejected", payment_rejected_at: now, payment_rejected_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã từ chối thanh toán." } : result;
}

export async function acceptRegistrationProof(input: RegistrationOperationInput): Promise<MutationResult> {
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const proofStatus = String(registration.proof_status ?? "not_required");
  if (!PROOF_REVIEWABLE_STATUSES.has(proofStatus)) {
    return { ok: false, message: "Trạng thái minh chứng hiện tại không hỗ trợ chấp nhận." };
  }

  const now = new Date().toISOString();
  const updates: JsonRecord = {
    proof_status: "accepted",
    proof_reviewed_at: now,
    proof_reviewed_by: adminId,
    proof_review_note: null
  };
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "accept_registration_proof",
    afterData: { id: registration.id, event_id: event.id, proof_status: "accepted", proof_reviewed_at: now, proof_reviewed_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã chấp nhận minh chứng." } : result;
}

export async function rejectRegistrationProof(input: RegistrationOperationInput): Promise<MutationResult> {
  const note = operationNote(input.note);
  if (!note) return { ok: false, message: "Vui lòng nhập ghi chú từ chối minh chứng." };
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const proofStatus = String(registration.proof_status ?? "not_required");
  if (!PROOF_REVIEWABLE_STATUSES.has(proofStatus)) {
    return { ok: false, message: "Trạng thái minh chứng hiện tại không hỗ trợ từ chối." };
  }

  const now = new Date().toISOString();
  const updates: JsonRecord = {
    proof_status: "rejected",
    proof_reviewed_at: now,
    proof_reviewed_by: adminId,
    proof_review_note: note
  };
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "reject_registration_proof",
    afterData: { id: registration.id, event_id: event.id, proof_status: "rejected", proof_reviewed_at: now, proof_reviewed_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã từ chối minh chứng." } : result;
}

export async function updateRegistrationReviewNote(input: RegistrationOperationInput): Promise<MutationResult> {
  const loaded = await loadRegistrationOperation(input);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const { client, adminId, registration, event } = loaded.data;
  const note = operationNote(input.note);
  const updates: JsonRecord = { review_note: note || null };
  const result = await updateRegistrationRow(client, String(registration.id), updates, {
    actionType: "update_registration_review_note",
    afterData: { id: registration.id, event_id: event.id, review_note_updated: true, updated_by: adminId }
  });
  return result.ok ? { ...result, message: "Đã cập nhật ghi chú rà soát." } : result;
}
/**
 * Nơi và lúc một sự kiện diễn ra, đọc từ form và kiểm xong.
 *
 * Dùng chung cho cả tạo mới lẫn sửa, vì một quy tắc chỉ đúng khi nó là MỘT
 * quy tắc: hai bản kiểm riêng cho hai đường là hai bản sẽ trôi lệch nhau, và
 * đường ít người dùng hơn sẽ là đường trôi.
 *
 * Cố ý KHÔNG bắt buộc phải có địa chỉ cho sự kiện offline. BTC thường tạo sự
 * kiện trước khi chốt được hội trường; chặn ở đây là buộc họ gõ một địa chỉ
 * giả để lưu được, và một địa chỉ giả tệ hơn một ô trống.
 */
function resolveEventPlaceInput(
  input: EventInput,
  startsAtIso: string
):
  | {
      ok: true;
      place: {
        endsAt: string | null;
        format: EventFormat;
        locationName: string | null;
        locationAddress: string | null;
        mapUrl: string | null;
        joinUrl: string | null;
      };
    }
  | { ok: false; message: string } {
  const rawFormat = clean(input.event_format);
  // Không ghi hình thức thì là sự kiện tới-tận-nơi, đúng như mọi sự kiện đã có
  // trong bảng trước khi cột này tồn tại.
  const format: EventFormat = isEventFormat(rawFormat) ? rawFormat : "offline";

  const endsAtRaw = clean(input.ends_at);
  const endsAt = endsAtRaw ? parseDateTime(endsAtRaw) : null;
  if (endsAtRaw && !endsAt) return { ok: false, message: "Giờ kết thúc không hợp lệ." };
  if (endsAt && endsAt <= startsAtIso) {
    return { ok: false, message: "Giờ kết thúc phải sau giờ bắt đầu." };
  }

  const map = normalizeMapUrl(input.location_map_url);
  if (!map.ok) return { ok: false, message: map.message };

  const join = normalizeJoinUrl(input.online_join_url);
  if (!join.ok) return { ok: false, message: join.message };

  return {
    ok: true,
    place: {
      endsAt,
      format,
      locationName: needsVenue(format) ? clean(input.location_name) : null,
      locationAddress: needsVenue(format) ? clean(input.location_address) : null,
      // Địa điểm bị xoá khi sự kiện chuyển sang thuần trực tuyến, và đường dẫn
      // phòng họp bị xoá khi nó chuyển sang thuần tại chỗ. Giữ lại nghĩa là gửi
      // cho người tham dự một địa chỉ của lần sửa trước.
      mapUrl: needsVenue(format) ? map.url : null,
      joinUrl: needsJoinUrl(format) ? join.url : null
    }
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

  const placeResult = resolveEventPlaceInput(input, startsAt);
  if (!placeResult.ok) return { ok: false, message: placeResult.message };
  const place = placeResult.place;

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
    ends_at: place.endsAt,
    event_format: place.format,
    location_name: place.locationName,
    location_address: place.locationAddress,
    location_map_url: place.mapUrl,
    online_join_url: place.joinUrl,
    series_id: clean(input.series_id),
    series_index: input.series_index ? Number(input.series_index) : null,
    series_total: input.series_total ? Number(input.series_total) : null,
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
    // Phase 2B: optional meal add-on
    meal_option_enabled: String(input.meal_option_enabled) === "true",
    meal_label: clean(input.meal_label),
    meal_fee_amount: input.meal_fee_amount ? Number(input.meal_fee_amount) : null,
    meal_fee_currency: clean(input.meal_fee_currency) || "VND",
    meal_payment_instruction: clean(input.meal_payment_instruction),
    meal_payment_proof_required: String(input.meal_payment_proof_required) !== "false",
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

/**
 * Tạo một chuỗi sự kiện lặp lại.
 *
 * Gọi lại chính `createEvent` cho từng buổi thay vì tự dựng payload: mọi quy
 * tắc quyền, phạm vi mùa, kiểm địa điểm và ghi nhật ký đều nằm trong đó, và
 * một bản sao thứ hai của chúng ở đây là bản sẽ trôi lệch.
 *
 * Hỏng giữa chừng thì KHÔNG quay lui. Những buổi đã tạo là đã tạo, và nói thật
 * điều đó có ích hơn là xoá đi những dòng có thể đã có người mở ra xem. Buổi
 * nào hỏng được nêu tên, và chuỗi ghi lại tổng số buổi theo ý định ban đầu chứ
 * không theo số buổi tạo được — `series_total` là ý định, không phải kết quả.
 */
export async function createEventSeries(
  input: EventInput & { recurrence?: unknown }
): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };

  const startsAt = parseDateTime(clean(input.starts_at));
  if (!startsAt) return { ok: false, message: "Thời điểm sự kiện không hợp lệ." };

  const rule = readRecurrenceInput(input);
  if (!rule.ok) return { ok: false, message: rule.message };

  const generated = generateOccurrences({
    startsAt,
    endsAt: parseDateTime(clean(input.ends_at)),
    rule: rule.rule
  });
  if (!generated.ok) return { ok: false, message: generated.message };

  const seriesId = randomUUID();
  const total = generated.occurrences.length;
  const failures: string[] = [];
  let created = 0;
  let firstId: string | null = null;

  // Vòng lặp theo chỉ số chứ không dùng .entries(): dự án biên dịch xuống ES5,
  // nơi duyệt thẳng một iterator cần bật downlevelIteration cho cả codebase.
  for (let index = 0; index < generated.occurrences.length; index += 1) {
    const occurrence = generated.occurrences[index];
    const result = await createEvent({
      ...input,
      starts_at: occurrence.startsAt,
      ends_at: occurrence.endsAt,
      series_id: seriesId,
      series_index: index + 1,
      series_total: total
    });

    if (result.ok) {
      created += 1;
      if (!firstId) firstId = clean((result.data as JsonRecord | undefined)?.id) ?? null;
    } else {
      failures.push(`Buổi ${index + 1}: ${result.message}`);
    }
  }

  if (!created) {
    return { ok: false, message: failures[0] ?? "Không tạo được buổi nào." };
  }

  return {
    ok: true,
    message: failures.length
      ? `Đã tạo ${created}/${total} buổi. ${failures.length} buổi không tạo được: ${failures.join("; ")}`
      : `Đã tạo chuỗi ${total} buổi.`,
    data: firstId ? { id: firstId, series_id: seriesId } : { series_id: seriesId }
  };
}

/** Đọc quy tắc lặp từ dữ liệu form, kiểm từng ô trước khi sinh buổi nào. */
function readRecurrenceInput(
  input: EventInput & { recurrence?: unknown }
): { ok: true; rule: RecurrenceRule } | { ok: false; message: string } {
  const frequency = clean(input.recurrence_frequency);
  if (!isRecurrenceFrequency(frequency)) {
    return { ok: false, message: "Tần suất lặp không hợp lệ." };
  }

  const monthlyMode = clean(input.recurrence_monthly_mode);
  const endMode = clean(input.recurrence_end_mode);
  if (!isEndMode(endMode)) {
    return { ok: false, message: "Điều kiện kết thúc chuỗi không hợp lệ." };
  }

  return {
    ok: true,
    rule: {
      frequency,
      interval: Number(clean(input.recurrence_interval) ?? 1),
      monthlyMode: isMonthlyMode(monthlyMode) ? monthlyMode : "day_of_month",
      endMode,
      endsOn: clean(input.recurrence_ends_on),
      count: input.recurrence_count ? Number(input.recurrence_count) : null
    }
  };
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

  const placeResult = resolveEventPlaceInput(input, startsAt);
  if (!placeResult.ok) return { ok: false, message: placeResult.message };
  updates.ends_at = placeResult.place.endsAt;
  updates.event_format = placeResult.place.format;
  updates.location_name = placeResult.place.locationName;
  updates.location_address = placeResult.place.locationAddress;
  updates.location_map_url = placeResult.place.mapUrl;
  updates.online_join_url = placeResult.place.joinUrl;

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
    "show_school_field", "show_program_field", "show_role_text_field", "show_notes_field", "student_id_required",
    "meal_option_enabled"
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
  // Phase 2B: meal_payment_proof_required defaults true — use !== "false" pattern
  if (Object.prototype.hasOwnProperty.call(input, "meal_payment_proof_required")) {
    updates.meal_payment_proof_required = String(input.meal_payment_proof_required) !== "false";
  }

  const textFields = [
    "checkin_mode", "proof_label", "proof_description", "speaker_question_label",
    "no_show_policy_text", "fee_currency", "fee_description", "payment_instruction",
    "event_description",
    "meal_label", "meal_fee_currency", "meal_payment_instruction"
  ];
  textFields.forEach(f => {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      updates[f] = clean(input[f as keyof EventInput]);
    }
  });

  // NOT NULL columns: guard against null from hidden/conditional form sections
  if ("fee_currency" in updates && !updates.fee_currency) updates.fee_currency = "VND";
  if ("checkin_mode" in updates && !updates.checkin_mode) updates.checkin_mode = "open";
  if ("meal_fee_currency" in updates && !updates.meal_fee_currency) updates.meal_fee_currency = "VND";

  const numFields = ["capacity_limit", "fee_amount", "meal_fee_amount"];
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
  const profileTable: PagedTable = group === "approved_mentees_in_batch" ? "mentee_profiles" : "mentor_profiles";
  const roleValue: EventRoleValue = group === "approved_mentees_in_batch" ? "mentee" : "mentor";

  // Class C. An intake batch is a whole cohort; truncation here does not fail,
  // it just adds fewer people than the admin asked for and reports the short
  // number as success, so nobody has a reason to look.
  const { data: profiles, error: profileError } = await selectAllWhere<{ id: string; person_id: string | null }>(
    client,
    profileTable,
    "id,person_id",
    (query) => query.eq("intake_batch_id", intakeBatchId),
    `load ${profileTable} for bulk add failed`
  );
  if (profileError) {
    return { ok: false, message: `${SAFE_ERROR} (${profileError})` };
  }

  const candidatePersonIds = profiles
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

  // Load existing participations for this event to detect duplicates.
  //
  // Class C, and the read whose completeness decides what gets INSERTed. There
  // is no `unique(event_id, person_id)` constraint on event_participations
  // (migration 051 says so explicitly and defers it), so this set is the ONLY
  // thing preventing a duplicate row. A truncated read means every member past
  // the cap is absent from `alreadyIn`, gets re-inserted, and the event's roster
  // silently doubles — with the operation reporting success. Of every read in
  // this file this is the one with no database backstop at all.
  const { data: existing, error: existingError } = await selectAllWhere<{ person_id: string | null }>(
    client,
    "event_participations",
    "person_id",
    (query) => query.eq("event_id", eventId),
    "load existing participations for bulk add failed"
  );
  if (existingError) {
    return { ok: false, message: `${SAFE_ERROR} (${existingError})` };
  }

  const alreadyIn = new Set(existing.map((row) => row.person_id as string).filter(Boolean));
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

/**
 * Thêm một buổi nữa vào chuỗi của một sự kiện đã có.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN, KHI ĐÃ CÓ "SỰ KIỆN LẶP LẠI" LÚC TẠO
 * ---------------------------------------------------------------------------
 * Lịch chương trình đổi sau khi sự kiện đã tạo, và đó là chuyện bình thường:
 * chốt thêm một buổi vì đăng ký vượt dự kiến, hoặc lúc tạo chưa biết có mấy
 * buổi. Bắt người ta xoá đi tạo lại nghĩa là mất luôn những đăng ký đã có.
 *
 * Buổi mới CHÉP LẠI toàn bộ cấu hình của buổi gốc — sức chứa, cấu hình đăng
 * ký, mô tả, địa điểm — vì "một buổi nữa của cùng một thứ" đúng nghĩa là vậy.
 * Chỉ ngày giờ là khác.
 *
 * ---------------------------------------------------------------------------
 * THỨ TỰ GHI QUAN TRỌNG
 * ---------------------------------------------------------------------------
 * `events_series_shape_check` bắt `series_index <= series_total`. Nên phải
 * NÂNG TỔNG trên các buổi đang có TRƯỚC, rồi mới chèn buổi mới — làm ngược lại
 * thì dòng mới vi phạm ràng buộc và cả thao tác hỏng.
 */
/**
 * Khoá so sánh địa điểm của một buổi.
 *
 * Chuẩn hoá khoảng trắng và hoa thường: "Phòng B1-502" và "phòng  b1-502" là
 * một chỗ, và để chúng thành hai chỗ khác nhau nghĩa là phép chặn trùng bỏ lọt
 * đúng những trường hợp nó sinh ra để bắt.
 */
function venueKey(row: JsonRecord): string {
  return [row.location_name, row.location_address]
    .map((value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

export async function addSessionToSeries(input: {
  eventId: unknown;
  starts_at: unknown;
  ends_at?: unknown;
}): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const eventId = clean(input.eventId);
  if (!eventId || !isValidUuid(eventId)) return { ok: false, message: "ID sự kiện không hợp lệ." };

  const startsAt = parseDateTime(clean(input.starts_at));
  if (!startsAt) return { ok: false, message: "Thời điểm buổi mới không hợp lệ." };

  const endsAtRaw = clean(input.ends_at);
  const endsAt = endsAtRaw ? parseDateTime(endsAtRaw) : null;
  if (endsAtRaw && !endsAt) return { ok: false, message: "Giờ kết thúc không hợp lệ." };
  if (endsAt && endsAt <= startsAt) {
    return { ok: false, message: "Giờ kết thúc phải sau giờ bắt đầu." };
  }

  const { data: anchor, error: anchorError } = await client
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (anchorError || !anchor) {
    log("addSessionToSeries: load anchor failed", anchorError);
    return { ok: false, message: "Không tìm thấy sự kiện." };
  }

  const scopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(scopeContext, clean((anchor as JsonRecord).season_id)))) {
    return { ok: false, message: "Bạn không có quyền vận hành trong mùa của sự kiện này." };
  }

  const source = anchor as JsonRecord;
  const seriesId = clean(source.series_id) ?? randomUUID();

  // Các buổi đang có của chuỗi. Sự kiện đơn lẻ thì chính nó là buổi duy nhất.
  const { data: siblings, error: siblingsError } = await client
    .from("events")
    .select("id, starts_at, location_name, location_address")
    .eq("series_id", seriesId);

  if (siblingsError) {
    log("addSessionToSeries: load siblings failed", siblingsError);
    return { ok: false, message: SAFE_ERROR };
  }

  // Chặn buổi trùng khít.
  //
  // Hai buổi cùng giờ ở cùng một phòng là điều không thể xảy ra thật — nó chỉ
  // xảy ra khi ai đó bấm "Thêm buổi" hai lần, hoặc quay lại trang rồi bấm lại.
  // Và một chuỗi có hai buổi giống hệt nhau thì người đăng ký không phân biệt
  // được để chọn, còn sức chứa thì bị chia đôi vô nghĩa.
  //
  // Buổi mới luôn chép địa điểm từ buổi gốc, nên trong thực tế đây là phép so
  // theo GIỜ BẮT ĐẦU. Vẫn so cả địa điểm, vì hai buổi song song ở hai phòng
  // khác nhau là chuyện có thật và không được chặn.
  const newVenue = venueKey(source);
  const clash = ((siblings ?? []) as JsonRecord[]).find(
    (row) =>
      clean(row.starts_at) === startsAt &&
      venueKey(row) === newVenue
  );
  const anchorClashes = clean(source.starts_at) === startsAt && venueKey(source) === newVenue;

  if (clash || anchorClashes) {
    return {
      ok: false,
      message:
        "Chuỗi này đã có một buổi đúng vào giờ đó, ở cùng địa điểm. Hai buổi trùng khít thì người đăng ký không phân biệt được để chọn — kiểm lại ngày giờ, hoặc xoá buổi cũ trước."
    };
  }

  const alreadyInSeries = Boolean(clean(source.series_id));
  const existingIds = ((siblings ?? []) as JsonRecord[]).map((row) => String(row.id));
  const idsToRenumber = alreadyInSeries && existingIds.length ? existingIds : [eventId];
  const newTotal = idsToRenumber.length + 1;

  // `events_series_shape_check` bắt BA CỘT đi cùng nhau hoặc cùng vắng. Nên
  // với một sự kiện chưa thuộc chuỗi nào, ghi mình `series_total` là vi phạm
  // ngay ràng buộc đó — cả ba phải vào trong CÙNG MỘT lệnh.
  //
  // Với chuỗi đã có, các dòng đều đã mang `series_id` và `series_index`, nên
  // nâng riêng tổng là hợp lệ.
  const { error: totalError } = alreadyInSeries
    ? await client.from("events").update({ series_total: newTotal }).in("id", idsToRenumber)
    : await client
        .from("events")
        .update({ series_id: seriesId, series_index: 1, series_total: newTotal })
        .eq("id", eventId);

  if (totalError) {
    log("addSessionToSeries: bump total failed", totalError);
    return {
      ok: false,
      message: `${SAFE_ERROR} (${(totalError as { message?: string }).message ?? ""})`
    };
  }

  // Chép nguyên cấu hình, đổi đúng ngày giờ và số thứ tự. Bỏ những cột thuộc về
  // riêng một dòng: id, thời điểm tạo, và mã tham chiếu legacy (nó là mã của
  // MỘT sự kiện, hai dòng cùng mang một mã là hai dòng không phân biệt được).
  const payload: JsonRecord = { ...source };
  delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  delete payload.legacy_event_temp_id;

  payload.starts_at = startsAt;
  payload.ends_at = endsAt;
  payload.series_id = seriesId;
  payload.series_index = newTotal;
  payload.series_total = newTotal;

  const { data: created, error: insertError } = await client
    .from("events")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (insertError || !created) {
    log("addSessionToSeries: insert failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (${(insertError as { message?: string })?.message ?? ""})` };
  }

  await writeAdminAudit(client, {
    actionType: "add_event_series_session",
    beforeData: source,
    afterData: created as JsonRecord
  });

  return {
    ok: true,
    message: `Đã thêm buổi ${newTotal}. Link đăng ký của chuỗi sẽ hiện buổi này ngay.`,
    data: created as JsonRecord
  };
}

export type SeriesSession = {
  id: string;
  seriesIndex: number | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string | null;
  /** Đăng ký chưa huỷ. Buổi đã có người thì không xoá được. */
  registrationCount: number;
  isCurrent: boolean;
};

/**
 * Các buổi của chuỗi mà một sự kiện thuộc về, kèm số người đã đăng ký.
 *
 * Sự kiện đơn lẻ trả về mảng rỗng — không có chuỗi thì không có gì để liệt kê,
 * và một danh sách "một buổi" chỉ làm màn hình rối thêm.
 */
export async function listSeriesSessions(eventId: string): Promise<SeriesSession[]> {
  const { client } = clientResult();
  if (!client) return [];

  const { data: anchor } = await client
    .from("events")
    .select("series_id")
    .eq("id", eventId)
    .maybeSingle();

  const seriesId = clean((anchor as JsonRecord | null)?.series_id);
  if (!seriesId) return [];

  const { data: rows, error } = await client
    .from("events")
    .select("id, series_index, starts_at, ends_at, status")
    .eq("series_id", seriesId)
    .order("series_index", { ascending: true });

  if (error) {
    log("listSeriesSessions failed", error);
    return [];
  }

  const sessions = (rows ?? []) as JsonRecord[];
  if (!sessions.length) return [];

  // Một truy vấn cho cả chuỗi, không phải một truy vấn mỗi buổi.
  const { data: registrations } = await client
    .from("event_registrations")
    .select("event_id")
    .in("event_id", sessions.map((row) => String(row.id)))
    .neq("registration_status", "cancelled");

  const counts = new Map<string, number>();
  for (const row of ((registrations ?? []) as JsonRecord[])) {
    const key = String(row.event_id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return sessions.map((row) => ({
    id: String(row.id),
    seriesIndex: typeof row.series_index === "number" ? row.series_index : null,
    startsAt: clean(row.starts_at),
    endsAt: clean(row.ends_at),
    status: clean(row.status),
    registrationCount: counts.get(String(row.id)) ?? 0,
    isCurrent: String(row.id) === eventId
  }));
}

/**
 * Bỏ một buổi khỏi chuỗi, và xoá hẳn nó.
 *
 * ---------------------------------------------------------------------------
 * CHỈ XOÁ ĐƯỢC BUỔI CHƯA CÓ AI ĐĂNG KÝ
 * ---------------------------------------------------------------------------
 * Đây là nút để sửa một cú bấm nhầm, không phải để huỷ một buổi đã mở bán. Một
 * buổi đã có người đăng ký nghĩa là có những tấm vé đang nằm trong hộp thư
 * người ta; xoá dòng đó là làm các tấm vé ấy trỏ vào hư không mà không ai được
 * báo. Trường hợp đó dùng "Huỷ sự kiện" — nó giữ lại dữ liệu và đánh dấu
 * cancelled.
 *
 * ---------------------------------------------------------------------------
 * ĐÁNH SỐ LẠI
 * ---------------------------------------------------------------------------
 * Xoá buổi 2 của chuỗi 3 buổi thì buổi 3 phải thành buổi 2 — nếu không, danh
 * sách hiện "Buổi 1, Buổi 3" và người đọc tưởng mình bỏ lỡ mất một buổi.
 *
 * Mỗi dòng được ghi số thứ tự và tổng trong CÙNG một lệnh: ràng buộc
 * `events_series_shape_check` xét theo từng dòng, nên miễn là mỗi dòng tự nhất
 * quán thì không có trạng thái trung gian nào vi phạm.
 *
 * Còn đúng một buổi thì nó rời khỏi chuỗi hẳn — ba cột về null cùng lúc. Một
 * "chuỗi một buổi" là một sự kiện đơn lẻ đang đeo nhãn sai.
 */
/**
 * Đánh số lại cả chuỗi theo thứ tự thời gian.
 *
 * Số thứ tự buổi là thứ người đọc dùng để đối chiếu giữa danh sách trong CRM,
 * ô chọn buổi trên link đăng ký, và thư xác nhận. Nó phải chạy 1, 2, 3 theo
 * đúng thứ tự các buổi diễn ra — một chuỗi hiện "Buổi 1" nằm sau "Buổi 2" là
 * chuỗi không ai đọc được.
 *
 * Mỗi dòng nhận số thứ tự và tổng trong CÙNG một lệnh: ràng buộc
 * `events_series_shape_check` xét theo từng dòng, nên miễn là mỗi dòng tự nhất
 * quán thì không trạng thái trung gian nào vi phạm.
 *
 * Còn từ một buổi trở xuống thì chuỗi tan: ba cột về null cùng lúc.
 *
 * Trả về số buổi còn lại, hoặc `null` khi không đọc nổi chuỗi.
 */
async function renumberSeries(client: any, seriesId: string): Promise<number | null> {
  const { data: rows, error } = await client
    .from("events")
    .select("id, starts_at")
    .eq("series_id", seriesId)
    .order("starts_at", { ascending: true });

  if (error) {
    log("renumberSeries: reload failed", error);
    return null;
  }

  const list = (rows ?? []) as JsonRecord[];

  if (list.length <= 1) {
    // Một "chuỗi một buổi" là một sự kiện đơn lẻ đang đeo nhãn sai.
    for (const left of list) {
      await client
        .from("events")
        .update({ series_id: null, series_index: null, series_total: null })
        .eq("id", String(left.id));
    }
    return list.length;
  }

  for (let index = 0; index < list.length; index += 1) {
    const { error: writeError } = await client
      .from("events")
      .update({ series_index: index + 1, series_total: list.length })
      .eq("id", String(list[index].id));
    if (writeError) log("renumberSeries: write failed", writeError);
  }

  return list.length;
}

export async function removeSessionFromSeries(input: {
  eventId: unknown;
}): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const eventId = clean(input.eventId);
  if (!eventId || !isValidUuid(eventId)) return { ok: false, message: "ID buổi không hợp lệ." };

  const { data: target, error: targetError } = await client
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (targetError || !target) return { ok: false, message: "Không tìm thấy buổi này." };

  const row = target as JsonRecord;
  const seriesId = clean(row.series_id);
  if (!seriesId) return { ok: false, message: "Buổi này không thuộc chuỗi nào." };

  const scopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(scopeContext, clean(row.season_id)))) {
    return { ok: false, message: "Bạn không có quyền vận hành trong mùa của sự kiện này." };
  }

  const { data: registrations, error: regError } = await client
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .neq("registration_status", "cancelled")
    .limit(1);

  if (regError) {
    log("removeSessionFromSeries: count registrations failed", regError);
    return { ok: false, message: SAFE_ERROR };
  }
  if ((registrations ?? []).length) {
    return {
      ok: false,
      message:
        "Buổi này đã có người đăng ký nên không xoá được — những tấm vé đã gửi đi sẽ trỏ vào hư không. Dùng \"Huỷ sự kiện\" nếu buổi này không diễn ra nữa."
    };
  }

  const { error: deleteError } = await client.from("events").delete().eq("id", eventId);
  if (deleteError) {
    log("removeSessionFromSeries: delete failed", deleteError);
    return {
      ok: false,
      message: `${SAFE_ERROR} (${(deleteError as { message?: string }).message ?? ""})`
    };
  }
  // Ghi nhật ký NGAY sau khi xoá, không đợi đánh số xong: nếu bước đánh số
  // hỏng giữa chừng thì dòng đã biến mất rồi, và thứ cần lần lại là ai đã
  // xoá nó, chứ không phải các số thứ tự sau đó.
  await writeAdminAudit(client, {
    actionType: "remove_event_series_session",
    beforeData: row,
    afterData: null
  });

  const remaining = await renumberSeries(client, seriesId);
  if (remaining === null) {
    return { ok: true, message: "Đã xoá buổi, nhưng chưa đánh số lại được các buổi còn lại." };
  }
  if (remaining <= 1) {
    return { ok: true, message: "Đã xoá buổi. Sự kiện quay lại là buổi đơn lẻ." };
  }
  return { ok: true, message: `Đã xoá buổi. Chuỗi còn ${remaining} buổi.` };
}

/**
 * Đổi giờ của MỘT buổi, không đụng gì khác.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO KHÔNG DÙNG LUÔN `updateEvent`
 * ---------------------------------------------------------------------------
 * `updateEvent` nhận cả biểu mẫu và ghi lại gần như mọi cột. Muốn dời một buổi
 * đi nửa tiếng mà phải gửi lên toàn bộ cấu hình sự kiện thì mọi ô người ta
 * không chạm tới cũng đi theo — và một ô đọc sai sẽ ghi đè lên giá trị đang
 * đúng. Ô sửa giờ nằm trong danh sách các buổi, nơi không có sẵn phần còn lại
 * của biểu mẫu, nên nó cần một đường ghi hẹp đúng bằng thứ nó sửa.
 *
 * ---------------------------------------------------------------------------
 * VẪN CHẶN TRÙNG KHÍT
 * ---------------------------------------------------------------------------
 * Dời một buổi vào đúng giờ và đúng chỗ của một buổi khác tạo ra cùng cái sai
 * mà `addSessionToSeries` đã chặn: hai lựa chọn không phân biệt được trên link
 * đăng ký. Chặn ở cả hai đường vào, vì một cánh cửa khoá không giúp gì khi cửa
 * bên cạnh vẫn mở.
 */
export async function updateSessionTime(input: {
  eventId: unknown;
  starts_at: unknown;
  ends_at?: unknown;
}): Promise<MutationResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error ?? SAFE_ERROR };

  const eventId = clean(input.eventId);
  if (!eventId || !isValidUuid(eventId)) return { ok: false, message: "ID buổi không hợp lệ." };

  const startsAt = parseDateTime(clean(input.starts_at));
  if (!startsAt) return { ok: false, message: "Thời điểm bắt đầu không hợp lệ." };

  const endsAtRaw = clean(input.ends_at);
  const endsAt = endsAtRaw ? parseDateTime(endsAtRaw) : null;
  if (endsAtRaw && !endsAt) return { ok: false, message: "Giờ kết thúc không hợp lệ." };
  if (endsAt && endsAt <= startsAt) {
    return { ok: false, message: "Giờ kết thúc phải sau giờ bắt đầu." };
  }

  const { data: target, error: targetError } = await client
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (targetError || !target) return { ok: false, message: "Không tìm thấy buổi này." };

  const row = target as JsonRecord;
  const scopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(scopeContext, clean(row.season_id)))) {
    return { ok: false, message: "Bạn không có quyền vận hành trong mùa của sự kiện này." };
  }

  const seriesId = clean(row.series_id);

  if (seriesId) {
    const { data: siblings, error: siblingsError } = await client
      .from("events")
      .select("id, starts_at, location_name, location_address")
      .eq("series_id", seriesId);

    if (siblingsError) {
      log("updateSessionTime: load siblings failed", siblingsError);
      return { ok: false, message: SAFE_ERROR };
    }

    const venue = venueKey(row);
    const clash = ((siblings ?? []) as JsonRecord[]).find(
      (other) =>
        String(other.id) !== eventId &&
        clean(other.starts_at) === startsAt &&
        venueKey(other) === venue
    );

    if (clash) {
      return {
        ok: false,
        message:
          "Chuỗi này đã có một buổi khác đúng vào giờ đó, ở cùng địa điểm. Hai buổi trùng khít thì người đăng ký không phân biệt được để chọn."
      };
    }
  }

  const { error: updateError } = await client
    .from("events")
    .update({ starts_at: startsAt, ends_at: endsAt })
    .eq("id", eventId);

  if (updateError) {
    log("updateSessionTime: update failed", updateError);
    return {
      ok: false,
      message: `${SAFE_ERROR} (${(updateError as { message?: string }).message ?? ""})`
    };
  }

  await writeAdminAudit(client, {
    actionType: "update_event_session_time",
    beforeData: row,
    afterData: { ...row, starts_at: startsAt, ends_at: endsAt }
  });

  // Đổi giờ có thể làm buổi này nhảy qua một buổi khác. Số thứ tự đọc theo thời
  // gian, nên phải chạy lại — nếu không danh sách hiện "Buổi 1" nằm sau "Buổi 2".
  if (seriesId) await renumberSeries(client, seriesId);

  // Người đã đăng ký đang giữ một tấm vé ghi giờ CŨ. Hệ thống không tự gửi thư
  // báo đổi lịch, nên chỗ duy nhất chuyện này được nói ra là ngay đây, lúc
  // người vận hành còn đang nhìn màn hình.
  const { data: holders } = await client
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .neq("registration_status", "cancelled");

  const count = (holders ?? []).length;
  return {
    ok: true,
    message: count
      ? `Đã đổi giờ. ${count} người đã đăng ký buổi này và đang giữ thư xác nhận ghi giờ cũ — nhớ báo lại cho họ.`
      : "Đã đổi giờ buổi này."
  };
}
