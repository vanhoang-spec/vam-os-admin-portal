import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canPublishCrossSession, canTriageCrossRequest } from "@/lib/permissions";
import { getCurrentParticipant } from "@/lib/participant-auth";
import { createRegistrationLinkForEvent } from "@/lib/events";
import { resolveEmailBaseUrl, sendCrossScheduled } from "@/lib/email";
import { fieldLabel, isRequestableField, type FieldKind } from "@/lib/cross-fields-core";
import {
  canTransition,
  requestStatusLabel,
  type RequestStatus
} from "@/lib/cross-mentoring-core";
import { writeLog } from "@/lib/cross-invitations";

/**
 * lib/cross-requests.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A mentee's wish, and what the organisers do with it.
 *
 * The request is the spine; the session is an ordinary event hanging off it.
 * That split is deliberate — `mentoring_recaps` holds exactly one mentor per
 * row, so a session with two or three mentors could not have lived there, and
 * `events` already knows how to take registrations, mint a QR link and record
 * a check-in. Nothing about attendance is reinvented here.
 *
 * Two moments are one-way. Scheduling creates an event and mentees may start
 * registering against it, so the state machine refuses to walk back past it —
 * cancelling is how you undo, and it says so. And a cancellation does not count
 * against the mentors who volunteered: they did nothing wrong, and the owner
 * asked for exactly that.
 */

const SAFE_ERROR = "Không thực hiện được thao tác. Vui lòng thử lại.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function clean(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, max);
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[cross-requests]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

export type CrossRequestRow = {
  id: string;
  seasonId: string;
  programId: string;
  requestedByPersonId: string;
  requesterName: string | null;
  fieldKind: string;
  fieldCode: string;
  fieldLabel: string;
  topic: string | null;
  note: string | null;
  status: RequestStatus;
  statusLabel: string;
  reviewNote: string | null;
  scheduledAt: string | null;
  location: string | null;
  eventId: string | null;
  postDraft: string | null;
  postStatus: string;
  createdAt: string;
  /** Invitation tallies, filled in by the operations list. */
  invited?: number;
  accepted?: number;
};

// ── The mentee's side ────────────────────────────────────────────────────────

/**
 * How many live wishes one mentee may hold at a time.
 *
 * The database enforces one live request per person per field; this is the
 * across-fields limit, and it exists so a queue of thirty requests from one
 * enthusiastic mentee cannot crowd out everybody else.
 */
export const MAX_LIVE_REQUESTS_PER_MENTEE = 3;

const LIVE_STATUSES: RequestStatus[] = [
  "submitted",
  "approved",
  "inviting",
  "selecting",
  "scheduled",
  "published"
];

/** A mentee submits a wish from the portal. */
export async function submitCrossRequest(input: {
  programCode?: unknown;
  fieldKind?: unknown;
  fieldCode?: unknown;
  topic?: unknown;
  note?: unknown;
}): Promise<MutationResult> {
  const participant = await getCurrentParticipant();
  if (participant.state !== "participant") {
    return { ok: false, message: "Bạn cần đăng nhập để gửi đề xuất." };
  }

  const fieldKind = String(input.fieldKind ?? "").trim();
  const fieldCode = String(input.fieldCode ?? "").trim();

  if (fieldKind !== "industry" && fieldKind !== "function") {
    return { ok: false, message: "Vui lòng chọn một lĩnh vực." };
  }
  // "Khác" and "Chưa xác định" exist so people can answer a form honestly, but
  // nobody can be invited on them — there is no such group of mentors.
  if (!isRequestableField(fieldKind as FieldKind, fieldCode)) {
    return {
      ok: false,
      message: "Lĩnh vực này chưa mời được mentor. Vui lòng chọn một lĩnh vực cụ thể hơn."
    };
  }

  const topic = clean(input.topic, 1000);
  if (!topic || topic.length < 20) {
    return {
      ok: false,
      message: "Vui lòng mô tả bạn muốn nghe chia sẻ về điều gì (ít nhất 20 ký tự)."
    };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const membership = await resolveMenteeMembership(
    client,
    participant.account.personId,
    String(input.programCode ?? "")
  );
  if (!membership.ok) return { ok: false, message: membership.message };

  const { data: live, error: liveErr } = await client
    .from("cross_requests")
    .select("id,field_kind,field_code")
    .eq("requested_by_person_id", participant.account.personId)
    .eq("season_id", membership.seasonId)
    .in("status", LIVE_STATUSES);

  if (liveErr) {
    log("count live requests", liveErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const liveRows = (live ?? []) as Array<{ field_kind: string; field_code: string }>;

  if (liveRows.some((row) => row.field_kind === fieldKind && row.field_code === fieldCode)) {
    return {
      ok: false,
      message: "Bạn đã có một đề xuất đang chờ cho lĩnh vực này. Vui lòng đợi ban tổ chức phản hồi."
    };
  }
  if (liveRows.length >= MAX_LIVE_REQUESTS_PER_MENTEE) {
    return {
      ok: false,
      message: `Bạn đang có ${liveRows.length} đề xuất chờ xử lý. Vui lòng đợi ban tổ chức phản hồi trước khi gửi thêm.`
    };
  }

  const { data: created, error: insertErr } = await client
    .from("cross_requests")
    .insert({
      season_id: membership.seasonId,
      program_id: membership.programId,
      requested_by_person_id: participant.account.personId,
      field_kind: fieldKind,
      field_code: fieldCode,
      topic,
      note: clean(input.note, 1000),
      status: "submitted"
    })
    .select("id")
    .maybeSingle();

  if (insertErr || !created) {
    // The partial unique index catches a double submit the count above raced.
    if ((insertErr as { code?: string } | null)?.code === "23505") {
      return { ok: false, message: "Bạn đã có một đề xuất đang chờ cho lĩnh vực này." };
    }
    log("create request", insertErr);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    requestId: (created as { id: string }).id,
    newStatus: "submitted",
    changeType: "created",
    reason: `Mentee đề xuất lĩnh vực ${fieldLabel(fieldKind, fieldCode)}.`,
    changedByPersonId: participant.account.personId
  });

  return {
    ok: true,
    message: "Đã gửi đề xuất. Ban tổ chức sẽ xem và phản hồi trong ít ngày tới."
  };
}

/** The wishes this mentee has sent, in this programme. */
export async function listMyCrossRequests(programCode: string): Promise<CrossRequestRow[]> {
  const participant = await getCurrentParticipant();
  if (participant.state !== "participant") return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const membership = await resolveMenteeMembership(
    client,
    participant.account.personId,
    programCode,
    { requireMentee: false }
  );
  if (!membership.ok) return [];

  const { data, error } = await client
    .from("cross_requests")
    .select(
      "id,season_id,program_id,requested_by_person_id,field_kind,field_code,topic,note,status,review_note,scheduled_at,location,event_id,post_draft,post_status,created_at"
    )
    .eq("requested_by_person_id", participant.account.personId)
    .eq("season_id", membership.seasonId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    log("list my requests", error);
    return [];
  }

  // The mentee sees their own rows; the draft post is an internal working
  // document and never leaves the operations screens.
  return (data ?? []).map((row) => ({ ...toRow(row), postDraft: null }));
}

// ── The organisers' side ─────────────────────────────────────────────────────

export async function listCrossRequests(input?: {
  seasonId?: string | null;
  status?: string | null;
}): Promise<CrossRequestRow[]> {
  const admin = await getCurrentAdminUser();
  if (!canTriageCrossRequest(admin?.role)) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  let query = client
    .from("cross_requests")
    .select(
      "id,season_id,program_id,requested_by_person_id,field_kind,field_code,topic,note,status,review_note,scheduled_at,location,event_id,post_draft,post_status,created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (input?.seasonId && isValidUuid(input.seasonId)) query = query.eq("season_id", input.seasonId);
  if (input?.status) query = query.eq("status", input.status);

  const { data, error } = await query;
  if (error) {
    log("list requests", error);
    return [];
  }

  const rows = (data ?? []).map(toRow);
  await attachRequesterNames(client, rows);
  await attachInvitationCounts(client, rows);
  return rows;
}

export type CrossRequestDetail = CrossRequestRow & {
  invitations: Array<{
    id: string;
    mentorPersonId: string;
    mentorName: string | null;
    status: string;
    respondedAt: string | null;
    note: string | null;
    linkSentAt: string | null;
    countsTowardDecline: boolean;
    slots: Array<{ startsAt: string; note: string | null }>;
  }>;
  history: Array<{
    changeType: string;
    oldStatus: string | null;
    newStatus: string;
    reason: string | null;
    createdAt: string;
  }>;
};

export async function getCrossRequestDetail(requestId: string): Promise<CrossRequestDetail | null> {
  const admin = await getCurrentAdminUser();
  if (!canTriageCrossRequest(admin?.role)) return null;
  if (!isValidUuid(requestId)) return null;

  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("cross_requests")
    .select(
      "id,season_id,program_id,requested_by_person_id,field_kind,field_code,topic,note,status,review_note,scheduled_at,location,event_id,post_draft,post_status,created_at"
    )
    .eq("id", requestId)
    .maybeSingle();

  if (error || !data) {
    if (error) log("read request detail", error);
    return null;
  }

  const row = toRow(data);
  await attachRequesterNames(client, [row]);

  const { data: invitationRows } = await client
    .from("cross_invitations")
    .select("id,mentor_person_id,status,responded_at,note,link_sent_at,counts_toward_decline")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });

  const invitations = ((invitationRows ?? []) as Array<{
    id: string;
    mentor_person_id: string;
    status: string;
    responded_at: string | null;
    note: string | null;
    link_sent_at: string | null;
    counts_toward_decline: boolean;
  }>).map((item) => ({
    id: item.id,
    mentorPersonId: item.mentor_person_id,
    mentorName: null as string | null,
    status: item.status,
    respondedAt: item.responded_at,
    note: item.note,
    linkSentAt: item.link_sent_at,
    countsTowardDecline: item.counts_toward_decline,
    slots: [] as Array<{ startsAt: string; note: string | null }>
  }));

  if (invitations.length) {
    const { data: people } = await client
      .from("people")
      .select("id,full_name")
      .in("id", invitations.map((item) => item.mentorPersonId));

    const names = new Map(
      ((people ?? []) as Array<{ id: string; full_name: string | null }>).map((person) => [
        person.id,
        person.full_name
      ])
    );

    const { data: slots } = await client
      .from("cross_invitation_slots")
      .select("invitation_id,starts_at,note")
      .in("invitation_id", invitations.map((item) => item.id))
      .order("starts_at", { ascending: true });

    for (const invitation of invitations) {
      invitation.mentorName = names.get(invitation.mentorPersonId) ?? null;
      invitation.slots = ((slots ?? []) as Array<{
        invitation_id: string;
        starts_at: string;
        note: string | null;
      }>)
        .filter((slot) => slot.invitation_id === invitation.id)
        .map((slot) => ({ startsAt: slot.starts_at, note: slot.note }));
    }
  }

  const { data: history } = await client
    .from("cross_request_log")
    .select("change_type,old_status,new_status,reason,created_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .limit(100);

  return {
    ...row,
    invitations,
    history: ((history ?? []) as Array<{
      change_type: string;
      old_status: string | null;
      new_status: string;
      reason: string | null;
      created_at: string;
    }>).map((item) => ({
      changeType: item.change_type,
      oldStatus: item.old_status,
      newStatus: item.new_status,
      reason: item.reason,
      createdAt: item.created_at
    }))
  };
}

/** Approve or turn down a wish. A rejection must say why. */
export async function reviewCrossRequest(input: {
  requestId?: unknown;
  decision?: unknown;
  reviewNote?: unknown;
}): Promise<MutationResult> {
  const requestId = String(input.requestId ?? "").trim();
  if (!isValidUuid(requestId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const decision = String(input.decision ?? "").trim();
  if (decision !== "approved" && decision !== "rejected") {
    return { ok: false, message: "Vui lòng chọn duyệt hoặc từ chối." };
  }

  const reviewNote = clean(input.reviewNote, 1000);
  if (decision === "rejected" && !reviewNote) {
    return { ok: false, message: "Vui lòng ghi lý do để mentee hiểu vì sao chưa được duyệt." };
  }

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canTriageCrossRequest(admin.role)) {
    return { ok: false, message: "Bạn không có quyền duyệt đề xuất cross-mentoring." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const current = await readStatus(client, requestId);
  if (!current) return { ok: false, message: "Không tìm thấy đề xuất." };

  const check = canTransition(current, decision, "reviewer");
  if (!check.ok) return { ok: false, message: check.message };

  const { data: updated, error } = await client
    .from("cross_requests")
    .update({
      status: decision,
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote
    })
    .eq("id", requestId)
    .eq("status", current)
    .select("id")
    .maybeSingle();

  if (error) {
    log("review request", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!updated) {
    return { ok: false, message: "Đề xuất vừa được người khác xử lý. Vui lòng tải lại trang." };
  }

  await writeLog(client, {
    requestId,
    oldStatus: current,
    newStatus: decision,
    changeType: decision === "approved" ? "approved" : "rejected",
    reason: reviewNote,
    changedBy: admin.id
  });

  return {
    ok: true,
    message:
      decision === "approved"
        ? "Đã duyệt. Bước tiếp theo: mời mentor theo lĩnh vực."
        : "Đã từ chối và ghi lại lý do."
  };
}

/**
 * Fix the time and place, and make the session real.
 *
 * The event is created first and the request updated second: an event with no
 * request pointing at it is an orphan an organiser can see and delete, while a
 * request claiming an event that was never made would break the shape check
 * every later read depends on.
 */
export async function scheduleCrossSession(input: {
  requestId?: unknown;
  scheduledAt?: unknown;
  location?: unknown;
  eventName?: unknown;
}): Promise<MutationResult> {
  const requestId = String(input.requestId ?? "").trim();
  if (!isValidUuid(requestId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canPublishCrossSession(admin.role)) {
    return { ok: false, message: "Chỉ core team trở lên mới chốt lịch buổi cross." };
  }

  const scheduledAt = parseDateTime(input.scheduledAt);
  if (!scheduledAt) return { ok: false, message: "Vui lòng nhập thời gian hợp lệ." };

  const location = clean(input.location, 500);
  if (!location) return { ok: false, message: "Vui lòng nhập địa điểm (hoặc link nếu họp online)." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client
    .from("cross_requests")
    .select("id,season_id,status,field_kind,field_code,topic,requested_by_person_id,event_id")
    .eq("id", requestId)
    .maybeSingle();

  if (error || !data) {
    if (error) log("read request for schedule", error);
    return { ok: false, message: "Không tìm thấy đề xuất." };
  }

  const request = data as {
    season_id: string;
    status: RequestStatus;
    field_kind: string;
    field_code: string;
    topic: string | null;
    requested_by_person_id: string;
    event_id: string | null;
  };

  const check = canTransition(request.status, "scheduled", "publisher");
  if (!check.ok) return { ok: false, message: check.message };

  // Somebody must actually be running it.
  const { data: selected } = await client
    .from("cross_invitations")
    .select("id,mentor_person_id")
    .eq("request_id", requestId)
    .eq("status", "selected");

  const chosen = (selected ?? []) as Array<{ id: string; mentor_person_id: string }>;
  if (!chosen.length) {
    return { ok: false, message: "Chưa chọn mentor cho buổi này. Vui lòng chốt mentor trước." };
  }

  const label = fieldLabel(request.field_kind, request.field_code);
  const eventName = clean(input.eventName, 200) ?? `Cross-mentoring — ${label}`;

  let eventId = request.event_id;

  if (!eventId) {
    // The venue is written into the description because `events` has no
    // location column; changing that table is its own piece of work.
    const description = [`Buổi cross-mentoring về ${label}.`, `Địa điểm: ${location}`]
      .concat(request.topic ? [`Chủ đề mentee đề xuất: ${request.topic}`] : [])
      .join("\n\n");

    const { data: createdEvent, error: eventErr } = await client
      .from("events")
      .insert({
        season_id: request.season_id,
        event_name: eventName,
        event_type: "cross_mentoring",
        starts_at: scheduledAt,
        event_description: description,
        registration_required: true,
        allow_walk_in: true,
        checkin_mode: "open"
      })
      .select("id")
      .maybeSingle();

    if (eventErr || !createdEvent) {
      log("create cross event", eventErr);
      return {
        ok: false,
        message:
          "Chưa tạo được sự kiện cho buổi này. Nếu lỗi lặp lại, có thể migration 073 chưa được chạy."
      };
    }

    eventId = (createdEvent as { id: string }).id;
  }

  const { data: updated, error: updateErr } = await client
    .from("cross_requests")
    .update({
      status: "scheduled",
      scheduled_at: scheduledAt,
      location,
      event_id: eventId
    })
    .eq("id", requestId)
    .eq("status", request.status)
    .select("id")
    .maybeSingle();

  if (updateErr || !updated) {
    log("attach event to request", updateErr);
    return {
      ok: false,
      message: `Đã tạo sự kiện nhưng chưa gắn được vào đề xuất. Vui lòng tải lại trang và thử lại.`
    };
  }

  // Mentors who volunteered and were chosen become participants straight away —
  // the owner's decision: a mentor who accepted almost never fails to appear.
  await recordMentorParticipation(client, eventId, request.season_id, chosen.map((row) => row.mentor_person_id));

  await writeLog(client, {
    requestId,
    oldStatus: request.status,
    newStatus: "scheduled",
    changeType: "scheduled",
    reason: `${scheduledAt} — ${location}`,
    changedBy: admin.id
  });

  await notifyMenteeScheduled(client, {
    requestId,
    personId: request.requested_by_person_id,
    fieldLabel: label,
    scheduledAt,
    location,
    eventId
  });

  return { ok: true, message: "Đã chốt lịch và tạo sự kiện. Bước tiếp theo: mở link đăng ký." };
}

/** Open registration and mark the post approved. */
export async function publishCrossSession(input: {
  requestId?: unknown;
}): Promise<MutationResult> {
  const requestId = String(input.requestId ?? "").trim();
  if (!isValidUuid(requestId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canPublishCrossSession(admin.role)) {
    return { ok: false, message: "Chỉ core team trở lên mới mở đăng ký buổi cross." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client
    .from("cross_requests")
    .select("id,status,event_id")
    .eq("id", requestId)
    .maybeSingle();

  if (error || !data) return { ok: false, message: "Không tìm thấy đề xuất." };

  const request = data as { status: RequestStatus; event_id: string | null };
  const check = canTransition(request.status, "published", "publisher");
  if (!check.ok) return { ok: false, message: check.message };
  if (!request.event_id) return { ok: false, message: "Buổi này chưa có sự kiện." };

  const link = await createRegistrationLinkForEvent(request.event_id);
  if (!link.ok) return { ok: false, message: link.message };

  const { data: updated, error: updateErr } = await client
    .from("cross_requests")
    .update({ status: "published", post_status: "approved" })
    .eq("id", requestId)
    .eq("status", request.status)
    .select("id")
    .maybeSingle();

  if (updateErr || !updated) {
    log("publish request", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    requestId,
    oldStatus: request.status,
    newStatus: "published",
    changeType: "published",
    reason: "Đã mở link đăng ký.",
    changedBy: admin.id
  });

  return { ok: true, message: "Đã mở đăng ký. Link và QR nằm ở trang sự kiện." };
}

/**
 * Close the books on a session.
 *
 * The one place `no_show` is ever written. Until this runs, "registered and did
 * not come" and "the session has not happened yet" look identical in the data,
 * and any attendance rate computed from them is wrong.
 */
export async function completeCrossSession(input: {
  requestId?: unknown;
}): Promise<MutationResult> {
  const requestId = String(input.requestId ?? "").trim();
  if (!isValidUuid(requestId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canPublishCrossSession(admin.role)) {
    return { ok: false, message: "Chỉ core team trở lên mới chốt sổ buổi cross." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client
    .from("cross_requests")
    .select("id,status,event_id")
    .eq("id", requestId)
    .maybeSingle();

  if (error || !data) return { ok: false, message: "Không tìm thấy đề xuất." };

  const request = data as { status: RequestStatus; event_id: string | null };
  const check = canTransition(request.status, "completed", "publisher");
  if (!check.ok) return { ok: false, message: check.message };

  let markedNoShow = 0;

  if (request.event_id) {
    const { data: pending, error: pendingErr } = await client
      .from("event_registrations")
      .update({ attendance_status: "no_show" })
      .eq("event_id", request.event_id)
      .eq("attendance_status", "pending")
      .neq("registration_status", "cancelled")
      .select("id");

    if (pendingErr) log("mark no_show (non-fatal)", pendingErr);
    else markedNoShow = (pending ?? []).length;

    // The chosen mentors were put on the sheet when the session was scheduled;
    // now that it has happened, they are marked present. The owner's call: a
    // mentor who accepted and was announced does not check in at their own
    // session, and making their attendance depend on a QR scan would report
    // every cross session as mentor-less.
    const { error: mentorErr } = await client
      .from("event_participations")
      .update({ attendance_status: "attended" })
      .eq("event_id", request.event_id)
      .eq("role_at_event", "mentor")
      .eq("attendance_status", "registered_no_response");

    if (mentorErr) log("mark mentors attended (non-fatal)", mentorErr);
  }

  const { data: updated, error: updateErr } = await client
    .from("cross_requests")
    .update({ status: "completed" })
    .eq("id", requestId)
    .eq("status", request.status)
    .select("id")
    .maybeSingle();

  if (updateErr || !updated) {
    log("complete request", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    requestId,
    oldStatus: request.status,
    newStatus: "completed",
    changeType: "completed",
    reason: `${markedNoShow} đăng ký không tới được ghi nhận vắng.`,
    changedBy: admin.id
  });

  return {
    ok: true,
    message: markedNoShow
      ? `Đã chốt sổ. ${markedNoShow} bạn đăng ký nhưng không tới được ghi nhận vắng.`
      : "Đã chốt sổ buổi gặp."
  };
}

/**
 * Call the whole thing off.
 *
 * Every mentor still waiting is released **without** it counting against them.
 * The owner asked for this in as many words, and it is right: a mentor who
 * volunteered for a session the organisers cancelled has not been passed over,
 * and should not be rested from the next two rounds because of it.
 */
export async function cancelCrossRequest(input: {
  requestId?: unknown;
  reason?: unknown;
}): Promise<MutationResult> {
  const requestId = String(input.requestId ?? "").trim();
  if (!isValidUuid(requestId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const reason = clean(input.reason, 1000);
  if (!reason) return { ok: false, message: "Vui lòng ghi lý do huỷ." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canPublishCrossSession(admin.role)) {
    return { ok: false, message: "Chỉ core team trở lên mới huỷ được buổi cross." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const current = await readStatus(client, requestId);
  if (!current) return { ok: false, message: "Không tìm thấy đề xuất." };

  const check = canTransition(current, "cancelled", "publisher");
  if (!check.ok) return { ok: false, message: check.message };

  const { error: releaseErr } = await client
    .from("cross_invitations")
    .update({ status: "withdrawn", counts_toward_decline: false })
    .eq("request_id", requestId)
    .in("status", ["invited", "accepted"]);

  if (releaseErr) log("release invitations (non-fatal)", releaseErr);

  const { data: updated, error: updateErr } = await client
    .from("cross_requests")
    .update({ status: "cancelled", review_note: reason })
    .eq("id", requestId)
    .eq("status", current)
    .select("id")
    .maybeSingle();

  if (updateErr || !updated) {
    log("cancel request", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    requestId,
    oldStatus: current,
    newStatus: "cancelled",
    changeType: "cancelled",
    reason,
    changedBy: admin.id
  });

  return {
    ok: true,
    message: "Đã huỷ. Các mentor đang chờ được thả ra và lần huỷ này không tính vào số lần chưa được chọn."
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toRow(raw: unknown): CrossRequestRow {
  const row = raw as Record<string, unknown>;
  const status = String(row.status ?? "submitted") as RequestStatus;

  return {
    id: String(row.id ?? ""),
    seasonId: String(row.season_id ?? ""),
    programId: String(row.program_id ?? ""),
    requestedByPersonId: String(row.requested_by_person_id ?? ""),
    requesterName: null,
    fieldKind: String(row.field_kind ?? ""),
    fieldCode: String(row.field_code ?? ""),
    fieldLabel: fieldLabel(row.field_kind, row.field_code),
    topic: (row.topic as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    status,
    statusLabel: requestStatusLabel(status),
    reviewNote: (row.review_note as string | null) ?? null,
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    eventId: (row.event_id as string | null) ?? null,
    postDraft: (row.post_draft as string | null) ?? null,
    postStatus: String(row.post_status ?? "none"),
    createdAt: String(row.created_at ?? "")
  };
}

async function readStatus(client: ServiceClient, requestId: string): Promise<RequestStatus | null> {
  const { data, error } = await client
    .from("cross_requests")
    .select("status")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    log("read status", error);
    return null;
  }
  return ((data as { status?: string } | null)?.status ?? null) as RequestStatus | null;
}

async function attachRequesterNames(client: ServiceClient, rows: CrossRequestRow[]) {
  const ids = Array.from(new Set(rows.map((row) => row.requestedByPersonId).filter(Boolean)));
  if (!ids.length) return;

  const { data, error } = await client.from("people").select("id,full_name").in("id", ids);
  if (error) {
    log("read requester names (non-fatal)", error);
    return;
  }

  const names = new Map(
    ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [
      row.id,
      row.full_name
    ])
  );
  for (const row of rows) row.requesterName = names.get(row.requestedByPersonId) ?? null;
}

async function attachInvitationCounts(client: ServiceClient, rows: CrossRequestRow[]) {
  if (!rows.length) return;

  const { data, error } = await client
    .from("cross_invitations")
    .select("request_id,status")
    .in("request_id", rows.map((row) => row.id));

  if (error) {
    log("count invitations (non-fatal)", error);
    return;
  }

  const items = (data ?? []) as Array<{ request_id: string; status: string }>;
  for (const row of rows) {
    const mine = items.filter((item) => item.request_id === row.id);
    row.invited = mine.length;
    row.accepted = mine.filter((item) => ["accepted", "selected"].includes(item.status)).length;
  }
}

type MembershipResult =
  | { ok: true; programId: string; seasonId: string }
  | { ok: false; message: string };

/**
 * The programme this person is in, and the season it is running.
 *
 * Resolved from the membership rather than trusted from the URL: the programme
 * code arrives from a page parameter, and a mentee editing it must not reach
 * another programme's queue.
 */
async function resolveMenteeMembership(
  client: ServiceClient,
  personId: string,
  programCode: string,
  options?: { requireMentee?: boolean }
): Promise<MembershipResult> {
  const code = String(programCode ?? "").trim();
  if (!code) return { ok: false, message: "Không xác định được chương trình." };

  const { data: program, error: programErr } = await client
    .from("programs")
    .select("id,current_season_id,is_active")
    .eq("code", code)
    .maybeSingle();

  if (programErr) {
    log("read program", programErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const programRow = program as {
    id: string;
    current_season_id: string | null;
    is_active: boolean | null;
  } | null;

  if (!programRow || programRow.is_active === false) {
    return { ok: false, message: "Chương trình này hiện không nhận đề xuất." };
  }
  if (!programRow.current_season_id) {
    return { ok: false, message: "Chương trình chưa mở mùa. Vui lòng liên hệ ban tổ chức." };
  }

  const { data: membership, error: membershipErr } = await client
    .from("person_program_memberships")
    .select("role,status")
    .eq("person_id", personId)
    .eq("program_id", programRow.id)
    .eq("status", "active");

  if (membershipErr) {
    log("read membership", membershipErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const roles = ((membership ?? []) as Array<{ role: string }>).map((row) => row.role);
  if (!roles.length) return { ok: false, message: "Bạn không thuộc chương trình này." };

  if (options?.requireMentee !== false && !roles.includes("mentee")) {
    return { ok: false, message: "Chỉ mentee mới gửi được đề xuất cross-mentoring." };
  }

  return { ok: true, programId: programRow.id, seasonId: programRow.current_season_id };
}

/** Put the chosen mentors on the event's attendance sheet. */
async function recordMentorParticipation(
  client: ServiceClient,
  eventId: string,
  seasonId: string,
  mentorPersonIds: string[]
) {
  if (!mentorPersonIds.length) return;

  for (const personId of mentorPersonIds) {
    const { data: existing } = await client
      .from("event_participations")
      .select("id")
      .eq("event_id", eventId)
      .eq("person_id", personId)
      .maybeSingle();

    if (existing) continue;

    // `event_participations` has no unique constraint on (event_id, person_id),
    // so the read above is the only thing standing between a re-run and a
    // duplicate row. Cheap, and the alternative is a mentor counted twice.
    //
    // `registered_no_response` and not `attended`: the session has not happened
    // yet. Migration 049's own comment says this value is not an absence, which
    // is exactly what is true here. It becomes `attended` when the organisers
    // close the books.
    const { error } = await client.from("event_participations").insert({
      event_id: eventId,
      person_id: personId,
      season_id: seasonId,
      role_at_event: "mentor",
      registration_status: "registered",
      attendance_status: "registered_no_response"
    });

    if (error) log("record mentor participation (non-fatal)", error);
  }
}

/** Tell the mentee their wish became a session. */
async function notifyMenteeScheduled(
  client: ServiceClient,
  input: {
    requestId: string;
    personId: string;
    fieldLabel: string;
    scheduledAt: string;
    location: string;
    eventId: string;
  }
) {
  try {
    const { data: person } = await client
      .from("people")
      .select("full_name,email_primary")
      .eq("id", input.personId)
      .maybeSingle();

    const row = person as { full_name: string | null; email_primary: string | null } | null;
    const email = String(row?.email_primary ?? "").trim();
    if (!email) return;

    // The registration link only exists once somebody publishes; before then
    // the letter simply says when and where, which is the part that matters.
    const { data: link } = await client
      .from("event_links")
      .select("token")
      .eq("event_id", input.eventId)
      .eq("link_type", "registration")
      .maybeSingle();

    const token = (link as { token?: string } | null)?.token ?? null;
    const base = resolveEmailBaseUrl(null);

    await sendCrossScheduled({
      toEmail: email,
      menteeName: row?.full_name ?? "",
      fieldLabel: input.fieldLabel,
      timeLabel: formatVietnameseDateTime(input.scheduledAt),
      location: input.location,
      registerUrl: token && base ? `${base}/register/${token}` : null,
      requestId: input.requestId
    });
  } catch (err) {
    log("notify mentee (non-fatal)", err);
  }
}

/** A `datetime-local` value carries no zone; the programme runs on GMT+7. */
function parseDateTime(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}:00+07:00`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatVietnameseDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
}
