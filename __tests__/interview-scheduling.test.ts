/**
 * Direct production tests for lib/interview-scheduling.ts — booking the
 * candidates a selection run invited.
 *
 * Supabase, admin auth, scope and email are mocked; the real function bodies
 * run, so the guards, the slot arithmetic and the write shapes are checked
 * against the actual code rather than a description of it.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canReviewSeason: vi.fn(),
  getScopeFilter: vi.fn()
}));
vi.mock("@/lib/email", () => ({
  sendInterviewSchedule: vi.fn(),
  sendInterviewInvite: vi.fn()
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
import { sendInterviewInvite, sendInterviewSchedule } from "@/lib/email";
import { cancelInterviewSlot, scheduleInterviews } from "@/lib/interview-scheduling";
import { MAX_INTERVIEWS_PER_RUN } from "@/lib/interview-scheduling-core";

// ── Mock helpers ──────────────────────────────────────────────────────────────

type ChainResult = { data?: unknown; error?: unknown; count?: number };

function makeChain(result: ChainResult = {}, capture?: { payloads: unknown[] }) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "neq", "in", "is", "ilike", "order", "limit", "delete"]) {
    chain[method] = self;
  }
  const record = (payload: unknown) => {
    capture?.payloads.push(payload);
    return chain;
  };
  chain.insert = record;
  chain.update = record;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null, ...result });
  chain.then = (f: unknown, r: unknown) => (resolved as Promise<unknown>).then(f as never, r as never);
  chain.catch = (r: unknown) => (resolved as Promise<unknown>).catch(r as never);
  chain.finally = (f: unknown) => (resolved as Promise<unknown>).finally(f as never);
  return chain;
}

function makeClient(byTable: Record<string, unknown[]>) {
  const queues = new Map(Object.entries(byTable).map(([table, chains]) => [table, [...chains]]));
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const queue = queues.get(table);
    if (queue && queue.length) return queue.length > 1 ? queue.shift() : queue[0];
    return makeChain();
  });
  return { client: { from } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>, tables };
}

const ACTOR = "00000000-0000-4000-8000-000000000a01";
const INTERVIEWER = "00000000-0000-4000-8000-000000000a02";
const OTHER_INTERVIEWER = "00000000-0000-4000-8000-000000000a03";
const SEASON = "00000000-0000-4000-8000-000000000b01";
const APP_1 = "00000000-0000-4000-8000-000000000c01";
const APP_2 = "00000000-0000-4000-8000-000000000c02";
const REVIEW_1 = "00000000-0000-4000-8000-000000000d01";

/** Far enough ahead that the "not in the past" rule never bites in CI. */
function futureStart() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)}T14:30`;
}

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "invited_to_interview",
    season_id: SEASON,
    intake_batch_id: null,
    full_name: `Ứng viên ${id.slice(-2)}`,
    email_primary: `cand-${id.slice(-2)}@example.com`,
    role_applied: "mentee",
    submitted_at: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

const activeInterviewer = {
  id: INTERVIEWER,
  email: "mentor@example.com",
  full_name: "Mentor Test",
  role: "reviewer",
  status: "active"
};

function baseTables(options: {
  candidates?: unknown[];
  existingReviews?: unknown[];
  reviewWrite?: { payloads: unknown[] };
  appUpdate?: { payloads: unknown[] };
  interviewer?: unknown;
}) {
  return {
    admin_users: [
      // "interviewer: null" is a real case (no such account), so it must not be
      // collapsed into the default by ??.
      makeChain({ data: "interviewer" in options ? options.interviewer : activeInterviewer })
    ],
    applications: [
      makeChain({ data: options.candidates ?? [candidate(APP_1), candidate(APP_2)] }),
      makeChain({}, options.appUpdate)
    ],
    application_reviews: [
      makeChain({ data: options.existingReviews ?? [] }),
      makeChain({}, options.reviewWrite)
    ]
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: ACTOR,
    email: "ops@example.com",
    full_name: "Ops",
    role: "core_team",
    status: "active"
  });
  (getAdminScopeContext as Mock).mockResolvedValue({ isSuperAdmin: true });
  (canReviewSeason as Mock).mockResolvedValue(true);
  (sendInterviewSchedule as Mock).mockResolvedValue({ ok: true, skipped: false });
  (sendInterviewInvite as Mock).mockResolvedValue({ ok: true, skipped: false });
});

// ── Authorization and input ───────────────────────────────────────────────────

describe("scheduleInterviews — who may book, and with what", () => {
  it("refuses a reviewer: booking is an organiser's job", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ACTOR, email: "m@example.com", role: "reviewer" });
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("không có quyền");
    expect(tables).toHaveLength(0);
  });

  it("refuses a start time in the past before reading anything", async () => {
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1],
      interviewerAdminUserId: INTERVIEWER,
      startAt: "2020-01-01T09:00"
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("quá khứ");
    expect(tables).toHaveLength(0);
  });

  it("refuses an empty selection", async () => {
    const { client } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("ít nhất một ứng viên");
  });

  it("caps one run so a mis-click cannot book hundreds of slots", async () => {
    const { client } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const tooMany = Array.from(
      { length: MAX_INTERVIEWS_PER_RUN + 1 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );

    const result = await scheduleInterviews({
      applicationIds: tooMany,
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(String(MAX_INTERVIEWS_PER_RUN));
  });

  it("rejects an interviewer id that is not an active account with review rights", async () => {
    for (const bad of [
      null,
      { ...activeInterviewer, status: "suspended" },
      { ...activeInterviewer, role: "viewer" }
    ]) {
      const { client } = makeClient(baseTables({ interviewer: bad }));
      (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

      const result = await scheduleInterviews({
        applicationIds: [APP_1],
        interviewerAdminUserId: INTERVIEWER,
        startAt: futureStart()
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain("không hợp lệ");
    }
  });

  it("refuses when the operator has no review scope on the candidates' season", async () => {
    (canReviewSeason as Mock).mockResolvedValue(false);
    const { client } = makeClient(baseTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1, APP_2],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("đã mời phỏng vấn");
  });

  it("refuses a candidate who is not in an interview status", async () => {
    const { client } = makeClient(
      baseTables({ candidates: [candidate(APP_1, { status: "submitted" })] })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(false);
  });
});

// ── Writing the appointments ──────────────────────────────────────────────────

describe("scheduleInterviews — the appointments", () => {
  it("creates one interview row per candidate, in consecutive slots", async () => {
    const reviewWrite = { payloads: [] as unknown[] };
    const { client } = makeClient(baseTables({ reviewWrite }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1, APP_2],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart(),
      slotMinutes: "30",
      mode: "online",
      location: "https://meet.example.com/vam"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scheduled).toBe(2);

    const rows = reviewWrite.payloads[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.review_round).toBe("interview");
      expect(row.reviewer_admin_user_id).toBe(INTERVIEWER);
      expect(row.assigned_by).toBe(ACTOR);
      expect(row.status).toBe("assigned");
      expect(row.claim_source).toBe("bulk_assign");
      expect(row.interview_mode).toBe("online");
      expect(row.interview_location).toBe("https://meet.example.com/vam");
    }

    const first = new Date(String(rows[0].interview_scheduled_at)).getTime();
    const second = new Date(String(rows[1].interview_scheduled_at)).getTime();
    expect(second - first).toBe(30 * 60_000);
  });

  it("moves the applications that were only invited to interview_scheduled", async () => {
    const appUpdate = { payloads: [] as unknown[] };
    const { client } = makeClient(
      baseTables({
        appUpdate,
        candidates: [candidate(APP_1), candidate(APP_2, { status: "interview_in_progress" })]
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1, APP_2],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(true);
    expect(appUpdate.payloads[0]).toEqual({ status: "interview_scheduled" });
  });

  it("moves the time instead of creating a second row for the same interviewer", async () => {
    const reviewWrite = { payloads: [] as unknown[] };
    const { client } = makeClient(
      baseTables({
        candidates: [candidate(APP_1, { status: "interview_scheduled" })],
        existingReviews: [
          { id: REVIEW_1, application_id: APP_1, reviewer_admin_user_id: INTERVIEWER, status: "assigned" }
        ],
        reviewWrite
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rescheduled).toBe(1);
    expect(result.scheduled).toBe(0);

    const update = reviewWrite.payloads[0] as Record<string, unknown>;
    expect(update.interview_scheduled_at).toBeTruthy();
    // A reschedule must never look like a new assignment.
    expect(update.status).toBeUndefined();
    expect(update.reviewer_admin_user_id).toBeUndefined();
  });

  it("leaves a candidate booked with somebody else alone, and says so", async () => {
    const reviewWrite = { payloads: [] as unknown[] };
    const { client } = makeClient(
      baseTables({
        existingReviews: [
          {
            id: REVIEW_1,
            application_id: APP_1,
            reviewer_admin_user_id: OTHER_INTERVIEWER,
            status: "in_progress"
          }
        ],
        reviewWrite
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1, APP_2],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedOtherInterviewer).toBe(1);
    expect(result.scheduled).toBe(1);
    expect(result.message).toContain("đã có người phỏng vấn khác");

    const rows = reviewWrite.payloads[0] as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.application_id)).toEqual([APP_2]);
  });

  it("refuses outright when every candidate belongs to another interviewer", async () => {
    const { client } = makeClient(
      baseTables({
        candidates: [candidate(APP_1)],
        existingReviews: [
          { id: REVIEW_1, application_id: APP_1, reviewer_admin_user_id: OTHER_INTERVIEWER, status: "assigned" }
        ]
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart()
    });

    expect(result.ok).toBe(false);
  });
});

// ── Telling people ────────────────────────────────────────────────────────────

describe("scheduleInterviews — notifications", () => {
  it("sends the interviewer one list and each candidate their own time", async () => {
    const { client } = makeClient(baseTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1, APP_2],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart(),
      notifyInterviewer: true,
      notifyCandidates: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sendInterviewSchedule).toHaveBeenCalledTimes(1);
    expect(sendInterviewSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "mentor@example.com", interviewCount: 2 })
    );
    expect(sendInterviewInvite).toHaveBeenCalledTimes(2);
    expect(result.notifiedCandidates).toBe(2);
    expect(result.interviewerNotified).toBe(true);
  });

  it("does not mail the candidates unless asked to", async () => {
    const { client } = makeClient(baseTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    await scheduleInterviews({
      applicationIds: [APP_1, APP_2],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart(),
      notifyCandidates: false
    });

    expect(sendInterviewInvite).not.toHaveBeenCalled();
  });

  it("keeps the booking when an email fails", async () => {
    (sendInterviewInvite as Mock).mockRejectedValue(new Error("provider down"));
    const reviewWrite = { payloads: [] as unknown[] };
    const { client } = makeClient(baseTables({ reviewWrite }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await scheduleInterviews({
      applicationIds: [APP_1, APP_2],
      interviewerAdminUserId: INTERVIEWER,
      startAt: futureStart(),
      notifyCandidates: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notifyFailures).toBe(2);
    expect((reviewWrite.payloads[0] as unknown[]).length).toBe(2);
  });
});

// ── Releasing a slot ──────────────────────────────────────────────────────────

describe("cancelInterviewSlot", () => {
  it("refuses a role that cannot assign reviews", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ACTOR, email: "m@example.com", role: "reviewer" });
    const { client } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await cancelInterviewSlot({ reviewId: REVIEW_1 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
  });

  it("will not cancel an interview whose score is already in", async () => {
    const { client } = makeClient({
      application_reviews: [
        makeChain({
          data: { id: REVIEW_1, application_id: APP_1, review_round: "interview", status: "submitted" }
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await cancelInterviewSlot({ reviewId: REVIEW_1 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã nộp điểm");
  });

  it("cancels the review and puts the candidate back in the invited pool", async () => {
    const reviewUpdate = { payloads: [] as unknown[] };
    const appUpdate = { payloads: [] as unknown[] };
    const { client } = makeClient({
      application_reviews: [
        makeChain({
          data: { id: REVIEW_1, application_id: APP_1, review_round: "interview", status: "assigned" }
        }),
        makeChain({}, reviewUpdate)
      ],
      applications: [
        makeChain({ data: { id: APP_1, season_id: SEASON, status: "interview_scheduled" } }),
        makeChain({}, appUpdate)
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await cancelInterviewSlot({ reviewId: REVIEW_1 });

    expect(result.ok).toBe(true);
    expect(reviewUpdate.payloads[0]).toEqual({ status: "cancelled" });
    expect(appUpdate.payloads[0]).toEqual({ status: "invited_to_interview" });
  });

  it("refuses when the operator has no scope on the season", async () => {
    (canReviewSeason as Mock).mockResolvedValue(false);
    const { client } = makeClient({
      application_reviews: [
        makeChain({
          data: { id: REVIEW_1, application_id: APP_1, review_round: "interview", status: "assigned" }
        })
      ],
      applications: [makeChain({ data: { id: APP_1, season_id: SEASON, status: "interview_scheduled" } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await cancelInterviewSlot({ reviewId: REVIEW_1 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
  });
});
