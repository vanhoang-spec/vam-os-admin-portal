/**
 * Direct production tests for the Season 12 additions to lib/bulk-assignment.ts:
 * reviewer validation, the per-reviewer batch ceiling, and the notification email.
 *
 * Supabase, scope and email are mocked; the real function body runs.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn(),
  canReviewSeason: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendReviewBatchAssigned: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getAdminScopeContext, getScopeFilter, canReviewSeason } from "@/lib/program-scope";
import { sendReviewBatchAssigned } from "@/lib/email";
import { bulkAssignApplicationReviews } from "@/lib/bulk-assignment";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeChain(result: { data?: unknown; error?: unknown } = {}) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "order", "limit", "update", "insert"]) {
    chain[method] = self;
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null, ...result });
  chain.then = (f: unknown, r: unknown) => (resolved as Promise<unknown>).then(f as never, r as never);
  chain.catch = (r: unknown) => (resolved as Promise<unknown>).catch(r as never);
  chain.finally = (f: unknown) => (resolved as Promise<unknown>).finally(f as never);
  return chain;
}

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const BATCH = "00000000-0000-4000-8000-0000000000bb";

const reviewer = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@example.test`,
  full_name: `Reviewer ${id}`,
  role: "reviewer",
  status: "active",
  ...overrides
});

function applications(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `app-${i + 1}`,
    submitted_at: `2026-08-0${(i % 9) + 1}`,
    status: "submitted",
    season_id: SEASON
  }));
}

/**
 * Chain order inside bulkAssignApplicationReviews:
 *   1 admin_users (reviewer validation)
 *   2 applications (the eligible query is built, which calls from() straight away)
 *   3 intake_batches (batch → season, for the scope check)
 *   4 application_reviews (already assigned)
 *   5 application_reviews (current workload)
 *   6 review_assignment_batches insert
 *   7 application_reviews insert  ← captured
 *   8 applications status update
 */
function makeClient(input: {
  reviewers: Array<Record<string, unknown>>;
  apps: Array<Record<string, unknown>>;
  insertCapture: { rows?: unknown };
}) {
  const insertChain = makeChain({ data: null }) as Record<string, unknown>;
  insertChain.insert = (rows: unknown) => {
    input.insertCapture.rows = rows;
    return insertChain;
  };

  const fromMock = vi.fn();
  fromMock
    .mockReturnValueOnce(makeChain({ data: input.reviewers }))
    .mockReturnValueOnce(makeChain({ data: input.apps }))
    .mockReturnValueOnce(makeChain({ data: { id: BATCH, season_id: SEASON } }))
    .mockReturnValueOnce(makeChain({ data: [] }))
    .mockReturnValueOnce(makeChain({ data: [] }))
    .mockReturnValueOnce(makeChain({ data: { id: "batch-1" } }))
    .mockReturnValueOnce(insertChain)
    .mockReturnValue(makeChain({ data: null }));
  return { from: fromMock };
}

const baseInput = {
  intakeBatchId: BATCH,
  roleApplied: "mentee",
  statuses: ["submitted"],
  dueAt: null,
  excludeAlreadyAssigned: true,
  assignmentNote: null,
  assignedByAdminUserId: "admin-1"
};

beforeEach(() => {
  vi.resetAllMocks();
  (getAdminScopeContext as Mock).mockResolvedValue({ isSuperAdmin: true });
  (getScopeFilter as Mock).mockResolvedValue(undefined);
  (canReviewSeason as Mock).mockResolvedValue(true);
  (sendReviewBatchAssigned as Mock).mockResolvedValue({ ok: true, skipped: false });
});

// ── Reviewer validation (audit finding F-8) ──────────────────────────────────

describe("bulkAssignApplicationReviews — reviewer validation", () => {
  it("refuses an id that belongs to nobody", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({ reviewers: [reviewer("r1")], apps: applications(4), insertCapture: capture })
    );

    const result = await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1", "ghost"]
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("không hợp lệ");
    expect(capture.rows).toBeUndefined();
  });

  it("refuses a suspended account", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({
        reviewers: [reviewer("r1", { status: "suspended" })],
        apps: applications(4),
        insertCapture: capture
      })
    );

    const result = await bulkAssignApplicationReviews({ ...baseInput, reviewerAdminUserIds: ["r1"] });

    expect(result.ok).toBe(false);
    expect(capture.rows).toBeUndefined();
  });

  it("refuses a role that cannot review, such as a viewer", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({
        reviewers: [reviewer("r1", { role: "viewer" })],
        apps: applications(4),
        insertCapture: capture
      })
    );

    const result = await bulkAssignApplicationReviews({ ...baseInput, reviewerAdminUserIds: ["r1"] });

    expect(result.ok).toBe(false);
    expect(capture.rows).toBeUndefined();
  });

  it("accepts an admin tier, which can review as well as assign", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({
        reviewers: [reviewer("r1", { role: "core_team" })],
        apps: applications(2),
        insertCapture: capture
      })
    );

    const result = await bulkAssignApplicationReviews({ ...baseInput, reviewerAdminUserIds: ["r1"] });

    expect(result.ok).toBe(true);
  });
});

// ── Batch ceiling ─────────────────────────────────────────────────────────────

describe("bulkAssignApplicationReviews — per-reviewer batch size", () => {
  it("gives each reviewer at most the requested number", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({
        reviewers: [reviewer("r1"), reviewer("r2")],
        apps: applications(25),
        insertCapture: capture
      })
    );

    const result = await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1", "r2"],
      maxPerReviewer: 10
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applicationsAssigned).toBe(20);
      expect(result.unassignedDueToCap).toBe(5);
      expect(result.maxPerReviewer).toBe(10);
      expect(result.minPerReviewer).toBe(10);
    }

    const rows = capture.rows as Array<{ reviewer_admin_user_id: string }>;
    expect(rows).toHaveLength(20);
    expect(rows.filter((r) => r.reviewer_admin_user_id === "r1")).toHaveLength(10);
    expect(rows.filter((r) => r.reviewer_admin_user_id === "r2")).toHaveLength(10);
  });

  it("spreads a partial batch evenly instead of filling one reviewer first", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({
        reviewers: [reviewer("r1"), reviewer("r2"), reviewer("r3")],
        apps: applications(7),
        insertCapture: capture
      })
    );

    await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1", "r2", "r3"],
      maxPerReviewer: 10
    });

    const rows = capture.rows as Array<{ reviewer_admin_user_id: string }>;
    const counts = ["r1", "r2", "r3"]
      .map((id) => rows.filter((r) => r.reviewer_admin_user_id === id).length)
      .sort();
    expect(counts).toEqual([2, 2, 3]);
  });

  it("assigns everything when no ceiling is given", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({ reviewers: [reviewer("r1")], apps: applications(14), insertCapture: capture })
    );

    const result = await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1"],
      maxPerReviewer: null
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applicationsAssigned).toBe(14);
      expect(result.unassignedDueToCap).toBe(0);
    }
  });

  it("leaves the applications it could not fit for the next round", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({ reviewers: [reviewer("r1")], apps: applications(5), insertCapture: capture })
    );

    await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1"],
      maxPerReviewer: 2
    });

    // Only these two may move to screening_assigned; the rest stay eligible.
    const rows = capture.rows as Array<{ application_id: string }>;
    expect(rows.map((r) => r.application_id)).toEqual(["app-1", "app-2"]);
  });
});

// ── Notification ──────────────────────────────────────────────────────────────

describe("bulkAssignApplicationReviews — reviewer notification", () => {
  it("emails each reviewer the size of their own batch", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({
        reviewers: [reviewer("r1"), reviewer("r2")],
        apps: applications(3),
        insertCapture: capture
      })
    );

    const result = await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1", "r2"],
      maxPerReviewer: 10,
      notifyReviewers: true
    });

    expect(sendReviewBatchAssigned).toHaveBeenCalledTimes(2);
    const counts = (sendReviewBatchAssigned as Mock).mock.calls
      .map((call) => call[0].assignmentCount)
      .sort();
    expect(counts).toEqual([1, 2]);
    if (result.ok) expect(result.notifiedReviewers).toBe(2);
  });

  it("sends nothing when notification is off", async () => {
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({ reviewers: [reviewer("r1")], apps: applications(2), insertCapture: capture })
    );

    await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1"],
      notifyReviewers: false
    });

    expect(sendReviewBatchAssigned).not.toHaveBeenCalled();
  });

  it("still reports success when an email fails — the rows are written", async () => {
    (sendReviewBatchAssigned as Mock).mockResolvedValue({
      ok: false,
      skipped: false,
      reason: "provider down"
    });
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({ reviewers: [reviewer("r1")], apps: applications(2), insertCapture: capture })
    );

    const result = await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1"],
      notifyReviewers: true
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notifyFailures).toBe(1);
      expect(result.notifiedReviewers).toBe(0);
      expect(result.applicationsAssigned).toBe(2);
    }
  });

  it("counts a configuration-skipped send as neither sent nor failed", async () => {
    (sendReviewBatchAssigned as Mock).mockResolvedValue({
      ok: true,
      skipped: true,
      reason: "email off"
    });
    const capture: { rows?: unknown } = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient({ reviewers: [reviewer("r1")], apps: applications(2), insertCapture: capture })
    );

    const result = await bulkAssignApplicationReviews({
      ...baseInput,
      reviewerAdminUserIds: ["r1"],
      notifyReviewers: true
    });

    if (result.ok) {
      expect(result.notifiedReviewers).toBe(0);
      expect(result.notifyFailures).toBe(0);
    }
  });
});
