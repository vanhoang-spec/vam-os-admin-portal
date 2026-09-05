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

  /** Every `.select()` projection issued, per table. */
  let recordedProjections: Array<{ table: string; columns: string }> = [];
  /** Every column passed to `.in()`, in call order. */
  let recordedInColumns: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.apps = [];
    mockDb.reviews = [];
    recordedProjections = [];
    recordedInColumns = [];

    const fakeClient = {
      from: vi.fn((table: string) => {
        // Faithful enough to catch projection and filter-column mistakes.
        //
        // A real PostgREST response contains ONLY the columns named in
        // `select`, and `.in()` filters on the column it is given. A fake that
        // returns whole rows regardless of projection cannot distinguish a
        // correct read from one that forgot to select the columns it later
        // reads — which is exactly how a swapped-argument call passed review.
        let projection: string[] = [];
        let cursor: string | null = null;
        const preds: Array<(r: any) => boolean> = [];

        const rowsFor = () => {
          if (table === "applications") return mockDb.apps;
          if (table === "application_reviews") return mockDb.reviews;
          return [];
        };

        const project = (row: any) => {
          if (!projection.length || projection.includes("*")) return { ...row };
          const out: any = {};
          for (const col of projection) {
            // An unknown column simply is not present in the response.
            if (Object.prototype.hasOwnProperty.call(row, col)) out[col] = row[col];
          }
          return out;
        };

        const run = async () => {
          if (cursor) return { data: [], error: null }; // keyset page 2 = exhausted
          const rows = rowsFor().filter((r) => preds.every((p) => p(r)));
          return { data: rows.map(project), error: null };
        };

        const query: any = {
          select: vi.fn((cols: string) => {
            projection = String(cols ?? "*").split(",").map((c) => c.trim()).filter(Boolean);
            return query;
          }),
          eq: vi.fn((col: string, val: any) => {
            preds.push((r) => r[col] === val);
            return query;
          }),
          neq: vi.fn((col: string, val: any) => {
            preds.push((r) => r[col] !== val);
            return query;
          }),
          in: vi.fn((col: string, vals: any[]) => {
            recordedInColumns.push(col);
            const set = new Set(vals);
            preds.push((r) => set.has(r[col]));
            return query;
          }),
          gt: vi.fn((_col: string, val: string) => {
            cursor = val;
            return query;
          }),
          order: vi.fn(() => query),
          limit: vi.fn(() => query),
          range: vi.fn(() => query)
        };

        query.then = (resolve: any, reject: any) => run().then(resolve, reject);

        // Record what each table was actually asked for.
        const origSelect = query.select;
        query.select = vi.fn((cols: string) => {
          recordedProjections.push({ table, columns: String(cols ?? "*") });
          return origSelect(cols);
        });

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
      { id: "app4", status: "withdrawn" },
    ];
    
    const { data, error } = await getReviewAssignableApplications({ reviewRound: "profile_screening" });
    if (error) throw new Error(String(error));
    const ids = data.map(a => a.id);
    expect(ids).toContain("app1");
    expect(ids).toContain("app3");
    expect(ids).not.toContain("app2"); // Wrong round status
    expect(ids).not.toContain("app4"); // Terminal application
  });

  it("filters interview strictly by interview statuses", async () => {
    mockDb.apps = [
      { id: "app1", status: "submitted" },
      { id: "app2", status: "invited_to_interview" },
      { id: "app3", status: "interview_in_progress" },
      { id: "app4", status: "withdrawn" },
    ];
    
    const { data, error } = await getReviewAssignableApplications({ reviewRound: "interview" });
    if (error) throw new Error(String(error));
    const ids = data.map(a => a.id);
    expect(ids).toContain("app2");
    expect(ids).toContain("app3");
    expect(ids).not.toContain("app1");
    expect(ids).not.toContain("app4");
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

  it("STAGING_2026_09_04: an assigned application is NOT offered as unassigned", async () => {
    // Reproduces the second Staging UAT failure. The UI listed these rows as
    // "Chưa giao" and the operator selected them; the RPC then refused the
    // whole batch with
    //   P0001 One or more applications are already assigned for this round
    // The database was right. The read that fed the UI was wrong.
    mockDb.apps = [
      { id: "app_assigned_1", status: "screening_assigned" },
      { id: "app_assigned_2", status: "screening_assigned" },
      { id: "app_free", status: "ready_for_screening" }
    ];
    mockDb.reviews = [
      { id: "r1", application_id: "app_assigned_1", review_round: "profile_screening", status: "assigned", reviewer_admin_user_id: "rev1" },
      { id: "r2", application_id: "app_assigned_2", review_round: "profile_screening", status: "in_progress", reviewer_admin_user_id: "rev1" }
    ];

    const { data, error } = await getReviewAssignableApplications({ reviewRound: "profile_screening" });
    if (error) throw new Error(String(error));

    const a1 = data.find((a) => a.id === "app_assigned_1");
    const a2 = data.find((a) => a.id === "app_assigned_2");
    const free = data.find((a) => a.id === "app_free");

    // These two must be reported as already assigned, so the form disables them
    // and they can never reach the RPC.
    expect(a1?.existing_review_count).toBe(1);
    expect(a1?.existing_reviewer_id).toBe("rev1");
    expect(a2?.existing_review_count).toBe(1);
    expect(a2?.existing_reviewer_id).toBe("rev1");

    // The genuinely free one stays selectable.
    expect(free?.existing_review_count).toBe(0);
    expect(free?.existing_reviewer_id).toBe(null);
  });

  it("READ_CONTRACT: the reviews read selects the columns it later reads", async () => {
    mockDb.apps = [{ id: "app1", status: "submitted" }];
    mockDb.reviews = [
      { id: "r1", application_id: "app1", review_round: "profile_screening", status: "assigned", reviewer_admin_user_id: "rev1" }
    ];

    await getReviewAssignableApplications({ reviewRound: "profile_screening" });

    const reviewSelects = recordedProjections
      .filter((p) => p.table === "application_reviews")
      .map((p) => p.columns.split(",").map((c) => c.trim()));
    expect(reviewSelects.length).toBeGreaterThan(0);

    // status and review_round are read from every row; a projection that omits
    // them makes every application look unassigned.
    for (const cols of reviewSelects) {
      expect(cols).toContain("application_id");
      expect(cols).toContain("review_round");
      expect(cols).toContain("status");
      expect(cols).toContain("reviewer_admin_user_id");
    }

    // The IN filter must name a single real column, never a projection list.
    for (const col of recordedInColumns) {
      expect(col).not.toContain(",");
    }
    expect(recordedInColumns).toContain("application_id");
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
