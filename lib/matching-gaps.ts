import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageMatches } from "@/lib/permissions";
import { canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { resolveMentorCap } from "@/lib/mentor-confirmations-core";

/**
 * lib/matching-gaps.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What is left over after the mentors have chosen for themselves.
 *
 * Three lists, all for one season, all read-only:
 *   * mentees who finished the interview and still have no mentor;
 *   * mentors who confirmed a place and still have room;
 *   * mentors who tried to take a mentee and were refused for being full —
 *     the queue of "please give me one more place" requests, which otherwise
 *     only exists in whatever channel the mentor used to complain.
 *
 * This is the hand-over point to the matching that the organisers do (and, in
 * the next phase, to the assisted matching): everything here is the input to
 * "who is still unpaired".
 */

const SAFE_ERROR = "Không thể tải dữ liệu ghép cặp. Vui lòng thử lại hoặc liên hệ admin.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A mentee is "waiting" once their interview is over, not before. */
const WAITING_STATUSES = ["interview_completed", "approved_as_mentee"];

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[matching-gaps]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type UnmatchedMentee = {
  application_id: string;
  person_id: string | null;
  full_name: string | null;
  email_primary: string | null;
  status: string | null;
  submitted_at: string | null;
  interview_review_status: string | null;
  interview_score: number | null;
};

export type MentorWithFreeSlots = {
  confirmation_id: string;
  person_id: string;
  full_name: string | null;
  email_primary: string | null;
  cap: number;
  active_count: number;
  free_slots: number;
  extra_slots: number;
  agree_to_interview: boolean | null;
};

export type BlockedSelectionRow = {
  id: string;
  created_at: string;
  outcome: string;
  mentor_person_id: string | null;
  mentor_name: string | null;
  mentor_email: string | null;
  application_id: string;
  candidate_name: string | null;
  cap_at_decision: number | null;
  active_count_at_decision: number | null;
  /** Present when the mentor still has a confirmation row to grant against. */
  confirmation_id: string | null;
  extra_slots: number | null;
};

export type MatchingGapsResult = {
  ok: boolean;
  error: string | null;
  mentees: UnmatchedMentee[];
  mentors: MentorWithFreeSlots[];
  blocked: BlockedSelectionRow[];
  totals: {
    menteesWaiting: number;
    freeSlots: number;
    capacityTotal: number;
    activeMatches: number;
  };
};

function emptyResult(error: string | null): MatchingGapsResult {
  return {
    ok: !error,
    error,
    mentees: [],
    mentors: [],
    blocked: [],
    totals: { menteesWaiting: 0, freeSlots: 0, capacityTotal: 0, activeMatches: 0 }
  };
}

export async function getMatchingGaps(input: {
  seasonId: string;
  intakeBatchId?: string | null;
  blockedLimit?: number;
}): Promise<MatchingGapsResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return emptyResult("Bạn chưa đăng nhập.");
  if (!canManageMatches(actor.role)) {
    return emptyResult("Bạn không có quyền xem danh sách ghép cặp.");
  }
  if (!isValidUuid(input.seasonId)) return emptyResult("Mùa không hợp lệ.");

  const scopeContext = await getAdminScopeContext();
  if (!(await canReadSeason(scopeContext, input.seasonId))) {
    return emptyResult("Bạn không có quyền xem dữ liệu của mùa này.");
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return emptyResult(SAFE_ERROR);

  // ── Active matches decide both "who is taken" and "who still has room"
  const { data: matchRows, error: matchErr } = await client
    .from("matches")
    .select("id,mentor_person_id,mentee_person_id")
    .eq("season_id", input.seasonId)
    .eq("status", "active");

  if (matchErr) {
    log("load active matches", matchErr);
    return emptyResult(SAFE_ERROR);
  }

  const matches = (matchRows ?? []) as Array<{
    id: string;
    mentor_person_id: string | null;
    mentee_person_id: string | null;
  }>;
  const matchedMenteeIds = new Set(
    matches.map((row) => row.mentee_person_id).filter((id): id is string => Boolean(id))
  );
  const activeByMentor = new Map<string, number>();
  for (const row of matches) {
    if (!row.mentor_person_id) continue;
    activeByMentor.set(row.mentor_person_id, (activeByMentor.get(row.mentor_person_id) ?? 0) + 1);
  }

  // ── Mentees who are through the interview and still unpaired
  let menteeQuery = client
    .from("applications")
    .select("id,person_id,full_name,email_primary,status,submitted_at")
    .eq("season_id", input.seasonId)
    .eq("role_applied", "mentee")
    .in("status", WAITING_STATUSES)
    .order("submitted_at", { ascending: true });

  if (input.intakeBatchId && isValidUuid(input.intakeBatchId)) {
    menteeQuery = menteeQuery.eq("intake_batch_id", input.intakeBatchId);
  }

  const { data: menteeRows, error: menteeErr } = await menteeQuery;
  if (menteeErr) {
    log("load waiting mentees", menteeErr);
    return emptyResult(SAFE_ERROR);
  }

  const waiting = ((menteeRows ?? []) as Array<{
    id: string;
    person_id: string | null;
    full_name: string | null;
    email_primary: string | null;
    status: string | null;
    submitted_at: string | null;
  }>).filter((row) => !row.person_id || !matchedMenteeIds.has(row.person_id));

  // The interview score explains the order the organisers should work in.
  const interviewByApp = new Map<string, { status: string; score: number | null }>();
  if (waiting.length) {
    const { data: reviewRows } = await client
      .from("application_reviews")
      .select("application_id,status,total_score")
      .eq("review_round", "interview")
      .neq("status", "cancelled")
      .in(
        "application_id",
        waiting.map((row) => row.id)
      )
      .order("submitted_at", { ascending: false });

    for (const row of (reviewRows ?? []) as Array<{
      application_id: string;
      status: string | null;
      total_score: number | null;
    }>) {
      if (interviewByApp.has(row.application_id)) continue;
      interviewByApp.set(row.application_id, {
        status: String(row.status ?? ""),
        score: row.total_score
      });
    }
  }

  const mentees: UnmatchedMentee[] = waiting.map((row) => {
    const interview = interviewByApp.get(row.id);
    return {
      application_id: row.id,
      person_id: row.person_id,
      full_name: row.full_name,
      email_primary: row.email_primary,
      status: row.status,
      submitted_at: row.submitted_at,
      interview_review_status: interview?.status ?? null,
      interview_score: interview?.score ?? null
    };
  });

  // ── Mentors who confirmed a place and still have room
  const { data: confirmationRows, error: confirmationErr } = await client
    .from("mentor_season_confirmations")
    .select("id,person_id,status,max_mentees,extra_slots,agree_to_interview")
    .eq("season_id", input.seasonId)
    .eq("status", "confirmed");

  if (confirmationErr) {
    log("load confirmations", confirmationErr);
    return emptyResult(SAFE_ERROR);
  }

  const confirmations = (confirmationRows ?? []) as Array<{
    id: string;
    person_id: string;
    status: string;
    max_mentees: number | null;
    extra_slots: number | null;
    agree_to_interview: boolean | null;
  }>;

  const personIds = Array.from(new Set(confirmations.map((row) => row.person_id)));
  const peopleById = new Map<string, { full_name: string | null; email_primary: string | null }>();
  if (personIds.length) {
    const { data: peopleRows } = await client
      .from("people")
      .select("id,full_name,email_primary")
      .in("id", personIds);
    for (const row of (peopleRows ?? []) as Array<{
      id: string;
      full_name: string | null;
      email_primary: string | null;
    }>) {
      peopleById.set(row.id, { full_name: row.full_name, email_primary: row.email_primary });
    }
  }

  let capacityTotal = 0;
  const mentors: MentorWithFreeSlots[] = [];
  for (const row of confirmations) {
    const cap = resolveMentorCap(row);
    capacityTotal += cap;
    const activeCount = activeByMentor.get(row.person_id) ?? 0;
    const free = cap - activeCount;
    if (free <= 0) continue;
    const person = peopleById.get(row.person_id);
    mentors.push({
      confirmation_id: row.id,
      person_id: row.person_id,
      full_name: person?.full_name ?? null,
      email_primary: person?.email_primary ?? null,
      cap,
      active_count: activeCount,
      free_slots: free,
      extra_slots: row.extra_slots ?? 0,
      agree_to_interview: row.agree_to_interview
    });
  }
  mentors.sort((a, b) => {
    if (b.free_slots !== a.free_slots) return b.free_slots - a.free_slots;
    return (a.full_name ?? "").localeCompare(b.full_name ?? "", "vi");
  });

  // ── Mentors who asked for one more place by being refused
  const confirmationByPerson = new Map(
    confirmations.map((row) => [row.person_id, { id: row.id, extra_slots: row.extra_slots ?? 0 }])
  );
  const blocked = await loadBlockedSelections(client, {
    seasonId: input.seasonId,
    limit: input.blockedLimit ?? 25,
    peopleById,
    confirmationByPerson
  });

  return {
    ok: true,
    error: null,
    mentees,
    mentors,
    blocked,
    totals: {
      menteesWaiting: mentees.length,
      freeSlots: mentors.reduce((sum, row) => sum + row.free_slots, 0),
      capacityTotal,
      activeMatches: matches.length
    }
  };
}

async function loadBlockedSelections(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  input: {
    seasonId: string;
    limit: number;
    peopleById: Map<string, { full_name: string | null; email_primary: string | null }>;
    confirmationByPerson: Map<string, { id: string; extra_slots: number }>;
  }
): Promise<BlockedSelectionRow[]> {
  const { data, error } = await client
    .from("mentor_mentee_selections")
    .select(
      "id,created_at,outcome,mentor_person_id,application_id,cap_at_decision,active_count_at_decision"
    )
    .eq("season_id", input.seasonId)
    .eq("outcome", "blocked_cap")
    .order("created_at", { ascending: false })
    .limit(input.limit);

  if (error) {
    // The table only exists from migration 067; an environment without it must
    // still render the rest of the page.
    log("load blocked selections (non-fatal)", error);
    return [];
  }

  const rows = (data ?? []) as Array<{
    id: string;
    created_at: string;
    outcome: string;
    mentor_person_id: string | null;
    application_id: string;
    cap_at_decision: number | null;
    active_count_at_decision: number | null;
  }>;
  if (!rows.length) return [];

  const missingPersonIds = Array.from(
    new Set(
      rows
        .map((row) => row.mentor_person_id)
        .filter((id): id is string => Boolean(id) && !input.peopleById.has(id as string))
    )
  );
  if (missingPersonIds.length) {
    const { data: peopleRows } = await client
      .from("people")
      .select("id,full_name,email_primary")
      .in("id", missingPersonIds);
    for (const person of (peopleRows ?? []) as Array<{
      id: string;
      full_name: string | null;
      email_primary: string | null;
    }>) {
      input.peopleById.set(person.id, {
        full_name: person.full_name,
        email_primary: person.email_primary
      });
    }
  }

  const applicationIds = Array.from(new Set(rows.map((row) => row.application_id)));
  const candidateNameById = new Map<string, string | null>();
  if (applicationIds.length) {
    const { data: appRows } = await client
      .from("applications")
      .select("id,full_name")
      .in("id", applicationIds);
    for (const row of (appRows ?? []) as Array<{ id: string; full_name: string | null }>) {
      candidateNameById.set(row.id, row.full_name);
    }
  }

  return rows.map((row) => {
    const person = row.mentor_person_id ? input.peopleById.get(row.mentor_person_id) : undefined;
    const confirmation = row.mentor_person_id
      ? input.confirmationByPerson.get(row.mentor_person_id)
      : undefined;
    return {
      id: row.id,
      created_at: row.created_at,
      outcome: row.outcome,
      mentor_person_id: row.mentor_person_id,
      mentor_name: person?.full_name ?? null,
      mentor_email: person?.email_primary ?? null,
      application_id: row.application_id,
      candidate_name: candidateNameById.get(row.application_id) ?? null,
      cap_at_decision: row.cap_at_decision,
      active_count_at_decision: row.active_count_at_decision,
      confirmation_id: confirmation?.id ?? null,
      extra_slots: confirmation?.extra_slots ?? null
    };
  });
}
