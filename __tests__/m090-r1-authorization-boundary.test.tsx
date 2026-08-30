/**
 * @vitest-environment jsdom
 */
/**
 * M090 R1 — H2 (operations/matches authorization) + H3 (cancelled/reassigned
 * reviewer old-URL leak) behavioural test suite.
 *
 * Every scenario below exercises the REAL page or lib function against the
 * fake PostgREST harness (see ./support/fake-postgrest.ts) — only identity
 * (getCurrentAdminUser) and Next.js navigation/module boundaries are mocked.
 * No assertion inspects source text; every assertion reads rendered DOM
 * output or an actual function return value. This file replaces
 * __tests__/m090-perf-and-auth-boundary.test.ts, whose "M090-B reviewer
 * isolation boundary" describe block only ever asserted readFileSync(...)
 * .toContain(...) against migration/lib source text and therefore proved
 * nothing about runtime behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});
vi.mock("next/link", () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error("REDIRECT:" + destination);
  }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));
vi.mock("@/components/charts", () => ({
  BarSummary: () => <div />,
  DonutSummary: () => <div />
}));
vi.mock("@/app/operations/month-selector", () => ({ MonthSelector: () => <div /> }));
vi.mock("@/app/operations/tasks/task-export-button", () => ({ TaskExportButton: () => <div /> }));
vi.mock("@/app/operations/tasks/workflow-forms", () => ({
  AddCommentForm: () => <div />,
  CreateActionItemForm: () => <div />,
  GenerateFollowupForm: () => <div />,
  UpdateActionItemForm: () => <div />
}));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

import OperationsPage from "@/app/operations/page";
import OperationsTasksPage from "@/app/operations/tasks/page";
import MatchDetailPage from "@/app/matches/[id]/page";
import ReviewDetailPage from "@/app/reviews/[id]/page";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getApplicationReviewById } from "@/lib/data";
import { canBrowseOperations } from "@/lib/permissions";
import { allNavHrefs, buildNavGroups } from "@/lib/nav-model";

const UEH_SEASON = "11111111-1111-4111-8111-111111111111";
const UEH_PROGRAM = "33333333-3333-4333-8333-333333333333";
const MONTH = "2026-07";

const db = createFakeDb();

let rpcCalls: Array<{ fn: string; args: any }> = [];
let rpcResponse: { data: any; error: any } = { data: null, error: { code: "PGRST202", message: "not found" } };

const EMPTY_WORKFLOW_DATA = {
  summary: {
    openActionCount: 0,
    overdueActionCount: 0,
    followUpOpenCount: 0,
    followUpResolvedCount: 0,
    dataIssueOpenCount: 0,
    correctionsThisMonth: 0
  },
  followUpQueue: [],
  dataIssuesQueue: [],
  correctionLog: [],
  myTasks: [],
  owners: []
};

/** Signs a user in. Everything downstream of identity resolves for real. */
function signIn(role: string, authUserId: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: `admin-${authUserId}`,
    role,
    status: "active",
    auth_user_id: authUserId,
    email: `${authUserId}@example.test`
  } as any);
  return `admin-${authUserId}`;
}

function grant(authUserId: string, scope: { program_id?: string | null; season_id?: string | null; role: string; status?: string }) {
  db.tables.admin_scope_access.push({
    id: `grant-${db.tables.admin_scope_access.length}`,
    user_id: authUserId,
    program_id: scope.program_id ?? null,
    season_id: scope.season_id ?? null,
    role: scope.role,
    status: scope.status ?? "active"
  });
}

function seed() {
  db.tables.seasons = [{ id: UEH_SEASON, code: "UEHM-S12", name: "UEH Mentoring Season 12", program_id: UEH_PROGRAM }];
  db.tables.programs = [{ id: UEH_PROGRAM, code: "UEHM", name: "UEH Mentoring" }];
  db.tables.admin_scope_access = [];
  db.tables.mentoring_recaps = [];
  db.tables.matches = [];
  db.tables.events = [];
  db.tables.event_participations = [];
  db.tables.people = [];
  db.tables.mentee_profiles = [];
  db.tables.mentor_profiles = [];
  db.tables.applications = [];
  db.tables.person_season_memberships = [];
  db.tables.intake_batches = [];
  db.tables.v_season_latest_closed_month = [];
  db.tables.application_reviews = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seed();
  rpcCalls = [];
  rpcResponse = { data: null, error: { code: "PGRST202", message: "not found" } };
  const client = fakeClient(db, {
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return rpcResponse;
    }
  });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
});

// ---------------------------------------------------------------------------
// canBrowseOperations predicate itself
// ---------------------------------------------------------------------------
describe("H2 canBrowseOperations predicate", () => {
  it("allows super_admin, admin, core_team, support_team", () => {
    for (const role of ["super_admin", "admin", "core_team", "support_team"]) {
      expect(canBrowseOperations(role)).toBe(true);
    }
  });

  it("excludes reviewer, viewer and null", () => {
    expect(canBrowseOperations("reviewer")).toBe(false);
    expect(canBrowseOperations("viewer")).toBe(false);
    expect(canBrowseOperations(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A. reviewer + valid S12 review grant: /operations DENIED
// ---------------------------------------------------------------------------
describe("A. reviewer + valid S12 review grant: /operations DENIED", () => {
  it("renders the denial screen, never the operations dashboard", async () => {
    signIn("reviewer", "auth-reviewer");
    grant("auth-reviewer", { season_id: UEH_SEASON, role: "review" });

    const ui = await OperationsPage({ searchParams: Promise.resolve({ month: MONTH }) });
    const { container } = render(<>{ui}</>);

    expect(container.textContent).toContain("Không có quyền truy cập");
    expect(container.textContent).not.toContain("Tổng hợp toàn chương trình");
    expect(container.textContent).not.toContain("Số recap trong tháng");
  });
});

// ---------------------------------------------------------------------------
// B. reviewer: /operations/tasks DENIED
// ---------------------------------------------------------------------------
describe("B. reviewer: /operations/tasks DENIED", () => {
  it("renders the denial screen before ever calling the workflow RPC", async () => {
    signIn("reviewer", "auth-reviewer");
    grant("auth-reviewer", { season_id: UEH_SEASON, role: "review" });

    const ui = await OperationsTasksPage({ searchParams: Promise.resolve({ month: MONTH }) });
    const { container } = render(<>{ui}</>);

    expect(container.textContent).toContain("Không có quyền truy cập");
    expect(container.textContent).not.toContain("Việc cần xử lý");
    expect(rpcCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C. reviewer: /matches/[id] DENIED
// ---------------------------------------------------------------------------
describe("C. reviewer: /matches/[id] DENIED", () => {
  it("redirects to /matches before loading any match data", async () => {
    signIn("reviewer", "auth-reviewer");
    grant("auth-reviewer", { season_id: UEH_SEASON, role: "review" });
    db.tables.matches = [{ id: "match-1", season_id: UEH_SEASON, status: "active", mentor_person_id: "m", mentee_person_id: "e" }];

    await expect(MatchDetailPage({ params: Promise.resolve({ id: "match-1" }) })).rejects.toThrow("REDIRECT:/matches");
  });
});

// ---------------------------------------------------------------------------
// D. reviewer nav: no /operations, no /matches
// ---------------------------------------------------------------------------
describe("D. reviewer nav visibility", () => {
  it("omits /operations and /matches hrefs from the nav model for reviewer", () => {
    const hrefs = allNavHrefs(buildNavGroups({ role: "reviewer", status: "active" } as any));
    expect(hrefs).not.toContain("/operations");
    expect(hrefs).not.toContain("/matches");
  });

  it("regression guard: core_team keeps both hrefs", () => {
    const hrefs = allNavHrefs(buildNavGroups({ role: "core_team", status: "active" } as any));
    expect(hrefs).toContain("/operations");
    expect(hrefs).toContain("/matches");
  });
});

// ---------------------------------------------------------------------------
// E. core_team + valid S12 scope: positive controls still allowed
// ---------------------------------------------------------------------------
describe("E. core_team + valid S12 scope: positive controls still allowed", () => {
  it("core_team reaches the /operations dashboard", async () => {
    signIn("core_team", "auth-core");
    grant("auth-core", { program_id: UEH_PROGRAM, role: "operations" });

    const ui = await OperationsPage({ searchParams: Promise.resolve({ month: MONTH }) });
    const { container } = render(<>{ui}</>);

    expect(container.textContent).not.toContain("Không có quyền truy cập");
    expect(container.textContent).toContain("Tổng hợp toàn chương trình");
  });

  it("core_team reaches /operations/tasks", async () => {
    signIn("core_team", "auth-core");
    grant("auth-core", { program_id: UEH_PROGRAM, role: "operations" });
    rpcResponse = { data: EMPTY_WORKFLOW_DATA, error: null };

    const ui = await OperationsTasksPage({ searchParams: Promise.resolve({ month: MONTH }) });
    const { container } = render(<>{ui}</>);

    expect(container.textContent).not.toContain("Không có quyền truy cập");
    expect(container.textContent).toContain("Việc cần xử lý");
    expect(rpcCalls.length).toBeGreaterThan(0);
  });

  it("core_team reaches /matches/[id]", async () => {
    signIn("core_team", "auth-core");
    grant("auth-core", { program_id: UEH_PROGRAM, role: "operations" });
    db.tables.matches = [{ id: "match-1", season_id: UEH_SEASON, status: "active", mentor_person_id: null, mentee_person_id: null }];

    const ui = await MatchDetailPage({ params: Promise.resolve({ id: "match-1" }) });
    const { container } = render(<>{ui}</>);

    expect(container.textContent).not.toContain("Không có quyền truy cập");
    expect(container.textContent).toContain("Chi tiết match");
  });
});

// ---------------------------------------------------------------------------
// H3 — getApplicationReviewById direct behavioural tests
// F, G, H, I, J run against the real function and the fake DB directly,
// decoupled from page-level scope machinery, since the fix is entirely in
// the query this function builds.
// ---------------------------------------------------------------------------
describe("H3 getApplicationReviewById — cancelled/reassigned reviewer isolation", () => {
  it("F. reviewer A owns an active (assigned) review: can open own review", async () => {
    db.tables.application_reviews = [
      { id: "rev-a", application_id: "app-1", reviewer_admin_user_id: "admin-A", review_round: "profile_screening", status: "assigned" }
    ];
    const result = await getApplicationReviewById("rev-a", undefined, "admin-A");
    expect(result.data?.id).toBe("rev-a");
  });

  it("G. operator cancels A's assignment: A cannot open the same old review ID", async () => {
    db.tables.application_reviews = [
      { id: "rev-a", application_id: "app-1", reviewer_admin_user_id: "admin-A", review_round: "profile_screening", status: "cancelled" }
    ];
    const result = await getApplicationReviewById("rev-a", undefined, "admin-A");
    expect(result.data).toBeNull();
  });

  it("H. reassign A -> B: A denied the old review, B allowed the new one", async () => {
    db.tables.application_reviews = [
      { id: "rev-old", application_id: "app-1", reviewer_admin_user_id: "admin-A", review_round: "profile_screening", status: "cancelled" },
      { id: "rev-new", application_id: "app-1", reviewer_admin_user_id: "admin-B", review_round: "profile_screening", status: "assigned" }
    ];
    const oldForA = await getApplicationReviewById("rev-old", undefined, "admin-A");
    expect(oldForA.data).toBeNull();
    const newForB = await getApplicationReviewById("rev-new", undefined, "admin-B");
    expect(newForB.data?.id).toBe("rev-new");
  });

  it("I. submitted review: original reviewer can still open it read-only", async () => {
    db.tables.application_reviews = [
      { id: "rev-a", application_id: "app-1", reviewer_admin_user_id: "admin-A", review_round: "profile_screening", status: "submitted" }
    ];
    const result = await getApplicationReviewById("rev-a", undefined, "admin-A");
    expect(result.data?.id).toBe("rev-a");
    expect(result.data?.status).toBe("submitted");
  });

  it("J. reviewer A cannot open reviewer B's active review", async () => {
    db.tables.application_reviews = [
      { id: "rev-b", application_id: "app-1", reviewer_admin_user_id: "admin-B", review_round: "profile_screening", status: "assigned" }
    ];
    const result = await getApplicationReviewById("rev-b", undefined, "admin-A");
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// H3 — page-level: PII must not render alongside the denial
// ---------------------------------------------------------------------------
describe("H3 (page-level) /reviews/[id] — no PII leak on denied access", () => {
  it("G. cancelled review's old URL renders not-found, never the applicant's PII", async () => {
    const adminId = signIn("reviewer", "auth-reviewer");
    grant("auth-reviewer", { season_id: UEH_SEASON, role: "review" });
    db.tables.application_reviews = [
      { id: "rev-a", application_id: "app-1", reviewer_admin_user_id: adminId, review_round: "profile_screening", status: "cancelled" }
    ];
    db.tables.applications = [
      { id: "app-1", season_id: UEH_SEASON, full_name: "Nguyen Van A", email_primary: "secret-applicant@test.invalid", status: "screening_assigned" }
    ];

    const ui = await ReviewDetailPage({ params: Promise.resolve({ id: "rev-a" }) });
    const { container } = render(<>{ui}</>);

    expect(container.textContent).toContain("không tồn tại");
    expect(container.textContent).not.toContain("Nguyen Van A");
    expect(container.textContent).not.toContain("secret-applicant@test.invalid");
  });

  it("J. reviewer A opening reviewer B's review URL renders not-found, never B's applicant's PII", async () => {
    signIn("reviewer", "auth-a");
    grant("auth-a", { season_id: UEH_SEASON, role: "review" });
    db.tables.application_reviews = [
      { id: "rev-b", application_id: "app-1", reviewer_admin_user_id: "admin-auth-b", review_round: "profile_screening", status: "assigned" }
    ];
    db.tables.applications = [
      { id: "app-1", season_id: UEH_SEASON, full_name: "Reviewer B Applicant", email_primary: "b-applicant@test.invalid", status: "screening_assigned" }
    ];

    const ui = await ReviewDetailPage({ params: Promise.resolve({ id: "rev-b" }) });
    const { container } = render(<>{ui}</>);

    expect(container.textContent).toContain("không tồn tại");
    expect(container.textContent).not.toContain("Reviewer B Applicant");
    expect(container.textContent).not.toContain("b-applicant@test.invalid");
  });

  it("F/I (page-level). reviewer A can open their own assigned and submitted reviews", async () => {
    const adminId = signIn("reviewer", "auth-reviewer");
    grant("auth-reviewer", { season_id: UEH_SEASON, role: "review" });
    db.tables.application_reviews = [
      { id: "rev-a", application_id: "app-1", reviewer_admin_user_id: adminId, review_round: "profile_screening", status: "submitted", recommendation: "pass_to_interview" }
    ];
    db.tables.applications = [
      { id: "app-1", season_id: UEH_SEASON, full_name: "Nguyen Van A", email_primary: "a@test.invalid", status: "screening_completed" }
    ];

    const ui = await ReviewDetailPage({ params: Promise.resolve({ id: "rev-a" }) });
    const { container } = render(<>{ui}</>);

    expect(container.textContent).not.toContain("không tồn tại");
    expect(container.textContent).toContain("Nguyen Van A");
  });
});
