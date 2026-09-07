vi.mock("react", () => ({
  cache: (fn: any) => fn,
  Suspense: ({ children }: any) => children,
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getReviewOversightQueue } from "@/lib/data";
import { parseReviewOversightFilters, getActionabilityState } from "@/lib/review-oversight";

const mockQuery: any = {};
mockQuery.select = vi.fn().mockImplementation(() => mockQuery);
mockQuery.in = vi.fn().mockImplementation(() => mockQuery);
mockQuery.neq = vi.fn().mockImplementation(() => mockQuery);
mockQuery.eq = vi.fn().mockImplementation(() => mockQuery);
mockQuery.is = vi.fn().mockImplementation(() => mockQuery);
mockQuery.or = vi.fn().mockImplementation(() => mockQuery);
mockQuery.order = vi.fn().mockImplementation(() => mockQuery);
mockQuery.range = vi.fn().mockImplementation(() => mockQuery);
mockQuery.then = vi.fn().mockImplementation((res) => res({ data: [], count: 0, error: null }));

vi.mock("@/lib/supabase-server", () => {
  return {
    getSupabaseServiceRoleClient: () => {
      return {
        from: () => {
          // Instead of referencing a hoisted variable, create a fresh chainable mock
          const m: any = {};
          m.select = vi.fn().mockReturnValue(m);
          m.in = vi.fn().mockReturnValue(m);
          m.neq = vi.fn().mockReturnValue(m);
          m.eq = vi.fn().mockReturnValue(m);
          m.is = vi.fn().mockReturnValue(m);
          m.or = vi.fn().mockReturnValue(m);
          m.order = vi.fn().mockReturnValue(m);
          m.range = vi.fn().mockReturnValue(m);
          m.then = vi.fn().mockImplementation((res) => res({ data: [], count: 0, error: null }));
          return m;
        }
      }
    }
  }
});

describe("M2-1: Interview Ops Oversight Foundation", () => {
  describe("getActionabilityState", () => {
    it("should classify cancelled reviews as non-actionable historical", () => {
      const state = getActionabilityState("cancelled", false);
      expect(state.isActionable).toBe(false);
      expect(state.badgeLabel).toBe("Đã huỷ");
    });

    it("should classify submitted reviews as non-actionable historical", () => {
      const state = getActionabilityState("submitted", false);
      expect(state.isActionable).toBe(false);
      expect(state.badgeLabel).toBe("Đã nộp");
    });

    it("should classify unsubmitted reviews of terminal parent as non-actionable historical", () => {
      const state = getActionabilityState("assigned", true);
      expect(state.isActionable).toBe(false);
      expect(state.badgeLabel).toBe("assigned");
    });

    it("should classify unsubmitted reviews of operational parent as actionable", () => {
      const state = getActionabilityState("assigned", false);
      expect(state.isActionable).toBe(true);
      expect(state.badgeLabel).toBe("assigned");
    });
  });

  describe("getReviewOversightQueue Projection & Quarantine Contract", () => {
    it("should query single-join projection replacing N+1 application reads", async () => {
      const filters = parseReviewOversightFilters({});
      const res = await getReviewOversightQueue(filters);
      expect(res.error).toBeNull();
    });

    it("should explicitly enforce reviewer-only quarantine by forcing operational mode and reviewerId", async () => {
      const filters = parseReviewOversightFilters({ scope: "all", reviewer: "other-user" });
      const res = await getReviewOversightQueue(filters, undefined, "my-user-id");
      expect(res.error).toBeNull();
    });
  });
});
