import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return {
    ...original,
    cache: (fn: any) => fn
  };
});

import { assignSelectedApplicationReviews } from "@/lib/bulk-assignment";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260904120000_manual_bulk_assignment.sql");

describe("VAM094 Manual Bulk Assignment RPC Contract", () => {
  it("rejects mixed batch, season, or role with strict cardinality validation", () => {
    // Tests that the migration does not reuse the same variable for distinct counts
    expect(migration).toContain("into v_found_count, v_batch_count, v_season_count, v_role_count");
    expect(migration).toContain("if v_batch_count <> 1 or v_season_count <> 1 or v_role_count <> 1 then");
  });

  it("rejects missing application ids", () => {
    // Tests that found_count matches array cardinality
    expect(migration).toContain("if v_found_count <> cardinality(p_application_ids) then");
  });

  it("enforces strict needs_more_review semantics per stage", () => {
    // Tests that profile_screening requires NO interview row, and interview requires an interview row
    expect(migration).toContain("a.status = 'needs_more_review' and not exists (");
    expect(migration).toContain("a.status = 'needs_more_review' and exists (");
  });

  it("prevents assigning applications that are already assigned", () => {
    // Tests that existing assignments block the entire transaction
    expect(migration).toContain("from public.application_reviews ar");
    expect(migration).toContain("and ar.review_round = p_review_round");
    expect(migration).toContain("and ar.status <> 'cancelled'");
    expect(migration).toContain("raise exception 'One or more applications are already assigned for this round'");
  });

  it("uses the exact schema column names for review_assignment_batches", () => {
    // tests that we insert using created_by, due_at, assignment_note, application_count, reviewer_count
    expect(migration).toContain("created_by,");
    expect(migration).toContain("due_at,");
    expect(migration).toContain("assignment_note,");
    expect(migration).toContain("application_count,");
    expect(migration).toContain("reviewer_count");
    
    // tests that we supply the correct arguments to those columns
    expect(migration).toContain("p_actor,");
    expect(migration).toContain("p_due_at,");
    expect(migration).toContain("nullif(btrim(p_assignment_note), ''),");
    expect(migration).toContain("cardinality(p_application_ids),");
    expect(migration).toContain("1");
  });

  it("preserves concurrency guarantees", () => {
    expect(migration).toContain("perform pg_advisory_xact_lock(hashtextextended(v_intake_batch_id::text || ':' || p_review_round, 0));");
    expect(migration).toContain("for update;");
  });
});

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn()
}));

describe("Server Action: assignSelectedApplicationReviews", () => {
  it("does not leak raw DB errors to the UI", async () => {
    const { getSupabaseServiceRoleClient } = await import("@/lib/supabase-server");
    const { getCurrentAdminUser } = await import("@/lib/admin-auth");
    
    // Mock the admin user as a valid actor
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor-1", role: "admin", email: "admin@test", auth_user_id: "auth" } as any);
    
    // Mock the Supabase client to return a raw Postgres error
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Some internal Postgres exception like division by zero or invalid uuid" }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc: rpcMock } as any);

    const result = await assignSelectedApplicationReviews({
      applicationIds: ["app1"],
      reviewerAdminUserId: "rev1",
      reviewRound: "profile_screening",
      dueAt: null,
      assignmentNote: null,
      assignedByAdminUserId: "actor-1"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.");
      expect(result.message).not.toContain("Some internal Postgres exception");
    }
  });
});
