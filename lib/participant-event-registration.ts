import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentParticipant } from "@/lib/participant-auth";

/**
 * lib/participant-event-registration.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Signing up from inside the portal.
 *
 * This exists to close the largest hole in the attendance numbers. The public
 * form matches a registration to a person by the email somebody typed; type it
 * with a different address than the one on file — a work address, a typo, a
 * second Gmail — and the row is `unlinked` forever. It counts in the event's
 * headcount and in nobody's personal record, so a mentee can attend four
 * sessions and appear to have attended none.
 *
 * A signed-in participant has no such ambiguity. The session already knows who
 * they are, so `linked_person_id` is written from it and never from a typed
 * field. That one line is why the percentages the owner asked for can be
 * trusted.
 */

const SAFE_ERROR = "Không đăng ký được lúc này. Vui lòng thử lại.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[participant-event-registration]", scope, {
    message: err?.message ?? String(error)
  });
}

export type MutationResult = { ok: boolean; message: string };

export type OpenSession = {
  eventId: string;
  eventName: string;
  startsAt: string | null;
  description: string | null;
  registered: boolean;
};

/**
 * The cross-mentoring sessions this person can still sign up for.
 *
 * Only sessions whose registration is open — a request that has been scheduled
 * but not published is not yet something to announce.
 */
export async function listOpenCrossSessions(input: {
  personId: string;
  seasonId: string;
}): Promise<OpenSession[]> {
  if (!isValidUuid(input.personId) || !isValidUuid(input.seasonId)) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const { data: requests, error } = await client
    .from("cross_requests")
    .select("event_id")
    .eq("season_id", input.seasonId)
    .eq("status", "published")
    .not("event_id", "is", null);

  if (error) {
    log("read published requests", error);
    return [];
  }

  const eventIds = Array.from(
    new Set(
      ((requests ?? []) as Array<{ event_id: string | null }>)
        .map((row) => row.event_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (!eventIds.length) return [];

  const [{ data: events }, { data: mine }] = await Promise.all([
    client
      .from("events")
      .select("id,event_name,starts_at,event_description")
      .in("id", eventIds)
      .order("starts_at", { ascending: true }),
    client
      .from("event_registrations")
      .select("event_id,registration_status")
      .eq("linked_person_id", input.personId)
      .in("event_id", eventIds)
  ]);

  const registered = new Set(
    ((mine ?? []) as Array<{ event_id: string; registration_status: string }>)
      .filter((row) => row.registration_status !== "cancelled")
      .map((row) => row.event_id)
  );

  return ((events ?? []) as Array<{
    id: string;
    event_name: string | null;
    starts_at: string | null;
    event_description: string | null;
  }>).map((event) => ({
    eventId: event.id,
    eventName: event.event_name ?? "Buổi cross-mentoring",
    startsAt: event.starts_at,
    description: event.event_description,
    registered: registered.has(event.id)
  }));
}

/**
 * Register the signed-in participant for one session.
 *
 * The identity comes from the session; nothing identifying is read from the
 * form. A second click is answered as success rather than as an error — the
 * person wanted to be registered, and they are.
 */
export async function registerForSession(input: {
  eventId?: unknown;
}): Promise<MutationResult> {
  const participant = await getCurrentParticipant();
  if (participant.state !== "participant") {
    return { ok: false, message: "Bạn cần đăng nhập để đăng ký." };
  }

  const eventId = String(input.eventId ?? "").trim();
  if (!isValidUuid(eventId)) return { ok: false, message: "Không xác định được buổi gặp." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: event, error: eventErr } = await client
    .from("events")
    .select("id,event_type,event_name")
    .eq("id", eventId)
    .maybeSingle();

  if (eventErr || !event) return { ok: false, message: "Không tìm thấy buổi gặp." };

  // The portal registers for cross sessions and nothing else. Other event types
  // have their own flows with their own rules about capacity, fees and proof.
  if ((event as { event_type?: string }).event_type !== "cross_mentoring") {
    return { ok: false, message: "Buổi này đăng ký ở nơi khác." };
  }

  const { data: existing } = await client
    .from("event_registrations")
    .select("id,registration_status")
    .eq("event_id", eventId)
    .eq("linked_person_id", participant.account.personId)
    .maybeSingle();

  const existingRow = existing as { id: string; registration_status: string } | null;

  if (existingRow) {
    if (existingRow.registration_status !== "cancelled") {
      return { ok: true, message: "Bạn đã đăng ký buổi này rồi." };
    }

    const { error: reviveErr } = await client
      .from("event_registrations")
      .update({ registration_status: "registered", attendance_status: "pending" })
      .eq("id", existingRow.id);

    if (reviveErr) {
      log("revive cancelled registration", reviveErr);
      return { ok: false, message: SAFE_ERROR };
    }
    return { ok: true, message: "Đã đăng ký lại. Hẹn gặp bạn." };
  }

  const { error: insertErr } = await client.from("event_registrations").insert({
    event_id: eventId,
    // From the session, never from a typed field. This is the whole point.
    linked_person_id: participant.account.personId,
    full_name: participant.account.fullName ?? "",
    email: participant.account.email ?? "",
    consent_given: true,
    registration_source: "admin_input",
    registration_status: "registered",
    attendance_status: "pending",
    is_walk_in: false,
    // The account was bound to this person by their email when it was created,
    // so the link really is an exact-email one — established earlier, and by us
    // rather than by whatever the visitor typed today.
    match_method: "exact_email",
    match_review_status: "auto_linked",
    matched_at: new Date().toISOString()
  });

  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") {
      return { ok: true, message: "Bạn đã đăng ký buổi này rồi." };
    }
    log("create portal registration", insertErr);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: "Đã đăng ký. Nhớ check-in tại buổi gặp nhé." };
}
