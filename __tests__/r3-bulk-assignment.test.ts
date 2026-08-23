import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/program-scope", () => ({
  canReviewSeason: vi.fn(),
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn()
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import {
  APPLICATION_ID_CHUNK_SIZE,
  buildRoundRobinAssignments,
  readActiveProfileReviewWorkloads,
  readExistingProfileReviews
} from "@/lib/bulk-assignment";

describe("R3 two-reviewer round robin", () => {
  it("assigns two distinct reviewers to every application and balances the pool", () => {
    const assignments = buildRoundRobinAssignments(
      [{ id: "app-1" }, { id: "app-2" }, { id: "app-3" }],
      ["reviewer-a", "reviewer-b", "reviewer-c"]
    );

    expect(assignments).toHaveLength(6);
    for (const applicationId of ["app-1", "app-2", "app-3"]) {
      const reviewers = assignments
        .filter((assignment) => assignment.applicationId === applicationId)
        .map((assignment) => assignment.reviewerAdminUserId);
      expect(new Set(reviewers).size).toBe(2);
    }

    const workloads = ["reviewer-a", "reviewer-b", "reviewer-c"].map(
      (reviewerId) => assignments.filter((assignment) => assignment.reviewerAdminUserId === reviewerId).length
    );
    expect(workloads).toEqual([2, 2, 2]);
  });

  it("tops up an application with one active reviewer without duplicating that reviewer", () => {
    const assignments = buildRoundRobinAssignments(
      [{ id: "app-1", existingReviewerIds: ["reviewer-a"] }],
      ["reviewer-a", "reviewer-b", "reviewer-c"]
    );

    expect(assignments).toEqual([
      { applicationId: "app-1", reviewerAdminUserId: "reviewer-b" }
    ]);
  });

  it("skips applications that already have two distinct active reviewers", () => {
    const assignments = buildRoundRobinAssignments(
      [{ id: "app-1", existingReviewerIds: ["reviewer-a", "reviewer-b"] }],
      ["reviewer-a", "reviewer-b", "reviewer-c"]
    );

    expect(assignments).toEqual([]);
  });

  it("keeps partial assignments instead of aborting the whole batch", () => {
    expect(buildRoundRobinAssignments(
      [{ id: "app-1" }, { id: "app-2" }],
      ["reviewer-a"],
      2
    )).toEqual([
      { applicationId: "app-1", reviewerAdminUserId: "reviewer-a" },
      { applicationId: "app-2", reviewerAdminUserId: "reviewer-a" }
    ]);
  });

  it("always tops up to the target and never adds the target on top of existing reviewers", () => {
    const assignments = buildRoundRobinAssignments(
      [
        { id: "one-existing", existingReviewerIds: ["reviewer-a"] },
        { id: "already-full", existingReviewerIds: ["reviewer-a", "reviewer-b"] }
      ],
      ["reviewer-a", "reviewer-b", "reviewer-c"],
      2
    );

    expect(assignments).toEqual([
      { applicationId: "one-existing", reviewerAdminUserId: "reviewer-b" }
    ]);
  });
});

describe("R3 bulk-assignment paged reads", () => {
  it("chunks application ids at 200 and reads past a 1000-row page", async () => {
    const applicationIds = Array.from({ length: 401 }, (_, index) => `app-${String(index).padStart(3, "0")}`);
    const rows = applicationIds.flatMap((applicationId, appIndex) => {
      const count = appIndex < APPLICATION_ID_CHUNK_SIZE ? 6 : 1;
      return Array.from({ length: count }, (_, reviewIndex) => ({
        id: `review-${String(appIndex).padStart(3, "0")}-${reviewIndex}`,
        application_id: applicationId,
        reviewer_admin_user_id: `reviewer-${reviewIndex}`
      }));
    }).sort((a, b) => a.id.localeCompare(b.id));

    const requestedChunks: string[][] = [];
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          let selectedApplicationIds: string[] = [];
          let cursor: string | null = null;
          const query: any = {
            eq: vi.fn(() => query),
            neq: vi.fn(() => query),
            in: vi.fn((column: string, ids: string[]) => {
              if (column === "application_id") {
                selectedApplicationIds = ids;
                requestedChunks.push(ids);
              }
              return query;
            }),
            gt: vi.fn((_column: string, value: string) => {
              cursor = value;
              return query;
            }),
            order: vi.fn(() => query),
            limit: vi.fn(async (limit: number) => ({
              data: rows
                .filter((row) => selectedApplicationIds.includes(row.application_id) && (cursor === null || row.id > cursor))
                .slice(0, limit),
              error: null
            }))
          };
          return query;
        })
      }))
    };

    const result = await readExistingProfileReviews(client, applicationIds);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1401);
    expect(Math.max(...requestedChunks.map((chunk) => chunk.length))).toBe(APPLICATION_ID_CHUNK_SIZE);
    expect(requestedChunks.some((chunk) => chunk.length === 1)).toBe(true);
  });

  it("pages reviewer workload beyond 1000 active review rows", async () => {
    const rows = Array.from({ length: 1205 }, (_, index) => ({
      id: `review-${String(index).padStart(4, "0")}`,
      reviewer_admin_user_id: index % 2 === 0 ? "reviewer-a" : "reviewer-b"
    }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          let selectedReviewerIds: string[] = [];
          let cursor: string | null = null;
          const query: any = {
            eq: vi.fn(() => query),
            neq: vi.fn(() => query),
            in: vi.fn((column: string, ids: string[]) => {
              if (column === "reviewer_admin_user_id") selectedReviewerIds = ids;
              return query;
            }),
            gt: vi.fn((_column: string, value: string) => {
              cursor = value;
              return query;
            }),
            order: vi.fn(() => query),
            limit: vi.fn(async (limit: number) => ({
              data: rows
                .filter((row) => selectedReviewerIds.includes(row.reviewer_admin_user_id) && (cursor === null || row.id > cursor))
                .slice(0, limit),
              error: null
            }))
          };
          return query;
        })
      }))
    };

    const result = await readActiveProfileReviewWorkloads(client, ["reviewer-a", "reviewer-b"]);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1205);
  });
});

describe("R3 bulk-assignment atomic persistence", () => {
  it("uses the migration-081 RPC instead of separate best-effort writes", () => {
    const source = readFileSync("lib/bulk-assignment.ts", "utf8");

    expect(source).toContain('client.rpc(\n    "vam081_bulk_assign_reviews_atomic"');
    expect(source).not.toContain('.from("review_assignment_batches")');
    expect(source).not.toContain('.from("application_reviews").insert');
    expect(source).not.toContain("non-fatal");
  });

  it("locks all application ids in ascending order inside the atomic RPC", () => {
    const migration = readFileSync("supabase_migrations/081_r3_atomic_review_workflow.sql", "utf8").toLowerCase();
    const start = migration.indexOf("create or replace function public.vam081_bulk_assign_reviews_atomic");
    const body = migration.slice(start, migration.indexOf("revoke all on function", start));

    expect(body).toContain("for v_application_id in");
    expect(body).toContain("order by 1");
    expect(body).toContain("pg_advisory_xact_lock");
    expect(body).toContain("insert into public.review_assignment_batches");
    expect(body).toContain("insert into public.application_reviews");
    expect(body).toContain("update public.applications");
  });
});
