/**
 * S12 helper access boundary — behavioural route-guard tests.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE PROVE
 * ---------------------------------------------------------------------------
 * A standalone recruitment helper holds platform role `reviewer` and a season
 * `review` scope. That is enough to score the mentee applications assigned to
 * them, and it must not be enough to browse the community, the events subtree
 * or the data-quality screen.
 *
 * Every test here CALLS THE REAL PAGE FUNCTION and asserts on what it did —
 * either that `redirect()` fired, or that the protected loader was never
 * reached. None of them reads source text. A marker test would have passed on
 * the broken code, because the defect was never a missing string: it was that
 * `getCurrentAdminUser()` sat inside the same `Promise.all` as the protected
 * reads and was used only to decide whether to show edit buttons.
 *
 * `redirect()` throws in Next.js, so the mock throws too. A page that reaches
 * its loaders anyway would fail the "loader not called" assertion rather than
 * quietly pass.
 *
 * ---------------------------------------------------------------------------
 * TWO GUARD FAMILIES, DELIBERATELY NOT UNIFIED
 * ---------------------------------------------------------------------------
 * /data-issues and /events (index) had no gate at all and now use
 * `canBrowseOperations` — the same predicate, in the same position, as the H2
 * fix on /operations and /matches. support_team is inside that allowlist and
 * keeps the access it already had.
 *
 * The five event detail routes already refused a reviewer through
 * `canEditRecaps` BEFORE loading anything. That predicate is STRICTER
 * (super_admin / admin / core_team — no support_team). They are left exactly as
 * they are and pinned here instead: swapping them to `canBrowseOperations`
 * would hand support_team access it does not have today, which this task
 * explicitly forbids.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: unknown) => fn };
});

class RedirectError extends Error {
  constructor(public readonly target: string) {
    super(`NEXT_REDIRECT:${target}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new RedirectError(target);
  })
}));

vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ globalRole: "reviewer" })),
  getScopeFilter: vi.fn(async () => ({ allowedSeasonIds: ["s12"] })),
  canOperateAnyScope: vi.fn(() => false)
}));

vi.mock("@/lib/data", () => ({
  getPeople: vi.fn(async () => ({ data: [], error: null })),
  getApplications: vi.fn(async () => ({ data: [], error: null })),
  getMenteeProfiles: vi.fn(async () => ({ data: [], error: null })),
  getMentorProfiles: vi.fn(async () => ({ data: [], error: null })),
  getMatches: vi.fn(async () => ({ data: [], error: null })),
  getIntakeBatches: vi.fn(async () => ({ data: [], error: null })),
  getSeasons: vi.fn(async () => ({ data: [], error: null })),
  keyById: vi.fn(() => new Map())
}));

vi.mock("@/lib/events", () => ({
  getEventListData: vi.fn(async () => ({
    events: [],
    participations: [],
    seasons: [],
    registrationRows: []
  })),
  getEventDetailData: vi.fn(async () => ({ event: null, participations: [] })),
  getRegistrationDetail: vi.fn(async () => ({ registration: null })),
  isValidUuid: vi.fn(() => true),
  isEventAbsenceStatus: vi.fn(() => false),
  isEventAttendedStatus: vi.fn(() => false),
  EVENT_TYPE_OPTIONS: []
}));

import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getApplications,
  getMatches,
  getMenteeProfiles,
  getMentorProfiles,
  getPeople,
  getSeasons
} from "@/lib/data";
import {
  getEventDetailData,
  getEventListData,
  getRegistrationDetail
} from "@/lib/events";

import DataIssuesPage from "@/app/data-issues/page";
import EventsPage from "@/app/events/page";
import EventDetailPage from "@/app/events/[id]/page";
import EventAttendancePage from "@/app/events/[id]/attendance/page";
import EventEditPage from "@/app/events/[id]/edit/page";
import RegistrationDetailPage from "@/app/events/[id]/registrations/[regId]/page";
import CreateEventPage from "@/app/events/create/page";

import { buildNavGroups, allNavHrefs } from "@/lib/nav-model";
import type { AdminRole, CurrentAdminUser } from "@/lib/auth-constants";

// ── Helpers ──────────────────────────────────────────────────────────────────

function signInAs(role: AdminRole | null) {
  (getCurrentAdminUser as Mock).mockResolvedValue(
    role ? { id: "u1", email: "helper@vam.org", full_name: "Helper", role, status: "active" } : null
  );
}

/** Runs a page and reports whether it redirected, swallowing only NEXT_REDIRECT. */
async function run(page: (props?: any) => Promise<unknown>, props?: any) {
  try {
    await page(props);
    return { redirected: false as const, target: null };
  } catch (error) {
    if (error instanceof RedirectError) return { redirected: true as const, target: error.target };
    throw error;
  }
}

const ID_PROPS = { params: Promise.resolve({ id: "e1", regId: "r1" }) };
const SEARCH_PROPS = { searchParams: Promise.resolve({}) };

/** Every loader that must not run for an unauthorised caller. */
const PROTECTED_LOADERS = [
  getPeople,
  getApplications,
  getMenteeProfiles,
  getMentorProfiles,
  getMatches,
  getEventListData,
  getEventDetailData,
  getRegistrationDetail
] as unknown as Mock[];

function expectNoProtectedRead() {
  for (const loader of PROTECTED_LOADERS) expect(loader).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  (redirect as unknown as Mock).mockImplementation((target: string) => {
    throw new RedirectError(target);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A · /data-issues
// ═══════════════════════════════════════════════════════════════════════════

describe("/data-issues", () => {
  it("redirects a standalone reviewer BEFORE loading any protected data", async () => {
    signInAs("reviewer");
    const result = await run(DataIssuesPage as never, SEARCH_PROPS);

    expect(result.redirected).toBe(true);
    expect(result.target).toBe("/");
    expectNoProtectedRead();
  });

  it("redirects a viewer", async () => {
    signInAs("viewer");
    const result = await run(DataIssuesPage as never, SEARCH_PROPS);
    expect(result.redirected).toBe(true);
    expectNoProtectedRead();
  });

  it("sends an unauthenticated caller to /login", async () => {
    signInAs(null);
    const result = await run(DataIssuesPage as never, SEARCH_PROPS);
    expect(result.redirected).toBe(true);
    expect(result.target).toBe("/login");
    expectNoProtectedRead();
  });

  it.each(["core_team", "admin", "super_admin"] as const)(
    "does NOT reject %s, and reaches the data",
    async (role) => {
      signInAs(role);
      const result = await run(DataIssuesPage as never, SEARCH_PROPS);

      expect(result.redirected).toBe(false);
      expect(getPeople).toHaveBeenCalled();
      expect(getApplications).toHaveBeenCalled();
    }
  );

  it("does NOT reject support_team — its access is unchanged", async () => {
    signInAs("support_team");
    const result = await run(DataIssuesPage as never, SEARCH_PROPS);

    expect(result.redirected).toBe(false);
    expect(getPeople).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B · /events subtree
// ═══════════════════════════════════════════════════════════════════════════

describe("/events index", () => {
  it("redirects a standalone reviewer BEFORE loading the event list", async () => {
    signInAs("reviewer");
    const result = await run(EventsPage as never, SEARCH_PROPS);

    expect(result.redirected).toBe(true);
    expect(result.target).toBe("/");
    expectNoProtectedRead();
  });

  it("sends an unauthenticated caller to /login", async () => {
    signInAs(null);
    const result = await run(EventsPage as never, SEARCH_PROPS);
    expect(result.redirected).toBe(true);
    expect(result.target).toBe("/login");
    expectNoProtectedRead();
  });

  it.each(["core_team", "admin", "super_admin"] as const)(
    "does NOT reject %s, and reaches the event list",
    async (role) => {
      signInAs(role);
      const result = await run(EventsPage as never, SEARCH_PROPS);

      expect(result.redirected).toBe(false);
      expect(getEventListData).toHaveBeenCalled();
    }
  );

  it("does NOT reject support_team — its access is unchanged", async () => {
    signInAs("support_team");
    const result = await run(EventsPage as never, SEARCH_PROPS);

    expect(result.redirected).toBe(false);
    expect(getEventListData).toHaveBeenCalled();
  });
});

/**
 * The five detail routes were already gated by `canEditRecaps` before any read.
 * They refuse by RETURNING a "no permission" view rather than by redirecting, so
 * the assertion that matters is that the protected loader never ran.
 */
describe("/events detail subtree — already gated, pinned here", () => {
  const routes: Array<[string, (props?: any) => Promise<unknown>, any]> = [
    ["/events/[id]", EventDetailPage as never, ID_PROPS],
    ["/events/[id]/attendance", EventAttendancePage as never, ID_PROPS],
    ["/events/[id]/edit", EventEditPage as never, ID_PROPS],
    ["/events/[id]/registrations/[regId]", RegistrationDetailPage as never, ID_PROPS],
    ["/events/create", CreateEventPage as never, undefined]
  ];

  it.each(routes)("refuses a standalone reviewer at %s without reading anything", async (_label, page, props) => {
    signInAs("reviewer");
    await run(page, props);
    expectNoProtectedRead();
  });

  it.each(routes)("refuses a viewer at %s without reading anything", async (_label, page, props) => {
    signInAs("viewer");
    await run(page, props);
    expectNoProtectedRead();
  });

  it("lets core_team through to the event detail loader", async () => {
    signInAs("core_team");
    await run(EventDetailPage as never, ID_PROPS);
    expect(getEventDetailData).toHaveBeenCalled();
  });

  it("lets core_team through to the registration detail loader", async () => {
    signInAs("core_team");
    await run(RegistrationDetailPage as never, ID_PROPS);
    expect(getRegistrationDetail).toHaveBeenCalled();
  });

  it("keeps /events/create restricted to the edit tier, support_team included in that exclusion", async () => {
    // canEditRecaps excludes support_team here and always has. Pinning it so a
    // later "unify the predicates" edit cannot silently widen it.
    signInAs("support_team");
    await run(CreateEventPage as never, undefined);
    expect(getSeasons).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C · navigation
// ═══════════════════════════════════════════════════════════════════════════

function navFor(role: AdminRole): string[] {
  const user = {
    id: "u1",
    email: "u@vam.org",
    full_name: null,
    role,
    status: "active",
    auth_user_id: null
  } as CurrentAdminUser;
  return allNavHrefs(buildNavGroups(user));
}

describe("reviewer navigation offers only the helper's own work surfaces", () => {
  const hrefs = navFor("reviewer");

  it("offers the three recruitment surfaces", () => {
    expect(hrefs).toContain("/my-work");
    expect(hrefs).toContain("/reviews");
    expect(hrefs).toContain("/interviews");
  });

  it("does NOT offer community directories", () => {
    expect(hrefs).not.toContain("/people");
    expect(hrefs).not.toContain("/mentors");
    expect(hrefs).not.toContain("/mentees");
  });

  it("does NOT offer full application operations", () => {
    expect(hrefs).not.toContain("/applications");
    expect(hrefs).not.toContain("/applications/mentor-review");
    expect(hrefs).not.toContain("/applications/mentee-review");
  });

  it("does NOT offer events or data issues", () => {
    expect(hrefs).not.toContain("/events");
    expect(hrefs).not.toContain("/data-issues");
  });

  it("does NOT offer matching, operations or admin surfaces", () => {
    expect(hrefs).not.toContain("/matches");
    expect(hrefs).not.toContain("/operations");
    expect(hrefs).not.toContain("/admin");
    expect(hrefs).not.toContain("/admin/users");
    expect(hrefs).not.toContain("/team");
  });

  it("offers no link that the route would refuse", () => {
    // The whole point of the trim: nav and route may not disagree.
    // /interviews/lich (22/09/2026): trang gate bằng đúng canSelfClaimInterview
    // nên reviewer mở được; tầng lib còn đòi thêm vai trò interviewer của mùa,
    // nhưng đó là câu từ chối tử tế trên trang, không phải cú đá về trang chủ.
    const helperAllowed = new Set(["/my-work", "/reviews", "/interviews", "/interviews/lich", "/"]);
    for (const href of hrefs) expect(helperAllowed.has(href)).toBe(true);
  });
});

describe("other roles keep the navigation they had", () => {
  it("support_team still sees events and data issues", () => {
    const hrefs = navFor("support_team");
    expect(hrefs).toContain("/events");
    expect(hrefs).toContain("/data-issues");
    expect(hrefs).toContain("/operations");
  });

  it("support_team still sees the community and applications directories", () => {
    const hrefs = navFor("support_team");
    expect(hrefs).toContain("/people");
    expect(hrefs).toContain("/mentors");
    expect(hrefs).toContain("/mentees");
    expect(hrefs).toContain("/applications");
  });

  it("core_team keeps every operational surface", () => {
    const hrefs = navFor("core_team");
    for (const href of [
      "/my-work",
      "/reviews",
      "/interviews",
      "/people",
      "/mentors",
      "/mentees",
      "/applications",
      "/matches",
      "/events",
      "/data-issues",
      "/operations",
      "/admin"
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("super_admin keeps user management", () => {
    expect(navFor("super_admin")).toContain("/admin/users");
  });

  it("viewer is offered no operations, admin or recruitment surface", () => {
    const hrefs = navFor("viewer");
    for (const href of ["/operations", "/matches", "/events", "/data-issues", "/admin", "/my-work", "/reviews"]) {
      expect(hrefs).not.toContain(href);
    }
  });
});
