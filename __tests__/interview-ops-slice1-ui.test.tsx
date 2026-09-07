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
import ReviewProgressPage from "@/app/reviews/progress/page";

const SEASON = "11111111-1111-4111-8111-111111111111";
const BATCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REVIEWER_NAMED = "33333333-3333-4333-8333-333333333333";
const REVIEWER_EMAIL_ONLY = "44444444-4444-4444-8444-444444444444";

function reviewRow(overrides: Record<string, any> = {}) {
  return {
    id: "rev-1",
    application_id: "app-1",
    reviewer_admin_user_id: REVIEWER_NAMED,
    review_round: "profile_screening",
    status: "assigned",
    due_at: null,
    submitted_at: null,
    total_score: null,
    recommendation: null,
    application: {
      id: "app-1",
      full_name: "Ứng viên Một",
      person_id: null,
      season_id: SEASON,
      intake_batch_id: BATCH,
      role_applied: "mentee",
      status: "screening_assigned",
      final_status: null
    },
    reviewer: { id: REVIEWER_NAMED, full_name: "Chiến Nguyễn", email: "chien@vam.test" },
    ...overrides
  };
}

function queue(rows: any[], overrides: Record<string, any> = {}) {
  return {
    data: {
      rows,
      totalCount: rows.length,
      page: 1,
      pageSize: 50,
      totalPages: rows.length ? 1 : 0,
      ...overrides
    },
    error: null
  };
}

function statsRow(overrides: Record<string, any> = {}) {
  return {
    reviewer_admin_user_id: REVIEWER_NAMED,
    reviewer_full_name: "Chiến Nguyễn",
    reviewer_email: "chien@vam.test",
    current_total: 12,
    submitted_count: 5,
    in_progress_count: 3,
    pending_count: 3,
    returned_count: 1,
    cancelled_count: 4,
    latest_submitted_at: "2026-09-05T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "admin-1", role: "core_team" });
  mocks.getAdminScopeContext.mockResolvedValue({ isSuperAdmin: true, scopeError: null });
  mocks.getScopeFilter.mockResolvedValue(undefined);
  mocks.getSeasons.mockResolvedValue({
    data: [{ id: SEASON, code: "S12", name: "Season 12" }],
    error: null
  });
  mocks.getIntakeBatches.mockResolvedValue({
    data: [{ id: BATCH, code: "B1", name: "Đợt 1", season_id: SEASON }],
    error: null
  });
  mocks.getReviewOversightQueue.mockResolvedValue(queue([reviewRow()]));
  mocks.getReviewOversightAggregate.mockResolvedValue({ data: [statsRow()], error: null });
});

// ---------------------------------------------------------------------------
// /reviews
// ---------------------------------------------------------------------------

describe("/reviews oversight list", () => {
  it("passes an oversight actor and the parsed filters to the query", async () => {
    await ReviewsPage({
      searchParams: Promise.resolve({
        season_id: SEASON,
        intake_batch_id: BATCH,
        role_applied: "mentor",
        review_round: "interview",
        reviewer: REVIEWER_EMAIL_ONLY,
        review_status: "submitted",
        scope: "all",
        page: "2"
      })
    });

    const call = mocks.getReviewOversightQueue.mock.calls[0][0];
    expect(call.actor).toEqual({ kind: "oversight", adminUserId: "admin-1" });
    expect(call.filters).toEqual({
      seasonId: SEASON,
      intakeBatchId: BATCH,
      roleApplied: "mentor",
      reviewRound: "interview",
      reviewerId: REVIEWER_EMAIL_ONLY,
      reviewStatus: "submitted",
      scopeMode: "all",
      page: 2
    });
  });

  it("defaults to every round and to the operational scope", async () => {
    await ReviewsPage({ searchParams: Promise.resolve({}) });
    const call = mocks.getReviewOversightQueue.mock.calls[0][0];
    expect(call.filters.reviewRound).toBeNull();
    expect(call.filters.scopeMode).toBe("operational");
  });

  it("pins a reviewer-only account to itself regardless of URL parameters", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "reviewer-a", role: "reviewer" });
    await ReviewsPage({
      searchParams: Promise.resolve({ reviewer: REVIEWER_EMAIL_ONLY, scope: "all" })
    });
    const call = mocks.getReviewOversightQueue.mock.calls[0][0];
    expect(call.actor).toEqual({ kind: "reviewer", adminUserId: "reviewer-a" });
    // The aggregate powers the reviewer dropdown, which a reviewer must not get.
    expect(mocks.getReviewOversightAggregate).not.toHaveBeenCalled();
  });

  it("renders the interviewer column, the filter bar and the history toggle", async () => {
    const html = renderToStaticMarkup(await ReviewsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Reviewer / Interviewer");
    expect(html).toContain('data-testid="review-filters"');
    expect(html).toContain('name="season_id"');
    expect(html).toContain('name="intake_batch_id"');
    expect(html).toContain('name="role_applied"');
    expect(html).toContain('name="review_round"');
    expect(html).toContain('name="reviewer"');
    expect(html).toContain('name="review_status"');
    expect(html).toContain('data-testid="history-toggle"');
    expect(html).toContain("Chiến Nguyễn");
  });

  it("hides the reviewer selector and history toggle from a reviewer-only account", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "reviewer-a", role: "reviewer" });
    const html = renderToStaticMarkup(await ReviewsPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('name="reviewer"');
    expect(html).not.toContain('data-testid="history-toggle"');
  });

  it("shows an email-only reviewer by email, never as (Chưa gán)", async () => {
    mocks.getReviewOversightQueue.mockResolvedValue(
      queue([
        reviewRow({
          reviewer_admin_user_id: REVIEWER_EMAIL_ONLY,
          reviewer: { id: REVIEWER_EMAIL_ONLY, full_name: null, email: "no-name@vam.test" }
        })
      ])
    );
    const html = renderToStaticMarkup(await ReviewsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("no-name@vam.test");
    expect(html).not.toContain("Chưa gán");
  });

  it("renders an unassigned row as (Chưa gán)", async () => {
    mocks.getReviewOversightQueue.mockResolvedValue(
      queue([reviewRow({ reviewer_admin_user_id: null, reviewer: null })])
    );
    const html = renderToStaticMarkup(await ReviewsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Chưa gán");
  });

  it("renders a cancelled assignment as read-only history, never actionable", async () => {
    mocks.getReviewOversightQueue.mockResolvedValue(
      queue([reviewRow({ id: "rev-cancelled", status: "cancelled" })])
    );
    const html = renderToStaticMarkup(
      await ReviewsPage({ searchParams: Promise.resolve({ scope: "all" }) })
    );
    expect(html).toContain("Đã huỷ");
    expect(html).toContain("Xem");
    expect(html).not.toContain("Làm review");
    expect(html).toContain('data-testid="history-notice"');
  });

  it("freezes a live assignment whose parent left recruitment, and says why", async () => {
    mocks.getReviewOversightQueue.mockResolvedValue(
      queue([
        reviewRow({
          status: "assigned",
          application: { ...reviewRow().application, status: "withdrawn" }
        })
      ])
    );
    const html = renderToStaticMarkup(
      await ReviewsPage({ searchParams: Promise.resolve({ scope: "all" }) })
    );
    expect(html).toContain("Hồ sơ đã kết thúc quy trình");
    expect(html).not.toContain("Làm review");
  });

  it("reports the filtered total and pages with every filter preserved", async () => {
    mocks.getReviewOversightQueue.mockResolvedValue(
      queue([reviewRow()], { totalCount: 123, page: 2, totalPages: 3 })
    );
    const html = renderToStaticMarkup(
      await ReviewsPage({
        searchParams: Promise.resolve({
          intake_batch_id: BATCH,
          role_applied: "mentee",
          review_round: "profile_screening",
          page: "2"
        })
      })
    );
    expect(html).toContain("123");
    expect(html).toContain('data-testid="oversight-pagination"');
    // Both neighbours carry the whole filter context.
    for (const page of ["1", "3"]) {
      const href = page === "1" ? "/reviews?" : "/reviews?";
      expect(html).toContain(href);
    }
    expect(html).toContain("intake_batch_id=" + BATCH);
    expect(html).toContain("role_applied=mentee");
    expect(html).toContain("review_round=profile_screening");
    expect(html).toContain("page=3");
  });
});

// ---------------------------------------------------------------------------
// /reviews/progress
// ---------------------------------------------------------------------------

describe("/reviews/progress", () => {
  it("keeps profile_screening as its round default and honours every filter", async () => {
    await ReviewProgressPage({
      searchParams: Promise.resolve({ season_id: SEASON, intake_batch_id: BATCH, role_applied: "mentee" })
    });
    const call = mocks.getReviewOversightAggregate.mock.calls[0][0];
    expect(call.filters.reviewRound).toBe("profile_screening");
    expect(call.filters.seasonId).toBe(SEASON);
    expect(call.filters.intakeBatchId).toBe(BATCH);
    expect(call.filters.roleApplied).toBe("mentee");
    expect(call.actor).toEqual({ kind: "oversight", adminUserId: "admin-1" });
  });

  it("offers season, batch, role and round filters", async () => {
    const html = renderToStaticMarkup(
      await ReviewProgressPage({ searchParams: Promise.resolve({}) })
    );
    expect(html).toContain('data-testid="progress-filters"');
    expect(html).toContain('name="season_id"');
    expect(html).toContain('name="intake_batch_id"');
    expect(html).toContain('name="role_applied"');
    expect(html).toContain('name="review_round"');
  });

  it("makes every count cell a drill-down that carries the whole filter context", async () => {
    const html = renderToStaticMarkup(
      await ReviewProgressPage({
        searchParams: Promise.resolve({
          season_id: SEASON,
          intake_batch_id: BATCH,
          role_applied: "mentee"
        })
      })
    );

    const hrefs = Array.from(html.matchAll(/href="([^"]*\/reviews\?[^"]*)"/g)).map((match) =>
      match[1].replace(/&amp;/g, "&")
    );
    const drilldowns = hrefs.filter((href) => href.includes(`reviewer=${REVIEWER_NAMED}`));
    expect(drilldowns.length).toBeGreaterThanOrEqual(6);

    for (const href of drilldowns) {
      expect(href).toContain(`season_id=${SEASON}`);
      expect(href).toContain(`intake_batch_id=${BATCH}`);
      expect(href).toContain("role_applied=mentee");
      expect(href).toContain("review_round=profile_screening");
      // Never the legacy short key — `review_round` is the only round parameter.
      expect(/[?&]round=/.test(href)).toBe(false);
    }

    // Current workload and each live bucket drill into the operational scope.
    expect(drilldowns.some((href) => !href.includes("review_status") && !href.includes("scope=all"))).toBe(true);
    expect(drilldowns.some((href) => href.includes("review_status=submitted"))).toBe(true);
    expect(drilldowns.some((href) => href.includes("review_status=in_progress"))).toBe(true);
    expect(drilldowns.some((href) => href.includes("review_status=assigned"))).toBe(true);
    expect(drilldowns.some((href) => href.includes("review_status=returned_for_clarification"))).toBe(true);
    // Cancelled is history, so its cell is the only one that switches scope.
    const cancelled = drilldowns.find((href) => href.includes("review_status=cancelled"));
    expect(cancelled).toBeTruthy();
    expect(cancelled).toContain("scope=all");
  });

  it("labels current workload separately from cancelled history", async () => {
    const html = renderToStaticMarkup(
      await ReviewProgressPage({ searchParams: Promise.resolve({}) })
    );
    expect(html).toContain("Đang phụ trách");
    expect(html).toContain("Đã huỷ");
    expect(html).toContain('data-testid="totals-current"');
    // 12 current, 4 cancelled — the cancelled rows are not inside the workload.
    expect(html).toContain(">12<");
    expect(html).toContain(">4<");
  });

  it("links an email-only reviewer by email and does not link an unassigned bucket", async () => {
    mocks.getReviewOversightAggregate.mockResolvedValue({
      data: [
        statsRow({
          reviewer_admin_user_id: REVIEWER_EMAIL_ONLY,
          reviewer_full_name: null,
          reviewer_email: "no-name@vam.test"
        }),
        statsRow({
          reviewer_admin_user_id: null,
          reviewer_full_name: null,
          reviewer_email: null,
          current_total: 2,
          submitted_count: 0,
          in_progress_count: 0,
          pending_count: 2,
          returned_count: 0,
          cancelled_count: 0
        })
      ],
      error: null
    });
    const html = renderToStaticMarkup(
      await ReviewProgressPage({ searchParams: Promise.resolve({}) })
    );
    expect(html).toContain("no-name@vam.test");
    expect(html).toContain("(Chưa gán)");
    expect(html).toContain('data-testid="progress-reviewer-link"');
  });

  it("sends a reviewer without oversight rights back to /reviews", async () => {
    const { redirect } = await import("next/navigation");
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "reviewer-a", role: "reviewer" });
    await ReviewProgressPage({ searchParams: Promise.resolve({}) }).catch(() => undefined);
    expect(redirect).toHaveBeenCalledWith("/reviews");
  });
});
