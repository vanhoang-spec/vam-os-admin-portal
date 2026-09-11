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
    // The INSERT column list and its VALUES list must line up positionally.
    const insert = migration.match(
      /insert into public\.review_assignment_batches\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*returning/i
    );
    expect(insert).not.toBeNull();

    const columns = insert![1].split(",").map((c) => c.trim()).filter(Boolean);
    const values = insert![2].split(/,(?![^()]*\))/).map((v) => v.trim()).filter(Boolean);

    expect(columns).toEqual([
      "intake_batch_id",
      "review_round",
      "created_by",
      "due_at",
      "assignment_note",
      "application_count",
      "reviewer_count"
    ]);
    expect(values).toHaveLength(columns.length);
    expect(values[columns.indexOf("created_by")]).toBe("p_actor");
    expect(values[columns.indexOf("due_at")]).toBe("p_due_at");
    expect(values[columns.indexOf("assignment_note")]).toBe("nullif(btrim(p_assignment_note), '')");
    expect(values[columns.indexOf("application_count")]).toBe("cardinality(p_application_ids)");
    // MANUAL model: exactly one assignee per batch, never a distributed set.
    expect(values[columns.indexOf("reviewer_count")]).toBe("1");
  });

  it("MANUAL_SINGLE_ASSIGNEE: takes one scalar reviewer, not an array", () => {
    expect(migration).toContain("p_reviewer_id uuid");
    expect(migration).not.toContain("p_reviewer_ids");
    // Every inserted review row is pinned to that single assignee.
    expect(migration).toMatch(/reviewer_admin_user_id[\s\S]{0,400}?p_reviewer_id/);
    // No distribution logic leaked in from the vam090 round-robin path.
    expect(migration).not.toMatch(/round.?robin|order by random|% *cardinality|ntile\(/i);
  });

  it("TRUSTED_CONTEXT_ONLY: refuses any caller that is not service_role", () => {
    expect(migration).toContain("if current_user <> 'service_role' then raise exception");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toMatch(
      /revoke all on function public\.vam094_assign_selected_application_reviews[\s\S]*?from public, anon, authenticated/
    );
    expect(migration).toMatch(
      /grant execute on function public\.vam094_assign_selected_application_reviews[\s\S]*?to service_role/
    );
  });

  it("NEGATIVE_AUTH: operator season scope and assignee stage eligibility are both enforced in-database", () => {
    // Authorization is a DB predicate, not UI hiding.
    expect(migration).toContain("if not public.vam084_operator_for_season(p_actor, v_season_id) then");
    expect(migration).toContain("raise exception 'Assignment batch scope denied'");
    // Interview policy must reuse the EXISTING stage predicate, not a widened one.
    expect(migration).toContain(
      "if not public.vam084_participant_for_stage(p_reviewer_id, v_season_id, p_review_round) then"
    );
    expect(migration).not.toMatch(/create or replace function public\.vam084_participant_for_stage/i);
  });

  it("BOUNDED_AND_DEDUPED: rejects empty, oversized, or duplicated id arrays", () => {
    expect(migration).toContain("if coalesce(cardinality(p_application_ids), 0) < 1 then");
    expect(migration).toContain("if cardinality(p_application_ids) > 500 then");
    expect(migration).toContain("raise exception 'Application IDs must be unique'");
  });

  it("does not widen the shared interview stage policy", () => {
    // The whole migration must not redefine any vam084_ policy function.
    const redefinitions = migration.match(/create or replace function public\.vam084_\w+/gi) ?? [];
    expect(redefinitions).toEqual([]);
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

  it("ALREADY_ASSIGNED: says why, and asks the screen to reload its stale list", async () => {
    const { getSupabaseServiceRoleClient } = await import("@/lib/supabase-server");
    const { getCurrentAdminUser } = await import("@/lib/admin-auth");

    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor-1", role: "admin", email: "admin@test", auth_user_id: "auth" } as any);
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "One or more applications are already assigned for this round" }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc: rpcMock } as any);

    const result = await assignSelectedApplicationReviews({
      applicationIds: ["app1", "app2"],
      reviewerAdminUserId: "rev1",
      reviewRound: "profile_screening",
      dueAt: null,
      assignmentNote: null,
      assignedByAdminUserId: "actor-1"
    });

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("đã được giao chấm hồ sơ trước đó"),
      refreshList: true
    });
  });

  it("SCOPE_DENIED: says so, and does not ask for a reload", async () => {
    const { getSupabaseServiceRoleClient } = await import("@/lib/supabase-server");
    const { getCurrentAdminUser } = await import("@/lib/admin-auth");

    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor-1", role: "admin", email: "admin@test", auth_user_id: "auth" } as any);
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Assignment batch scope denied" }
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

    expect(result).toEqual({
      ok: false,
      message: "Bạn không có quyền vận hành mùa của các hồ sơ này.",
      refreshList: false
    });
  });

  it("NEGATIVE_AUTH_ROLE: a reviewer cannot assign work to anyone", async () => {
    const { getSupabaseServiceRoleClient } = await import("@/lib/supabase-server");
    const { getCurrentAdminUser } = await import("@/lib/admin-auth");

    vi.mocked(getCurrentAdminUser).mockResolvedValue({
      id: "reviewer-1", role: "reviewer", email: "rev@test", auth_user_id: "auth"
    } as any);
    const rpcMock = vi.fn();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc: rpcMock } as any);

    const result = await assignSelectedApplicationReviews({
      applicationIds: ["app1"],
      reviewerAdminUserId: "rev2",
      reviewRound: "profile_screening",
      dueAt: null,
      assignmentNote: null,
      assignedByAdminUserId: "reviewer-1"
    });

    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("NEGATIVE_AUTH_IDENTITY: a spoofed actor id cannot mutate another admin's batch", async () => {
    const { getSupabaseServiceRoleClient } = await import("@/lib/supabase-server");
    const { getCurrentAdminUser } = await import("@/lib/admin-auth");

    // The session belongs to admin-A, but the payload claims admin-B.
    vi.mocked(getCurrentAdminUser).mockResolvedValue({
      id: "admin-A", role: "admin", email: "a@test", auth_user_id: "auth"
    } as any);
    const rpcMock = vi.fn();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc: rpcMock } as any);

    const result = await assignSelectedApplicationReviews({
      applicationIds: ["app1"],
      reviewerAdminUserId: "rev1",
      reviewRound: "profile_screening",
      dueAt: null,
      assignmentNote: null,
      assignedByAdminUserId: "admin-B"
    });

    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ONLY_SELECTED_IDS_REACH_THE_DATABASE, de-duplicated and with one assignee", async () => {
    const { getSupabaseServiceRoleClient } = await import("@/lib/supabase-server");
    const { getCurrentAdminUser } = await import("@/lib/admin-auth");

    vi.mocked(getCurrentAdminUser).mockResolvedValue({
      id: "actor-1", role: "admin", email: "admin@test", auth_user_id: "auth"
    } as any);
    const rpcMock = vi.fn().mockResolvedValue({
      data: [{ batch_id: "b1", applications_assigned: 2, reviewer_id: "rev1" }],
      error: null
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc: rpcMock } as any);

    const result = await assignSelectedApplicationReviews({
      applicationIds: ["app1", "app2", "app1", ""],
      reviewerAdminUserId: "rev1",
      reviewRound: "interview",
      dueAt: null,
      assignmentNote: null,
      assignedByAdminUserId: "actor-1"
    });

    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("vam094_assign_selected_application_reviews");
    // Exactly the selected ids, de-duplicated, blanks dropped — nothing else.
    expect(args.p_application_ids).toEqual(["app1", "app2"]);
    // Exactly one assignee; no array, no distribution parameters.
    expect(args.p_reviewer_id).toBe("rev1");
    expect(args).not.toHaveProperty("p_reviewer_ids");
    expect(args).not.toHaveProperty("p_statuses");
    expect(args).not.toHaveProperty("p_exclude_already_assigned");
    expect(args.p_review_round).toBe("interview");
  });

  it("EMPTY_SELECTION_IS_REFUSED before touching the database", async () => {
    const { getSupabaseServiceRoleClient } = await import("@/lib/supabase-server");
    const { getCurrentAdminUser } = await import("@/lib/admin-auth");

    vi.mocked(getCurrentAdminUser).mockResolvedValue({
      id: "actor-1", role: "admin", email: "admin@test", auth_user_id: "auth"
    } as any);
    const rpcMock = vi.fn();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc: rpcMock } as any);

    const result = await assignSelectedApplicationReviews({
      applicationIds: ["", "  "].map((v) => v.trim()),
      reviewerAdminUserId: "rev1",
      reviewRound: "profile_screening",
      dueAt: null,
      assignmentNote: null,
      assignedByAdminUserId: "actor-1"
    });

    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
