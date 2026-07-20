import { describe, it, expect } from "vitest";
import type { CurrentAdminUser } from "../lib/auth-constants";
import { buildNavGroups, isActiveRoute, allNavHrefs } from "../lib/nav-model";

function makeUser(role: CurrentAdminUser["role"]): CurrentAdminUser {
  return { id: "u1", email: "test@vam.org", full_name: null, role, status: "active", auth_user_id: null };
}

const ROUTES_ALL = [
  "/", "/operations",
  "/people", "/mentors", "/mentees",
  "/applications", "/reviews", "/interviews",
  "/matches", "/events", "/data-issues",
  "/admin", "/team", "/admin/users",
];

const ROUTES_BASE = [
  "/", "/operations",
  "/people", "/mentors", "/mentees",
  "/applications",
  "/matches", "/events", "/data-issues",
];

// ── isActiveRoute ─────────────────────────────────────────────────────────────

describe("isActiveRoute", () => {
  it("matches root exactly", () => {
    expect(isActiveRoute("/", "/")).toBe(true);
  });

  it("does not prefix-match root for other routes", () => {
    expect(isActiveRoute("/operations", "/")).toBe(false);
    expect(isActiveRoute("/operations/monthly", "/")).toBe(false);
  });

  it("prefix-matches non-root routes", () => {
    expect(isActiveRoute("/operations/monthly", "/operations")).toBe(true);
    expect(isActiveRoute("/admin/users", "/admin")).toBe(true);
  });

  it("does not match a different route that starts with the same characters", () => {
    expect(isActiveRoute("/admins", "/admin")).toBe(false);
    expect(isActiveRoute("/operations-overview", "/operations")).toBe(false);
  });

  it("matches exact non-root path", () => {
    expect(isActiveRoute("/matches", "/matches")).toBe(true);
    expect(isActiveRoute("/events", "/events")).toBe(true);
  });
});

// ── buildNavGroups — super_admin ──────────────────────────────────────────────

describe("buildNavGroups — super_admin", () => {
  const groups = buildNavGroups(makeUser("super_admin"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 8 top-level groups", () => {
    expect(groups.length).toBeLessThanOrEqual(8);
  });

  it("contains all 14 routes", () => {
    ROUTES_ALL.forEach((r) => expect(hrefs).toContain(r));
  });

  it("includes admin group with user management sub-item", () => {
    const admin = groups.find((g) => g.key === "admin");
    expect(admin).toBeDefined();
    expect(admin!.items?.map((i) => i.href)).toContain("/admin/users");
  });

  it("applications group has reviews and interviews sub-items", () => {
    const apps = groups.find((g) => g.key === "applications");
    const subHrefs = apps!.items?.map((i) => i.href) ?? [];
    expect(subHrefs).toContain("/reviews");
    expect(subHrefs).toContain("/interviews");
    expect(subHrefs).toContain("/applications");
  });
});

// ── buildNavGroups — admin ────────────────────────────────────────────────────

describe("buildNavGroups — admin", () => {
  const groups = buildNavGroups(makeUser("admin"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 8 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(8));
  it("includes /admin/users", () => expect(hrefs).toContain("/admin/users"));
  it("includes /reviews and /interviews", () => {
    expect(hrefs).toContain("/reviews");
    expect(hrefs).toContain("/interviews");
  });
});

// ── buildNavGroups — core_team ────────────────────────────────────────────────

describe("buildNavGroups — core_team", () => {
  const groups = buildNavGroups(makeUser("core_team"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 8 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(8));

  it("does NOT include /admin/users", () => expect(hrefs).not.toContain("/admin/users"));

  it("includes admin group but without user management", () => {
    const admin = groups.find((g) => g.key === "admin");
    expect(admin).toBeDefined();
    expect(admin!.items?.map((i) => i.href)).not.toContain("/admin/users");
    expect(admin!.items?.map((i) => i.href)).toContain("/admin");
    expect(admin!.items?.map((i) => i.href)).toContain("/team");
  });

  it("includes /reviews and /interviews", () => {
    expect(hrefs).toContain("/reviews");
    expect(hrefs).toContain("/interviews");
  });
});

// ── buildNavGroups — reviewer ─────────────────────────────────────────────────

describe("buildNavGroups — reviewer", () => {
  const groups = buildNavGroups(makeUser("reviewer"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 8 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(8));

  it("does NOT include admin group", () => {
    expect(groups.find((g) => g.key === "admin")).toBeUndefined();
  });

  it("does NOT include /team, /admin, or /admin/users", () => {
    expect(hrefs).not.toContain("/team");
    expect(hrefs).not.toContain("/admin");
    expect(hrefs).not.toContain("/admin/users");
  });

  it("includes /reviews and /interviews", () => {
    expect(hrefs).toContain("/reviews");
    expect(hrefs).toContain("/interviews");
  });

  it("includes all base routes", () => {
    ROUTES_BASE.forEach((r) => expect(hrefs).toContain(r));
  });
});

// ── buildNavGroups — viewer ───────────────────────────────────────────────────

describe("buildNavGroups — viewer", () => {
  const groups = buildNavGroups(makeUser("viewer"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 8 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(8));

  it("does NOT include review, interview, or admin routes", () => {
    ["/reviews", "/interviews", "/admin", "/team", "/admin/users"].forEach((r) =>
      expect(hrefs).not.toContain(r)
    );
  });

  it("includes all base routes", () => {
    ROUTES_BASE.forEach((r) => expect(hrefs).toContain(r));
  });

  it("applications is a standalone link (no sub-items)", () => {
    const apps = groups.find((g) => g.key === "applications");
    expect(apps!.href).toBe("/applications");
    expect(apps!.items).toBeUndefined();
  });
});

// ── buildNavGroups — support_team ─────────────────────────────────────────────

describe("buildNavGroups — support_team", () => {
  const groups = buildNavGroups(makeUser("support_team"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 8 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(8));

  it("does NOT include review or admin routes", () => {
    ["/reviews", "/interviews", "/admin", "/team", "/admin/users"].forEach((r) =>
      expect(hrefs).not.toContain(r)
    );
  });

  it("includes all base routes", () => {
    ROUTES_BASE.forEach((r) => expect(hrefs).toContain(r));
  });
});

// ── buildNavGroups — null user ────────────────────────────────────────────────

describe("buildNavGroups — null user", () => {
  const groups = buildNavGroups(null);
  const hrefs = allNavHrefs(groups);

  it("returns no admin group", () => {
    expect(groups.find((g) => g.key === "admin")).toBeUndefined();
  });

  it("returns no gated routes", () => {
    ["/reviews", "/interviews", "/admin", "/team", "/admin/users"].forEach((r) =>
      expect(hrefs).not.toContain(r)
    );
  });

  it("includes base routes", () => {
    ROUTES_BASE.forEach((r) => expect(hrefs).toContain(r));
  });
});

// ── Route coverage unchanged from Batch 1 ────────────────────────────────────

describe("route coverage — no routes removed by nav grouping", () => {
  it("super_admin can reach all 14 original routes", () => {
    const hrefs = allNavHrefs(buildNavGroups(makeUser("super_admin")));
    ROUTES_ALL.forEach((r) => expect(hrefs).toContain(r));
  });

  it("community group exposes /people, /mentors, /mentees for all roles", () => {
    const roles: CurrentAdminUser["role"][] = ["super_admin", "admin", "core_team", "reviewer", "viewer", "support_team"];
    roles.forEach((role) => {
      const hrefs = allNavHrefs(buildNavGroups(makeUser(role)));
      expect(hrefs).toContain("/people");
      expect(hrefs).toContain("/mentors");
      expect(hrefs).toContain("/mentees");
    });
  });
});

// ── allNavHrefs ───────────────────────────────────────────────────────────────

describe("allNavHrefs", () => {
  it("flattens standalone hrefs and sub-item hrefs", () => {
    const groups = buildNavGroups(makeUser("super_admin"));
    const hrefs = allNavHrefs(groups);
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/people");
    expect(hrefs).toContain("/admin/users");
  });

  it("produces no duplicates for any role", () => {
    const roles: CurrentAdminUser["role"][] = ["super_admin", "admin", "core_team", "reviewer", "viewer"];
    roles.forEach((role) => {
      const hrefs = allNavHrefs(buildNavGroups(makeUser(role)));
      const unique = new Set(hrefs);
      expect(unique.size).toBe(hrefs.length);
    });
  });
});

// ── Explicit per-role route set equivalence (verifies fa42fa1 permission model) ─
//
// Source of truth: fa42fa1 components/app-shell.tsx
//   navItems (all roles):        /, /operations, /people, /mentors, /mentees,
//                                 /applications, /matches, /events, /data-issues
//   canReview (+reviewer):       + /reviews, /interviews
//   canAccessAdminUser (+core):  + /admin, /team
//   canManageUsers (+admin):     + /admin/users

const BASE_ROUTE_ARR = [
  "/", "/operations", "/people", "/mentors", "/mentees",
  "/applications", "/matches", "/events", "/data-issues",
];

const EXPECTED_ROUTES: Record<CurrentAdminUser["role"], string[]> = {
  viewer:       BASE_ROUTE_ARR,
  support_team: BASE_ROUTE_ARR,
  reviewer:     [...BASE_ROUTE_ARR, "/reviews", "/interviews"],
  core_team:    [...BASE_ROUTE_ARR, "/reviews", "/interviews", "/admin", "/team"],
  admin:        [...BASE_ROUTE_ARR, "/reviews", "/interviews", "/admin", "/team", "/admin/users"],
  super_admin:  [...BASE_ROUTE_ARR, "/reviews", "/interviews", "/admin", "/team", "/admin/users"],
};

function sortedRoutes(arr: string[]) {
  return [...arr].sort();
}

describe("Explicit per-role route set — equivalence with fa42fa1 permission model", () => {
  const roles = Object.keys(EXPECTED_ROUTES) as CurrentAdminUser["role"][];

  roles.forEach((role) => {
    it(`${role}: exact route set matches base commit (${EXPECTED_ROUTES[role].length} routes)`, () => {
      const actual = sortedRoutes(allNavHrefs(buildNavGroups(makeUser(role))));
      const expected = sortedRoutes(EXPECTED_ROUTES[role]);
      expect(actual).toEqual(expected);
    });
  });

  it("null user has exactly the same routes as viewer", () => {
    const actual = sortedRoutes(allNavHrefs(buildNavGroups(null)));
    const expected = sortedRoutes(EXPECTED_ROUTES.viewer);
    expect(actual).toEqual(expected);
  });
});
