/**
 * Direct production tests for lib/selection.ts — the module that turns a
 * ranking into invitations.
 *
 * Supabase, admin auth and scope are mocked; the real function bodies run, so
 * the guards, the refusals and the write shapes are checked against the actual
 * code rather than a description of it.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn(),
  canReadSeason: vi.fn()
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import {
  applySelectionRun,
  computeSeasonCapacity,
  createSelectionRun,
  discardSelectionRun,
  promoteReserveApplication
} from "@/lib/selection";

// ── Mock helpers ──────────────────────────────────────────────────────────────

type ChainResult = { data?: unknown; error?: unknown };

function makeChain(result: ChainResult = {}, capture?: { payloads: unknown[] }) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "neq", "in", "is", "order", "limit", "delete"]) {
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

function makeClient(responses: unknown[]) {
  const fromMock = vi.fn();
  responses.forEach((r) => fromMock.mockReturnValueOnce(r));
  fromMock.mockReturnValue(makeChain());
  return { from: fromMock } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

const BATCH = "00000000-0000-4000-8000-000000000001";
const SEASON = "00000000-0000-4000-8000-000000000002";
const RUN = "00000000-0000-4000-8000-000000000003";
const APP_A = "00000000-0000-4000-8000-00000000000a";
const APP_B = "00000000-0000-4000-8000-00000000000b";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN,
    season_id: SEASON,
    intake_batch_id: BATCH,
    role_applied: "mentee",
    capacity_total: 2,
    reserve_pct: 10,
    scored_count: 3,
    unscored_count: 0,
    main_count: 2,
    reserve_count: 1,
    status: "draft",
    note: null,
    applied_at: null,
    created_at: "2026-08-18T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "admin", full_name: "Admin" });
  (getAdminScopeContext as Mock).mockResolvedValue({ isSuperAdmin: true });
  (canOperateSeason as Mock).mockResolvedValue(true);
  (canReadSeason as Mock).mockResolvedValue(true);
});

// ── Capacity ──────────────────────────────────────────────────────────────────

describe("computeSeasonCapacity", () => {
  it("adds up the confirmed mentors' capacities, including granted slots", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({
          data: [
            { status: "confirmed", max_mentees: 1, extra_slots: 0 },
            { status: "confirmed", max_mentees: 3, extra_slots: 0 },
            { status: "confirmed", max_mentees: 2, extra_slots: 1 }
          ]
        })
      ])
    );

    expect(await computeSeasonCapacity(SEASON)).toBe(7);
  });

  it("is zero when nobody has confirmed", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([makeChain({ data: [] })]));
    expect(await computeSeasonCapacity(SEASON)).toBe(0);
  });

  it("is zero rather than wrong when the query fails", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: null, error: { code: "42501", message: "permission denied" } })])
    );
    expect(await computeSeasonCapacity(SEASON)).toBe(0);
  });
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe("selection runs — authorization", () => {
  it("refuses a role that cannot decide", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "u", role: "reviewer" });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: { id: BATCH, season_id: SEASON } })])
    );

    const result = await createSelectionRun({ intakeBatchId: BATCH });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
  });

  it("refuses an operator without scope on the season", async () => {
    (canOperateSeason as Mock).mockResolvedValue(false);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: { id: BATCH, season_id: SEASON } })])
    );

    const result = await createSelectionRun({ intakeBatchId: BATCH });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("vận hành mùa này");
  });

  it("rejects a malformed batch id before touching the database", async () => {
    const client = makeClient([]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createSelectionRun({ intakeBatchId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    expect((client as unknown as { from: Mock }).from).not.toHaveBeenCalled();
  });
});

// ── Creating a run ────────────────────────────────────────────────────────────

describe("createSelectionRun", () => {
  it("refuses a second draft for the same batch and role", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: BATCH, season_id: SEASON } }), // batch
        makeChain({ data: { id: RUN } }) // existing draft
      ])
    );

    const result = await createSelectionRun({ intakeBatchId: BATCH });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("bản tính nháp");
  });

  it("refuses an out-of-range reserve percentage", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([]));
    const result = await createSelectionRun({ intakeBatchId: BATCH, reservePct: 250 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("từ 0 đến 100");
  });

  it("stores the run and its ranked items, and reports the cut", async () => {
    const runCapture = { payloads: [] as unknown[] };
    const itemCapture = { payloads: [] as unknown[] };

    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: BATCH, season_id: SEASON } }), // batch
        makeChain({ data: null }), // no existing draft
        makeChain({
          data: [
            { id: APP_A, submitted_at: "2026-08-01", status: "screening_completed" },
            { id: APP_B, submitted_at: "2026-08-02", status: "screening_completed" }
          ]
        }), // applications
        makeChain({ data: [{ status: "confirmed", max_mentees: 1, extra_slots: 0 }] }), // capacity (Promise.all interleaves here)
        makeChain({
          data: [
            { application_id: APP_A, total_score: 20 },
            { application_id: APP_B, total_score: 10 }
          ]
        }), // reviews
        makeChain({ data: { id: RUN } }, runCapture), // run insert
        makeChain({ data: null }, itemCapture) // items insert
      ])
    );

    const result = await createSelectionRun({ intakeBatchId: BATCH });

    expect(result.ok).toBe(true);
    expect(result.runId).toBe(RUN);

    const run = runCapture.payloads[0] as Record<string, unknown>;
    expect(run.capacity_total).toBe(1);
    expect(run.main_count).toBe(1);
    expect(run.reserve_count).toBe(1);
    expect(run.status).toBe("draft");

    const items = itemCapture.payloads[0] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ application_id: APP_A, rank: 1, selection_group: "main" });
    expect(items[1]).toMatchObject({ application_id: APP_B, rank: 2, selection_group: "reserve" });
  });

  it("reports the block instead of pretending the run is ready when scoring is unfinished", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: BATCH, season_id: SEASON } }),
        makeChain({ data: null }),
        makeChain({
          data: [
            { id: APP_A, submitted_at: "2026-08-01", status: "screening_completed" },
            { id: APP_B, submitted_at: "2026-08-02", status: "screening_assigned" }
          ]
        }),
        makeChain({ data: [{ status: "confirmed", max_mentees: 1, extra_slots: 0 }] }), // capacity
        makeChain({ data: [{ application_id: APP_A, total_score: 20 }] }), // only one scored
        makeChain({ data: { id: RUN } }),
        makeChain({ data: null })
      ])
    );

    const result = await createSelectionRun({ intakeBatchId: BATCH });

    expect(result.ok).toBe(true);
    expect(result.summary?.canApply).toBe(false);
    expect(result.summary?.unscoredCount).toBe(1);
    expect(result.message).toContain("chưa thể áp dụng");
  });

  it("says so plainly when the batch has no applications", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: BATCH, season_id: SEASON } }),
        makeChain({ data: null }),
        makeChain({ data: [] }),
        makeChain({ data: [] })
      ])
    );

    const result = await createSelectionRun({ intakeBatchId: BATCH });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Không có hồ sơ nào");
  });
});

// ── Applying a run ────────────────────────────────────────────────────────────

describe("applySelectionRun", () => {
  it("refuses while any application is unscored", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRun({ unscored_count: 4 }) })])
    );

    const result = await applySelectionRun({ runId: RUN });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa có điểm chấm");
  });

  it("refuses when no mentor has confirmed a place", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRun({ capacity_total: 0 }) })])
    );

    const result = await applySelectionRun({ runId: RUN });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa xác định được số suất");
  });

  it("refuses a run that was already applied", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRun({ status: "applied", applied_at: "2026-08-18T00:00:00.000Z" }) })])
    );

    const result = await applySelectionRun({ runId: RUN });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã được áp dụng");
  });

  it("invites the main group and waitlists the reserve", async () => {
    const mainUpdate = { payloads: [] as unknown[] };
    const reserveUpdate = { payloads: [] as unknown[] };

    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRun() }), // run
        makeChain({
          data: [
            { id: "item-1", run_id: RUN, application_id: APP_A, rank: 1, selection_group: "main" },
            { id: "item-2", run_id: RUN, application_id: APP_B, rank: 2, selection_group: "reserve" }
          ]
        }), // items
        makeChain({ data: [{ id: APP_A, status: "screening_completed" }, { id: APP_B, status: "screening_completed" }] }), // before
        makeChain({ data: null }, mainUpdate), // applications update — main
        makeChain({ data: null }), // selection_run_items applied_status — main
        makeChain({ data: null }), // application_decisions — main
        makeChain({ data: null }, reserveUpdate), // applications update — reserve
        makeChain({ data: null }), // selection_run_items applied_status — reserve
        makeChain({ data: null }), // application_decisions — reserve
        makeChain({ data: { id: RUN } }) // run status → applied
      ])
    );

    const result = await applySelectionRun({ runId: RUN });

    expect(result.ok).toBe(true);
    expect(mainUpdate.payloads[0]).toMatchObject({ status: "invited_to_interview" });
    expect(reserveUpdate.payloads[0]).toMatchObject({ status: "waitlisted" });
    expect(result.message).toContain("mời 2 hồ sơ phỏng vấn");
  });

  it("reports a lost race when another operator applied it first", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRun() }),
        makeChain({
          data: [{ id: "item-1", run_id: RUN, application_id: APP_A, rank: 1, selection_group: "main" }]
        }),
        makeChain({ data: [{ id: APP_A, status: "screening_completed" }] }),
        makeChain({ data: null }),
        makeChain({ data: null }),
        makeChain({ data: null }),
        makeChain({ data: null }) // conditional update matches nothing
      ])
    );

    const result = await applySelectionRun({ runId: RUN });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("tải lại trang");
  });
});

// ── Discarding ────────────────────────────────────────────────────────────────

describe("discardSelectionRun", () => {
  it("only discards a draft", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRun({ status: "applied", applied_at: "2026-08-18T00:00:00.000Z" }) })])
    );

    const result = await discardSelectionRun({ runId: RUN });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("nháp");
  });

  it("discards a draft so a fresh one can be computed", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRun() }), makeChain({ data: { id: RUN } })])
    );

    const result = await discardSelectionRun({ runId: RUN });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("tính lại");
  });
});

// ── Promoting from the reserve ────────────────────────────────────────────────

describe("promoteReserveApplication", () => {
  it("only works once the run has been applied", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([makeChain({ data: makeRun() })]));

    const result = await promoteReserveApplication({ runId: RUN, applicationId: APP_B });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã được áp dụng");
  });

  it("refuses an application that is not in the reserve group", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRun({ status: "applied", applied_at: "2026-08-18T00:00:00.000Z" }) }),
        makeChain({
          data: { id: "item-1", run_id: RUN, application_id: APP_A, rank: 1, selection_group: "main" }
        })
      ])
    );

    const result = await promoteReserveApplication({ runId: RUN, applicationId: APP_A });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("nhóm dự phòng");
  });

  it("refuses a second promotion of the same application", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRun({ status: "applied", applied_at: "2026-08-18T00:00:00.000Z" }) }),
        makeChain({
          data: {
            id: "item-2",
            run_id: RUN,
            application_id: APP_B,
            rank: 2,
            selection_group: "reserve",
            promoted_at: "2026-08-18T01:00:00.000Z"
          }
        })
      ])
    );

    const result = await promoteReserveApplication({ runId: RUN, applicationId: APP_B });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã được đôn lên");
  });

  it("invites the standby applicant and records it", async () => {
    const appUpdate = { payloads: [] as unknown[] };

    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRun({ status: "applied", applied_at: "2026-08-18T00:00:00.000Z" }) }),
        makeChain({
          data: { id: "item-2", run_id: RUN, application_id: APP_B, rank: 2, selection_group: "reserve", promoted_at: null }
        }),
        makeChain({ data: { id: APP_B, status: "waitlisted" } }), // previous status
        makeChain({ data: null }, appUpdate), // applications update
        makeChain({ data: { id: "item-2" } }), // item update
        makeChain({ data: null }) // decision row
      ])
    );

    const result = await promoteReserveApplication({ runId: RUN, applicationId: APP_B });

    expect(result.ok).toBe(true);
    expect(appUpdate.payloads[0]).toMatchObject({ status: "invited_to_interview" });
  });
});
