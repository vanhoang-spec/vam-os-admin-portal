import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canTriageCrossRequest } from "@/lib/permissions";
import {
  summarizeAttendance,
  type AttendanceRow,
  type AttendanceSummary
} from "@/lib/cross-attendance-core";

/**
 * lib/cross-attendance.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reading the attendance sheets the events machinery already keeps.
 *
 * Both vitals come from ONE table. `event_registrations` holds the sign-up and
 * the check-in on the same row, so registered-versus-attended needs no join and
 * cannot drift — which is the reason `event_participations`, the other
 * attendance table in this schema, is not used for the rate.
 *
 * All the counting rules live in `cross-attendance-core`; this module only
 * fetches rows and hands them over.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[cross-attendance]", scope, { message: err?.message ?? String(error) });
}

const EMPTY: AttendanceSummary = { people: [], unlinkedRegistrations: 0, unlinkedAttended: 0 };

const SELECT = "linked_person_id,registration_status,attendance_status,is_walk_in,event_id";

function toRows(data: unknown): AttendanceRow[] {
  return ((data ?? []) as Array<{
    linked_person_id: string | null;
    registration_status: string | null;
    attendance_status: string | null;
    is_walk_in: boolean | null;
    event_id: string | null;
  }>).map((row) => ({
    linkedPersonId: row.linked_person_id,
    registrationStatus: row.registration_status,
    attendanceStatus: row.attendance_status,
    isWalkIn: row.is_walk_in,
    eventId: row.event_id
  }));
}

/** The cross-mentoring events of one season. */
async function readCrossEventIds(client: ServiceClient, seasonId: string): Promise<string[]> {
  const { data, error } = await client
    .from("events")
    .select("id")
    .eq("season_id", seasonId)
    .eq("event_type", "cross_mentoring");

  if (error) {
    log("read cross events", error);
    return [];
  }
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

/**
 * Registered versus attended across every cross session in a season.
 *
 * Returns the unlinked count alongside the people, so the screen can say how
 * much of the sheet the percentage actually covers.
 */
export async function getCrossAttendanceForSeason(seasonId: string): Promise<AttendanceSummary> {
  const admin = await getCurrentAdminUser();
  if (!canTriageCrossRequest(admin?.role)) return EMPTY;
  if (!isValidUuid(seasonId)) return EMPTY;

  const client = getSupabaseServiceRoleClient();
  if (!client) return EMPTY;

  const eventIds = await readCrossEventIds(client, seasonId);
  if (!eventIds.length) return EMPTY;

  const { data, error } = await client
    .from("event_registrations")
    .select(SELECT)
    .in("event_id", eventIds);

  if (error) {
    log("read registrations for season", error);
    return EMPTY;
  }

  return summarizeAttendance(toRows(data));
}

/** One session's sheet. */
export async function getCrossAttendanceForEvent(eventId: string): Promise<AttendanceSummary> {
  const admin = await getCurrentAdminUser();
  if (!canTriageCrossRequest(admin?.role)) return EMPTY;
  if (!isValidUuid(eventId)) return EMPTY;

  const client = getSupabaseServiceRoleClient();
  if (!client) return EMPTY;

  const { data, error } = await client
    .from("event_registrations")
    .select(SELECT)
    .eq("event_id", eventId);

  if (error) {
    log("read registrations for event", error);
    return EMPTY;
  }

  return summarizeAttendance(toRows(data));
}

/**
 * One person's cross-mentoring record for a season.
 *
 * Used both by the operations profile page and, later, by the participant's own
 * portal — hence taking the person id rather than reading the session: the
 * caller decides whose record it is entitled to ask for.
 */
export async function getCrossAttendanceForPerson(input: {
  personId: string;
  seasonId: string;
}): Promise<AttendanceSummary> {
  if (!isValidUuid(input.personId) || !isValidUuid(input.seasonId)) return EMPTY;

  const client = getSupabaseServiceRoleClient();
  if (!client) return EMPTY;

  const eventIds = await readCrossEventIds(client, input.seasonId);
  if (!eventIds.length) return EMPTY;

  const { data, error } = await client
    .from("event_registrations")
    .select(SELECT)
    .eq("linked_person_id", input.personId)
    .in("event_id", eventIds);

  if (error) {
    log("read registrations for person", error);
    return EMPTY;
  }

  return summarizeAttendance(toRows(data));
}
