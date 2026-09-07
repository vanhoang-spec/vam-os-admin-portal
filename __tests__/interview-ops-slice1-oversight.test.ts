import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: any) => fn };
});

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  getReviewOversightAggregate,
  getReviewOversightQueue,
  REVIEW_OVERSIGHT_AGGREGATE_SELECT,
  REVIEW_OVERSIGHT_LIST_SELECT,
  type ReviewOversightActor
} from "@/lib/data";
import {
  BUCKET_DRILLDOWN_STATUS,
  buildReviewOversightHref,
  isOversightOperationalParent,
  OVERSIGHT_OPERATIONAL_STATUSES,
  parseReviewOversightFilters,
  REVIEW_OVERSIGHT_PAGE_SIZE,
  reviewerIdentityLabel,
  reviewOversightActionability,
  type ReviewOversightFilters
} from "@/lib/review-oversight";
import { isApplicationRecruitmentOperational } from "@/lib/application-review-assignability";
import { makeProjectionFake, type FakeStore } from "./support/postgrest-projection-fake";

// ---------------------------------------------------------------------------
// Fixture — 2 seasons, 2 batches, 2 rounds, 3 reviewers, mentee + mentor,
// every assignment status, and both operational and terminal parents.
// ---------------------------------------------------------------------------

const SEASON_A = "11111111-1111-4111-8111-111111111111";
const SEASON_B = "22222222-2222-4222-8222-222222222222";
const BATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const REVIEWER_NAMED = "33333333-3333-4333-8333-333333333333";
const REVIEWER_EMAIL_ONLY = "44444444-4444-4444-8444-444444444444";
const REVIEWER_INACTIVE = "55555555-5555-4555-8555-555555555555";

const ADMIN_USERS = [
  { id: REVIEWER_NAMED, full_name: "Chiến Nguyễn", email: "chien@vam.test", status: "active" },
  // Known email, no name — must never render as "(Chưa gán)".
  { id: REVIEWER_EMAIL_ONLY, full_name: null, email: "no-name@vam.test", status: "active" },
  // Deactivated, but still holds history — must stay resolvable and filterable.
  { id: REVIEWER_INACTIVE, full_name: "Hà Cũ", email: "ha@vam.test", status: "inactive" }
];

type ReviewSeed = {
  id: string;
  app: string;
  reviewer: string | null;
  round: string;
  status: string;
  due_at?: string | null;
  submitted_at?: string | null;
};

const APPLICATIONS = [
  // Season A / Batch A
  { id: "app-a1", full_name: "Ứng viên A1", person_id: null, season_id: SEASON_A, intake_batch_id: BATCH_A, role_applied: "mentee", status: "screening_assigned", final_status: null },
  { id: "app-a2", full_name: "Ứng viên A2", person_id: null, season_id: SEASON_A, intake_batch_id: BATCH_A, role_applied: "mentor", status: "invited_to_interview", final_status: null },
  { id: "app-a3", full_name: "Ứng viên A3", person_id: null, season_id: SEASON_A, intake_batch_id: BATCH_A, role_applied: "mentee", status: "screening_in_progress", final_status: null },
  // Season A / Batch B
  { id: "app-b1", full_name: "Ứng viên B1", person_id: null, season_id: SEASON_A, intake_batch_id: BATCH_B, role_applied: "mentee", status: "screening_assigned", final_status: null },
  { id: "app-b2", full_name: "Ứng viên B2", person_id: null, season_id: SEASON_A, intake_batch_id: BATCH_B, role_applied: "mentor", status: "interview_scheduled", final_status: null },
  // Terminal parents — history only.
  { id: "app-w1", full_name: "Ứng viên Rút", person_id: null, season_id: SEASON_A, intake_batch_id: BATCH_A, role_applied: "mentee", status: "withdrawn", final_status: null },
  { id: "app-r1", full_name: "Ứng viên Loại", person_id: null, season_id: SEASON_A, intake_batch_id: BATCH_B, role_applied: "mentor", status: "rejected_or_not_fit", final_status: null },
  // Season B
  { id: "app-s2", full_name: "Ứng viên Mùa 2", person_id: null, season_id: SEASON_B, intake_batch_id: BATCH_B, role_applied: "mentee", status: "screening_assigned", final_status: null }
];

const REVIEW_SEEDS: ReviewSeed[] = [
  // Named reviewer — profile screening, batch A
  { id: "rev-01", app: "app-a1", reviewer: REVIEWER_NAMED, round: "profile_screening", status: "assigned", due_at: "2026-09-10T00:00:00.000Z" },
  { id: "rev-02", app: "app-a3", reviewer: REVIEWER_NAMED, round: "profile_screening", status: "in_progress", due_at: "2026-09-11T00:00:00.000Z" },
  { id: "rev-03", app: "app-b1", reviewer: REVIEWER_NAMED, round: "profile_screening", status: "submitted", submitted_at: "2026-09-05T00:00:00.000Z" },
  { id: "rev-04", app: "app-a1", reviewer: REVIEWER_NAMED, round: "profile_screening", status: "returned_for_clarification", due_at: "2026-09-12T00:00:00.000Z" },
  // Reassigned away — cancelled under an OPERATIONAL parent. History, never workload.
  { id: "rev-05", app: "app-a3", reviewer: REVIEWER_NAMED, round: "profile_screening", status: "cancelled" },
  // Auto-cancelled by withdrawal.
  { id: "rev-06", app: "app-w1", reviewer: REVIEWER_NAMED, round: "profile_screening", status: "cancelled" },
  // Submitted work preserved under a withdrawn parent — history, not workload.
  { id: "rev-07", app: "app-w1", reviewer: REVIEWER_NAMED, round: "profile_screening", status: "submitted", submitted_at: "2026-09-01T00:00:00.000Z" },
  // Named reviewer — interview round
  { id: "rev-08", app: "app-a2", reviewer: REVIEWER_NAMED, round: "interview", status: "in_progress" },

  // Email-only reviewer
  { id: "rev-09", app: "app-a2", reviewer: REVIEWER_EMAIL_ONLY, round: "profile_screening", status: "submitted", submitted_at: "2026-09-06T00:00:00.000Z" },
  { id: "rev-10", app: "app-b2", reviewer: REVIEWER_EMAIL_ONLY, round: "interview", status: "assigned", due_at: "2026-09-15T00:00:00.000Z" },
  { id: "rev-11", app: "app-b2", reviewer: REVIEWER_EMAIL_ONLY, round: "interview", status: "cancelled" },
  { id: "rev-12", app: "app-s2", reviewer: REVIEWER_EMAIL_ONLY, round: "profile_screening", status: "assigned" },

  // Inactive reviewer — history plus one live row
  { id: "rev-13", app: "app-r1", reviewer: REVIEWER_INACTIVE, round: "profile_screening", status: "submitted", submitted_at: "2026-08-20T00:00:00.000Z" },
  { id: "rev-14", app: "app-b1", reviewer: REVIEWER_INACTIVE, round: "profile_screening", status: "in_progress" },
  { id: "rev-15", app: "app-r1", reviewer: REVIEWER_INACTIVE, round: "interview", status: "cancelled" },

  // Orphan parent: the application does not exist. Must never render.
  { id: "rev-16", app: "app-missing", reviewer: REVIEWER_NAMED, round: "profile_screening", status: "assigned" }
];

function buildStore(reviews: ReviewSeed[] = REVIEW_SEEDS): FakeStore {
  return {
    applications: APPLICATIONS.map((row) => ({ ...row })),
    admin_users: ADMIN_USERS.map((row) => ({ ...row })),
    application_reviews: reviews.map((seed) => ({
      id: seed.id,
      application_id: seed.app,
      reviewer_admin_user_id: seed.reviewer,
      review_round: seed.round,
      status: seed.status,
      due_at: seed.due_at ?? null,
      submitted_at: seed.submitted_at ?? null,
      total_score: seed.status === "submitted" ? 20 : null,
      recommendation: seed.status === "submitted" ? "pass_to_interview" : null,
      assigned_by: "someone-else"
    }))
  };
}

let fake: ReturnType<typeof makeProjectionFake>;

function install(store: FakeStore = buildStore()) {
  fake = makeProjectionFake(store);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as any);
  return fake;
}

const OVERSIGHT: ReviewOversightActor = { kind: "oversight", adminUserId: "admin-1" };

function filtersFor(overrides: Partial<ReviewOversightFilters> = {}): ReviewOversightFilters {
  return {
    seasonId: null,
    intakeBatchId: null,
    roleApplied: null,
    reviewRound: null,
    reviewerId: null,
    reviewStatus: null,
    scopeMode: "operational",
    page: 1,
    ...overrides
  };
}

/** Parses a generated href back through the canonical parser — proves the round trip. */
function filtersFromHref(href: string, defaultReviewRound: string | null = null) {
  const url = new URL(href, "https://example.test");
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return { filters: parseReviewOversightFilters(params, { defaultReviewRound }), params };
}

beforeEach(() => {
  vi.clearAllMocks();
  install();
});

// ---------------------------------------------------------------------------
// 1. Operational-status mirror must not drift from the canonical predicate
// ---------------------------------------------------------------------------

describe("operational status mirror", () => {
  const STATUS_UNIVERSE = [
    "submitted",
    "under_data_check",
    "ready_for_screening",
    "screening_assigned",
    "screening_in_progress",
    "screening_completed",
    "screening_passed",
    "invited_to_meeting",
    "invited_to_orientation",
    "invited_to_interview",
    "interview_scheduled",
    "interview_in_progress",
    "interview_completed",
    "ready_for_final_decision",
    "interview_passed",
    "needs_more_review",
    "needs_admin_review",
    "waitlisted",
    "approved_as_mentor",
    "approved_as_mentee",
    "rejected_or_not_fit",
    "withdrawn",
    "excluded",
    "",
    "not_a_status"
  ];

  it("agrees with isApplicationRecruitmentOperational over the whole status universe", () => {
    for (const status of STATUS_UNIVERSE) {
      expect(
        isOversightOperationalParent(status),
        `oversight mirror disagrees with the canonical predicate for "${status}"`
      ).toBe(isApplicationRecruitmentOperational(status));
    }
  });

  it("treats null and undefined parents as non-operational", () => {
    expect(isOversightOperationalParent(null)).toBe(false);
    expect(isOversightOperationalParent(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Projection / consumer contract
// ---------------------------------------------------------------------------

describe("projection contract", () => {
  const CONSUMED_REVIEW_FIELDS = [
    "id",
    "application_id",
    "reviewer_admin_user_id",
    "review_round",
    "status",
    "due_at",
    "submitted_at",
    "total_score",
    "recommendation"
  ];
  const CONSUMED_APPLICATION_FIELDS = [
    "id",
    "full_name",
    "person_id",
    "season_id",
    "intake_batch_id",
    "role_applied",
    "status",
    "final_status"
  ];
  const CONSUMED_REVIEWER_FIELDS = ["id", "full_name", "email"];

  it("never selects * on the oversight path", () => {
    expect(REVIEW_OVERSIGHT_LIST_SELECT).not.toContain("*");
    expect(REVIEW_OVERSIGHT_AGGREGATE_SELECT).not.toContain("*");
  });

  it("names the reviewer foreign key explicitly so the assignee embed is unambiguous", () => {
    // application_reviews references admin_users twice; an unqualified embed
    // would be ambiguous and could resolve through assigned_by.
    expect(REVIEW_OVERSIGHT_LIST_SELECT).toContain(
      "admin_users!application_reviews_reviewer_admin_user_id_fkey"
    );
    expect(REVIEW_OVERSIGHT_AGGREGATE_SELECT).toContain(
      "admin_users!application_reviews_reviewer_admin_user_id_fkey"
    );
  });

  it("delivers every consumed field to the list, through a projection-honouring read", async () => {
    const result = await getReviewOversightQueue({ filters: filtersFor(), actor: OVERSIGHT });
    const row = result.data.rows[0];
    expect(row).toBeTruthy();

    for (const field of CONSUMED_REVIEW_FIELDS) {
      expect(row, `review.${field} is consumed but not projected`).toHaveProperty(field);
      expect((row as any)[field]).not.toBeUndefined();
    }
    for (const field of CONSUMED_APPLICATION_FIELDS) {
      expect(row.application, `application.${field} is consumed but not projected`).toHaveProperty(field);
      expect((row.application as any)[field]).not.toBeUndefined();
    }
    for (const field of CONSUMED_REVIEWER_FIELDS) {
      expect(row.reviewer, `reviewer.${field} is consumed but not projected`).toHaveProperty(field);
      expect((row.reviewer as any)[field]).not.toBeUndefined();
    }
  });

  it("returns undefined for a field the projection omits, so the fake cannot mask a gap", async () => {
    await getReviewOversightQueue({ filters: filtersFor(), actor: OVERSIGHT });
    const query = fake.lastQueryFor("application_reviews");
    expect(query?.projection).toBe(REVIEW_OVERSIGHT_LIST_SELECT);
    // `assigned_by` exists in the store and is deliberately NOT projected.
    const result = await getReviewOversightQueue({ filters: filtersFor(), actor: OVERSIGHT });
    expect((result.data.rows[0] as any).assigned_by).toBeUndefined();
  });

  it("aggregates through the same joined read, not a per-review application fetch", async () => {
    fake.reset();
    await getReviewOversightAggregate({ filters: filtersFor(), actor: OVERSIGHT });
    const applicationReads = fake.queries.filter((query) => query.table === "applications");
    expect(applicationReads).toHaveLength(0);
  });

  it("issues exactly one read for a page of the list — no N+1", async () => {
    fake.reset();
    await getReviewOversightQueue({ filters: filtersFor(), actor: OVERSIGHT });
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].table).toBe("application_reviews");
  });
});

// ---------------------------------------------------------------------------
// 3. Population contract
// ---------------------------------------------------------------------------

describe("population contract", () => {
  it("excludes cancelled assignments from the operational list", async () => {
    const result = await getReviewOversightQueue({ filters: filtersFor(), actor: OVERSIGHT });
    expect(result.data.rows.every((row) => row.status !== "cancelled")).toBe(true);
  });

  it("excludes terminal-parent rows from the operational list", async () => {
    const result = await getReviewOversightQueue({ filters: filtersFor(), actor: OVERSIGHT });
    const parents = result.data.rows.map((row) => row.application?.status);
    expect(parents.every((status) => isOversightOperationalParent(status))).toBe(true);
  });

  it("surfaces cancelled and terminal-parent rows under scope=all", async () => {
    const result = await getReviewOversightQueue({
      filters: filtersFor({ scopeMode: "all" }),
      actor: OVERSIGHT
    });
    const ids = result.data.rows.map((row) => row.id);
    expect(ids).toContain("rev-05"); // cancelled, operational parent
    expect(ids).toContain("rev-06"); // cancelled, withdrawn parent
    expect(ids).toContain("rev-07"); // submitted, withdrawn parent
  });

  it("never renders a review whose parent application is missing, in either scope", async () => {
    for (const scopeMode of ["operational", "all"] as const) {
      const result = await getReviewOversightQueue({
        filters: filtersFor({ scopeMode }),
        actor: OVERSIGHT
      });
      expect(result.data.rows.map((row) => row.id)).not.toContain("rev-16");
    }
  });

  it("keeps cancelled out of every reviewer's current total", async () => {
    const result = await getReviewOversightAggregate({ filters: filtersFor(), actor: OVERSIGHT });
    for (const row of result.data) {
      expect(row.current_total).toBe(
        row.submitted_count + row.in_progress_count + row.pending_count + row.returned_count
      );
      expect(row.current_total).toBeGreaterThanOrEqual(0);
    }
    const named = result.data.find((row) => row.reviewer_admin_user_id === REVIEWER_NAMED)!;
    // rev-01 assigned, rev-02 in_progress, rev-03 submitted, rev-04 returned,
    // rev-08 interview in_progress. rev-05/06 cancelled and rev-07 (withdrawn
    // parent) are history; rev-16 has no parent.
    expect(named.current_total).toBe(5);
    expect(named.cancelled_count).toBe(2);
  });

  it("reports cancelled as its own historical metric, including under terminal parents", async () => {
    const result = await getReviewOversightAggregate({ filters: filtersFor(), actor: OVERSIGHT });
    const inactive = result.data.find((row) => row.reviewer_admin_user_id === REVIEWER_INACTIVE)!;
    expect(inactive.cancelled_count).toBe(1); // rev-15, rejected parent
    expect(inactive.current_total).toBe(1); // rev-14 only; rev-13 sits on a rejected parent
  });
});

// ---------------------------------------------------------------------------
// 4. Authorization — the QUERY is constrained, not the result
// ---------------------------------------------------------------------------

describe("reviewer-only authorization", () => {
  const REVIEWER_ACTOR: ReviewOversightActor = {
    kind: "reviewer",
    adminUserId: REVIEWER_NAMED
  };

  it("pins the query to the current actor even when the URL names another reviewer", async () => {
    const { filters } = filtersFromHref(`/reviews?reviewer=${REVIEWER_EMAIL_ONLY}&scope=all`);
    expect(filters.reviewerId).toBe(REVIEWER_EMAIL_ONLY);
    expect(filters.scopeMode).toBe("all");

    fake.reset();
    const result = await getReviewOversightQueue({ filters, actor: REVIEWER_ACTOR });

    const query = fake.lastQueryFor("application_reviews")!;
    const reviewerFilters = query.filters.filter(
      (filter) => filter.column === "reviewer_admin_user_id"
    );
    // The actor's id is applied to the QUERY...
    expect(reviewerFilters).toEqual([
      { op: "eq", column: "reviewer_admin_user_id", value: REVIEWER_NAMED }
    ]);
    // ...and the other reviewer's id never reaches the query at all.
    expect(JSON.stringify(query.filters)).not.toContain(REVIEWER_EMAIL_ONLY);

    // scope=all is ignored: the operational constraints are still applied.
    expect(query.filters).toContainEqual({
      op: "neq",
      column: "status",
      value: "cancelled"
    });
    expect(query.filters).toContainEqual({
      op: "in",
      column: "application.status",
      value: OVERSIGHT_OPERATIONAL_STATUSES
    });

    expect(result.data.rows.every((row) => row.reviewer_admin_user_id === REVIEWER_NAMED)).toBe(true);
    expect(result.data.rows.every((row) => row.status !== "cancelled")).toBe(true);
    expect(result.data.totalCount).toBe(5);
  });

  it("fails closed when a reviewer asks for cancelled history by URL", async () => {
    const { filters } = filtersFromHref("/reviews?scope=all&review_status=cancelled");
    const result = await getReviewOversightQueue({ filters, actor: REVIEWER_ACTOR });
    // The forced `status <> cancelled` and the requested `status = cancelled`
    // are both applied, so the quarantine wins rather than the URL.
    expect(result.data.totalCount).toBe(0);
    expect(result.data.rows).toHaveLength(0);
  });

  it("cannot reach another reviewer's rows through the aggregate either", async () => {
    fake.reset();
    const result = await getReviewOversightAggregate({
      filters: filtersFor({ reviewerId: REVIEWER_EMAIL_ONLY, scopeMode: "all" }),
      actor: REVIEWER_ACTOR
    });
    const query = fake.lastQueryFor("application_reviews")!;
    expect(query.filters).toContainEqual({
      op: "eq",
      column: "reviewer_admin_user_id",
      value: REVIEWER_NAMED
    });
    expect(result.data.every((row) => row.reviewer_admin_user_id === REVIEWER_NAMED)).toBe(true);
  });

  it("lets an oversight actor use the reviewer filter", async () => {
    fake.reset();
    const result = await getReviewOversightQueue({
      filters: filtersFor({ reviewerId: REVIEWER_EMAIL_ONLY }),
      actor: OVERSIGHT
    });
    const query = fake.lastQueryFor("application_reviews")!;
    expect(query.filters).toContainEqual({
      op: "eq",
      column: "reviewer_admin_user_id",
      value: REVIEWER_EMAIL_ONLY
    });
    expect(result.data.rows.every((row) => row.reviewer_admin_user_id === REVIEWER_EMAIL_ONLY)).toBe(
      true
    );
  });

  it("drops a non-identifier reviewer parameter instead of passing it to the query", () => {
    const { filters } = filtersFromHref("/reviews?reviewer=' or 1=1--");
    expect(filters.reviewerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Count -> list reconciliation across every filter axis
// ---------------------------------------------------------------------------

describe("progress count reconciles with the list it links to", () => {
  const FILTER_SETS: Array<{ name: string; filters: ReviewOversightFilters }> = [
    { name: "no filter", filters: filtersFor() },
    { name: "season", filters: filtersFor({ seasonId: SEASON_A }) },
    { name: "batch", filters: filtersFor({ intakeBatchId: BATCH_A }) },
    { name: "role mentee", filters: filtersFor({ roleApplied: "mentee" }) },
    { name: "role mentor", filters: filtersFor({ roleApplied: "mentor" }) },
    { name: "round profile", filters: filtersFor({ reviewRound: "profile_screening" }) },
    { name: "round interview", filters: filtersFor({ reviewRound: "interview" }) },
    {
      name: "season + batch + role + round",
      filters: filtersFor({
        seasonId: SEASON_A,
        intakeBatchId: BATCH_B,
        roleApplied: "mentor",
        reviewRound: "interview"
      })
    }
  ];

  /** Mirrors exactly what the progress page renders for a count cell. */
  function drilldownHref(
    filters: ReviewOversightFilters,
    reviewerId: string | null,
    reviewStatus: string | null,
    scopeMode: "operational" | "all"
  ) {
    return buildReviewOversightHref("/reviews", filters, {
      page: 1,
      reviewerId,
      reviewStatus,
      scopeMode
    });
  }

  for (const set of FILTER_SETS) {
    it(`reconciles every bucket under: ${set.name}`, async () => {
      const aggregate = await getReviewOversightAggregate({
        filters: set.filters,
        actor: OVERSIGHT
      });
      expect(aggregate.error).toBeNull();

      for (const row of aggregate.data) {
        const reviewerId = row.reviewer_admin_user_id;

        const cases: Array<{ label: string; expected: number; status: string | null; scope: "operational" | "all" }> = [
          { label: "current_total", expected: row.current_total, status: null, scope: "operational" },
          { label: "submitted", expected: row.submitted_count, status: BUCKET_DRILLDOWN_STATUS.submitted, scope: "operational" },
          { label: "in_progress", expected: row.in_progress_count, status: BUCKET_DRILLDOWN_STATUS.in_progress, scope: "operational" },
          { label: "pending", expected: row.pending_count, status: BUCKET_DRILLDOWN_STATUS.pending, scope: "operational" },
          { label: "returned", expected: row.returned_count, status: BUCKET_DRILLDOWN_STATUS.returned, scope: "operational" },
          { label: "cancelled", expected: row.cancelled_count, status: BUCKET_DRILLDOWN_STATUS.cancelled, scope: "all" }
        ];

        for (const testCase of cases) {
          const href = drilldownHref(set.filters, reviewerId, testCase.status, testCase.scope);
          const { filters: parsed } = filtersFromHref(href);
          const listed = await getReviewOversightQueue({ filters: parsed, actor: OVERSIGHT });

          expect(
            listed.data.totalCount,
            `${set.name} / ${reviewerId ?? "unassigned"} / ${testCase.label} -> ${href}`
          ).toBe(testCase.expected);
        }
      }
    });
  }

  it("preserves every active filter key in a drill-down link", () => {
    const filters = filtersFor({
      seasonId: SEASON_A,
      intakeBatchId: BATCH_A,
      roleApplied: "mentee",
      reviewRound: "profile_screening"
    });
    const href = drilldownHref(filters, REVIEWER_NAMED, "submitted", "operational");
    const { params } = filtersFromHref(href);

    expect(params.season_id).toBe(SEASON_A);
    expect(params.intake_batch_id).toBe(BATCH_A);
    expect(params.role_applied).toBe("mentee");
    expect(params.review_round).toBe("profile_screening");
    expect(params.reviewer).toBe(REVIEWER_NAMED);
    expect(params.review_status).toBe("submitted");
    // The legacy short key must never be emitted.
    expect(params.round).toBeUndefined();
  });

  it("keeps the round filter attached when the progress default is in force", () => {
    const progressFilters = parseReviewOversightFilters(
      { intake_batch_id: BATCH_A },
      { defaultReviewRound: "profile_screening" }
    );
    const href = drilldownHref(progressFilters, REVIEWER_NAMED, null, "operational");
    const { params } = filtersFromHref(href);
    expect(params.review_round).toBe("profile_screening");
    expect(params.intake_batch_id).toBe(BATCH_A);
  });
});

// ---------------------------------------------------------------------------
// 6. Historical reviewer options
// ---------------------------------------------------------------------------

describe("historical reviewers", () => {
  it("resolves an inactive reviewer's identity and keeps them filterable", async () => {
    const aggregate = await getReviewOversightAggregate({
      filters: filtersFor(),
      actor: OVERSIGHT
    });
    const inactive = aggregate.data.find((row) => row.reviewer_admin_user_id === REVIEWER_INACTIVE);
    expect(inactive).toBeTruthy();
    expect(reviewerIdentityLabel(inactive!.reviewer_admin_user_id, inactive!.reviewer_full_name, inactive!.reviewer_email)).toBe("Hà Cũ");

    const filtered = await getReviewOversightQueue({
      filters: filtersFor({ reviewerId: REVIEWER_INACTIVE, scopeMode: "all" }),
      actor: OVERSIGHT
    });
    expect(filtered.data.totalCount).toBe(3);
  });

  it("shows a known email rather than (Chưa gán) when the name is null", async () => {
    const aggregate = await getReviewOversightAggregate({
      filters: filtersFor(),
      actor: OVERSIGHT
    });
    const emailOnly = aggregate.data.find(
      (row) => row.reviewer_admin_user_id === REVIEWER_EMAIL_ONLY
    )!;
    const label = reviewerIdentityLabel(
      emailOnly.reviewer_admin_user_id,
      emailOnly.reviewer_full_name,
      emailOnly.reviewer_email
    );
    expect(label).toBe("no-name@vam.test");
    expect(label).not.toContain("Chưa gán");
  });

  it("uses (Chưa gán) only for a genuinely unassigned row", () => {
    expect(reviewerIdentityLabel(null, null, null)).toBe("(Chưa gán)");
    expect(reviewerIdentityLabel(null, "Anything", "any@vam.test")).toBe("(Chưa gán)");
    expect(reviewerIdentityLabel(REVIEWER_NAMED, null, null)).toBe(
      "Reviewer không xác định (33333333)"
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Pagination
// ---------------------------------------------------------------------------

describe("pagination", () => {
  const BIG_TOTAL = 123;

  function bigStore(): FakeStore {
    const seeds: ReviewSeed[] = Array.from({ length: BIG_TOTAL }, (_, index) => ({
      id: `big-${String(index).padStart(4, "0")}`,
      app: "app-a1",
      reviewer: REVIEWER_NAMED,
      round: "profile_screening",
      status: "assigned",
      due_at: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`
    }));
    return buildStore(seeds);
  }

  it("serves 50 rows per page and reports the FULL filtered total", async () => {
    install(bigStore());
    const page1 = await getReviewOversightQueue({ filters: filtersFor(), actor: OVERSIGHT });
    expect(page1.data.pageSize).toBe(REVIEW_OVERSIGHT_PAGE_SIZE);
    expect(page1.data.rows).toHaveLength(50);
    expect(page1.data.totalCount).toBe(BIG_TOTAL);
    expect(page1.data.totalPages).toBe(3);

    const page2 = await getReviewOversightQueue({
      filters: filtersFor({ page: 2 }),
      actor: OVERSIGHT
    });
    expect(page2.data.rows).toHaveLength(50);
    expect(page2.data.totalCount).toBe(BIG_TOTAL);

    const page3 = await getReviewOversightQueue({
      filters: filtersFor({ page: 3 }),
      actor: OVERSIGHT
    });
    expect(page3.data.rows).toHaveLength(BIG_TOTAL - 100);
    expect(page3.data.totalCount).toBe(BIG_TOTAL);
  });

  it("returns disjoint pages under a deterministic order", async () => {
    install(bigStore());
    const seen = new Set<string>();
    for (const page of [1, 2, 3]) {
      const result = await getReviewOversightQueue({
        filters: filtersFor({ page }),
        actor: OVERSIGHT
      });
      for (const row of result.data.rows) {
        expect(seen.has(row.id), `row ${row.id} appeared on two pages`).toBe(false);
        seen.add(row.id);
      }
    }
    expect(seen.size).toBe(BIG_TOTAL);
  });

  it("clamps an out-of-range page to the last real one instead of rendering empty", async () => {
    install(bigStore());
    const result = await getReviewOversightQueue({
      filters: filtersFor({ page: 99 }),
      actor: OVERSIGHT
    });
    expect(result.data.page).toBe(3);
    expect(result.data.rows).toHaveLength(BIG_TOTAL - 100);
    expect(result.data.totalCount).toBe(BIG_TOTAL);
  });

  it("keeps the aggregate total equal to the full population, not one page", async () => {
    install(bigStore());
    const aggregate = await getReviewOversightAggregate({
      filters: filtersFor(),
      actor: OVERSIGHT
    });
    const named = aggregate.data.find((row) => row.reviewer_admin_user_id === REVIEWER_NAMED)!;
    expect(named.current_total).toBe(BIG_TOTAL);

    const listed = await getReviewOversightQueue({
      filters: filtersFor({ reviewerId: REVIEWER_NAMED }),
      actor: OVERSIGHT
    });
    expect(listed.data.totalCount).toBe(named.current_total);
    expect(listed.data.rows.length).toBeLessThan(named.current_total);
  });
});

// ---------------------------------------------------------------------------
// 8. Actionability
// ---------------------------------------------------------------------------

describe("actionability", () => {
  it("never makes a cancelled assignment actionable, whatever the parent", () => {
    expect(
      reviewOversightActionability({ reviewStatus: "cancelled", parentStatus: "screening_assigned" })
    ).toEqual({ actionable: false, readOnlyReason: "cancelled" });
    expect(
      reviewOversightActionability({ reviewStatus: "cancelled", parentStatus: "withdrawn" })
    ).toEqual({ actionable: false, readOnlyReason: "cancelled" });
  });

  it("freezes a live assignment once its parent leaves recruitment", () => {
    expect(
      reviewOversightActionability({ reviewStatus: "assigned", parentStatus: "withdrawn" })
    ).toEqual({ actionable: false, readOnlyReason: "terminal_parent" });
    expect(
      reviewOversightActionability({ reviewStatus: "in_progress", parentStatus: "rejected_or_not_fit" })
    ).toEqual({ actionable: false, readOnlyReason: "terminal_parent" });
  });

  it("keeps submitted work read-only and live work actionable", () => {
    expect(
      reviewOversightActionability({ reviewStatus: "submitted", parentStatus: "screening_assigned" })
    ).toEqual({ actionable: false, readOnlyReason: "submitted" });
    expect(
      reviewOversightActionability({ reviewStatus: "assigned", parentStatus: "screening_assigned" })
    ).toEqual({ actionable: true, readOnlyReason: "none" });
    expect(
      reviewOversightActionability({
        reviewStatus: "returned_for_clarification",
        parentStatus: "screening_assigned"
      })
    ).toEqual({ actionable: true, readOnlyReason: "none" });
  });
});

// ---------------------------------------------------------------------------
// 9. Scope
// ---------------------------------------------------------------------------

describe("season scope", () => {
  it("constrains the query to the granted seasons", async () => {
    fake.reset();
    const result = await getReviewOversightQueue({
      filters: filtersFor(),
      actor: OVERSIGHT,
      scope: { allowedSeasonIds: [SEASON_A] }
    });
    const query = fake.lastQueryFor("application_reviews")!;
    expect(query.filters).toContainEqual({
      op: "in",
      column: "application.season_id",
      value: [SEASON_A]
    });
    expect(result.data.rows.every((row) => row.application?.season_id === SEASON_A)).toBe(true);
  });

  it("returns nothing for a grant that admits no rows", async () => {
    const result = await getReviewOversightQueue({
      filters: filtersFor(),
      actor: OVERSIGHT,
      scope: { allowedSeasonIds: [] }
    });
    expect(result.data.totalCount).toBe(0);
    expect(result.data.rows).toHaveLength(0);
  });
});
