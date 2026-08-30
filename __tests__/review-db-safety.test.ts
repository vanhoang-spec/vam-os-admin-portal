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
  saveApplicationReviewDraft,
  submitApplicationReview,
} from "@/lib/application-reviews";

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

function makeClient(fromResponses: unknown[], rpc?: (name: string) => Promise<unknown>) {
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
  it("insert failure: raw DB message is not returned to caller", async () => {
    // Call sequence:
    // 1. from("applications") → scopeApp (canWriteReviewWorkflowForApplication)
    // 2. from("admin_users") → eligible target reviewer
    // 3. from("application_reviews") → no duplicate
    // 4. from("application_reviews").insert → error
    const client = makeClient([
      makeChain({ data: scopeApp() }),
      makeChain({ data: [] }),
      makeChain({ data: null, error: { code: "42501", message: SENSITIVE_MSG } }),
    ], vi.fn().mockResolvedValue({ data: [{ id: "reviewer-1", role: "reviewer" }], error: null }));
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
  });
});

// ── saveApplicationReviewDraft — DB error safety ──────────────────────────────

describe("saveApplicationReviewDraft — DB error safety", () => {
  it("update failure: raw DB message is not returned to caller", async () => {
    // Call sequence:
    // 1. from("application_reviews").select → existing review (ownership check)
    // 2. from("applications").select → scopeApp (canWriteReviewWorkflowForApplication)
    // 3. from("application_reviews").update → error (direct await)
    const client = makeClient([
      makeChain({ data: existingReview() }),
      makeChain({ data: scopeApp() }),
      makeChain({ error: { code: "42501", message: SENSITIVE_MSG } }),
    ]);
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
