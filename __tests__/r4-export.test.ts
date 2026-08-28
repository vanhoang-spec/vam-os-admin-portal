import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/applications/export/route";
import * as dataLib from "@/lib/data";
import * as adminScope from "@/lib/program-scope";
import * as auth from "@/lib/admin-auth";
import * as excel from "write-excel-file/node";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const { mockSupabase } = vi.hoisted(() => {
  const m: any = {};
  m.from = vi.fn(() => m);
  m.select = vi.fn(() => m);
  m.in = vi.fn(() => m);
  m.then = vi.fn((resolve: any) => resolve({ data: [], error: null }));
  return { mockSupabase: m };
});

vi.mock("@/lib/data", () => ({
  getApplications: vi.fn(),
  getAllApplicationReviews: vi.fn(),
  getIntakeBatches: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn(),
}));

vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => {
  return {
    getSupabaseServerClient: vi.fn(() => mockSupabase),
  };
});

vi.mock("write-excel-file/node", () => ({
  default: vi.fn().mockResolvedValue(Buffer.from("fake-excel-data")),
}));

describe("R4 Export API Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.then.mockImplementation((resolve: any) => resolve({ data: [], error: null }));
  });

  const setupAuth = (role: string | null) => {
    if (role) {
      vi.mocked(auth.getCurrentAdminUser).mockResolvedValue({ id: "1", role } as any);
    } else {
      vi.mocked(auth.getCurrentAdminUser).mockResolvedValue(null);
    }
    vi.mocked(adminScope.getAdminScopeContext).mockResolvedValue({} as any);
    vi.mocked(adminScope.getScopeFilter).mockResolvedValue({} as any);
  };

  const setupDefaultMocks = () => {
    vi.mocked(dataLib.getApplications).mockResolvedValue({ data: [], error: null } as any);
    vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({ data: [], error: null } as any);
    vi.mocked(dataLib.getIntakeBatches).mockResolvedValue({ data: [], error: null } as any);
  };

  describe("11. Real Auth Policy", () => {
    it("allows explicit roles", async () => {
      for (const role of ["super_admin", "admin", "core_team"]) {
        setupAuth(role);
        setupDefaultMocks();
        
        const req = new NextRequest("http://localhost/api/applications/export");
        const res = await GET(req);
        expect(res.status).toBe(200);
      }
    });

    it("denies unauthenticated and other roles", async () => {
      for (const role of [null, "reviewer", "support_team", "viewer"]) {
        setupAuth(role);
        setupDefaultMocks();
        
        const req = new NextRequest("http://localhost/api/applications/export");
        const res = await GET(req);
        expect(res.status).toBe(403);
      }
    });
  });

  describe("2. Fail Closed on Source Errors", () => {
    it("fails on applications query error", async () => {
      setupAuth("admin");
      setupDefaultMocks();
      vi.mocked(dataLib.getApplications).mockResolvedValue({ data: null, error: "DB Error" } as any);

      const req = new NextRequest("http://localhost/api/applications/export");
      const res = await GET(req);
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("Failed to load applications");
    });

    it("fails on reviews query error", async () => {
      setupAuth("admin");
      setupDefaultMocks();
      vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({ data: null, error: "DB Error" } as any);

      const req = new NextRequest("http://localhost/api/applications/export");
      const res = await GET(req);
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("Failed to load reviews");
    });

    it("fails on batches query error", async () => {
      setupAuth("admin");
      setupDefaultMocks();
      vi.mocked(dataLib.getIntakeBatches).mockResolvedValue({ data: null, error: "DB Error" } as any);

      const req = new NextRequest("http://localhost/api/applications/export");
      const res = await GET(req);
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("Failed to load batches");
    });
  });

  describe("3. Reviewer Identity", () => {
    it("resolves full name and email for reviewers", async () => {
      setupAuth("admin");
      setupDefaultMocks();
      vi.mocked(dataLib.getApplications).mockResolvedValue({
        data: [{ id: "app-1", status: "submitted" }],
        error: null
      } as any);
      vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({
        data: [{ id: "r1", application_id: "app-1", reviewer_admin_user_id: "user-123" }],
        error: null
      } as any);
      
      mockSupabase.then
        .mockImplementationOnce((resolve: any) => resolve({ data: [], error: null })) // seasons
        .mockImplementationOnce((resolve: any) => resolve({ data: [{ id: "user-123", full_name: "John Doe", email: "john@example.com" }], error: null }));

      const req = new NextRequest("http://localhost/api/applications/export?type=detail&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      const lines = csv.split("\n");
      const dataCols = lines[1].split(",");
      
      expect(dataCols[4]).toBe("John Doe"); // Reviewer Name
      expect(dataCols[5]).toBe("john@example.com"); // Reviewer Email
    });
  });

  describe("4. Season Output", () => {
    it("resolves season code and populates correctly", async () => {
      setupAuth("admin");
      setupDefaultMocks();
      vi.mocked(dataLib.getApplications).mockResolvedValue({
        data: [{ id: "app-1", season_id: "season-id-1", status: "submitted" }],
        error: null
      } as any);
      
      mockSupabase.then
        .mockImplementationOnce((resolve: any) => resolve({ data: [{ id: "season-id-1", code: "UEHM-S12" }], error: null }))
        .mockImplementationOnce((resolve: any) => resolve({ data: [], error: null }));

      const req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      const lines = csv.split("\n");
      const dataCols = lines[1].split(",");
      
      expect(dataCols[0]).toBe("UEHM-S12"); // Season Code
    });
  });

  describe("7. Data Semantics Tests", () => {
    it("aggregates only submitted reviews and calculates correctly", async () => {
      setupAuth("admin");
      setupDefaultMocks();
      vi.mocked(dataLib.getApplications).mockResolvedValue({
        data: [{ id: "app-1", status: "submitted" }],
        error: null
      } as any);
      
      vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({
        data: [
          { id: "r1", application_id: "app-1", review_round: "profile_screening", status: "submitted", total_score: 10, recommendation: "Yes" },
          { id: "r2", application_id: "app-1", review_round: "profile_screening", status: "submitted", total_score: 20, recommendation: "Maybe" },
          { id: "r3", application_id: "app-1", review_round: "profile_screening", status: "assigned", total_score: 30, recommendation: "No" },
          { id: "r4", application_id: "app-1", review_round: "profile_screening", status: "cancelled", total_score: 40, recommendation: "No" },
          { id: "r5", application_id: "app-1", review_round: "interview", status: "submitted", total_score: 50, recommendation: "Pass" },
        ],
        error: null
      } as any);

      const req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      const lines = csv.split("\n");
      const cols = lines[1].split(",");

      expect(cols[9]).toBe("2"); // Profile count
      expect(cols[10]).toBe("15.00"); // Profile avg
      expect(cols[11]).toBe("Yes; Maybe"); // Profile recs
      
      expect(cols[12]).toBe("1"); // Interview count
      expect(cols[13]).toBe("50.00"); // Interview avg
      expect(cols[14]).toBe("Pass"); // Interview recs
    });
  });

  describe("2. Final Decision Contract", () => {
    it("maps final statuses correctly", async () => {
      setupAuth("admin");
      setupDefaultMocks();
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

      const req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      const lines = csv.split("\n");

      expect(lines[1].split(",")[8]).toBe("Accepted");
      expect(lines[2].split(",")[8]).toBe("Accepted");
      expect(lines[3].split(",")[8]).toBe("Rejected");
      expect(lines[4].split(",")[8]).toBe("Withdrawn");
      expect(lines[5].split(",")[8]).toBe("Pending");
      expect(lines[6].split(",")[8]).toBe("Pending");
    });
  });

  describe("9. Spreadsheet Safety", () => {
    it("prepends tick to malicious formulas", async () => {
      setupAuth("admin");
      setupDefaultMocks();
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

      const req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      const res = await GET(req);
      const csv = await res.text();
      const dataCols = csv.split("\n")[1].split(",");
      
      expect(dataCols[2]).toBe("'-500");
      expect(dataCols[4]).toBe("'=cmd|' /C calc'!A0");
      expect(dataCols[5]).toBe("'+12345");
      expect(dataCols[6]).toBe("'@danger");
    });
  });
  
  describe("8. CSV Quoting", () => {
    it("quotes fields with commas, newlines and double quotes", async () => {
      setupAuth("admin");
      setupDefaultMocks();
      vi.mocked(dataLib.getApplications).mockResolvedValue({
        data: [{
          id: "app-1", 
          status: "submitted",
          full_name: "Nguyễn, Văn A",
          email_primary: 'He said "OK"',
        }],
        error: null
      } as any);
      vi.mocked(dataLib.getAllApplicationReviews).mockResolvedValue({
        data: [{ id: "r1", application_id: "app-1", reviewer_note: "Line1\nLine2" }],
        error: null
      } as any);

      let req = new NextRequest("http://localhost/api/applications/export?type=summary&format=csv");
      let res = await GET(req);
      let csv = await res.text();
      let lines = csv.split("\n");
      
      expect(lines[1]).toContain('"Nguyễn, Văn A"');
      expect(lines[1]).toContain('"He said ""OK"""');
      
      req = new NextRequest("http://localhost/api/applications/export?type=detail&format=csv");
      res = await GET(req);
      csv = await res.text();
      expect(csv).toContain('"Line1\nLine2"');
    });
  });
});
