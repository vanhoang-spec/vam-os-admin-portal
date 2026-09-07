/**
 * The fence.
 *
 * Migration 071 gives roughly eleven hundred mentors and mentees a login into an
 * application that was staff-only until now. This file is the test that says
 * they cannot get out of their half of it, and that the read-only reporting
 * account cannot get into the operational half.
 *
 * It is written against the source of `middleware.ts` and the pure routing core
 * rather than against a running server, because the property being asserted is
 * structural: the fence is an allow-list, and a page added next month is closed
 * by default rather than open until somebody remembers.
 *
 * If a change makes this file fail, the change is almost certainly wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isParticipantPath,
  isReportOnlyPath,
  isReportOnlyRole,
  resolvePostLogin,
  ROUTES
} from "@/lib/participant-auth-core";
import { buildNavGroups, allNavHrefs } from "@/lib/nav-model";
import type { CurrentAdminUser } from "@/lib/auth-constants";

const middleware = readFileSync(resolve(process.cwd(), "middleware.ts"), "utf8");
const layout = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");

/** Every operational screen a participant must never reach. */
const STAFF_ROUTES = [
  "/",
  "/operations",
  "/operations/monthly",
  "/operations/recap-import",
  "/people",
  "/people/123",
  "/mentors",
  "/mentees",
  "/matches",
  "/matches/recommendations",
  "/applications",
  "/reviews",
  "/reviews/selection",
  "/interviews",
  "/events",
  "/data-issues",
  "/admin",
  "/admin/users",
  "/admin/participants",
  "/portfolio",
  "/team",
  "/recaps/create",
  "/programs/UEHM"
];

function makeUser(role: CurrentAdminUser["role"]): CurrentAdminUser {
  return {
    id: "admin-1",
    email: "a@vam.vn",
    full_name: "A",
    role,
    status: "active",
    auth_user_id: "auth-1"
  };
}

describe("a participant cannot reach a staff route", () => {
  it.each(STAFF_ROUTES)("refuses %s", (path) => {
    expect(isParticipantPath(path)).toBe(false);
  });

  it("admits only the two participant routes and their children", () => {
    for (const path of ["/ct", "/ct/UEHM", "/ct/UEHM/anything", "/chon-chuong-trinh"]) {
      expect(isParticipantPath(path), path).toBe(true);
    }
  });

  it("is an allow-list, so a route added later is closed by default", () => {
    for (const future of ["/bao-cao-moi", "/ct-admin", "/mentor-portal", "/operations/new-thing"]) {
      expect(isParticipantPath(future), future).toBe(false);
    }
  });

  it("never follows a deep link a participant carried into the staff portal", () => {
    for (const next of STAFF_ROUTES) {
      const decision = resolvePostLogin({
        hasParticipantAccount: true,
        programs: [{ programId: "p1", programCode: "UEHM", programName: "UEH Mentoring" }],
        requestedNext: next
      });
      expect(decision.redirectTo, next).toBe("/ct/UEHM");
    }
  });

  it("refuses a visitor who is neither staff nor a linked participant", () => {
    const decision = resolvePostLogin({ programs: [] });
    expect(decision.outcome).toBe("no_account");
    expect(decision.redirectTo).toBe(ROUTES.login);
  });
});

describe("middleware enforces it, not the pages", () => {
  it("bounces a signed-in non-admin away from anything outside the participant routes", () => {
    // The three states exist precisely so "signed in but not staff" is not
    // treated the same as "not signed in".
    expect(middleware).toContain('state: "signed_in"');
    expect(middleware).toContain("isParticipantPath(request.nextUrl.pathname)");
    expect(middleware).toContain("ROUTES.participantHome");
  });

  it("still sends a visitor with no session to the login page", () => {
    expect(middleware).toContain('if (session.state === "none") return redirectToLogin(request)');
  });

  it("derives the participant flag from the pathname, never from the request", () => {
    // A header a client could set would be a way to ask for the participant
    // shell — and, with it, for the shell that skips the admin lookup.
    expect(middleware).toContain("isParticipantPath(request.nextUrl.pathname)");
    expect(middleware).toContain('requestHeaders.set("x-vam-participant-route", "1")');
    expect(middleware).not.toMatch(/request\.headers\.get\(["']x-vam-participant-route["']\)/);
  });

  it("keeps the machine endpoints and public token routes outside the gate", () => {
    expect(middleware).toContain("api/recap-import|api/cron");
    expect(middleware).toContain('requestHeaders.set("x-vam-public-route", publicRoute)');
  });
});

describe("the layout strips the staff shell for a participant", () => {
  it("renders bare only when the route is a participant route AND there is no admin row", () => {
    // Next 15 made headers() async; the guard is the same one, awaited.
    expect(layout).toContain('(await headers()).get("x-vam-participant-route") && !adminUser');
  });

  it("still calls getCurrentAdminUser without swallowing its throw", () => {
    // The comment above it explains why; this asserts nobody wrapped it again.
    expect(layout).toContain("const adminUser = await getCurrentAdminUser();");
    expect(layout).not.toMatch(/try\s*{[\s\S]*getCurrentAdminUser/);
  });
});

describe("vam_admin reads and exports, and does nothing else", () => {
  it("is recognised as the read-only role", () => {
    expect(isReportOnlyRole("vam_admin")).toBe(true);
    for (const role of ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"]) {
      expect(isReportOnlyRole(role), role).toBe(false);
    }
  });

  it("may reach the reporting console and the programme picker, and nothing else", () => {
    expect(isReportOnlyPath("/bao-cao")).toBe(true);
    expect(isReportOnlyPath("/chon-chuong-trinh")).toBe(true);
    for (const path of STAFF_ROUTES) {
      if (path === "/") continue;
      expect(isReportOnlyPath(path), path).toBe(false);
    }
  });

  it("is turned away by middleware rather than by each page", () => {
    expect(middleware).toContain("isReportOnlyRole(session.role)");
    expect(middleware).toContain("isReportOnlyPath(request.nextUrl.pathname)");
    expect(middleware).toContain("url.pathname = ROUTES.reports");
  });

  it("lands on the reporting console even carrying a deep link into operations", () => {
    for (const next of STAFF_ROUTES) {
      const decision = resolvePostLogin({ adminRole: "vam_admin", requestedNext: next });
      expect(decision.outcome, next).toBe("reports");
      expect(decision.redirectTo, next).toBe(ROUTES.reports);
    }
  });

  it("is offered one navigation link, so nothing dangles", () => {
    expect(allNavHrefs(buildNavGroups(makeUser("vam_admin")))).toEqual(["/bao-cao"]);
  });
});

describe("staff are unaffected", () => {
  it("still lands ordinary staff on the operations dashboard", () => {
    const decision = resolvePostLogin({ adminRole: "core_team" });
    expect(decision.outcome).toBe("staff");
    expect(decision.redirectTo).toBe(ROUTES.staffHome);
  });

  it("still honours a staff deep link", () => {
    for (const next of STAFF_ROUTES) {
      if (next === ROUTES.staffHome) continue;
      const decision = resolvePostLogin({ adminRole: "admin", requestedNext: next });
      expect(decision.redirectTo, next).toBe(next);
    }
  });

  it("keeps the staff experience for a mentor who is also an interviewer", () => {
    // lib/enable-reviewer.ts creates exactly this: a reviewer row whose
    // linked_person_id points at a real mentor.
    const decision = resolvePostLogin({
      adminRole: "reviewer",
      hasParticipantAccount: true,
      programs: [{ programId: "p1", programCode: "UEHM", programName: "UEH Mentoring" }]
    });
    expect(decision.outcome).toBe("staff");
  });
});
