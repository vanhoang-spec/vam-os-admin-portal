import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/applications/export/route";
import * as dataLib from "../lib/data";
import * as adminScope from "../lib/program-scope";
import * as auth from "../lib/admin-auth";
import * as readAccess from "../lib/read-access";
import * as excel from "write-excel-file/node";

// Mock dependencies
vi.mock("@/lib/data", () => ({
  getApplications: vi.fn(),
  getAllApplicationReviews: vi.fn(),
  getIntakeBatches: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn(),
}));

vi.mock("@/lib/read-access", () => ({
  canBrowseApplications: vi.fn(),
}));

vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn(),
}));

vi.mock("write-excel-file/node", () => ({
  default: vi.fn().mockResolvedValue(Buffer.from("fake-excel-data")),
}));

describe("R4 Export API Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupAuth = (role: string) => {
    vi.mocked(auth.getCurrentAdminUser).mockResolvedValue({ id: "1", role } as any);
    vi.mocked(readAccess.canBrowseApplications).mockReturnValue(["super_admin", "admin", "core_team"].includes(role));
    vi.mocked(adminScope.getAdminScopeContext).mockResolvedValue({} as any);
    vi.mocked(adminScope.getScopeFilter).mockResolvedValue({} as any);
  };

  describe("6. Authorization Certification", () => {
    it("allows super_admin, admin, core_team", async () => {
      for (const role of ["super_admin", "admin", "core_team"]) {
        setupAuth(role);
        vi.mocked(dataLib.getApplications).mockResolvedValue({ data: [], error: null } as any);
        vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({ data: [], error: null } as any);
        vi.mocked(dataLib.getIntakeBatches).mockResolvedValue({ data: [], error: null } as any);
        
        const req = new NextRequest("http://localhost/api/applications/export");
        const res = await GET(req);
        expect(res.status).toBe(200);
      }
    });

    it("denies unauthenticated, reviewer, support_team, viewer", async () => {
      for (const role of [null, "reviewer", "support_team", "viewer"]) {
        if (role) {
          setupAuth(role);
        } else {
          vi.mocked(auth.getCurrentAdminUser).mockResolvedValue(null);
        }
        vi.mocked(dataLib.getIntakeBatches).mockResolvedValue({ data: [], error: null } as any);
        
        const req = new NextRequest("http://localhost/api/applications/export");
        const res = await GET(req);
        expect(res.status).toBe(403);
      }
    });
  });

  describe("7. Data Semantics Tests", () => {
    it("aggregates only submitted reviews and calculates correctly", async () => {
      setupAuth("admin");
      vi.mocked(dataLib.getApplications).mockResolvedValue({
        data: [{ id: "app-1", status: "submitted" }],
        error: null
      } as any);
      
      vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({
        data: [
          // A: no review (not present)
          // B, C: profile reviews
          { id: "r1", application_id: "app-1", review_round: "profile_screening", status: "submitted", total_score: 10, recommendation: "Yes" },
          { id: "r2", application_id: "app-1", review_round: "profile_screening", status: "submitted", total_score: 20, recommendation: "Maybe" },
          // D: assigned unfinished review
          { id: "r3", application_id: "app-1", review_round: "profile_screening", status: "assigned", total_score: 30, recommendation: "No" },
          // E: cancelled old review
          { id: "r4", application_id: "app-1", review_round: "profile_screening", status: "cancelled", total_score: 40, recommendation: "No" },
          // F, G: interview reviews
          { id: "r5", application_id: "app-1", review_round: "interview", status: "submitted", total_score: 50, recommendation: "Pass" },
        ],
        error: null
      } as any);
      vi.mocked(dataLib.getIntakeBatches).mockResolvedValue({ data: [], error: null } as any);

      const req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      
      expect(res.status).toBe(200);
      const lines = csv.split("\n");
      const dataLine = lines[1];
      const cols = dataLine.split(",");

      // Profile count: 2 (r1, r2). r3 (assigned) and r4 (cancelled) ignored.
      expect(cols[9]).toBe("2");
      // Profile avg: (10 + 20) / 2 = 15.00
      expect(cols[10]).toBe("15.00");
      // Profile recommendations: "Yes; Maybe"
      expect(cols[11]).toBe("Yes; Maybe");
      
      // Interview count: 1 (r5)
      expect(cols[12]).toBe("1");
      expect(cols[13]).toBe("50.00");
      expect(cols[14]).toBe("Pass");
    });
  });

  describe("2. Final Decision Contract", () => {
    it("maps final statuses correctly", async () => {
      setupAuth("admin");
      vi.mocked(dataLib.getApplications).mockResolvedValue({
        data: [
          { id: "app-acc-mentor", status: "approved_as_mentor" },
          { id: "app-acc-mentee", status: "approved_as_mentee" },
          { id: "app-rej", status: "rejected_or_not_fit" },
          { id: "app-withdrawn", status: "withdrawn" },
          { id: "app-wait", status: "waitlisted" },
          { id: "app-sub", status: "submitted" },
        ],
        error: null
      } as any);
      vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({ data: [], error: null } as any);
      vi.mocked(dataLib.getIntakeBatches).mockResolvedValue({ data: [], error: null } as any);

      const req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      const lines = csv.split("\n");

      // Final Decision is column index 8
      expect(lines[1].split(",")[8]).toBe("Accepted");
      expect(lines[2].split(",")[8]).toBe("Accepted");
      expect(lines[3].split(",")[8]).toBe("Rejected");
      expect(lines[4].split(",")[8]).toBe("Withdrawn");
      expect(lines[5].split(",")[8]).toBe("Pending");
      expect(lines[6].split(",")[8]).toBe("Pending");
    });
  });

  describe("8. >1000 Completeness", () => {
    it("returns exactly 1500 rows when present", async () => {
      setupAuth("admin");
      const largeApps = Array.from({ length: 1500 }).map((_, i) => ({
        id: `app-${i}`, status: "submitted"
      }));
      vi.mocked(dataLib.getApplications).mockResolvedValue({ data: largeApps, error: null } as any);
      vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({ data: [], error: null } as any);
      vi.mocked(dataLib.getIntakeBatches).mockResolvedValue({ data: [], error: null } as any);

      const req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      // header + 1500 rows + trailing empty line
      expect(csv.split("\n").length).toBe(1502);
    });
  });

  describe("9. Spreadsheet Safety", () => {
    it("prepends tick to malicious formulas", async () => {
      setupAuth("admin");
      vi.mocked(dataLib.getApplications).mockResolvedValue({
        data: [{
          id: "app-1", 
          status: "submitted",
          full_name: "=cmd|' /C calc'!A0",
          email_primary: "+12345",
          role_applied: "-500",
          raw_payload: { mssv: "@danger" }
        }],
        error: null
      } as any);
      vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({ data: [], error: null } as any);
      vi.mocked(dataLib.getIntakeBatches).mockResolvedValue({ data: [], error: null } as any);

      const req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      const dataCols = csv.split("\n")[1].split(",");
      
      // Role (col 2), Name (col 4), Email (col 5), MSSV (col 6)
      expect(dataCols[2]).toBe("'-500");
      expect(dataCols[4]).toBe("'=cmd|' /C calc'!A0");
      expect(dataCols[5]).toBe("'+12345");
      expect(dataCols[6]).toBe("'@danger");
    });
  });
});
