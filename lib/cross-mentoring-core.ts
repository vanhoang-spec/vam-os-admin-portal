/**
 * lib/cross-mentoring-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * How a cross-mentoring request moves, and who may move it.
 *
 * A request travels through nine states and touches four different kinds of
 * people — the mentee who asked, the mentors who were invited, the coordinators
 * who choose, and the organisers who publish. That is exactly the shape of
 * thing that becomes a scatter of `if` statements across a dozen files unless
 * the rules live in one pure, tested place.
 *
 * Two rules carry the weight:
 *
 * THERE IS NO WAY BACK FROM `scheduled`. Once a session is scheduled an event
 * exists and mentees can already be registering for it. Reopening the request
 * would leave that event orphaned and those registrations pointing at
 * something that is no longer happening. The only exit is `cancelled`, which
 * cancels the event too.
 *
 * A MENTOR PASSED OVER TWICE STOPS BEING ASKED. Not blocked, not hidden — just
 * left out of the automatic sweep for the rest of the season, so somebody who
 * keeps volunteering and keeps not being picked is not asked a third time.
 * An organiser can still invite them by hand.
 */

// ── The states ───────────────────────────────────────────────────────────────

export const REQUEST_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "inviting",
  "selecting",
  "scheduled",
  "published",
  "completed",
  "cancelled"
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Nothing moves out of these. */
export const TERMINAL_STATUSES: RequestStatus[] = ["rejected", "completed", "cancelled"];

/**
 * From here on an event exists and mentees may have registered against it.
 * Anything that would un-schedule the session has to cancel it instead.
 */
export const COMMITTED_STATUSES: RequestStatus[] = ["scheduled", "published", "completed"];

export type ActorRole =
  /** The mentee whose request it is. */
  | "owner"
  /** support_team and above — reviews, invites, chooses. */
  | "reviewer"
  /** core_team and above — schedules, creates the event, publishes. */
  | "publisher"
  /** No person: a mentor's reply moved it. */
  | "system";

type Transition = { to: RequestStatus; by: ActorRole[] };

/**
 * Every move that exists. Anything not listed here cannot happen, which is what
 * makes "no way back from scheduled" a property of the table rather than of a
 * check somebody has to remember to write.
 */
const TRANSITIONS: Record<RequestStatus, Transition[]> = {
  draft: [
    { to: "submitted", by: ["owner"] },
    { to: "cancelled", by: ["owner", "reviewer", "publisher"] }
  ],
  submitted: [
    { to: "approved", by: ["reviewer", "publisher"] },
    { to: "rejected", by: ["reviewer", "publisher"] },
    // A mentee may withdraw a request nobody has acted on yet.
    { to: "cancelled", by: ["owner", "reviewer", "publisher"] }
  ],
  approved: [
    { to: "inviting", by: ["reviewer", "publisher", "system"] },
    { to: "cancelled", by: ["reviewer", "publisher"] }
  ],
  inviting: [
    // The first mentor to accept moves it; no organiser has to notice.
    { to: "selecting", by: ["system", "reviewer", "publisher"] },
    { to: "cancelled", by: ["reviewer", "publisher"] }
  ],
  selecting: [
    { to: "scheduled", by: ["publisher"] },
    // Nobody accepted, or nobody suitable — the request goes back out.
    { to: "inviting", by: ["reviewer", "publisher"] },
    { to: "cancelled", by: ["reviewer", "publisher"] }
  ],
  scheduled: [
    { to: "published", by: ["publisher"] },
    { to: "cancelled", by: ["publisher"] }
  ],
  published: [
    { to: "completed", by: ["publisher"] },
    { to: "cancelled", by: ["publisher"] }
  ],
  completed: [],
  rejected: [],
  cancelled: []
};

export type TransitionCheck = { ok: true } | { ok: false; message: string };

/**
 * May this actor make this move?
 *
 * Refusals name the reason, because the three ways a move can be wrong need
 * different answers on screen: the request is finished, the move does not
 * exist, or this person is not the one who makes it.
 */
export function canTransition(
  from: unknown,
  to: unknown,
  actor: ActorRole
): TransitionCheck {
  const current = String(from ?? "") as RequestStatus;
  const next = String(to ?? "") as RequestStatus;

  if (!(REQUEST_STATUSES as readonly string[]).includes(current)) {
    return { ok: false, message: "Trạng thái hiện tại không hợp lệ." };
  }
  if (!(REQUEST_STATUSES as readonly string[]).includes(next)) {
    return { ok: false, message: "Trạng thái muốn chuyển sang không hợp lệ." };
  }
  if (current === next) {
    return { ok: false, message: "Không có gì thay đổi." };
  }

  if (TERMINAL_STATUSES.includes(current)) {
    return { ok: false, message: "Đề xuất này đã kết thúc, không đổi được nữa." };
  }

  const allowed = TRANSITIONS[current] ?? [];
  const move = allowed.find((row) => row.to === next);

  if (!move) {
    // The single most likely wrong move, and worth its own sentence.
    if (COMMITTED_STATUSES.includes(current) && !COMMITTED_STATUSES.includes(next)) {
      return {
        ok: false,
        message: "Buổi gặp đã được xếp lịch và mentee có thể đã đăng ký. Muốn dừng thì huỷ, không quay lui được."
      };
    }
    return { ok: false, message: "Không chuyển thẳng từ bước này sang bước đó được." };
  }

  if (!move.by.includes(actor)) {
    return { ok: false, message: "Bạn không có quyền thực hiện bước này." };
  }

  return { ok: true };
}

/** The moves an actor could make right now — what the screen should offer. */
export function availableTransitions(from: unknown, actor: ActorRole): RequestStatus[] {
  const current = String(from ?? "") as RequestStatus;
  if (!(REQUEST_STATUSES as readonly string[]).includes(current)) return [];
  return (TRANSITIONS[current] ?? [])
    .filter((row) => row.by.includes(actor))
    .map((row) => row.to);
}

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Nháp",
  submitted: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  inviting: "Đang mời mentor",
  selecting: "Đang chọn mentor",
  scheduled: "Đã xếp lịch",
  published: "Đã mở đăng ký",
  completed: "Đã diễn ra",
  cancelled: "Đã huỷ"
};

export function requestStatusLabel(status: unknown): string {
  const value = String(status ?? "");
  return REQUEST_STATUS_LABELS[value as RequestStatus] ?? value;
}

// ── Invitations ──────────────────────────────────────────────────────────────

export const INVITATION_STATUSES = [
  "invited",
  "accepted",
  "declined",
  "selected",
  "not_selected",
  "withdrawn"
] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  invited: "Đã gửi thư mời",
  accepted: "Đã nhận lời",
  declined: "Đã từ chối",
  selected: "Được chọn",
  not_selected: "Chưa xếp được lịch",
  withdrawn: "Đã rút lời"
};

export function invitationStatusLabel(status: unknown): string {
  const value = String(status ?? "");
  return INVITATION_STATUS_LABELS[value as InvitationStatus] ?? value;
}

/** A mentor may only be chosen from among those who said yes. */
export function canSelectInvitation(status: unknown): boolean {
  return String(status ?? "") === "accepted";
}

/** What a mentor may still do with their own invitation. */
export function canMentorRespond(status: unknown): boolean {
  return ["invited", "accepted", "declined"].includes(String(status ?? ""));
}

export type InvitationSummary = {
  invited: number;
  accepted: number;
  declined: number;
  selected: number;
  notSelected: number;
  /** True once at least one mentor has said yes. */
  hasAcceptance: boolean;
  /** True once somebody has been chosen. */
  hasSelection: boolean;
};

export function summarizeInvitations(
  rows: Array<{ status?: unknown }>
): InvitationSummary {
  const count = (status: InvitationStatus) =>
    (rows ?? []).filter((row) => String(row?.status ?? "") === status).length;

  const accepted = count("accepted");
  const selected = count("selected");

  return {
    invited: count("invited"),
    accepted,
    declined: count("declined"),
    selected,
    notSelected: count("not_selected"),
    hasAcceptance: accepted > 0 || selected > 0,
    hasSelection: selected > 0
  };
}

/**
 * Where the request should sit given who has replied.
 *
 * Returns null when nothing should move — the caller then leaves the row alone
 * rather than writing the same status back and filling the log with noise.
 */
export function nextStatusAfterResponse(
  current: unknown,
  summary: InvitationSummary
): RequestStatus | null {
  const status = String(current ?? "") as RequestStatus;
  if (status === "inviting" && summary.hasAcceptance) return "selecting";
  return null;
}

// ── Being passed over ────────────────────────────────────────────────────────

/**
 * How many times a mentor may volunteer and not be chosen before the automatic
 * sweep stops asking them.
 *
 * Two, and the count resets with the season. The owner's words: a mentor turned
 * down twice should not be asked a third time.
 */
export const MAX_TIMES_PASSED_OVER = 2;

/**
 * Should this mentor be left out of the next automatic invitation sweep?
 *
 * Counts only `not_selected` — a mentor who declined of their own accord is
 * saying "not this one", not "stop asking me", and is invited again next time.
 * An organiser can still add anybody by hand; this only shapes the sweep.
 */
export function shouldExcludeFromSweep(timesPassedOver: unknown): boolean {
  const count = Number(timesPassedOver);
  if (!Number.isFinite(count) || count < 0) return false;
  return count >= MAX_TIMES_PASSED_OVER;
}

/**
 * Split a pool of candidate mentors into who gets written to and who is rested.
 *
 * Returns both halves rather than just the invitees, so the screen can say
 * "3 mentors rested because they were passed over twice this season" instead of
 * silently mailing fewer people than the organiser expected.
 */
export function partitionSweepCandidates<T extends { personId: string }>(
  candidates: T[],
  timesPassedOverByPerson: Map<string, number>
): { invite: T[]; rested: T[] } {
  const invite: T[] = [];
  const rested: T[] = [];

  for (const candidate of candidates ?? []) {
    const count = timesPassedOverByPerson.get(candidate.personId) ?? 0;
    if (shouldExcludeFromSweep(count)) rested.push(candidate);
    else invite.push(candidate);
  }

  return { invite, rested };
}
