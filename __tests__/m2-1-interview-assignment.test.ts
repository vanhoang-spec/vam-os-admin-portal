import { beforeEach, describe, expect, it, vi } from "vitest";
import { MutationPostgrestDb, mutationClient } from "./support/mutation-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canReviewSeason: vi.fn(),
  getScopeFilter: vi.fn()
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  assignApplicationReview,
  cancelApplicationReview,
  reassignApplicationReview,
  saveApplicationReviewDraft,
  submitApplicationReview
} from "@/lib/application-reviews";
import { bulkAssignApplicationReviews } from "@/lib/bulk-assignment";
import { getApplicationReviewById } from "@/lib/data";
import { claimInterviewReview, INTERVIEW_ELIGIBLE_STATUSES } from "@/lib/interview-claim";
import { canReviewSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import {
  getSupabaseServerClient,
  getSupabaseServiceRoleClient
} from "@/lib/supabase-server";

const IDS = {
  admin: "admin-1",
  core: "core-1",
  reviewerA: "reviewer-a",
  reviewerB: "reviewer-b",
  inactive: "reviewer-inactive",
  suspended: "reviewer-suspended",
  viewer: "viewer-1",
  season: "season-1",
  mentor: "app-mentor",
  mentee: "app-mentee",
  submitted: "app-submitted",
  review: "review-1"
};

const db = new MutationPostgrestDb();
const client = mutationClient(db);

function setActor(id = IDS.admin, role = "admin") {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id, role } as never);
}

function adminUser(id: string, role: string, status = "active") {
  return { id, email: `${id}@example.test`, full_name: id, role, status };
}

function application(id: string, roleApplied: "mentor" | "mentee", status: string) {
  return {
    id,
    role_applied: roleApplied,
    status,
    season_id: IDS.season,
    submitted_at: `2026-08-28T00:00:0${db.tables.applications?.length ?? 0}.000Z`
  };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.review,
    application_id: IDS.mentee,
    review_round: "interview",
    reviewer_admin_user_id: IDS.reviewerA,
    assigned_by: IDS.admin,
    status: "assigned",
    due_at: null,
    updated_at: "2026-08-27T12:00:00.000Z",
    score_motivation: 4,
    reviewer_note: "historical note",
    recommendation: "waitlist",
    ...overrides
  };
}

function seedBase() {
  db.tables.admin_users = [
    adminUser(IDS.admin, "admin"),
    adminUser(IDS.core, "core_team"),
    adminUser(IDS.reviewerA, "reviewer"),
    adminUser(IDS.reviewerB, "reviewer"),
    adminUser(IDS.inactive, "reviewer", "inactive"),
    adminUser(IDS.suspended, "reviewer", "suspended"),
    adminUser(IDS.viewer, "viewer")
  ];
  db.tables.applications = [
    application(IDS.mentor, "mentor", "invited_to_interview"),
    application(IDS.mentee, "mentee", "interview_scheduled"),
    application(IDS.submitted, "mentee", "submitted")
  ];
  db.tables.application_reviews = [];
  db.tables.review_assignment_batches = [];
}

function assignment(applicationId: string, reviewerAdminUserId = IDS.reviewerA) {
  return {
    applicationId,
    reviewerAdminUserId,
    assignedByAdminUserId: IDS.admin,
    reviewRound: "interview" as const
  };
}

function reviewUpdates() {
  return db.records.filter(
    (record) => record.table === "application_reviews" && record.operation === "update"
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seedBase();
  setActor();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(getAdminScopeContext).mockResolvedValue({ isSuperAdmin: true } as never);
  vi.mocked(getScopeFilter).mockResolvedValue(undefined);
  vi.mocked(canReviewSeason).mockResolvedValue(true);
});

describe("M2.1 interview pre-assignment eligibility and reviewer validation", () => {
  it("assigns an interview-eligible Mentor", async () => {
    const result = await assignApplicationReview(assignment(IDS.mentor));
    expect(result.ok).toBe(true);
    expect(db.tables.application_reviews).toContainEqual(expect.objectContaining({
      application_id: IDS.mentor,
      reviewer_admin_user_id: IDS.reviewerA,
      review_round: "interview",
      status: "assigned"
    }));
  });

  it("assigns an interview-eligible Mentee", async () => {
    expect((await assignApplicationReview(assignment(IDS.mentee))).ok).toBe(true);
  });

  it.each(["submitted", "ready_for_screening", "screening_assigned"])(
    "rejects a forged direct interview assignment from %s",
    async (status) => {
      const forged = application(`forged-${status}`, "mentee", status);
      db.tables.applications.push(forged);
      const result = await assignApplicationReview(assignment(forged.id));
      expect(result.ok).toBe(false);
      expect(db.tables.application_reviews).toHaveLength(0);
    }
  );

  it("rejects a forged bulk interview status before querying applications", async () => {
    const result = await bulkAssignApplicationReviews({
      intakeBatchId: null,
      roleApplied: "mentee",
      statuses: ["submitted"],
      reviewerAdminUserIds: [IDS.reviewerA],
      assignedByAdminUserId: IDS.admin,
      reviewRound: "interview",
      excludeAlreadyAssigned: false,
      dueAt: null,
      assignmentNote: null
    });
    expect(result.ok).toBe(false);
    expect(db.records.some((record) => record.table === "applications")).toBe(false);
  });

  it("uses only the shared canonical interview statuses in a valid bulk query", async () => {
    const result = await bulkAssignApplicationReviews({
      intakeBatchId: null,
      roleApplied: "mentor",
      statuses: ["invited_to_interview"],
      reviewerAdminUserIds: [IDS.reviewerA],
      assignedByAdminUserId: IDS.admin,
      reviewRound: "interview",
      excludeAlreadyAssigned: false,
      dueAt: null,
      assignmentNote: null
    });
    expect(result.ok).toBe(true);
    const statusPredicate = db.records
      .find((record) => record.table === "applications" && record.operation === "select")
      ?.predicates.find((predicate) => predicate.kind === "in" && predicate.column === "status");
    expect(statusPredicate).toEqual({ kind: "in", column: "status", values: ["invited_to_interview"] });
    expect(INTERVIEW_ELIGIBLE_STATUSES.has("invited_to_interview")).toBe(true);
  });

  it("rejects a nonexistent target reviewer", async () => {
    expect((await assignApplicationReview(assignment(IDS.mentee, "missing-reviewer"))).ok).toBe(false);
    expect(db.tables.application_reviews).toHaveLength(0);
  });

  it.each([IDS.inactive, IDS.suspended])("rejects non-active target %s", async (target) => {
    expect((await assignApplicationReview(assignment(IDS.mentee, target))).ok).toBe(false);
  });

  it("rejects an active viewer target", async () => {
    expect((await assignApplicationReview(assignment(IDS.mentee, IDS.viewer))).ok).toBe(false);
  });

  it.each(["missing-reviewer", IDS.inactive, IDS.viewer])(
    "rejects invalid bulk target %s before application selection",
    async (target) => {
      const result = await bulkAssignApplicationReviews({
        intakeBatchId: null,
        roleApplied: "mentee",
        statuses: ["interview_scheduled"],
        reviewerAdminUserIds: [target],
        assignedByAdminUserId: IDS.admin,
        reviewRound: "interview",
        excludeAlreadyAssigned: false,
        dueAt: null,
        assignmentNote: null
      });
      expect(result.ok).toBe(false);
      expect(db.records.some((record) => record.table === "applications")).toBe(false);
    }
  );

  it.each([
    [IDS.reviewerA, "reviewer"],
    [IDS.core, "core_team"],
    [IDS.admin, "admin"]
  ])("accepts production-policy target %s (%s)", async (target) => {
    expect((await assignApplicationReview(assignment(IDS.mentee, target))).ok).toBe(true);
  });

  it("rejects an unauthenticated or mismatched service-role actor", async () => {
    setActor(IDS.viewer, "viewer");
    expect((await assignApplicationReview(assignment(IDS.mentee))).ok).toBe(false);
    expect(db.records.some((record) => record.operation === "insert")).toBe(false);
  });

  it("rejects out-of-scope assignment before target mutation", async () => {
    vi.mocked(canReviewSeason).mockResolvedValue(false);
    const result = await assignApplicationReview(assignment(IDS.mentee));
    expect(result.ok).toBe(false);
    expect(db.records.some((record) => record.operation === "insert")).toBe(false);
  });
});

describe("M2.1 cancelled reviews are dead and mutations are race-safe", () => {
  it("conditionally cancels an assigned review without deleting its history", async () => {
    db.tables.application_reviews = [review()];
    const result = await cancelApplicationReview({ reviewId: IDS.review, adminUserId: IDS.admin });
    expect(result.ok).toBe(true);
    expect(db.tables.application_reviews).toHaveLength(1);
    expect(db.tables.application_reviews[0]).toMatchObject({
      status: "cancelled",
      score_motivation: 4,
      reviewer_note: "historical note"
    });
    expect(reviewUpdates()[0].predicates).toContainEqual({
      kind: "in",
      column: "status",
      values: ["assigned", "in_progress", "returned_for_clarification"]
    });
  });

  it("rejects a cancelled draft without resurrecting it", async () => {
    db.tables.application_reviews = [review({ status: "cancelled" })];
    setActor(IDS.reviewerA, "reviewer");
    const result = await saveApplicationReviewDraft({
      reviewId: IDS.review,
      adminUserId: IDS.reviewerA,
      reviewerNote: "resurrect"
    });
    expect(result.ok).toBe(false);
    expect(db.tables.application_reviews[0]).toMatchObject({ status: "cancelled", reviewer_note: "historical note" });
    expect(reviewUpdates()).toHaveLength(0);
  });

  it("rejects a cancelled submit without advancing the application", async () => {
    db.tables.application_reviews = [review({ status: "cancelled" })];
    setActor(IDS.reviewerA, "reviewer");
    const result = await submitApplicationReview({
      reviewId: IDS.review,
      adminUserId: IDS.reviewerA,
      recommendation: "approve_recommended"
    });
    expect(result.ok).toBe(false);
    expect(db.tables.application_reviews[0].status).toBe("cancelled");
    expect(db.tables.applications.find((row) => row.id === IDS.mentee)?.status).toBe("interview_scheduled");
  });

  it("blocks cancellation of a submitted review", async () => {
    db.tables.application_reviews = [review({ status: "submitted" })];
    expect((await cancelApplicationReview({ reviewId: IDS.review, adminUserId: IDS.admin })).ok).toBe(false);
    expect(db.tables.application_reviews[0].status).toBe("submitted");
  });

  it("blocks reassignment of a submitted review", async () => {
    db.tables.application_reviews = [review({ status: "submitted" })];
    expect((await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: IDS.reviewerB,
      adminUserId: IDS.admin
    })).ok).toBe(false);
    expect(db.tables.application_reviews).toHaveLength(1);
    expect(db.tables.application_reviews[0].status).toBe("submitted");
  });

  it("keeps a concurrent submit intact when cancel read stale in_progress", async () => {
    db.tables.application_reviews = [review({ status: "in_progress" })];
    db.beforeNextUpdate("application_reviews", () => {
      db.tables.application_reviews[0].status = "submitted";
    });
    const result = await cancelApplicationReview({ reviewId: IDS.review, adminUserId: IDS.admin });
    expect(result.ok).toBe(false);
    expect(db.tables.application_reviews[0].status).toBe("submitted");
    expect(reviewUpdates()[0]).toMatchObject({ affected: 0 });
    expect(reviewUpdates()[0].predicates).toContainEqual({
      kind: "in",
      column: "status",
      values: ["assigned", "in_progress", "returned_for_clarification"]
    });
  });

  it("keeps a concurrent submit intact when reassign read stale in_progress", async () => {
    db.tables.application_reviews = [review({ status: "in_progress" })];
    db.beforeNextUpdate("application_reviews", () => {
      db.tables.application_reviews[0].status = "submitted";
    });
    const result = await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: IDS.reviewerB,
      adminUserId: IDS.admin
    });
    expect(result.ok).toBe(false);
    expect(db.tables.application_reviews).toHaveLength(1);
    expect(db.tables.application_reviews[0].status).toBe("submitted");
    expect(reviewUpdates()[0].affected).toBe(0);
  });
});

describe("M2.1 reassignment prevalidation, compensation, and isolation", () => {
  it("prevalidates the target before any cancellation", async () => {
    db.tables.application_reviews = [review()];
    const result = await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: "missing",
      adminUserId: IDS.admin
    });
    expect(result.ok).toBe(false);
    expect(reviewUpdates()).toHaveLength(0);
    expect(db.tables.application_reviews[0].status).toBe("assigned");
  });

  it("rejects same-reviewer reassignment without churn", async () => {
    db.tables.application_reviews = [review()];
    const result = await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: IDS.reviewerA,
      adminUserId: IDS.admin
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("phải khác") });
    expect(reviewUpdates()).toHaveLength(0);
  });

  it("rejects a duplicate target before cancelling the old row", async () => {
    db.tables.application_reviews = [
      review(),
      review({ id: "target-existing", reviewer_admin_user_id: IDS.reviewerB })
    ];
    const result = await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: IDS.reviewerB,
      adminUserId: IDS.admin
    });
    expect(result.ok).toBe(false);
    expect(reviewUpdates()).toHaveLength(0);
    expect(db.tables.application_reviews[0].status).toBe("assigned");
  });

  it("restores the exact prior active state when replacement insert fails", async () => {
    db.tables.application_reviews = [review({ status: "in_progress" })];
    const before = { ...db.tables.application_reviews[0] };
    db.failNextInsert("application_reviews");
    const result = await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: IDS.reviewerB,
      adminUserId: IDS.admin
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("đã được khôi phục") });
    expect(db.tables.application_reviews).toHaveLength(1);
    expect(db.tables.application_reviews[0]).toEqual(before);
    expect(reviewUpdates()).toHaveLength(2);
    expect(reviewUpdates()[1].predicates).toContainEqual({ kind: "eq", column: "status", value: "cancelled" });
  });

  it("fails loudly if conditional compensation cannot restore the old row", async () => {
    db.tables.application_reviews = [review({ status: "in_progress" })];
    db.failNextInsert("application_reviews");
    db.beforeNextUpdate("application_reviews", () => undefined);
    db.beforeNextUpdate("application_reviews", () => {
      db.tables.application_reviews[0].status = "submitted";
    });
    const result = await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: IDS.reviewerB,
      adminUserId: IDS.admin
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("không thể tự động khôi phục") });
    expect(db.tables.application_reviews[0].status).toBe("submitted");
  });

  it("preserves old content and creates a clean assignment owned by the new reviewer", async () => {
    db.tables.application_reviews = [review({ status: "in_progress" })];
    const result = await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: IDS.reviewerB,
      adminUserId: IDS.admin
    });
    expect(result.ok).toBe(true);
    const oldRow = db.tables.application_reviews.find((row) => row.id === IDS.review)!;
    const newRow = db.tables.application_reviews.find((row) => row.id !== IDS.review)!;
    expect(oldRow).toMatchObject({
      status: "cancelled",
      score_motivation: 4,
      reviewer_note: "historical note",
      recommendation: "waitlist"
    });
    expect(newRow).toMatchObject({ reviewer_admin_user_id: IDS.reviewerB, status: "assigned" });
    expect(newRow).not.toHaveProperty("score_motivation");
    expect(newRow).not.toHaveProperty("reviewer_note");

    expect((await getApplicationReviewById(newRow.id, undefined, IDS.reviewerA)).data).toBeNull();
    expect((await getApplicationReviewById(newRow.id, undefined, IDS.reviewerB)).data?.id).toBe(newRow.id);
  });

  it("old reviewer cannot operate the cancelled row while the new reviewer can save the new row", async () => {
    db.tables.application_reviews = [review()];
    const reassigned = await reassignApplicationReview({
      reviewId: IDS.review,
      newReviewerAdminUserId: IDS.reviewerB,
      adminUserId: IDS.admin
    });
    expect(reassigned.ok).toBe(true);
    if (!reassigned.ok) return;

    setActor(IDS.reviewerA, "reviewer");
    expect((await saveApplicationReviewDraft({
      reviewId: IDS.review,
      adminUserId: IDS.reviewerA,
      reviewerNote: "try old"
    })).ok).toBe(false);

    setActor(IDS.reviewerB, "reviewer");
    expect((await saveApplicationReviewDraft({
      reviewId: reassigned.id,
      adminUserId: IDS.reviewerB,
      reviewerNote: "new owner note"
    })).ok).toBe(true);
    expect(db.tables.application_reviews.find((row) => row.id === reassigned.id)).toMatchObject({
      status: "in_progress",
      reviewer_note: "new owner note"
    });
  });
});

describe("M2.1 self-claim, cancelled reuse, and accurate bulk writes", () => {
  it("does not let self-claim steal another reviewer's active pre-assignment", async () => {
    db.tables.application_reviews = [review({ reviewer_admin_user_id: IDS.reviewerB })];
    setActor(IDS.reviewerA, "reviewer");
    const result = await claimInterviewReview({ applicationId: IDS.mentee });
    expect(result).toMatchObject({ ok: false, alreadyClaimed: true });
    expect(db.tables.application_reviews).toHaveLength(1);
  });

  it("allows a legitimate future assignment after the prior assignment was cancelled", async () => {
    db.tables.application_reviews = [review({ status: "cancelled" })];
    const result = await assignApplicationReview(assignment(IDS.mentee));
    expect(result.ok).toBe(true);
    expect(db.tables.application_reviews.filter((row) => row.status !== "cancelled")).toHaveLength(1);
  });

  it("reports one actual insert and advances only that application when one of two pairs is duplicate", async () => {
    const first = application("bulk-app-1", "mentee", "invited_to_interview");
    const second = application("bulk-app-2", "mentee", "invited_to_interview");
    db.tables.applications.push(first, second);
    db.tables.application_reviews = [review({
      id: "existing-pair",
      application_id: first.id,
      reviewer_admin_user_id: IDS.reviewerA
    })];

    const result = await bulkAssignApplicationReviews({
      intakeBatchId: null,
      roleApplied: "mentee",
      statuses: ["invited_to_interview"],
      reviewerAdminUserIds: [IDS.reviewerA],
      assignedByAdminUserId: IDS.admin,
      reviewRound: "interview",
      excludeAlreadyAssigned: false,
      dueAt: null,
      assignmentNote: null
    });

    expect(result).toMatchObject({ ok: true, applicationsAssigned: 1, skippedAlreadyAssigned: 1 });
    expect(db.tables.application_reviews.filter((row) => row.application_id === second.id)).toHaveLength(1);
    expect(db.tables.applications.find((row) => row.id === first.id)?.status).toBe("invited_to_interview");
    expect(db.tables.applications.find((row) => row.id === second.id)?.status).toBe("interview_in_progress");
    const statusUpdate = db.records.find(
      (record) => record.table === "applications" && record.operation === "update"
    );
    expect(statusUpdate?.predicates).toContainEqual({ kind: "in", column: "id", values: [second.id] });
  });

  it.each(["mentor", "mentee"] as const)(
    "preserves profile-screening bulk assignment for %s",
    async (roleApplied) => {
      const app = application(`profile-${roleApplied}`, roleApplied, "ready_for_screening");
      db.tables.applications.push(app);
      const result = await bulkAssignApplicationReviews({
        intakeBatchId: null,
        roleApplied,
        statuses: ["ready_for_screening"],
        reviewerAdminUserIds: [IDS.reviewerA],
        assignedByAdminUserId: IDS.admin,
        reviewRound: "profile_screening",
        excludeAlreadyAssigned: true,
        dueAt: null,
        assignmentNote: null
      });
      expect(result).toMatchObject({ ok: true, applicationsAssigned: 1 });
      expect(db.tables.application_reviews).toContainEqual(expect.objectContaining({
        application_id: app.id,
        review_round: "profile_screening"
      }));
      expect(db.tables.applications.find((row) => row.id === app.id)?.status).toBe("screening_assigned");
    }
  );
});
