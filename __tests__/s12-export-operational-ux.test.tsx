/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scope: "test" })),
  canOperateSeason: vi.fn(async () => true),
  getScopeFilter: vi.fn(async () => ({ scope: "test" }))
}));

import { ResultsExportPanel, ScoresExportPanel } from "@/app/applications/exports/export-panels";
import { GET as resultsGet } from "@/app/api/exports/recruitment-results/route";
import {
  classifyOperational,
  deriveDecisions,
  matchesOperationalGroup
} from "@/lib/recruitment-export";
import { getSeasonReviewerOptions } from "@/lib/review-reviewer-options";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createFakeDb, fakeClient, requestsFor } from "./support/fake-postgrest";

const SEASON = "11111111-1111-4111-8111-111111111111";
const OTHER_SEASON = "22222222-2222-4222-8222-222222222222";
const BATCH = "33333333-3333-4333-8333-333333333333";
const REVIEWER_A = "55555555-5555-4555-8555-555555555555";
const REVIEWER_B = "66666666-6666-4666-8666-666666666666";

const db = createFakeDb();

function uuid(n: number) {
  return `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// Auto-cleanup is not enabled repo-wide (vitest globals are off), so rendered
// trees would otherwise accumulate across cases in this file and turn every
// getByLabelText into a multiple-match error.
afterEach(() => cleanup());

beforeEach(() => {
  db.reset();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "admin" } as never);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
  db.tables.intake_batches = [{ id: BATCH, season_id: SEASON }];
  db.tables.applications = [];
  db.tables.application_reviews = [];
  db.tables.application_decisions = [];
});

// ── Evidence safety: audit stays exact, operational stays separate ───────────

describe("audit evidence is never fabricated", () => {
  it("keeps audit fields blank while still classifying an approved applicant operationally", () => {
    // The real Staging shape: finally approved, but the screening and
    // interview audit rows were never written by the older/UAT flow.
    const derived = deriveDecisions([]);
    const operational = classifyOperational("approved_as_mentor", derived);

    expect(derived.screening).toBeNull();
    expect(derived.interview).toBeNull();
    expect(derived.final).toBeNull();

    expect(operational.passedScreening).toBe(true);
    expect(operational.passedInterview).toBe(true);
    expect(operational.officiallyApproved).toBe(true);
    expect(operational.basis).toBe("current_status");
  });

  it("reports audit+current_status when both agree", () => {
    const derived = deriveDecisions([
      { new_status: "screening_passed", created_at: "2026-08-02T00:00:00Z" },
      { new_status: "interview_passed", created_at: "2026-08-04T00:00:00Z" },
      { new_status: "approved_as_mentor", created_at: "2026-08-05T00:00:00Z" }
    ]);
    expect(classifyOperational("approved_as_mentor", derived).basis).toBe("audit+current_status");
  });

  it("reports audit-only when the trail proves more than the current status does", () => {
    // Screening was passed and recorded, then the applicant was rejected at
    // interview. Current status alone would not prove screening was passed.
    const derived = deriveDecisions([
      { new_status: "screening_passed", created_at: "2026-08-02T00:00:00Z" },
      { new_status: "rejected_or_not_fit", created_at: "2026-08-09T00:00:00Z" }
    ]);
    const operational = classifyOperational("rejected_or_not_fit", derived);
    expect(operational.passedScreening).toBe(true);
    expect(operational.rejected).toBe(true);
    expect(operational.basis).toBe("audit+current_status");
  });

  it("leaves everything blank for an application with no outcome at all", () => {
    const operational = classifyOperational("submitted", deriveDecisions([]));
    expect(operational).toMatchObject({
      passedScreening: false,
      passedInterview: false,
      officiallyApproved: false,
      rejected: false,
      needsMoreReview: false,
      basis: ""
    });
  });
});

describe("operational classification only infers what the lifecycle proves", () => {
  it.each([
    "screening_passed",
    "invited_to_interview",
    "interview_scheduled",
    "interview_in_progress",
    "interview_completed",
    "ready_for_final_decision",
    "interview_passed",
    "approved_as_mentor",
    "approved_as_mentee"
  ])("%s proves screening was passed", (status) => {
    expect(classifyOperational(status, deriveDecisions([])).passedScreening).toBe(true);
  });

  it.each(["interview_passed", "approved_as_mentor", "approved_as_mentee"])(
    "%s proves the interview was passed",
    (status) => {
      expect(classifyOperational(status, deriveDecisions([])).passedInterview).toBe(true);
    }
  );

  it("does NOT treat ready_for_final_decision as having passed the interview", () => {
    // It means the interview reviews are in, not that the pass decision was made.
    const operational = classifyOperational("ready_for_final_decision", deriveDecisions([]));
    expect(operational.passedScreening).toBe(true);
    expect(operational.passedInterview).toBe(false);
  });

  it.each(["needs_more_review", "invited_to_meeting", "invited_to_orientation", "waitlisted"])(
    "%s proves nothing about screening on its own",
    (status) => {
      // needs_more_review appears in BOTH recompute guards; the two invite
      // statuses are set by no code path in the repository at all.
      expect(classifyOperational(status, deriveDecisions([])).passedScreening).toBe(false);
    }
  );

  it("maps each operational group to its classification", () => {
    const approved = classifyOperational("approved_as_mentee", deriveDecisions([]));
    expect(matchesOperationalGroup("approved", approved)).toBe(true);
    expect(matchesOperationalGroup("passed_screening", approved)).toBe(true);
    expect(matchesOperationalGroup("rejected", approved)).toBe(false);

    const more = classifyOperational("needs_more_review", deriveDecisions([]));
    expect(matchesOperationalGroup("needs_more_review", more)).toBe(true);
    expect(matchesOperationalGroup("passed_screening", more)).toBe(false);
  });
});

// ── Results route: the two evidence families coexist ─────────────────────────

describe("results export — audit and operational columns coexist", () => {
  function parseCsv(text: string) {
    return text.split("\n").map((line) => line.split('","').map((cell) => cell.replace(/^"|"$/g, "")));
  }

  it("emits blank audit columns and positive operational columns on the same row", async () => {
    db.tables.applications = [
      {
        id: uuid(1),
        sbd: "SBD-1",
        full_name: "Nguyễn Văn A",
        email_primary: "a@example.com",
        role_applied: "mentor",
        season_id: SEASON,
        intake_batch_id: BATCH,
        status: "approved_as_mentor",
        submitted_at: "2026-08-01T00:00:00Z"
      }
    ];
    const rows = parseCsv(await (await resultsGet(new Request(`https://t/x?season_id=${SEASON}`))).text());
    const header = rows[0];
    const row = rows[1];

    expect(header).toEqual(
      expect.arrayContaining([
        "Kết quả sơ loại",
        "Đã qua vòng hồ sơ (hiện tại)",
        "Đã qua vòng phỏng vấn (hiện tại)",
        "Đã duyệt chính thức",
        "Cơ sở phân loại"
      ])
    );
    // Audit columns blank — not backfilled.
    expect(row[header.indexOf("Kết quả sơ loại")]).toBe("");
    expect(row[header.indexOf("Kết quả phỏng vấn")]).toBe("");
    // Operational columns positive, and labelled as status-derived.
    expect(row[header.indexOf("Đã qua vòng hồ sơ (hiện tại)")]).toBe("có");
    expect(row[header.indexOf("Đã qua vòng phỏng vấn (hiện tại)")]).toBe("có");
    expect(row[header.indexOf("Đã duyệt chính thức")]).toBe("có");
    expect(row[header.indexOf("Cơ sở phân loại")]).toBe("current_status");
  });

  it("filters by operational group where the audit filter would miss the row", async () => {
    db.tables.applications = [
      { id: uuid(1), role_applied: "mentor", season_id: SEASON, intake_batch_id: BATCH, status: "approved_as_mentor" },
      { id: uuid(2), role_applied: "mentor", season_id: SEASON, intake_batch_id: BATCH, status: "submitted" }
    ];
    const viaGroup = parseCsv(
      await (await resultsGet(new Request(`https://t/x?season_id=${SEASON}&operational_group=passed_screening`))).text()
    );
    expect(viaGroup).toHaveLength(2);
    expect(viaGroup[1][0]).toBe(uuid(1));

    // The audit-only filter correctly returns nothing: there is no audit row.
    const viaAudit = parseCsv(
      await (await resultsGet(new Request(`https://t/x?season_id=${SEASON}&screening_decision=passed`))).text()
    );
    expect(viaAudit).toHaveLength(1);
  });

  it("rejects an out-of-domain operational_group rather than widening", async () => {
    const res = await resultsGet(new Request(`https://t/x?season_id=${SEASON}&operational_group=passed`));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("operational_group");
  });
});

// ── Reviewer options ────────────────────────────────────────────────────────

describe("reviewer options for the scores filter", () => {
  it("comes from reviews that exist in the season, including non-pool accounts", async () => {
    db.tables.application_reviews = [
      {
        id: uuid(1),
        reviewer_admin_user_id: REVIEWER_A,
        reviewer: { id: REVIEWER_A, email: "rev.a@example.com", full_name: "Reviewer A" },
        application: { season_id: SEASON }
      },
      {
        id: uuid(2),
        reviewer_admin_user_id: REVIEWER_A,
        reviewer: { id: REVIEWER_A, email: "rev.a@example.com", full_name: "Reviewer A" },
        application: { season_id: SEASON }
      },
      {
        // An admin account that screened historically — never in the reviewer pool.
        id: uuid(3),
        reviewer_admin_user_id: REVIEWER_B,
        reviewer: { id: REVIEWER_B, email: "core@example.com", full_name: "Core Team" },
        application: { season_id: SEASON }
      }
    ];
    const { data, error } = await getSeasonReviewerOptions(SEASON);
    expect(error).toBeNull();
    expect(data.map((o) => o.adminUserId).sort()).toEqual([REVIEWER_A, REVIEWER_B].sort());
    expect(data.find((o) => o.adminUserId === REVIEWER_A)?.reviewCount).toBe(2);
    expect(data.find((o) => o.adminUserId === REVIEWER_B)?.fullName).toBe("Core Team");
  });

  it("is scoped to the requested season", async () => {
    db.tables.application_reviews = [
      {
        id: uuid(1),
        reviewer_admin_user_id: REVIEWER_A,
        reviewer: { id: REVIEWER_A, email: "a@x", full_name: "A" },
        application: { season_id: SEASON }
      },
      {
        id: uuid(2),
        reviewer_admin_user_id: REVIEWER_B,
        reviewer: { id: REVIEWER_B, email: "b@x", full_name: "B" },
        application: { season_id: OTHER_SEASON }
      }
    ];
    const { data } = await getSeasonReviewerOptions(SEASON);
    expect(data.map((o) => o.adminUserId)).toEqual([REVIEWER_A]);
  });

  it("pages to exhaustion with the season filter on every page", async () => {
    db.tables.application_reviews = Array.from({ length: 2500 }, (_, i) => ({
      id: uuid(i + 1),
      reviewer_admin_user_id: i % 2 === 0 ? REVIEWER_A : REVIEWER_B,
      reviewer: { id: i % 2 === 0 ? REVIEWER_A : REVIEWER_B, email: "x@x", full_name: i % 2 === 0 ? "A" : "B" },
      application: { season_id: SEASON }
    }));
    const { data } = await getSeasonReviewerOptions(SEASON);
    const pages = requestsFor(db, "application_reviews");
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.filters).toContain("application.season_id");
    expect(data.reduce((sum, o) => sum + o.reviewCount, 0)).toBe(2500);
  });
});

// ── Export UX ───────────────────────────────────────────────────────────────

describe("results export panel", () => {
  it("offers role and operational group without requiring technical status names", () => {
    render(<ResultsExportPanel seasonId={SEASON} seasonLabel="UEHM-S12" />);
    for (const option of ["Tất cả", "Mentor", "Mentee"]) {
      expect(screen.getAllByRole("option", { name: option }).length).toBeGreaterThan(0);
    }
    for (const group of [
      "Đã qua vòng hồ sơ",
      "Đã qua vòng phỏng vấn",
      "Đã duyệt chính thức",
      "Không phù hợp / từ chối",
      "Cần review thêm"
    ]) {
      expect(screen.getByRole("option", { name: group })).toBeTruthy();
    }
  });

  it("omits unset filters from the URL instead of sending empty values", () => {
    render(<ResultsExportPanel seasonId={SEASON} seasonLabel="UEHM-S12" />);
    const href = screen.getByTestId("results-export-link").getAttribute("href")!;
    expect(href).toBe(`/api/exports/recruitment-results?season_id=${SEASON}`);
    expect(href).not.toContain("role_applied=");
    expect(href).not.toContain("operational_group=");
  });

  it("builds a Mentor + operational group URL from UI state", async () => {
    const user = userEvent.setup();
    render(<ResultsExportPanel seasonId={SEASON} seasonLabel="UEHM-S12" />);
    await user.selectOptions(screen.getByLabelText("Vai trò"), "mentor");
    await user.selectOptions(screen.getByLabelText("Nhóm vận hành"), "passed_screening");
    const href = screen.getByTestId("results-export-link").getAttribute("href")!;
    expect(href).toContain(`season_id=${SEASON}`);
    expect(href).toContain("role_applied=mentor");
    expect(href).toContain("operational_group=passed_screening");
  });

  it("keeps the exact audit filters behind an advanced section", async () => {
    const user = userEvent.setup();
    render(<ResultsExportPanel seasonId={SEASON} seasonLabel="UEHM-S12" />);
    expect(screen.queryByLabelText("Kết quả sơ loại (audit)")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Nâng cao" }));
    await user.selectOptions(screen.getByLabelText("Kết quả sơ loại (audit)"), "passed");
    expect(screen.getByTestId("results-export-link").getAttribute("href")).toContain("screening_decision=passed");
  });
});

describe("scores export panel", () => {
  const reviewers = [
    { adminUserId: REVIEWER_A, email: "rev.a@example.com", fullName: "Reviewer A", reviewCount: 12 },
    { adminUserId: REVIEWER_B, email: "core@example.com", fullName: "Core Team", reviewCount: 3 }
  ];

  it("offers role, round, status and reviewer", () => {
    render(<ScoresExportPanel seasonId={SEASON} seasonLabel="UEHM-S12" reviewers={reviewers} />);
    for (const name of ["Vai trò", "Vòng review", "Trạng thái", "Reviewer"]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    for (const option of ["Hồ sơ", "Phỏng vấn", "Chưa bắt đầu", "Đang làm", "Đã nộp", "Đã huỷ"]) {
      expect(screen.getByRole("option", { name: option })).toBeTruthy();
    }
    expect(screen.getByRole("option", { name: "Reviewer A (12)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Core Team (3)" })).toBeTruthy();
  });

  it("builds the Owner-UAT combination Mentor + Hồ sơ + Đã nộp", async () => {
    const user = userEvent.setup();
    render(<ScoresExportPanel seasonId={SEASON} seasonLabel="UEHM-S12" reviewers={reviewers} />);
    await user.selectOptions(screen.getByLabelText("Vai trò"), "mentor");
    await user.selectOptions(screen.getByLabelText("Vòng review"), "profile_screening");
    await user.selectOptions(screen.getByLabelText("Trạng thái"), "submitted");
    const href = screen.getByTestId("scores-export-link").getAttribute("href")!;
    expect(href).toContain("role_applied=mentor");
    expect(href).toContain("review_round=profile_screening");
    expect(href).toContain("review_status=submitted");
  });

  it("carries the selected reviewer id into the URL", async () => {
    const user = userEvent.setup();
    render(<ScoresExportPanel seasonId={SEASON} seasonLabel="UEHM-S12" reviewers={reviewers} />);
    await user.selectOptions(screen.getByLabelText("Reviewer"), REVIEWER_B);
    expect(screen.getByTestId("scores-export-link").getAttribute("href")).toContain(`reviewer=${REVIEWER_B}`);
  });

  it("says so plainly when the season has no reviews yet", () => {
    render(<ScoresExportPanel seasonId={SEASON} seasonLabel="UEHM-S12" reviewers={[]} />);
    expect(screen.getByText("Chưa có review nào trong mùa này.")).toBeTruthy();
  });
});

// ── Entry points ────────────────────────────────────────────────────────────

describe("applications page entry points", () => {
  const PAGE = readFileSync("app/applications/page.tsx", "utf8");
  const EXPORTS_PAGE = readFileSync("app/applications/exports/page.tsx", "utf8");

  it("no longer surfaces the Bulk Final Decision entry point", () => {
    expect(PAGE).not.toContain("Bulk Final Decision</");
    expect(PAGE).not.toContain('href="/applications/bulk-decision"');
  });

  it("keeps the bulk-decision route and action intact for later controlled UAT", () => {
    expect(readFileSync("app/applications/bulk-decision/page.tsx", "utf8").length).toBeGreaterThan(0);
    expect(readFileSync("app/actions/bulk-application-decisions.ts", "utf8")).toContain("applyApplicationDecisions");
  });

  it("links to the export panel instead of a blind download", () => {
    expect(PAGE).toContain('href="/applications/exports"');
    expect(PAGE).not.toContain("/api/exports/recruitment-results?season_id=${exportSeasonId}");
  });

  it("gates the export page behind canAssignReview, not a read-only role", () => {
    expect(EXPORTS_PAGE).toContain("canAssignReview(adminUser.role)");
    expect(EXPORTS_PAGE).toContain('redirect("/applications")');
  });
});
