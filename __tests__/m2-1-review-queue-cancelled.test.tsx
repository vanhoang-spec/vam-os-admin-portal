import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn(),
  getReviewOversightQueue: vi.fn(),
  getReviewOversightAggregate: vi.fn(),
  getSeasons: vi.fn(),
  getIntakeBatches: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: mocks.getAdminScopeContext,
  getScopeFilter: mocks.getScopeFilter
}));
vi.mock("@/lib/data", () => ({
  getReviewOversightQueue: mocks.getReviewOversightQueue,
  getReviewOversightAggregate: mocks.getReviewOversightAggregate,
  getSeasons: mocks.getSeasons,
  getIntakeBatches: mocks.getIntakeBatches
}));

import ReviewsPage from "@/app/reviews/page";

/**
 * A cancelled assignment under a still-operational parent — what every
 * reassignment leaves behind. It must be reachable for audit and must never
 * offer the operator work to do.
 */
const cancelledRow = {
  id: "review-cancelled",
  application_id: "app-1",
  reviewer_admin_user_id: "reviewer-a",
  review_round: "interview",
  status: "cancelled",
  due_at: null,
  submitted_at: null,
  total_score: null,
  recommendation: null,
  application: {
    id: "app-1",
    full_name: "Candidate One",
    person_id: null,
    season_id: "season-1",
    intake_batch_id: "batch-1",
    role_applied: "mentee",
    status: "interview_in_progress",
    final_status: null
  },
  reviewer: { id: "reviewer-a", full_name: "Reviewer A", email: "a@vam.test" }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.getAdminScopeContext.mockResolvedValue({ isSuperAdmin: true, scopeError: null });
  mocks.getScopeFilter.mockResolvedValue(undefined);
  mocks.getSeasons.mockResolvedValue({ data: [], error: null });
  mocks.getIntakeBatches.mockResolvedValue({ data: [], error: null });
  mocks.getReviewOversightAggregate.mockResolvedValue({ data: [], error: null });
  mocks.getReviewOversightQueue.mockResolvedValue({
    data: { rows: [cancelledRow], totalCount: 1, page: 1, pageSize: 50, totalPages: 1 },
    error: null
  });
});

describe("M2.1 cancelled review in queue", () => {
  it("renders a read-only historical row for admin oversight", async () => {
    const html = renderToStaticMarkup(
      await ReviewsPage({ searchParams: Promise.resolve({ scope: "all" }) })
    );
    expect(html).toContain("Candidate One");
    expect(html).toContain("Đã huỷ");
    expect(html).toContain("Xem");
    expect(html).not.toContain("Làm review");
  });

  it("asks the query for history rather than filtering a cancelled row out in the page", async () => {
    await ReviewsPage({ searchParams: Promise.resolve({ scope: "all" }) });
    const call = mocks.getReviewOversightQueue.mock.calls[0][0];
    expect(call.filters.scopeMode).toBe("all");
  });

  it("keeps cancelled assignments out of the default operational view", async () => {
    await ReviewsPage({ searchParams: Promise.resolve({}) });
    const call = mocks.getReviewOversightQueue.mock.calls[0][0];
    expect(call.filters.scopeMode).toBe("operational");
  });
});
