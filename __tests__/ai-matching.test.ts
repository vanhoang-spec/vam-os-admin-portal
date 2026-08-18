/**
 * Direct production tests for lib/ai-matching.ts — the run that proposes pairs
 * and the approval that turns one into a match.
 *
 * Supabase, admin auth, scope, the approval helper, the manual-matching path
 * and `fetch` are mocked; the real function bodies run. The assertion that
 * matters most is on the outgoing request: it must carry codes and criteria and
 * nothing that identifies anybody.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn(),
  canReadSeason: vi.fn()
}));
vi.mock("@/lib/matches", () => ({ createManualMatch: vi.fn() }));
vi.mock("@/lib/application-approvals", () => ({ approveApplication: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { createManualMatch } from "@/lib/matches";
import { approveApplication } from "@/lib/application-approvals";
import {
  approveRecommendation,
  rejectRecommendation,
  runMatchRecommendations
} from "@/lib/ai-matching";

// ── Mock helpers ──────────────────────────────────────────────────────────────

type ChainResult = { data?: unknown; error?: unknown; count?: number };

function makeChain(result: ChainResult = {}, capture?: { payloads: unknown[] }) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "neq", "in", "is", "ilike", "order", "limit"]) {
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
const SEASON = "00000000-0000-4000-8000-000000000b01";
const RUN = "00000000-0000-4000-8000-000000000c01";
const REC = "00000000-0000-4000-8000-000000000c02";
const APP_1 = "00000000-0000-4000-8000-000000000d01";
const APP_2 = "00000000-0000-4000-8000-000000000d02";
const BATCH = "00000000-0000-4000-8000-000000000e01";
const MENTOR_PERSON = "00000000-0000-4000-8000-000000000f01";
const MENTEE_PERSON = "00000000-0000-4000-8000-000000000f02";
const MENTOR_PROFILE = "00000000-0000-4000-8000-000000000f03";
const MENTEE_PROFILE = "00000000-0000-4000-8000-000000000f04";

function menteeApplication(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    person_id: null,
    full_name: "Nguyễn Thị Bích Ngọc",
    submitted_at: "2026-08-01",
    raw_payload: {
      email_primary: "bichngoc@example.com",
      phone_primary: "0912345678",
      mssv: "31221024567",
      university: "Đại học Kinh tế TP.HCM",
      target_industry: "Tài chính - Ngân hàng",
      target_function: "Phân tích đầu tư",
      mentoring_goals_text: "Muốn hiểu nghề phân tích đầu tư"
    },
    ...overrides
  };
}

function poolTables(options: {
  mentees?: unknown[];
  confirmations?: unknown[];
  activeMatches?: unknown[];
  runInsert?: { payloads: unknown[] };
  runUpdate?: { payloads: unknown[] };
  recInsert?: { payloads: unknown[] };
  runInsertResult?: ChainResult;
}) {
  return {
    matches: [makeChain({ data: options.activeMatches ?? [] })],
    applications: [makeChain({ data: options.mentees ?? [menteeApplication(APP_1)] })],
    mentor_season_confirmations: [
      makeChain({
        data: options.confirmations ?? [
          { person_id: MENTOR_PERSON, status: "confirmed", max_mentees: 2, extra_slots: 0 }
        ]
      })
    ],
    mentor_profiles: [
      makeChain({
        data: [
          {
            person_id: MENTOR_PERSON,
            industry: "Tài chính - Ngân hàng",
            function_area: "Phân tích đầu tư",
            years_experience_min: 8
          }
        ]
      })
    ],
    match_recommendation_runs: [
      makeChain(options.runInsertResult ?? { data: { id: RUN } }, options.runInsert),
      makeChain({ data: [] }), // no older runs to supersede
      makeChain({}, options.runUpdate)
    ],
    match_recommendations: [makeChain({}, options.recInsert)],
    match_recommendation_log: [makeChain({})]
  };
}

function providerReply(pairs: Array<{ mentee: string; mentor: string; score: number; reason?: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ pairs }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 }
    })
  };
}

function requestBody(fetchMock: Mock): string {
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return init.body;
}

let fetchMock: Mock;

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
  (canOperateSeason as Mock).mockResolvedValue(true);

  process.env.VAM_OS_AI_MATCHING_ENABLED = "true";
  process.env.DEEPSEEK_API_KEY = "sk-test";

  fetchMock = vi.fn().mockResolvedValue(providerReply([{ mentee: "E001", mentor: "M001", score: 0.9, reason: "cùng ngành" }]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.VAM_OS_AI_MATCHING_ENABLED;
  delete process.env.DEEPSEEK_API_KEY;
  vi.unstubAllGlobals();
});

// ── Authorization and configuration ──────────────────────────────────────────

describe("runMatchRecommendations — who may run it", () => {
  it("refuses a reviewer", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ACTOR, email: "m@example.com", role: "reviewer" });
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
    expect(tables).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an operator without operations scope on the season", async () => {
    (canOperateSeason as Mock).mockResolvedValue(false);
    const { client } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("vận hành mùa này");
  });

  it("rejects a malformed season id before anything else", async () => {
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    expect(tables).toHaveLength(0);
  });

  it("refuses when the feature is not switched on, without opening a run", async () => {
    delete process.env.VAM_OS_AI_MATCHING_ENABLED;
    const runInsert = { payloads: [] as unknown[] };
    const { client, tables } = makeClient(poolTables({ runInsert }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Chưa bật ghép cặp bằng AI");
    expect(tables).not.toContain("match_recommendation_runs");
    expect(runInsert.payloads).toHaveLength(0);
  });
});

// ── The pool ─────────────────────────────────────────────────────────────────

describe("runMatchRecommendations — the pool", () => {
  it("says so when there is nobody left to match", async () => {
    const { client } = makeClient(poolTables({ mentees: [] }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Không còn mentee");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when no mentor has a free place", async () => {
    const { client } = makeClient(
      poolTables({
        confirmations: [{ person_id: MENTOR_PERSON, status: "confirmed", max_mentees: 1, extra_slots: 0 }],
        activeMatches: [{ mentor_person_id: MENTOR_PERSON, mentee_person_id: "someone" }]
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Không còn mentor nào trống suất");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves out a mentee who already has a mentor", async () => {
    const { client } = makeClient(
      poolTables({
        mentees: [menteeApplication(APP_1, { person_id: MENTEE_PERSON })],
        activeMatches: [{ mentor_person_id: "other", mentee_person_id: MENTEE_PERSON }]
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Không còn mentee");
  });
});

// ── What leaves the building ─────────────────────────────────────────────────

describe("runMatchRecommendations — the request to the provider", () => {
  it("sends codes and criteria, and nothing that identifies anybody", async () => {
    const { client } = makeClient(poolTables({ recInsert: { payloads: [] } }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    await runMatchRecommendations({ seasonId: SEASON });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = requestBody(fetchMock);

    expect(body).toContain("E001");
    expect(body).toContain("M001");
    expect(body).toContain("Phân tích đầu tư");

    for (const secret of [
      "Nguyễn Thị Bích Ngọc",
      "bichngoc@example.com",
      "0912345678",
      "31221024567",
      "Đại học Kinh tế",
      APP_1,
      MENTOR_PERSON
    ]) {
      expect(body, secret).not.toContain(secret);
    }
  });

  it("asks for JSON and authenticates with the configured key", async () => {
    const { client } = makeClient(poolTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    await runMatchRecommendations({ seasonId: SEASON });

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string }
    ];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body).response_format).toEqual({ type: "json_object" });
  });
});

// ── Storing the proposal ─────────────────────────────────────────────────────

describe("runMatchRecommendations — what is stored", () => {
  it("stores pending pairs and completes the run", async () => {
    const recInsert = { payloads: [] as unknown[] };
    const runUpdate = { payloads: [] as unknown[] };
    const { client } = makeClient(poolTables({ recInsert, runUpdate }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    expect(result.pairCount).toBe(1);
    expect(result.message).toContain("Chưa có cặp nào được tạo");

    const rows = recInsert.payloads[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      run_id: RUN,
      round: 1,
      mentor_person_id: MENTOR_PERSON,
      mentee_application_id: APP_1,
      status: "pending",
      score: 0.9
    });

    const completed = runUpdate.payloads[0] as Record<string, unknown>;
    expect(completed.status).toBe("completed");
    expect(completed.pair_count).toBe(1);
    expect(completed.prompt_tokens).toBe(120);
    expect(completed.completed_at).toBeTruthy();
  });

  it("records how the proposal was produced", async () => {
    const runInsert = { payloads: [] as unknown[] };
    const { client } = makeClient(poolTables({ runInsert }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    await runMatchRecommendations({ seasonId: SEASON });

    const run = runInsert.payloads[0] as Record<string, unknown>;
    expect(run.provider).toBe("deepseek");
    expect(run.model).toBe("deepseek-chat");
    expect(run.prompt_version).toBeTruthy();
    expect(run.status).toBe("running");
    expect(run.mentee_count).toBe(1);
    expect(run.mentor_count).toBe(1);
  });

  it("never proposes more mentees than a mentor has places", async () => {
    // One mentor, one place, and a model that offers them both mentees.
    fetchMock.mockResolvedValue(
      providerReply([
        { mentee: "E001", mentor: "M001", score: 0.9 },
        { mentee: "E002", mentor: "M001", score: 0.8 }
      ])
    );
    const recInsert = { payloads: [] as unknown[] };
    const { client } = makeClient(
      poolTables({
        mentees: [menteeApplication(APP_1), menteeApplication(APP_2)],
        confirmations: [
          { person_id: MENTOR_PERSON, status: "confirmed", max_mentees: 1, extra_slots: 0 }
        ],
        recInsert
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    const rows = recInsert.payloads[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].mentee_application_id).toBe(APP_1);
  });

  it("drops a pair for a mentor code the model invented", async () => {
    fetchMock.mockResolvedValue(providerReply([{ mentee: "E001", mentor: "M404", score: 1 }]));
    const recInsert = { payloads: [] as unknown[] };
    const { client } = makeClient(poolTables({ recInsert }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    expect(result.pairCount).toBe(0);
    expect(recInsert.payloads).toHaveLength(0);
  });
});

// ── When it goes wrong ───────────────────────────────────────────────────────

describe("runMatchRecommendations — failure", () => {
  it("marks the run failed and stores no pairs when the provider errors", async () => {
    fetchMock.mockRejectedValue(new Error("connection reset"));
    const recInsert = { payloads: [] as unknown[] };
    const runUpdate = { payloads: [] as unknown[] };
    const tables = poolTables({ recInsert });
    // A failing run never reaches the supersede step, so the second call on
    // this table is the "mark failed" update.
    tables.match_recommendation_runs = [
      makeChain({ data: { id: RUN } }),
      makeChain({}, runUpdate)
    ];
    const { client } = makeClient(tables);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Lần chạy thất bại");
    expect(recInsert.payloads).toHaveLength(0);

    const failed = runUpdate.payloads[0] as Record<string, unknown>;
    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("connection reset");
    // A retry means two attempts before giving up.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains the conflict when another run is already going", async () => {
    const { client } = makeClient(
      poolTables({
        runInsertResult: { data: null, error: { code: "23505", message: "duplicate key" } }
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await runMatchRecommendations({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("một lần chạy khác");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Approving ────────────────────────────────────────────────────────────────

function approvalTables(options: {
  recommendation?: Record<string, unknown> | null;
  recUpdate?: { payloads: unknown[] };
  application?: Record<string, unknown> | null;
}) {
  return {
    match_recommendations: [
      makeChain({
        data:
          options.recommendation === undefined
            ? {
                id: REC,
                run_id: RUN,
                status: "pending",
                mentor_person_id: MENTOR_PERSON,
                mentee_application_id: APP_1
              }
            : options.recommendation
      }),
      makeChain({}, options.recUpdate)
    ],
    match_recommendation_runs: [makeChain({ data: { season_id: SEASON } })],
    applications: [
      makeChain({
        data:
          options.application === undefined
            ? {
                id: APP_1,
                status: "interview_completed",
                intake_batch_id: BATCH,
                full_name: "Nguyễn Thị Bích Ngọc",
                email_primary: "bichngoc@example.com",
                phone_primary: "0912345678",
                gender: "female",
                role_applied: "mentee"
              }
            : options.application
      })
    ],
    mentor_profiles: [makeChain({ data: { id: MENTOR_PROFILE } })],
    match_recommendation_log: [makeChain({})]
  };
}

describe("approveRecommendation", () => {
  beforeEach(() => {
    (approveApplication as Mock).mockResolvedValue({
      ok: true,
      personId: MENTEE_PERSON,
      profileId: MENTEE_PROFILE,
      personCreated: false,
      profileCreated: true
    });
    (createManualMatch as Mock).mockResolvedValue({ ok: true, message: "Đã tạo match thành công.", matchId: "match-1" });
  });

  it("refuses a reviewer", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ACTOR, email: "m@example.com", role: "reviewer" });
    const { client } = makeClient(approvalTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveRecommendation({ recommendationId: REC });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
    expect(createManualMatch).not.toHaveBeenCalled();
  });

  it("creates the match through the manual path, which re-checks capacity", async () => {
    const recUpdate = { payloads: [] as unknown[] };
    const { client } = makeClient(approvalTables({ recUpdate }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveRecommendation({ recommendationId: REC });

    expect(result.ok).toBe(true);
    expect(approveApplication).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: APP_1, targetRole: "mentee", approvedByAdminUserId: ACTOR })
    );
    expect(createManualMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        mentorProfileId: MENTOR_PROFILE,
        menteeProfileId: MENTEE_PROFILE,
        intakeBatchId: BATCH
      })
    );

    const update = recUpdate.payloads[0] as Record<string, unknown>;
    expect(update.status).toBe("approved");
    expect(update.match_id).toBe("match-1");
    expect(update.decided_by).toBe(ACTOR);
    expect(update.mentee_person_id).toBe(MENTEE_PERSON);
  });

  it("surfaces the refusal when the mentor filled up since the proposal", async () => {
    (createManualMatch as Mock).mockResolvedValue({
      ok: false,
      message: "Mentor này đã có 2/2 mentee. Không thể thêm mentee mới."
    });
    const recUpdate = { payloads: [] as unknown[] };
    const { client } = makeClient(approvalTables({ recUpdate }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveRecommendation({ recommendationId: REC });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("2/2 mentee");
    // The proposal stays pending so an organiser can grant a slot and retry.
    expect(recUpdate.payloads).toHaveLength(0);
  });

  it("refuses a proposal that was already decided", async () => {
    const { client } = makeClient(
      approvalTables({
        recommendation: {
          id: REC,
          run_id: RUN,
          status: "approved",
          mentor_person_id: MENTOR_PERSON,
          mentee_application_id: APP_1
        }
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveRecommendation({ recommendationId: REC });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã được xử lý");
    expect(createManualMatch).not.toHaveBeenCalled();
  });

  it("stops when the mentee application has no intake batch", async () => {
    const { client } = makeClient(
      approvalTables({
        application: {
          id: APP_1,
          status: "interview_completed",
          intake_batch_id: null,
          full_name: "Nguyễn Thị Bích Ngọc",
          email_primary: "b@example.com",
          phone_primary: null,
          gender: null,
          role_applied: "mentee"
        }
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveRecommendation({ recommendationId: REC });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đợt tuyển");
    expect(approveApplication).not.toHaveBeenCalled();
  });
});

describe("rejectRecommendation", () => {
  it("marks the proposal rejected without touching matches", async () => {
    const recUpdate = { payloads: [] as unknown[] };
    const { client } = makeClient(approvalTables({ recUpdate }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await rejectRecommendation({ recommendationId: REC, reason: "không phù hợp" });

    expect(result.ok).toBe(true);
    const update = recUpdate.payloads[0] as Record<string, unknown>;
    expect(update.status).toBe("rejected");
    expect(update.decided_at).toBeTruthy();
    expect(createManualMatch).not.toHaveBeenCalled();
  });

  it("refuses an operator without scope", async () => {
    (canOperateSeason as Mock).mockResolvedValue(false);
    const { client } = makeClient(approvalTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await rejectRecommendation({ recommendationId: REC });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("vận hành mùa này");
  });
});
