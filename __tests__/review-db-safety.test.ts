/**
 * DB error safety tests for lib/application-reviews.ts.
 *
 * Verifies that when Supabase operations fail, raw database error messages
 * (codes, relation names, schema names, internal hints) are never returned
 * to callers. All mutations use the service-role client; scope gating uses
 * canWriteReviewWorkflowForApplication() which calls canReviewSeason().
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual library exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canReviewSeason: vi.fn(),
  canOperateSeason: vi.fn(),
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, canReviewSeason, canOperateSeason } from "@/lib/program-scope";
import {
  assignApplicationReview,
  cancelApplicationReview,
  saveApplicationReviewDraft,
  submitApplicationReview,
} from "@/lib/application-reviews";
import { buildMyWorkItems } from "@/lib/my-work";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeChain(result: { data?: unknown; error?: unknown } = {}): unknown {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.neq = self;
  chain.limit = self;
  chain.in = self;
  chain.update = self;
  chain.insert = self;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null, ...result });
  chain.single = () => Promise.resolve({ data: null, error: null, ...result });
  chain.then = (f: unknown, r: unknown) => (resolved as Promise<unknown>).then(f as never, r as never);
  chain.catch = (r: unknown) => (resolved as Promise<unknown>).catch(r as never);
  chain.finally = (f: unknown) => (resolved as Promise<unknown>).finally(f as never);
  return chain;
}

function makeClient(
  fromResponses: unknown[],
  rpc?: (name: string, params?: Record<string, unknown>) => Promise<unknown>
) {
  const fromMock = vi.fn();
  fromResponses.forEach((r) => fromMock.mockReturnValueOnce(r));
  fromMock.mockReturnValue(makeChain());
  return { from: fromMock, rpc: rpc ?? vi.fn().mockResolvedValue({ data: null, error: null }) };
}

const APP_UUID    = "00000000-0000-4000-8000-000000000020";
const REVIEW_UUID = "00000000-0000-4000-8000-000000000021";
const SEASON_UUID = "00000000-0000-4000-8000-000000000022";
const ADMIN_ID    = "admin-review-1";

const SENSITIVE_MSG = "INTERNAL: permission denied for table application_reviews in schema public";

function scopeApp() {
  return { id: APP_UUID, season_id: SEASON_UUID };
}

function existingReview(overrides: Record<string, unknown> = {}) {
  return {
    id: REVIEW_UUID,
    reviewer_admin_user_id: ADMIN_ID,
    status: "assigned",
    application_id: APP_UUID,
    review_round: "profile_screening",
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: ADMIN_ID, role: "admin" });
  (getAdminScopeContext as Mock).mockResolvedValue({ isSuperAdmin: true, seasons: [], programs: [] });
  (canReviewSeason as Mock).mockResolvedValue(true);
  (canOperateSeason as Mock).mockResolvedValue(true);
});

// ── assignApplicationReview — DB error safety ─────────────────────────────────

describe("assignApplicationReview — DB error safety", () => {
  it("rejects a crafted withdrawn assignment before the assignment RPC", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "vam095_application_review_assignability") {
        return {
          data: [{ assignable: false, reason: "application_withdrawn" }],
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const client = makeClient([
      makeChain({ data: { ...scopeApp(), status: "withdrawn" } }),
    ], rpc);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await assignApplicationReview({
      applicationId: APP_UUID,
      reviewerAdminUserId: "reviewer-1",
      assignedByAdminUserId: ADMIN_ID,
      reviewRound: "profile_screening",
    });

    expect(result).toEqual({
      ok: false,
      message: "Hồ sơ đã rút khỏi quy trình tuyển và không thể được phân công đánh giá.",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("vam095_assign_application_review", expect.anything());
  });

  it("insert failure: raw DB message is not returned to caller", async () => {
    // Call sequence:
    // 1. from("applications") → scopeApp (canWriteReviewWorkflowForApplication)
    // 2. canonical assignability RPC → eligible
    // 3. participant-list RPC → eligible target reviewer
    // 4. atomic assignment RPC → error
    const rpc = vi.fn(async (name: string) => {
      if (name === "vam095_application_review_assignability") {
        return { data: [{ assignable: true, reason: "assignable" }], error: null };
      }
      if (name === "vam084_list_recruitment_participants") {
        return { data: [{ id: "reviewer-1", role: "reviewer" }], error: null };
      }
      if (name === "vam095_assign_application_review") {
        return { data: null, error: { code: "42501", message: SENSITIVE_MSG } };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const client = makeClient([
      makeChain({ data: scopeApp() }),
    ], rpc);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await assignApplicationReview({
      applicationId: APP_UUID,
      reviewerAdminUserId: "reviewer-1",
      assignedByAdminUserId: ADMIN_ID,
      reviewRound: "profile_screening",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain(SENSITIVE_MSG);
      expect(result.message).not.toContain("INTERNAL");
      expect(result.message).not.toContain("permission denied");
      expect(result.message.length).toBeGreaterThan(0);
    }
    expect(rpc).toHaveBeenCalledWith("vam095_assign_application_review", expect.anything());
  });
});

// ── saveApplicationReviewDraft — DB error safety ──────────────────────────────

describe("saveApplicationReviewDraft — DB error safety", () => {
  it("update failure: raw DB message is not returned to caller", async () => {
    // Call sequence:
    // 1. from("application_reviews").select → existing review (ownership check)
    // 2. from("applications").select → scopeApp (canWriteReviewWorkflowForApplication)
    // 3. atomic draft-save RPC → error
    const client = makeClient([
      makeChain({ data: existingReview() }),
      makeChain({ data: scopeApp() }),
    ], vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: SENSITIVE_MSG },
    }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await saveApplicationReviewDraft({
      reviewId: REVIEW_UUID,
      adminUserId: ADMIN_ID,
      recommendation: "approve",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain(SENSITIVE_MSG);
      expect(result.message).not.toContain("INTERNAL");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

// ── submitApplicationReview — DB error safety ─────────────────────────────────

describe("submitApplicationReview — DB error safety", () => {
  it("maps a stale submit rejected after withdrawal to the terminal message", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "APPLICATION_WITHDRAWN" },
    });
    const client = makeClient([
      makeChain({ data: existingReview() }),
      makeChain({ data: { ...scopeApp(), status: "withdrawn" } }),
    ], rpc);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await submitApplicationReview({
      reviewId: REVIEW_UUID,
      adminUserId: ADMIN_ID,
      recommendation: "reject",
    });

    expect(result).toEqual({
      ok: false,
      message: "Hồ sơ đã rút khỏi quy trình tuyển và không thể được phân công đánh giá.",
    });
  });

  it("update failure: raw DB message is not returned to caller", async () => {
    // Call sequence:
    // 1. from("application_reviews").select → existing review (ownership + status check)
    // 2. from("applications").select → scopeApp (canWriteReviewWorkflowForApplication)
    // 3. from("application_reviews").update → error (direct await)
    const client = makeClient([
      makeChain({ data: existingReview() }),
      makeChain({ data: scopeApp() }),
    ], vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: SENSITIVE_MSG } }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await submitApplicationReview({
      reviewId: REVIEW_UUID,
      adminUserId: ADMIN_ID,
      recommendation: "approve",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain(SENSITIVE_MSG);
      expect(result.message).not.toContain("INTERNAL");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

describe("terminal cancellation correction", () => {
  it("cancels synthetic active work on withdrawn, audits it, keeps withdrawn, and clears My Work", async () => {
    const state = {
      application: { id: APP_UUID, status: "withdrawn", full_name: "Synthetic Applicant" },
      review: {
        ...existingReview(),
        review_round: "profile_screening",
        status: "assigned",
        due_at: null,
      },
      events: [] as Array<Record<string, unknown>>,
    };
    const rpc = vi.fn(async (name: string, params?: Record<string, unknown>) => {
      expect(name).toBe("vam084_change_review_assignment");
      expect(params?.p_new_reviewer).toBeNull();
      expect(params?.p_actor).toBe(ADMIN_ID);
      state.review.status = "cancelled";
      state.events.push({
        event_type: "cancelled",
        previous_review_id: REVIEW_UUID,
        actor_admin_user_id: ADMIN_ID,
      });
      return { data: REVIEW_UUID, error: null };
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([], rpc));

    const result = await cancelApplicationReview({
      reviewId: REVIEW_UUID,
      adminUserId: ADMIN_ID,
      reason: "Clean legacy assignment on withdrawn application",
    });

    expect(result).toEqual({ ok: true, id: REVIEW_UUID });
    expect(state.application.status).toBe("withdrawn");
    expect(state.review.status).toBe("cancelled");
    expect(state.events).toEqual([expect.objectContaining({
      event_type: "cancelled",
      previous_review_id: REVIEW_UUID,
      actor_admin_user_id: ADMIN_ID,
    })]);
    expect(buildMyWorkItems({
      reviews: [state.review],
      applications: new Map([[APP_UUID, state.application]]),
      assigneeAdminUserId: ADMIN_ID,
      now: new Date("2026-09-05T00:00:00Z"),
    })).toEqual([]);
  });
});
