import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn(),
  getApplicationReviewById: vi.fn(),
  getApplication: vi.fn(),
  getPerson: vi.fn(),
  getSeasons: vi.fn(),
  getReviewEligibleReviewers: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: mocks.getAdminScopeContext,
  getScopeFilter: mocks.getScopeFilter
}));
vi.mock("@/lib/data", () => ({
  getApplicationReviewById: mocks.getApplicationReviewById,
  getApplication: mocks.getApplication,
  getPerson: mocks.getPerson,
  getSeasons: mocks.getSeasons,
  getReviewEligibleReviewers: mocks.getReviewEligibleReviewers,
  keyById: (rows: Array<{ id: string }>) => new Map(rows.map((row) => [row.id, row]))
}));
vi.mock("@/app/reviews/[id]/review-form", () => ({
  ReviewForm: () => React.createElement("div", null, "ACTIVE_REVIEW_FORM")
}));
vi.mock("@/app/reviews/[id]/review-operations", () => ({
  ReviewOperations: () => React.createElement("div", null, "ACTIVE_REVIEW_OPERATIONS")
}));

import ReviewDetailPage from "@/app/reviews/[id]/page";

const baseReview = {
  id: "review-old",
  application_id: "app-1",
  reviewer_admin_user_id: "reviewer-a",
  review_round: "interview",
  status: "cancelled",
  due_at: null,
  submitted_at: null,
  total_score: null,
  recommendation: null,
  score_motivation: 4,
  score_goal_clarity: null,
  score_commitment: null,
  score_fit: null,
  score_communication: null,
  reviewer_note: "historical note"
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "reviewer-a", role: "reviewer" });
  mocks.getAdminScopeContext.mockResolvedValue({ isSuperAdmin: false });
  mocks.getScopeFilter.mockResolvedValue(undefined);
  mocks.getApplicationReviewById.mockResolvedValue({ data: baseReview, error: null });
  mocks.getApplication.mockResolvedValue({
    data: {
      id: "app-1",
      full_name: "Candidate One",
      email_primary: "candidate@example.test",
      phone_primary: "0900000000",
      gender: null,
      status: "interview_in_progress",
      final_status: null,
      role_applied: "mentee",
      season_id: "season-1",
      person_id: null,
      raw_payload: {},
      submitted_at: "2026-08-28T00:00:00.000Z"
    },
    error: null
  });
  mocks.getPerson.mockResolvedValue({ data: null, error: null });
  mocks.getSeasons.mockResolvedValue({ data: [{ id: "season-1", code: "S12" }], error: null });
  mocks.getReviewEligibleReviewers.mockResolvedValue({ data: [], error: null });
});

describe("M2.1 cancelled direct review URL", () => {
  it("keeps historical content viewable but renders no Save/Submit or operator controls", async () => {
    const html = renderToStaticMarkup(
      await ReviewDetailPage({ params: Promise.resolve({ id: "review-old" }) })
    );
    expect(html).toContain("Candidate One");
    expect(html).toContain("Đã huỷ");
    expect(html).not.toContain("ACTIVE_REVIEW_FORM");
    expect(html).not.toContain("ACTIVE_REVIEW_OPERATIONS");
    expect(html).toContain("Bạn không có quyền chỉnh sửa review này.");
  });

  it("still renders the active form for the owner of an assigned review", async () => {
    mocks.getApplicationReviewById.mockResolvedValue({
      data: { ...baseReview, status: "assigned" },
      error: null
    });
    const html = renderToStaticMarkup(
      await ReviewDetailPage({ params: Promise.resolve({ id: "review-active" }) })
    );
    expect(html).toContain("ACTIVE_REVIEW_FORM");
  });
});
