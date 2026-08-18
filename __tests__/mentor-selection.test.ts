/**
 * Direct production tests for lib/mentor-selection.ts — the one write path
 * where somebody who is not an organiser creates a match.
 *
 * Supabase, admin auth and the approval helper are mocked; the real function
 * bodies run, so the guards, the capacity arithmetic and the append-only log
 * are checked against the actual code rather than a description of it.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/application-approvals", () => ({ approveApplication: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { approveApplication } from "@/lib/application-approvals";
import { getMentorSelectionContext, selectMenteeAfterInterview } from "@/lib/mentor-selection";

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

/**
 * Chains are queued per table, so a test says what each table answers rather
 * than counting `from()` calls in order.
 */
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

const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const APP = "00000000-0000-4000-8000-0000000000b1";
const SEASON = "00000000-0000-4000-8000-0000000000c1";
const BATCH = "00000000-0000-4000-8000-0000000000d1";
const MENTOR_PERSON = "00000000-0000-4000-8000-0000000000e1";
const MENTEE_PERSON = "00000000-0000-4000-8000-0000000000f1";
const MENTOR_PROFILE = "00000000-0000-4000-8000-000000000101";
const MENTEE_PROFILE = "00000000-0000-4000-8000-000000000102";

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: APP,
    status: "interview_completed",
    season_id: SEASON,
    intake_batch_id: BATCH,
    full_name: "Nguyễn Văn A",
    email_primary: "mentee@example.com",
    phone_primary: "0900000000",
    gender: "male",
    role_applied: "mentee",
    person_id: null,
    ...overrides
  };
}

/** Everything in place: interviewed, identified, confirmed, one place free. */
function happyTables(options: {
  selectionLog: { payloads: unknown[] };
  matchInsert?: { payloads: unknown[] };
  auditLog?: { payloads: unknown[] };
  activeCount?: number;
  cap?: { max_mentees: number; extra_slots: number };
  app?: Record<string, unknown>;
}) {
  return {
    applications: [makeChain({ data: application(options.app) })],
    application_reviews: [makeChain({ data: { id: "review-1", status: "submitted" } })],
    admin_users: [makeChain({ data: { email: "mentor@example.com", linked_person_id: MENTOR_PERSON } })],
    mentor_season_confirmations: [
      makeChain({
        data: {
          id: "conf-1",
          status: "confirmed",
          max_mentees: options.cap?.max_mentees ?? 2,
          extra_slots: options.cap?.extra_slots ?? 0
        }
      })
    ],
    // The "is this candidate already taken" query only happens once the
    // application has a person row, so the queue mirrors that.
    matches: [
      makeChain({ count: options.activeCount ?? 0 }), // workload count
      ...(options.app?.person_id ? [makeChain({ data: null })] : []), // mentee not taken
      makeChain({ data: { id: "match-1" } }, options.matchInsert) // insert
    ],
    mentor_profiles: [makeChain({ data: { id: MENTOR_PROFILE } })],
    mentor_mentee_selections: [makeChain({}, options.selectionLog)],
    admin_audit_log: [makeChain({}, options.auditLog)]
  };
}

function loggedOutcome(capture: { payloads: unknown[] }) {
  return (capture.payloads[0] as { outcome?: string } | undefined)?.outcome;
}

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: ACTOR,
    email: "mentor@example.com",
    full_name: "Mentor Test",
    role: "reviewer",
    status: "active"
  });
  (approveApplication as Mock).mockResolvedValue({
    ok: true,
    personId: MENTEE_PERSON,
    profileId: MENTEE_PROFILE,
    personCreated: true,
    profileCreated: true
  });
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe("selectMenteeAfterInterview — who may call it", () => {
  it("refuses a role that cannot interview at all", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ACTOR, email: "v@example.com", role: "viewer" });
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
    expect(tables).toHaveLength(0);
  });

  it("refuses a caller who is not signed in", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue(null);
    const result = await selectMenteeAfterInterview({ applicationId: APP });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa đăng nhập");
  });

  it("rejects a malformed application id before touching the database", async () => {
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    expect(tables).toHaveLength(0);
  });

  it("refuses to take a mentor application as a mentee", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient({
      ...happyTables({ selectionLog: log }),
      applications: [makeChain({ data: application({ role_applied: "mentor" }) })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("hồ sơ ứng tuyển mentee");
  });
});

// ── The interview is what earns the right to choose ──────────────────────────

describe("selectMenteeAfterInterview — the interview requirement", () => {
  it("refuses when the caller has not submitted the interview score, and records it", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient({
      ...happyTables({ selectionLog: log }),
      application_reviews: [makeChain({ data: null })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("nộp điểm phỏng vấn");
    expect(loggedOutcome(log)).toBe("blocked_no_interview");
  });
});

// ── Identity ─────────────────────────────────────────────────────────────────

describe("selectMenteeAfterInterview — which mentor is calling", () => {
  it("uses the linked person id without falling back to email matching", async () => {
    const log = { payloads: [] as unknown[] };
    const { client, tables } = makeClient(happyTables({ selectionLog: log }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(true);
    expect(tables).not.toContain("people");
  });

  it("falls back to a unique email match when no link is stored", async () => {
    const log = { payloads: [] as unknown[] };
    const { client, tables } = makeClient({
      ...happyTables({ selectionLog: log }),
      admin_users: [makeChain({ data: { email: "mentor@example.com", linked_person_id: null } })],
      people: [makeChain({ data: [{ id: MENTOR_PERSON, email_primary: "Mentor@Example.com" }] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(true);
    expect(tables).toContain("people");
  });

  it("refuses when the email matches more than one person, and records it", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient({
      ...happyTables({ selectionLog: log }),
      admin_users: [makeChain({ data: { email: "mentor@example.com", linked_person_id: null } })],
      people: [
        makeChain({
          data: [
            { id: MENTOR_PERSON, email_primary: "mentor@example.com" },
            { id: "00000000-0000-4000-8000-0000000000e2", email_primary: "MENTOR@example.com" }
          ]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("trùng với nhiều hồ sơ");
    expect(loggedOutcome(log)).toBe("blocked_identity");
  });

  it("ignores a row that only matched because ilike treated _ as a wildcard", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient({
      ...happyTables({ selectionLog: log }),
      admin_users: [makeChain({ data: { email: "a_b@example.com", linked_person_id: null } })],
      people: [
        makeChain({
          data: [
            { id: MENTOR_PERSON, email_primary: "a_b@example.com" },
            { id: "00000000-0000-4000-8000-0000000000e3", email_primary: "axb@example.com" }
          ]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(true);
  });
});

// ── Capacity ─────────────────────────────────────────────────────────────────

describe("selectMenteeAfterInterview — the mentor's place in the season", () => {
  it("refuses a mentor with no confirmation row for this season", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient({
      ...happyTables({ selectionLog: log }),
      mentor_season_confirmations: [makeChain({ data: null })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa có suất nhận mentee");
    expect(loggedOutcome(log)).toBe("blocked_not_confirmed");
  });

  it("refuses a mentor who declined the season", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient({
      ...happyTables({ selectionLog: log }),
      mentor_season_confirmations: [
        makeChain({ data: { id: "conf-1", status: "declined", max_mentees: null, extra_slots: 0 } })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(loggedOutcome(log)).toBe("blocked_not_confirmed");
  });

  it("refuses when the mentor is already full, names the fix, and creates no match", async () => {
    const log = { payloads: [] as unknown[] };
    const matchInsert = { payloads: [] as unknown[] };
    const { client } = makeClient(
      happyTables({
        selectionLog: log,
        matchInsert,
        activeCount: 2,
        cap: { max_mentees: 2, extra_slots: 0 }
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.capExceeded).toBe(true);
    expect(result.message).toContain("2/2");
    expect(result.message).toContain("liên hệ ban tổ chức");
    expect(matchInsert.payloads).toHaveLength(0);
    expect(approveApplication).not.toHaveBeenCalled();

    const logged = log.payloads[0] as Record<string, unknown>;
    expect(logged.outcome).toBe("blocked_cap");
    expect(logged.cap_at_decision).toBe(2);
    expect(logged.active_count_at_decision).toBe(2);
  });

  it("counts a granted extra place as capacity", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient(
      happyTables({
        selectionLog: log,
        activeCount: 2,
        cap: { max_mentees: 2, extra_slots: 1 }
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("3/3");
  });
});

// ── Another mentor got there first ───────────────────────────────────────────

describe("selectMenteeAfterInterview — the candidate may already be taken", () => {
  it("refuses when the candidate has an active match with somebody else", async () => {
    const log = { payloads: [] as unknown[] };
    const tables = happyTables({ selectionLog: log, app: { person_id: MENTEE_PERSON } });
    tables.matches = [
      makeChain({ count: 0 }),
      makeChain({ data: { id: "match-other", mentor_person_id: "someone-else" } })
    ];
    const { client } = makeClient(tables);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("mentor khác");
    expect(loggedOutcome(log)).toBe("blocked_mentee_taken");
  });

  it("is idempotent when the candidate is already this mentor's mentee", async () => {
    const log = { payloads: [] as unknown[] };
    const tables = happyTables({ selectionLog: log, app: { person_id: MENTEE_PERSON } });
    tables.matches = [
      makeChain({ count: 1 }),
      makeChain({ data: { id: "match-mine", mentor_person_id: MENTOR_PERSON } })
    ];
    const { client } = makeClient(tables);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(true);
    expect(result.matchId).toBe("match-mine");
    expect(approveApplication).not.toHaveBeenCalled();
    expect(log.payloads).toHaveLength(0);
  });

  it("treats a unique-violation from a simultaneous click as taken", async () => {
    const log = { payloads: [] as unknown[] };
    const tables = happyTables({ selectionLog: log, app: { person_id: MENTEE_PERSON } });
    tables.matches = [
      makeChain({ count: 0 }),
      makeChain({ data: null }),
      makeChain({ data: null, error: { code: "23505", message: "duplicate key" } })
    ];
    const { client } = makeClient(tables);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("mentor khác");
    expect(loggedOutcome(log)).toBe("blocked_mentee_taken");
  });
});

// ── The match itself ─────────────────────────────────────────────────────────

describe("selectMenteeAfterInterview — creating the match", () => {
  it("writes the pair with the identity taken from the application", async () => {
    const log = { payloads: [] as unknown[] };
    const matchInsert = { payloads: [] as unknown[] };
    const auditLog = { payloads: [] as unknown[] };
    const { client } = makeClient(happyTables({ selectionLog: log, matchInsert, auditLog }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP, note: "hợp định hướng" });

    expect(result.ok).toBe(true);
    expect(result.matchId).toBe("match-1");

    const payload = matchInsert.payloads[0] as Record<string, unknown>;
    expect(payload.season_id).toBe(SEASON);
    expect(payload.mentor_person_id).toBe(MENTOR_PERSON);
    expect(payload.mentee_person_id).toBe(MENTEE_PERSON);
    expect(payload.mentee_profile_id).toBe(MENTEE_PROFILE);
    expect(payload.mentor_profile_id).toBe(MENTOR_PROFILE);
    expect(payload.status).toBe("active");
    expect(payload.match_source).toBe("mentor_self_select");
    expect(payload.matched_by).toBe(ACTOR);
    expect(payload.admin_notes).toBe("hợp định hướng");

    // Identity comes from the application row, never from the caller.
    expect(approveApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APP,
        targetRole: "mentee",
        fullName: "Nguyễn Văn A",
        emailPrimary: "mentee@example.com",
        approvedByAdminUserId: ACTOR
      })
    );
  });

  it("records the decision and audits it with an existing action_type", async () => {
    const log = { payloads: [] as unknown[] };
    const auditLog = { payloads: [] as unknown[] };
    const { client } = makeClient(happyTables({ selectionLog: log, auditLog, activeCount: 1 }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    await selectMenteeAfterInterview({ applicationId: APP });

    const logged = log.payloads[0] as Record<string, unknown>;
    expect(logged.outcome).toBe("created");
    expect(logged.match_id).toBe("match-1");
    expect(logged.mentor_person_id).toBe(MENTOR_PERSON);
    expect(logged.mentee_person_id).toBe(MENTEE_PERSON);
    expect(logged.active_count_at_decision).toBe(2);

    const audited = auditLog.payloads[0] as Record<string, unknown>;
    expect(audited.action_type).toBe("create_manual_match");
    expect(audited.actor_admin_user_id).toBe(ACTOR);
  });

  it("stops when the candidate has no name to create a profile from", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient({
      ...happyTables({ selectionLog: log }),
      applications: [makeChain({ data: application({ full_name: "  " }) })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("thiếu họ tên");
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("surfaces a failed approval instead of creating a dangling match", async () => {
    (approveApplication as Mock).mockResolvedValue({ ok: false, message: "Không thể tạo mentee profile." });
    const log = { payloads: [] as unknown[] };
    const matchInsert = { payloads: [] as unknown[] };
    const { client } = makeClient(happyTables({ selectionLog: log, matchInsert }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await selectMenteeAfterInterview({ applicationId: APP });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("mentee profile");
    expect(matchInsert.payloads).toHaveLength(0);
  });
});

// ── What the screen shows before anyone clicks ───────────────────────────────

describe("getMentorSelectionContext", () => {
  it("reports the remaining places without writing anything", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient(
      happyTables({ selectionLog: log, activeCount: 1, cap: { max_mentees: 3, extra_slots: 0 } })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const view = await getMentorSelectionContext({ applicationId: APP });

    expect(view.available).toBe(true);
    expect(view.canSelect).toBe(true);
    expect(view.cap).toBe(3);
    expect(view.activeCount).toBe(1);
    expect(view.capExceeded).toBe(false);
    expect(log.payloads).toHaveLength(0);
  });

  it("disables the button and explains why when the mentor is full", async () => {
    const log = { payloads: [] as unknown[] };
    const { client } = makeClient(
      happyTables({ selectionLog: log, activeCount: 1, cap: { max_mentees: 1, extra_slots: 0 } })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const view = await getMentorSelectionContext({ applicationId: APP });

    expect(view.canSelect).toBe(false);
    expect(view.capExceeded).toBe(true);
    expect(view.message).toContain("liên hệ ban tổ chức");
  });

  it("says so when the candidate is already this mentor's mentee", async () => {
    const log = { payloads: [] as unknown[] };
    const tables = happyTables({ selectionLog: log, app: { person_id: MENTEE_PERSON } });
    tables.matches = [
      makeChain({ count: 1 }),
      makeChain({ data: { id: "match-mine", mentor_person_id: MENTOR_PERSON } })
    ];
    const { client } = makeClient(tables);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const view = await getMentorSelectionContext({ applicationId: APP });

    expect(view.alreadyMineMatchId).toBe("match-mine");
    expect(view.canSelect).toBe(false);
    expect(view.message).toContain("đã là mentee của anh/chị");
  });
});
