import { describe, expect, it, vi, beforeEach, Mock } from "vitest";

// Mock React cache since program-scope imports it
vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: any) => fn };
});

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));

import { getSupabaseServiceRoleClient, getSupabaseServerClient } from "@/lib/supabase-server";
import { getReviewAssignableApplications } from "@/lib/data";

describe("getReviewAssignableApplications (Data layer round semantics)", () => {
  const mockDb = {
    apps: [] as any[],
    reviews: [] as any[],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.apps = [];
    mockDb.reviews = [];

    const fakeClient = {
      from: vi.fn((table: string) => {
        let currentGt: string | null = null;
        let query: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          gt: vi.fn((key: string, val: string) => { currentGt = val; return query; }),
        };
        
        const runQuery = async () => {
          if (currentGt) return { data: [], error: null };
          if (table === "applications") return { data: mockDb.apps, error: null };
          if (table === "application_reviews") return { data: mockDb.reviews, error: null };
          return { data: [], error: null };
        };
        
        query.order = vi.fn().mockReturnThis();
        query.range = vi.fn().mockReturnThis();
        query.then = (resolve: any) => runQuery().then(resolve);

        return query;
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
    };

    (getSupabaseServiceRoleClient as Mock).mockReturnValue(fakeClient as any);
    (getSupabaseServerClient as Mock).mockReturnValue(fakeClient as any);
  });

  it("filters profile_screening strictly by profile statuses", async () => {
    mockDb.apps = [
      { id: "app1", status: "submitted" },
      { id: "app2", status: "invited_to_interview" },
      { id: "app3", status: "screening_assigned" },
    ];
    
    const { data, error } = await getReviewAssignableApplications({ reviewRound: "profile_screening" });
    if (error) throw new Error(String(error));
    const ids = data.map(a => a.id);
    expect(ids).toContain("app1");
    expect(ids).toContain("app3");
    expect(ids).not.toContain("app2"); // Wrong round status
  });

  it("filters interview strictly by interview statuses", async () => {
    mockDb.apps = [
      { id: "app1", status: "submitted" },
      { id: "app2", status: "invited_to_interview" },
      { id: "app3", status: "interview_in_progress" },
    ];
    
    const { data, error } = await getReviewAssignableApplications({ reviewRound: "interview" });
    if (error) throw new Error(String(error));
    const ids = data.map(a => a.id);
    expect(ids).toContain("app2");
    expect(ids).toContain("app3");
    expect(ids).not.toContain("app1");
  });

  it("preserves M093 needs_more_review exact provenance", async () => {
    mockDb.apps = [
      { id: "app_no_interview", status: "needs_more_review" },
      { id: "app_with_cancelled_interview", status: "needs_more_review" },
      { id: "app_with_active_interview", status: "needs_more_review" }
    ];
    
    mockDb.reviews = [
      { id: "r1", application_id: "app_with_cancelled_interview", review_round: "interview", status: "cancelled", reviewer_admin_user_id: "rev1" },
      { id: "r2", application_id: "app_with_active_interview", review_round: "interview", status: "assigned", reviewer_admin_user_id: "rev1" },
      { id: "r3", application_id: "app_no_interview", review_round: "profile_screening", status: "assigned", reviewer_admin_user_id: "rev2" },
    ];

    // For profile_screening: only app_no_interview should be eligible because it has no interview row
    const profileResult = await getReviewAssignableApplications({ reviewRound: "profile_screening" });
    if (profileResult.error) throw new Error(String(profileResult.error));
    const profileIds = profileResult.data.map(a => a.id);
    expect(profileIds).toContain("app_no_interview");
    expect(profileIds).not.toContain("app_with_cancelled_interview");
    expect(profileIds).not.toContain("app_with_active_interview");

    // For interview: the other two are eligible because they have an interview row (cancelled or active doesn't matter for provenance)
    const interviewResult = await getReviewAssignableApplications({ reviewRound: "interview" });
    if (interviewResult.error) throw new Error(String(interviewResult.error));
    const interviewIds = interviewResult.data.map(a => a.id);
    expect(interviewIds).not.toContain("app_no_interview");
    expect(interviewIds).toContain("app_with_cancelled_interview");
    expect(interviewIds).toContain("app_with_active_interview");
  });

  it("current assignment detection excludes cancelled rows", async () => {
    mockDb.apps = [
      { id: "app_active", status: "submitted" },
      { id: "app_cancelled", status: "submitted" }
    ];
    
    mockDb.reviews = [
      { id: "r1", application_id: "app_active", review_round: "profile_screening", status: "assigned", reviewer_admin_user_id: "rev1" },
      { id: "r2", application_id: "app_cancelled", review_round: "profile_screening", status: "cancelled", reviewer_admin_user_id: "rev2" }
    ];

    const { data, error } = await getReviewAssignableApplications({ reviewRound: "profile_screening" });
    if (error) throw new Error(String(error));
    
    const active = data.find(a => a.id === "app_active");
    expect(active?.existing_review_count).toBe(1);
    expect(active?.existing_reviewer_id).toBe("rev1");

    const cancelled = data.find(a => a.id === "app_cancelled");
    expect(cancelled?.existing_review_count).toBe(0);
    expect(cancelled?.existing_reviewer_id).toBe(null);
  });
});
