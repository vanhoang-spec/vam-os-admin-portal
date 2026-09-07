import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn(),
  getAllApplicationReviews: vi.fn(),
  getApplication: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: mocks.getAdminScopeContext,
  getScopeFilter: mocks.getScopeFilter
}));
vi.mock("@/lib/data", () => ({
  getAllApplicationReviews: mocks.getAllApplicationReviews,
  getApplication: mocks.getApplication
}));

import ReviewsPage from "@/app/reviews/page";

const baseReview = {
  id: "review-cancelled",
  application_id: "app-1",
  reviewer_admin_user_id: "reviewer-a",
  review_round: "interview",
  status: "cancelled",
  due_at: null,
  submitted_at: null,
  total_score: null,
  recommendation: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.getAdminScopeContext.mockResolvedValue({ isSuperAdmin: true });
  mocks.getScopeFilter.mockResolvedValue(undefined);
  mocks.getAllApplicationReviews.mockResolvedValue({ data: [baseReview], error: null });
  mocks.getApplication.mockResolvedValue({
    data: {
      id: "app-1",
      full_name: "Candidate One",
      status: "interview_in_progress",
    },
    error: null
  });
});

describe("M2.1 cancelled review in queue", () => {
  it("renders a read-only historical row for admin oversight", async () => {
    const html = renderToStaticMarkup(await ReviewsPage());
    expect(html).toContain("Candidate One");
    expect(html).toContain("Đã huỷ");
    expect(html).toContain("Xem");
    expect(html).not.toContain("Làm review");
  });
});
