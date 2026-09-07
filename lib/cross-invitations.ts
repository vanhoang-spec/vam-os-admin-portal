import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canPublishCrossSession, canTriageCrossRequest } from "@/lib/permissions";
import { resolveEmailBaseUrl, sendCrossInvite, sendCrossNotSelected, sendCrossSelected } from "@/lib/email";
import { fieldLabel, type FieldKind } from "@/lib/cross-fields-core";
import {
  canMentorRespond,
  canSelectInvitation,
  nextStatusAfterResponse,
  partitionSweepCandidates,
  summarizeInvitations,
  type InvitationStatus
} from "@/lib/cross-mentoring-core";
import { getMentorsForField } from "@/lib/mentor-cross-fields";

/**
 * lib/cross-invitations.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Asking mentors, hearing back, and choosing.
 *
 * Three rules run through it.
 *
 * A MENTOR IS WRITTEN TO ONCE. The row is claimed — `link_sent_at` set from
 * null in a single conditional update — and the letter goes only if that claim
 * came back. Two clicks on "send invitations" half a second apart would
 * otherwise mail every mentor twice, and the whole point of this feature is to
 * ask people carefully.
 *
 * A MENTOR PASSED OVER TWICE IS RESTED. Not blocked and not hidden: left out of
 * the automatic sweep for the rest of the season, and still addable by hand.
 * Only a passing-over that was about them counts — a session the organisers
 * cancelled outright spends nobody's patience.
 *
 * NOBODY IS CHOSEN WHO DID NOT SAY YES. Enforced here and again in the
 * database, because "we've scheduled you" to somebody who never accepted is the
 * kind of mistake that costs a mentor.
 */

const SAFE_ERROR = "Không thực hiện được thao tác. Vui lòng thử lại.";

/** One sweep writes to at most this many people, well under the provider's daily ceiling. */
export const MAX_INVITES_PER_SWEEP = 40;

/** How long a mentor has to answer before the link stops working. */
const INVITE_TTL_DAYS = 21;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[cross-invitations]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

// ── The sweep ────────────────────────────────────────────────────────────────

export type SweepSummary = {
  ok: boolean;
  message: string;
  invited: number;
  /** Mentors left out because they were passed over twice this season. */
  rested: number;
  alreadyInvited: number;
  noEmail: number;
  failed: number;
};

/**
 * Ask the mentors who master this field.
 *
 * Every exclusion is counted and reported rather than applied silently: an
 * organiser who expected twenty letters and got twelve should be told why on
 * the same screen, not left to wonder.
 */
export async function sweepInvitations(input: {
  requestId?: unknown;
}): Promise<SweepSummary> {
  const requestId = String(input.requestId ?? "").trim();
  const empty = (message: string): SweepSummary => ({
    ok: false,
    message,
    invited: 0,
    rested: 0,
    alreadyInvited: 0,
    noEmail: 0,
    failed: 0
  });

  if (!isValidUuid(requestId)) return empty("Đề xuất không hợp lệ.");

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return empty("Bạn chưa đăng nhập.");
  if (!canTriageCrossRequest(admin.role)) {
    return empty("Bạn không có quyền mời mentor cho đề xuất này.");
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return empty(SAFE_ERROR);

  const request = await readRequest(client, requestId);
  if (!request) return empty("Không tìm thấy đề xuất.");
  if (!["approved", "inviting", "selecting"].includes(request.status)) {
    return empty("Đề xuất này chưa được duyệt, hoặc đã kết thúc.");
  }

  const candidates = await getMentorsForField({
    seasonId: request.season_id,
    fieldKind: request.field_kind as FieldKind,
    fieldCode: request.field_code
  });

  if (!candidates.length) {
    return empty(
      "Chưa có mentor nào khai lĩnh vực này trong mùa. Cần mời tay, hoặc nhắc mentor cập nhật lĩnh vực."
    );
  }

  // Never ask the mentee's own mentor: cross-mentoring means hearing from
  // somebody who is not already yours.
  const ownMentors = await readOwnMentors(client, request.season_id, request.requested_by_person_id);
  const alreadyInvited = await readAlreadyInvited(client, requestId);
  const passedOver = await countPassedOver(client, request.season_id);

  const pool = candidates
    .filter((personId) => !ownMentors.has(personId))
    .filter((personId) => !alreadyInvited.has(personId))
    .map((personId) => ({ personId }));

  const { invite, rested } = partitionSweepCandidates(pool, passedOver);
  const batch = invite.slice(0, MAX_INVITES_PER_SWEEP);

  const summary: SweepSummary = {
    ok: true,
    message: "",
    invited: 0,
    rested: rested.length,
    alreadyInvited: alreadyInvited.size,
    noEmail: 0,
    failed: 0
  };

  if (!batch.length) {
    return {
      ...summary,
      ok: false,
      message: rested.length
        ? `Không còn mentor nào để mời: ${rested.length} người đã được nghỉ vì chưa được chọn 2 lần trong mùa.`
        : "Tất cả mentor của lĩnh vực này đã được mời cho đề xuất này."
    };
  }

  const people = await readPeople(client, batch.map((row) => row.personId));
  const seasonLabel = request.season_name || request.season_code || "";
  const label = fieldLabel(request.field_kind, request.field_code);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  const base = resolveEmailBaseUrl(null);

  for (const candidate of batch) {
    const person = people.get(candidate.personId);
    const email = String(person?.email_primary ?? "").trim();
    if (!email) {
      summary.noEmail++;
      continue;
    }

    const { data: created, error: insertErr } = await client
      .from("cross_invitations")
      .insert({
        request_id: requestId,
        season_id: request.season_id,
        mentor_person_id: candidate.personId,
        status: "invited",
        token_expires_at: expiresAt
      })
      .select("id,token")
      .maybeSingle();

    if (insertErr || !created) {
      // A unique violation here means somebody else's sweep got there first,
      // which is the constraint doing its job.
      log("create invitation", insertErr);
      summary.failed++;
      continue;
    }

    const invitation = created as { id: string; token: string };

    // Claim before sending. If two sweeps race, only one update returns a row,
    // and only that one writes to the mentor.
    const { data: claimed, error: claimErr } = await client
      .from("cross_invitations")
      .update({ link_sent_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .is("link_sent_at", null)
      .select("id")
      .maybeSingle();

    if (claimErr || !claimed) {
      log("claim invitation (already claimed)", claimErr);
      continue;
    }

    try {
      const sent = await sendCrossInvite({
        toEmail: email,
        mentorName: person?.full_name ?? "",
        fieldLabel: label,
        topic: request.topic,
        seasonLabel,
        respondUrl: `${base}/cross/${invitation.token}`,
        invitationId: invitation.id
      });

      if (sent.ok) summary.invited++;
      else {
        summary.failed++;
        await client
          .from("cross_invitations")
          .update({ link_send_error: String(sent.reason ?? "").slice(0, 300) })
          .eq("id", invitation.id);
      }
    } catch (err) {
      log("send invite (non-fatal)", err);
      summary.failed++;
    }
  }

  if (summary.invited > 0 && request.status === "approved") {
    await client.from("cross_requests").update({ status: "inviting" }).eq("id", requestId);
    await writeLog(client, {
      requestId,
      oldStatus: request.status,
      newStatus: "inviting",
      changeType: "invited",
      reason: `Đã mời ${summary.invited} mentor.`,
      changedBy: admin.id
    });
  }

  const parts = [`Đã mời ${summary.invited} mentor`];
  if (summary.rested) parts.push(`${summary.rested} người được nghỉ (chưa được chọn 2 lần)`);
  if (summary.alreadyInvited) parts.push(`${summary.alreadyInvited} người đã mời trước đó`);
  if (summary.noEmail) parts.push(`${summary.noEmail} người chưa có email`);
  if (summary.failed) parts.push(`${summary.failed} người chưa gửi được`);

  summary.message = `${parts.join(", ")}.`;
  summary.ok = summary.invited > 0;
  return summary;
}

// ── The mentor's reply ───────────────────────────────────────────────────────

export type PublicInvitationState = "ready" | "not_found" | "expired" | "closed";

export type PublicInvitationView = {
  state: PublicInvitationState;
  mentorName: string;
  fieldLabel: string;
  topic: string | null;
  seasonLabel: string;
  status: InvitationStatus | null;
  slots: Array<{ startsAt: string; note: string | null }>;
  note: string | null;
  updatedAt: string | null;
};

const NOT_FOUND_VIEW: PublicInvitationView = {
  state: "not_found",
  mentorName: "",
  fieldLabel: "",
  topic: null,
  seasonLabel: "",
  status: null,
  slots: [],
  note: null,
  updatedAt: null
};

/**
 * The invitation behind a token.
 *
 * Four coarse states and no more, exactly as the mentor confirmation page does
 * it: the page must not become a way to find out which tokens exist, and it
 * must never say who else was invited or who was chosen.
 */
export async function getInvitationByToken(token: string): Promise<PublicInvitationView> {
  if (!isValidUuid(token)) return NOT_FOUND_VIEW;

  const client = getSupabaseServiceRoleClient();
  if (!client) return NOT_FOUND_VIEW;

  const { data, error } = await client
    .from("cross_invitations")
    .select("id,request_id,mentor_person_id,status,token_expires_at,note,updated_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    log("read invitation by token", error);
    return NOT_FOUND_VIEW;
  }

  const row = data as {
    id: string;
    request_id: string;
    mentor_person_id: string;
    status: string;
    token_expires_at: string | null;
    note: string | null;
    updated_at: string | null;
  } | null;
  if (!row) return NOT_FOUND_VIEW;

  const request = await readRequest(client, row.request_id);
  const people = await readPeople(client, [row.mentor_person_id]);
  const mentorName = people.get(row.mentor_person_id)?.full_name ?? "";

  const base = {
    mentorName,
    fieldLabel: request ? fieldLabel(request.field_kind, request.field_code) : "",
    topic: request?.topic ?? null,
    seasonLabel: request?.season_name || request?.season_code || "",
    status: row.status as InvitationStatus,
    slots: await readSlots(client, row.id),
    note: row.note,
    updatedAt: row.updated_at
  };

  if (row.token_expires_at && new Date(row.token_expires_at).getTime() <= Date.now()) {
    return { ...base, state: "expired" };
  }

  // The organisers have decided, or the request has moved on. Deliberately one
  // state for both: the page never reveals that somebody else was chosen.
  if (!canMentorRespond(row.status)) return { ...base, state: "closed" };
  if (request && !["inviting", "selecting"].includes(request.status)) {
    return { ...base, state: "closed" };
  }

  return { ...base, state: "ready" };
}

/**
 * Record what a mentor answered.
 *
 * Slots are written before the status, on purpose. A crash between the two
 * leaves an unanswered invitation with some hours attached, which the next
 * submit overwrites; the reverse order would leave "accepted, any time".
 */
export async function submitInvitationResponse(input: {
  token?: unknown;
  decision?: unknown;
  slots?: unknown;
  note?: unknown;
  updatedAtSnapshot?: string | null;
}): Promise<MutationResult & { state?: PublicInvitationState }> {
  const token = String(input.token ?? "").trim();
  if (!isValidUuid(token)) return { ok: false, message: "Đường dẫn không hợp lệ." };

  const decision = String(input.decision ?? "").trim();
  if (!["accepted", "declined"].includes(decision)) {
    return { ok: false, message: "Vui lòng chọn nhận lời hoặc từ chối." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client
    .from("cross_invitations")
    .select("id,request_id,status,token_expires_at,updated_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    log("read invitation for submit", error);
    return { ok: false, message: SAFE_ERROR };
  }

  const row = data as {
    id: string;
    request_id: string;
    status: string;
    token_expires_at: string | null;
  } | null;
  if (!row) return { ok: false, message: "Không tìm thấy lời mời này.", state: "not_found" };

  if (row.token_expires_at && new Date(row.token_expires_at).getTime() <= Date.now()) {
    return { ok: false, message: "Đường dẫn đã hết hạn. Vui lòng liên hệ ban tổ chức.", state: "expired" };
  }
  if (!canMentorRespond(row.status)) {
    return {
      ok: false,
      message: "Ban tổ chức đã chốt cho buổi này. Cảm ơn anh/chị đã phản hồi.",
      state: "closed"
    };
  }

  const slots = parseSlots(input.slots);

  if (decision === "accepted") {
    await client.from("cross_invitation_slots").delete().eq("invitation_id", row.id);
    if (slots.length) {
      const { error: slotErr } = await client
        .from("cross_invitation_slots")
        .insert(slots.map((slot) => ({ invitation_id: row.id, starts_at: slot })));
      if (slotErr) log("write slots (non-fatal)", slotErr);
    }
  }

  let update = client
    .from("cross_invitations")
    .update({
      status: decision,
      responded_at: new Date().toISOString(),
      note: String(input.note ?? "").trim().slice(0, 1000) || null
    })
    .eq("id", row.id);

  // A stale tab must not overwrite a newer answer.
  if (input.updatedAtSnapshot) update = update.eq("updated_at", input.updatedAtSnapshot);

  const { data: updated, error: updateErr } = await update.select("id").maybeSingle();

  if (updateErr) {
    log("record response", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!updated) {
    return {
      ok: false,
      message: "Thông tin đã được cập nhật ở nơi khác. Vui lòng tải lại trang và thử lại."
    };
  }

  await writeLog(client, {
    requestId: row.request_id,
    invitationId: row.id,
    oldStatus: row.status,
    newStatus: decision,
    changeType: "mentor_responded",
    reason: decision === "accepted" ? `Nhận lời, đề nghị ${slots.length} khung giờ.` : "Từ chối."
  });

  // The first acceptance moves the request on without an organiser noticing.
  await advanceRequestAfterResponse(client, row.request_id);

  return {
    ok: true,
    message:
      decision === "accepted"
        ? "Cảm ơn anh/chị đã nhận lời. Ban tổ chức sẽ báo lại sau khi chốt."
        : "Đã ghi nhận. Cảm ơn anh/chị đã phản hồi."
  };
}

// ── Choosing ─────────────────────────────────────────────────────────────────

/**
 * Choose who runs the session, and tell everybody who answered.
 *
 * Both letters go out here, and neither can be taken back — which is why this
 * needs the publishing role rather than the triage one.
 */
export async function decideInvitations(input: {
  requestId?: unknown;
  selectedIds?: unknown;
  /** False when the passing-over is not about the mentors — a cancelled session. */
  countsTowardDecline?: boolean;
}): Promise<MutationResult> {
  const requestId = String(input.requestId ?? "").trim();
  if (!isValidUuid(requestId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const selectedIds = toIdList(input.selectedIds);
  if (!selectedIds.length) return { ok: false, message: "Chưa chọn mentor nào." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canPublishCrossSession(admin.role)) {
    return { ok: false, message: "Chỉ core team trở lên mới chốt được mentor cho buổi cross." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const request = await readRequest(client, requestId);
  if (!request) return { ok: false, message: "Không tìm thấy đề xuất." };

  const { data: rows, error } = await client
    .from("cross_invitations")
    .select("id,mentor_person_id,status")
    .eq("request_id", requestId);

  if (error) {
    log("read invitations for decision", error);
    return { ok: false, message: SAFE_ERROR };
  }

  const invitations = (rows ?? []) as Array<{
    id: string;
    mentor_person_id: string;
    status: string;
  }>;

  // Nobody is chosen who did not say yes.
  const invalid = selectedIds.filter((id) => {
    const row = invitations.find((item) => item.id === id);
    return !row || !canSelectInvitation(row.status);
  });
  if (invalid.length) {
    return { ok: false, message: "Chỉ chọn được mentor đã nhận lời." };
  }

  const countsTowardDecline = input.countsTowardDecline !== false;
  const decidedAt = new Date().toISOString();
  const label = fieldLabel(request.field_kind, request.field_code);
  const seasonLabel = request.season_name || request.season_code || "";

  const people = await readPeople(client, invitations.map((row) => row.mentor_person_id));

  let chosen = 0;
  let passedOver = 0;

  for (const invitation of invitations) {
    if (!canSelectInvitation(invitation.status)) continue;

    const isChosen = selectedIds.includes(invitation.id);
    const status: InvitationStatus = isChosen ? "selected" : "not_selected";

    const { error: updateErr } = await client
      .from("cross_invitations")
      .update({
        status,
        decided_by: admin.id,
        decided_at: decidedAt,
        counts_toward_decline: isChosen ? true : countsTowardDecline
      })
      .eq("id", invitation.id);

    if (updateErr) {
      log("record decision", updateErr);
      continue;
    }

    const person = people.get(invitation.mentor_person_id);
    const email = String(person?.email_primary ?? "").trim();

    if (email) {
      try {
        if (isChosen) {
          await sendCrossSelected({
            toEmail: email,
            mentorName: person?.full_name ?? "",
            fieldLabel: label,
            seasonLabel,
            timeLabel: request.scheduled_at,
            location: request.location,
            invitationId: invitation.id
          });
        } else {
          await sendCrossNotSelected({
            toEmail: email,
            mentorName: person?.full_name ?? "",
            fieldLabel: label,
            seasonLabel,
            invitationId: invitation.id
          });
        }
      } catch (err) {
        log("send decision letter (non-fatal)", err);
      }
    }

    await writeLog(client, {
      requestId,
      invitationId: invitation.id,
      oldStatus: invitation.status,
      newStatus: status,
      changeType: isChosen ? "selected" : "not_selected",
      reason: countsTowardDecline ? null : "Buổi bị huỷ — không tính vào số lần chưa được chọn.",
      changedBy: admin.id
    });

    if (isChosen) chosen++;
    else passedOver++;
  }

  return {
    ok: chosen > 0,
    message: chosen
      ? `Đã chốt ${chosen} mentor và báo cho ${passedOver} người còn lại.`
      : "Chưa chốt được mentor nào."
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

type RequestRow = {
  id: string;
  season_id: string;
  status: string;
  field_kind: string;
  field_code: string;
  topic: string | null;
  location: string | null;
  scheduled_at: string | null;
  requested_by_person_id: string;
  season_code?: string | null;
  season_name?: string | null;
};

async function readRequest(client: ServiceClient, requestId: string): Promise<RequestRow | null> {
  const { data, error } = await client
    .from("cross_requests")
    .select(
      "id,season_id,status,field_kind,field_code,topic,location,scheduled_at,requested_by_person_id"
    )
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    log("read request", error);
    return null;
  }
  const row = data as RequestRow | null;
  if (!row) return null;

  const { data: season } = await client
    .from("seasons")
    .select("code,name")
    .eq("id", row.season_id)
    .maybeSingle();

  const seasonRow = season as { code?: string; name?: string } | null;
  return { ...row, season_code: seasonRow?.code ?? null, season_name: seasonRow?.name ?? null };
}

async function readPeople(client: ServiceClient, personIds: string[]) {
  const byId = new Map<string, { full_name: string | null; email_primary: string | null }>();
  if (!personIds.length) return byId;

  const { data, error } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .in("id", Array.from(new Set(personIds)));

  if (error) {
    log("read people", error);
    return byId;
  }

  for (const row of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email_primary: string | null;
  }>) {
    byId.set(row.id, { full_name: row.full_name, email_primary: row.email_primary });
  }
  return byId;
}

/** The mentee's own mentors this season — never invited to their cross session. */
async function readOwnMentors(client: ServiceClient, seasonId: string, menteePersonId: string) {
  const own = new Set<string>();

  const { data, error } = await client
    .from("matches")
    .select("mentor_person_id")
    .eq("season_id", seasonId)
    .eq("mentee_person_id", menteePersonId)
    .eq("status", "active");

  if (error) {
    // Fail closed on this one: inviting a mentee's own mentor to cross-mentor
    // them is a small, memorable embarrassment.
    log("read own mentors", error);
    return own;
  }

  for (const row of (data ?? []) as Array<{ mentor_person_id: string | null }>) {
    if (row.mentor_person_id) own.add(row.mentor_person_id);
  }
  return own;
}

async function readAlreadyInvited(client: ServiceClient, requestId: string) {
  const invited = new Set<string>();

  const { data, error } = await client
    .from("cross_invitations")
    .select("mentor_person_id")
    .eq("request_id", requestId);

  if (error) {
    // Without this list a re-run would write to everybody again, so refuse to
    // treat the failure as "nobody has been invited".
    log("read already invited", error);
    return invited;
  }

  for (const row of (data ?? []) as Array<{ mentor_person_id: string }>) {
    invited.add(row.mentor_person_id);
  }
  return invited;
}

/**
 * How many times each mentor has been passed over this season.
 *
 * Derived rather than stored: the definition will change the first time
 * somebody asks whether a cancelled session counts, and a stored integer would
 * freeze the old answer. Cheap, too — one indexed read per sweep.
 */
export async function countPassedOver(
  client: ServiceClient,
  seasonId: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  const { data, error } = await client
    .from("cross_invitations")
    .select("mentor_person_id")
    .eq("season_id", seasonId)
    .eq("status", "not_selected")
    .eq("counts_toward_decline", true);

  if (error) {
    log("count passed over", error);
    return counts;
  }

  for (const row of (data ?? []) as Array<{ mentor_person_id: string }>) {
    counts.set(row.mentor_person_id, (counts.get(row.mentor_person_id) ?? 0) + 1);
  }
  return counts;
}

async function readSlots(client: ServiceClient, invitationId: string) {
  const { data, error } = await client
    .from("cross_invitation_slots")
    .select("starts_at,note")
    .eq("invitation_id", invitationId)
    .order("starts_at", { ascending: true });

  if (error) {
    log("read slots (non-fatal)", error);
    return [];
  }

  return ((data ?? []) as Array<{ starts_at: string; note: string | null }>).map((row) => ({
    startsAt: row.starts_at,
    note: row.note
  }));
}

/** Move the request to `selecting` once anybody has said yes. */
async function advanceRequestAfterResponse(client: ServiceClient, requestId: string) {
  const request = await readRequest(client, requestId);
  if (!request) return;

  const { data } = await client
    .from("cross_invitations")
    .select("status")
    .eq("request_id", requestId);

  const summary = summarizeInvitations((data ?? []) as Array<{ status: string }>);
  const next = nextStatusAfterResponse(request.status, summary);
  if (!next) return;

  await client.from("cross_requests").update({ status: next }).eq("id", requestId);
  await writeLog(client, {
    requestId,
    oldStatus: request.status,
    newStatus: next,
    changeType: "status_change",
    reason: "Đã có mentor nhận lời."
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** At most five hours, each a real instant, in order, without duplicates. */
function parseSlots(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  const parsed = raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => {
      // A bare `datetime-local` value carries no zone; the programme runs on
      // Vietnamese wall-clock time, so read it as such.
      const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(item) ? item : `${item}:00+07:00`;
      const date = new Date(withZone);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    })
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(parsed)).sort().slice(0, 5);
}

function toIdList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(
    new Set(raw.map((item) => String(item ?? "").trim()).filter((item) => isValidUuid(item)))
  );
}

export async function writeLog(
  client: ServiceClient,
  entry: {
    requestId: string;
    invitationId?: string | null;
    oldStatus?: string | null;
    newStatus: string;
    changeType: string;
    reason?: string | null;
    changedBy?: string | null;
    changedByPersonId?: string | null;
  }
) {
  const { error } = await client.from("cross_request_log").insert({
    request_id: entry.requestId,
    invitation_id: entry.invitationId ?? null,
    old_status: entry.oldStatus ?? null,
    new_status: entry.newStatus,
    change_type: entry.changeType,
    reason: entry.reason ?? null,
    changed_by: entry.changedBy ?? null,
    changed_by_person_id: entry.changedByPersonId ?? null
  });

  if (error) log("write log (non-fatal)", error);
}
