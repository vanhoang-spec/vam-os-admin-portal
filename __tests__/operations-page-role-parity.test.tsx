/**
 * @vitest-environment jsdom
 */
/**
 * `/operations` role parity, exercised through the real page.
 *
 * The only thing mocked per role is IDENTITY — the signed-in admin row. Role
 * resolution, `admin_scope_access` lookup, scope-filter derivation, every data
 * loader and the page component itself all run for real against the faithful
 * PostgREST fake. Handing a scope object straight to a loader would skip the
 * exact links where the Production divergence lived, so nothing here does that.
 *
 * What must hold, for the same program, season and month:
 *   - Super Admin, scoped Admin and scoped Reviewer read one aggregate truth.
 *   - No grant means denial, never a zero dashboard.
 *   - A scope-resolution failure is distinguishable from having no grant.
 *   - A genuinely quiet month renders zero; a failed source withholds the KPIs.
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
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));
vi.mock("@/components/charts", () => ({
  BarSummary: ({ data }: any) => <div data-testid="bar-summary">{JSON.stringify(data)}</div>,
  DonutSummary: ({ data }: any) => <div data-testid="donut-summary">{JSON.stringify(data)}</div>
}));
vi.mock("@/app/operations/month-selector", () => ({ MonthSelector: () => <div /> }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

import OperationsPage from "@/app/operations/page";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { SCOPE_RESOLUTION_ERROR } from "@/lib/program-scope";

const SEASON_CODE = "UEHM-S12";
const UEH_SEASON = "11111111-1111-4111-8111-111111111111";
const HAM_SEASON = "22222222-2222-4222-8222-222222222222";
const UEH_PROGRAM = "33333333-3333-4333-8333-333333333333";
const HAM_PROGRAM = "44444444-4444-4444-8444-444444444444";
const MONTH = "2026-07";

const db = createFakeDb();

/** ~2,323 recaps, the recorded Production volume, with July inserted last. */
function seedRecaps() {
  const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const rows: any[] = [];
  let n = 0;
  for (const month of months) {
    for (let index = 0; index < 256; index += 1) {
      rows.push({
        id: `recap-${String(n++).padStart(6, "0")}`,
        season_id: UEH_SEASON,
        meeting_month: month,
        meeting_date: `${month}-15`,
        status: "submitted",
        mentor_person_id: `mentor-${index % 438}`,
        mentee_person_id: `mentee-${index % 637}`
      });
    }
  }
  for (let index = 0; index < 18; index += 1) {
    rows.push({
      id: `recap-july-${String(index).padStart(6, "0")}`,
      season_id: UEH_SEASON,
      meeting_month: MONTH,
      meeting_date: `${MONTH}-15`,
      status: "submitted",
      mentor_person_id: `mentor-${index % 3}`,
      mentee_person_id: `mentee-${index % 15}`
    });
  }
  rows.push({
    id: "recap-ham",
    season_id: HAM_SEASON,
    meeting_month: MONTH,
    meeting_date: `${MONTH}-20`,
    status: "submitted",
    mentor_person_id: "mentor-ham",
    mentee_person_id: "mentee-ham"
  });
  return rows;
}

function seed(withRecaps = true) {
  db.tables.seasons = [
    { id: UEH_SEASON, code: SEASON_CODE, name: "UEH Mentoring Season 12", program_id: UEH_PROGRAM },
    { id: HAM_SEASON, code: "HAM-S6", name: "HAM Season 6", program_id: HAM_PROGRAM }
  ];
  db.tables.programs = [
    { id: UEH_PROGRAM, code: "UEHM", name: "UEH Mentoring" },
    { id: HAM_PROGRAM, code: "HAM", name: "HAM" }
  ];
  db.tables.mentoring_recaps = withRecaps ? seedRecaps() : [];
  db.tables.matches = [
    ...Array.from({ length: 637 }, (_, index) => ({
      id: `match-${String(index).padStart(6, "0")}`,
      season_id: UEH_SEASON,
      status: "active",
      mentor_person_id: `mentor-${index % 438}`,
      mentee_person_id: `mentee-${index}`
    })),
    { id: "match-ham", season_id: HAM_SEASON, status: "active", mentor_person_id: "mentor-ham", mentee_person_id: "mentee-ham" }
  ];
  db.tables.events = [{ id: "event-1", season_id: UEH_SEASON, starts_at: `${MONTH}-10T01:00:00Z`, event_name: "Training" }];
  db.tables.event_participations = [
    { id: "part-1", event_id: "event-1", season_id: UEH_SEASON, person_id: "mentee-0", attendance_status: "attended" }
  ];
  db.tables.people = [];
  db.tables.mentee_profiles = [];
  db.tables.mentor_profiles = [];
  db.tables.applications = [];
  db.tables.person_season_memberships = [];
  db.tables.intake_batches = [];
  db.tables.v_season_latest_closed_month = [
    { season_id: UEH_SEASON, latest_closed_month: "2026-06", previous_closed_month: "2026-05" }
  ];
  db.tables.admin_scope_access = [];
}

/** Signs a user in. Everything downstream of identity resolves for real. */
function signIn(role: string, authUserId: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: `admin-${authUserId}`,
    role,
    status: "active",
    auth_user_id: authUserId,
    email: `${authUserId}@example.test`
  } as any);
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

async function renderOperations() {
  const ui = await OperationsPage({ searchParams: Promise.resolve({ month: MONTH }) });
  return render(<>{ui}</>);
}

/** The KPI cards, read off the rendered page by their Vietnamese labels. */
function readKpis(container: HTMLElement) {
  const values: Record<string, string> = {};
  for (const value of Array.from(container.querySelectorAll(".text-3xl"))) {
    const label = value.previousElementSibling;
    if (label) values[label.textContent?.trim() ?? ""] = value.textContent?.trim() ?? "";
  }
  return values;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seed();
  const client = fakeClient(db);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
});

describe("1-2. one aggregate truth across roles", () => {
  it("Super Admin and scoped Admin render identical KPI cards", async () => {
    signIn("super_admin", "auth-super");
    const superAdmin = readKpis((await renderOperations()).container);

    db.requests.length = 0;
    signIn("admin", "auth-admin");
    grant("auth-admin", { program_id: UEH_PROGRAM, role: "operations" });
    const admin = readKpis((await renderOperations()).container);

    expect(Object.keys(superAdmin).length).toBeGreaterThan(5);
    expect(admin).toEqual(superAdmin);

    // The values the scoped path used to lose entirely.
    expect(superAdmin["Số recap trong tháng"]).toBe("18");
    expect(superAdmin["Mentee active"]).toBe("15");
    expect(superAdmin["Mentor active"]).toBe("3");
    expect(superAdmin["Mentor chưa có recap"]).toBe("435");
  });

  // H2: a season "review" scope grant is not a global role. Before the H2
  // fix this page gated only on canReadSeason (true for ANY scope level,
  // "review" included), so a reviewer with this exact grant used to render
  // full KPI parity with Super Admin. See m090-r1-authorization-boundary
  // for the full reviewer-denial behavioral suite.
  it("a Reviewer with a valid season review grant is denied, not given KPI parity", async () => {
    signIn("reviewer", "auth-reviewer");
    grant("auth-reviewer", { season_id: UEH_SEASON, role: "review" });
    const { container } = await renderOperations();
    expect(container.textContent).toContain("Không có quyền truy cập");
    expect(container.textContent).not.toContain("Số recap trong tháng");
  });

  it("a scoped Admin sees no other program's rows in the aggregate", async () => {
    signIn("admin", "auth-admin");
    grant("auth-admin", { program_id: UEH_PROGRAM, role: "operations" });
    const kpis = readKpis((await renderOperations()).container);
    // The HAM July recap would push this to 19 if scope leaked.
    expect(kpis["Số recap trong tháng"]).toBe("18");
  });
});

describe("3. no grant is a denial, not a zero dashboard", () => {
  it("an Admin with no grant is denied", async () => {
    signIn("admin", "auth-admin");
    const { container } = await renderOperations();
    expect(container.textContent).toContain("Không có quyền truy cập");
    expect(container.textContent).not.toContain("Tổng hợp toàn chương trình");
    expect(container.textContent).not.toContain("Số recap trong tháng");
  });

  it("a Reviewer granted only another program is denied", async () => {
    signIn("reviewer", "auth-reviewer");
    grant("auth-reviewer", { program_id: HAM_PROGRAM, role: "review" });
    const { container } = await renderOperations();
    expect(container.textContent).toContain("Không có quyền truy cập");
  });

  it("a revoked grant does not authorize", async () => {
    signIn("admin", "auth-admin");
    grant("auth-admin", { program_id: UEH_PROGRAM, role: "operations", status: "revoked" });
    const { container } = await renderOperations();
    expect(container.textContent).toContain("Không có quyền truy cập");
  });

  it("another user's grant does not authorize", async () => {
    signIn("admin", "auth-admin");
    grant("auth-someone-else", { program_id: UEH_PROGRAM, role: "full_access" });
    const { container } = await renderOperations();
    expect(container.textContent).toContain("Không có quyền truy cập");
  });
});

describe("4. a scope-read failure is not a zero-grant denial", () => {
  it("an unreadable admin_scope_access renders the scope error, not a denial and not zeros", async () => {
    signIn("admin", "auth-admin");
    grant("auth-admin", { program_id: UEH_PROGRAM, role: "operations" });
    db.errors.admin_scope_access = { code: "42501", message: "permission denied" };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = await renderOperations();
    expect(container.textContent).toContain(SCOPE_RESOLUTION_ERROR);
    expect(container.textContent).not.toContain("Không có quyền truy cập");
    expect(container.textContent).not.toContain("Số recap trong tháng");
    errorLog.mockRestore();
  });

  it("a missing service-role credential renders the scope error", async () => {
    signIn("admin", "auth-admin");
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as any);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = await renderOperations();
    expect(container.textContent).toContain(SCOPE_RESOLUTION_ERROR);
    errorLog.mockRestore();
  });
});

describe("5-6. quiet months and broken sources are told apart", () => {
  it("a true zero-activity month renders zero for every role", async () => {
    db.tables.mentoring_recaps = [];
    db.tables.events = [];
    db.tables.event_participations = [];

    signIn("super_admin", "auth-super");
    const superAdmin = readKpis((await renderOperations()).container);
    signIn("admin", "auth-admin");
    grant("auth-admin", { program_id: UEH_PROGRAM, role: "operations" });
    const admin = readKpis((await renderOperations()).container);

    expect(superAdmin["Số recap trong tháng"]).toBe("0");
    expect(superAdmin["Mentee active"]).toBe("0");
    expect(admin).toEqual(superAdmin);
  });

  it("a failed KPI source withholds the numbers instead of printing a plausible zero", async () => {
    signIn("admin", "auth-admin");
    grant("auth-admin", { program_id: UEH_PROGRAM, role: "operations" });
    db.errors.mentoring_recaps = { code: "57014", message: "canceling statement due to statement timeout" };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = await renderOperations();
    expect(container.textContent).toContain("Không tính được KPI vận hành");
    expect(container.textContent).not.toContain("Số recap trong tháng");
    expect(container.textContent).not.toContain("Tổng hợp toàn chương trình");
    errorLog.mockRestore();
  });

  it("the same failure for a Super Admin also withholds the numbers", async () => {
    signIn("super_admin", "auth-super");
    db.errors.mentoring_recaps = { code: "57014", message: "canceling statement due to statement timeout" };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = await renderOperations();
    expect(container.textContent).toContain("Không tính được KPI vận hành");
    errorLog.mockRestore();
  });
});

describe("action authorization stays role-dependent while the aggregate does not", () => {
  it("an operations-scoped Admin gets the recap edit entry point and a Reviewer does not", async () => {
    signIn("admin", "auth-admin");
    grant("auth-admin", { program_id: UEH_PROGRAM, role: "operations" });
    const adminPage = await renderOperations();
    expect(adminPage.container.textContent).toContain("Thêm recap thủ công");

    db.tables.admin_scope_access = [];
    signIn("reviewer", "auth-reviewer");
    grant("auth-reviewer", { season_id: UEH_SEASON, role: "review" });
    const reviewerPage = await renderOperations();
    expect(reviewerPage.container.textContent).not.toContain("Thêm recap thủ công");
  });
});
