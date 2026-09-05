/**
 * S12 interview day — bounded self-claim.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE PROVE
 * ---------------------------------------------------------------------------
 * Every behavioural test runs the REAL `claimInterviewReview` body against an
 * in-memory fake whose `vam095_claim_interview_review` is a faithful port of
 * the migration's plpgsql: same eligibility gates, same create-or-noop decision,
 * and — critically — the same advisory lock held across the existence check and
 * the insert.
 *
 * The concurrency section does not take that on trust. It runs the same two
 * racing claims twice: once against the serialized RPC (proving first-claim-
 * wins) and once against a deliberately UNSERIALIZED port that drops the lock
 * (proving the test can actually see a double-claim). Without that second run,
 * test 6 would pass on a fake that never interleaved in the first place.
 *
 * The SQL contract tests then pin the three properties the JS port assumes and
 * cannot itself prove: that the lock is taken, that it is taken BEFORE the
 * existence check, and that it is transaction-scoped.
 *
 * ---------------------------------------------------------------------------
 * THE OPERATING SHAPE BEING DEFENDED
 * ---------------------------------------------------------------------------
 * Mentee interviews are walk-up. A candidate arrives, gives a name, and any
 * free interviewer claims them on the spot. Core Team pre-assigns only the
 * candidates it deliberately reserves for a named interviewer — and that
 * reservation is carried by the existence of that interviewer's review, which
 * is why "another interviewer already holds one" must refuse rather than fork.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canReviewSeason: vi.fn()
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { claimInterviewReview } from "@/lib/interview-claim";

// ── Fixture ids ──────────────────────────────────────────────────────────────

const S12 = "00000000-0000-4000-8000-000000000001";
const S11 = "00000000-0000-4000-8000-000000000002";

const APP_WALKUP = "00000000-0000-4000-8000-000000000101";
const APP_RESERVED = "00000000-0000-4000-8000-000000000102";
const APP_NOT_ELIGIBLE = "00000000-0000-4000-8000-000000000103";
const APP_OTHER_SEASON = "00000000-0000-4000-8000-000000000104";
const APP_SCHEDULED = "00000000-0000-4000-8000-000000000105";

const INTERVIEWER_A = "admin-interviewer-a";
const INTERVIEWER_B = "admin-interviewer-b";
const HELPER = "admin-helper";

const EXISTING_REVIEW = "00000000-0000-4000-8000-000000000201";

// ── In-memory database ───────────────────────────────────────────────────────

type Row = Record<string, any>;

const db: {
  applications: Row[];
  application_reviews: Row[];
  admin_users: Row[];
  /** Season ids in which a given admin holds ACTIVE `interviewer` membership. */
  interviewerSeasons: Record<string, string[]>;
} = { applications: [], application_reviews: [], admin_users: [], interviewerSeasons: {} };

let reviewSeq = 0;
/** Every RPC name the production code invoked, in order. */
let rpcCalls: string[] = [];

const INTERVIEW_ELIGIBLE = new Set([
  "invited_to_interview",
  "interview_scheduled",
  "interview_in_progress",
  "needs_more_review"
]);

/**
 * A faithful port of vam095_claim_interview_review.
 *
 * `serialized` mirrors `pg_advisory_xact_lock`: when true the existence check
 * and the insert are one indivisible critical section per (application, round),
 * exactly as the transaction-scoped lock makes them in Postgres. When false the
 * port models the select-then-insert this migration exists to replace.
 */
function makeClaimRpc(serialized: boolean) {
  const locks = new Map<string, Promise<void>>();

  async function body(appId: string, actor: string) {
    const app = db.applications.find((a) => a.id === appId);
    if (!app?.season_id) throw new Error("Application or season not found");

    if (!(db.interviewerSeasons[actor] ?? []).includes(app.season_id)) {
      throw new Error("Actor is not an active interview participant for this season");
    }

    const status = String(app.status ?? "");
    if (!INTERVIEW_ELIGIBLE.has(status)) throw new Error("Application is not interview eligible");
    if (
      status === "needs_more_review" &&
      !db.application_reviews.some((r) => r.application_id === appId && r.review_round === "interview")
    ) {
      throw new Error("Application is not interview eligible");
    }

    // ---- critical section (advisory lock in SQL) ----
    const active = db.application_reviews
      .filter(
        (r) =>
          r.application_id === appId &&
          r.review_round === "interview" &&
          r.status !== "cancelled"
      )
      .sort(
        (a, b) =>
          Number(b.reviewer_admin_user_id === actor) - Number(a.reviewer_admin_user_id === actor) ||
          String(a.created_at).localeCompare(String(b.created_at))
      );

    const held = active[0];
    const describe = (id: string) => {
      const u = db.admin_users.find((x) => x.id === id);
      return { holder_full_name: u?.full_name ?? null, holder_email: u?.email ?? null };
    };

    if (held) {
      const outcome = held.reviewer_admin_user_id === actor ? "existing" : "already_claimed";
      const holder = String(held.reviewer_admin_user_id);
      return [
        {
          outcome_status: outcome,
          review_id: held.id,
          holder_admin_user_id: holder,
          ...describe(holder),
          application_status: status
        }
      ];
    }

    // A real await between the check and the insert. Under the unserialized
    // port this is where the second caller slips in.
    await Promise.resolve();

    const created = {
      id: `review-${++reviewSeq}`,
      application_id: appId,
      review_round: "interview",
      reviewer_admin_user_id: actor,
      assigned_by: actor,
      status: "in_progress",
      claim_source: "self_claim",
      claimed_at: new Date().toISOString(),
      created_at: new Date(Date.now() + reviewSeq).toISOString()
    };
    db.application_reviews.push(created);

    // vam084_recompute_application_review_status: with one active interview
    // review and none submitted, the interview branch resolves to
    // interview_in_progress and only overwrites a status it is allowed to.
    if (["invited_to_interview", "interview_scheduled", "interview_in_progress"].includes(status)) {
      app.status = "interview_in_progress";
    }

    return [
      {
        outcome_status: "claimed",
        review_id: created.id,
        holder_admin_user_id: actor,
        ...describe(actor),
        application_status: app.status
      }
    ];
  }

  return async (appId: string, actor: string) => {
    if (!serialized) return body(appId, actor);
    const key = `${appId}:interview`;
    const prior = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    locks.set(key, new Promise<void>((r) => (release = r)));
    await prior;
    try {
      return await body(appId, actor);
    } finally {
      release();
    }
  };
}

function makeFakeClient(serialized = true) {
  const claim = makeClaimRpc(serialized);
  return {
    from: vi.fn((table: string) => {
      const preds: Array<(r: Row) => boolean> = [];
      const rows = () => ((db as any)[table] ?? []) as Row[];
      const query: Row = {
        select: vi.fn(() => query),
        eq: vi.fn((col: string, val: unknown) => {
          preds.push((r) => r[col] === val);
          return query;
        }),
        neq: vi.fn((col: string, val: unknown) => {
          preds.push((r) => r[col] !== val);
          return query;
        }),
        maybeSingle: async () => {
          const hit = rows().filter((r) => preds.every((p) => p(r)));
          return { data: hit.length ? { ...hit[0] } : null, error: null };
        }
      };
      return query;
    }),
    rpc: vi.fn(async (name: string, args: Row) => {
      rpcCalls.push(name);
      if (name === "vam084_participant_for_stage") {
        const seasons = db.interviewerSeasons[String(args.p_admin_user_id)] ?? [];
        return {
          data: args.p_review_stage === "interview" && seasons.includes(String(args.p_season_id)),
          error: null
        };
      }
      if (name === "vam095_claim_interview_review") {
        try {
          return { data: await claim(String(args.p_application_id), String(args.p_actor)), error: null };
        } catch (err) {
          return { data: null, error: { message: (err as Error).message, code: "P0001" } };
        }
      }
      throw new Error(`unexpected rpc ${name}`);
    })
  };
}

function seed() {
  reviewSeq = 0;
  rpcCalls = [];
  db.applications = [
    { id: APP_WALKUP, season_id: S12, status: "invited_to_interview", full_name: "Walk Up", email_primary: "w@x.vn" },
    { id: APP_SCHEDULED, season_id: S12, status: "interview_scheduled", full_name: "Scheduled", email_primary: "s@x.vn" },
    { id: APP_RESERVED, season_id: S12, status: "invited_to_interview", full_name: "Reserved", email_primary: "r@x.vn" },
    { id: APP_NOT_ELIGIBLE, season_id: S12, status: "screening_passed", full_name: "Too Early", email_primary: "t@x.vn" },
    { id: APP_OTHER_SEASON, season_id: S11, status: "invited_to_interview", full_name: "Old Season", email_primary: "o@x.vn" }
  ];
  // Core Team reserved this candidate for interviewer B in advance.
  db.application_reviews = [
    {
      id: EXISTING_REVIEW,
      application_id: APP_RESERVED,
      review_round: "interview",
      reviewer_admin_user_id: INTERVIEWER_B,
      assigned_by: "admin-core",
      status: "assigned",
      claim_source: null,
      created_at: "2026-09-01T00:00:00.000Z"
    }
  ];
  db.admin_users = [
    { id: INTERVIEWER_A, full_name: "Interviewer A", email: "a@vam.vn", role: "reviewer" },
    { id: INTERVIEWER_B, full_name: "Interviewer B", email: "b@vam.vn", role: "reviewer" },
    { id: HELPER, full_name: "Helper", email: "h@vam.vn", role: "support_team" }
  ];
  db.interviewerSeasons = {
    [INTERVIEWER_A]: [S12],
    [INTERVIEWER_B]: [S12],
    [HELPER]: [S12]
  };
}

function actAs(id: string, role: string) {
  (getCurrentAdminUser as Mock).mockResolvedValue({ id, role });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeFakeClient(true));
  (getAdminScopeContext as Mock).mockResolvedValue({ scope: "all" });
  (canReviewSeason as Mock).mockResolvedValue(true);
  actAs(INTERVIEWER_A, "reviewer");
});

const claim = (applicationId: string) => claimInterviewReview({ applicationId });
const activeInterviewReviews = (appId: string) =>
  db.application_reviews.filter(
    (r) => r.application_id === appId && r.review_round === "interview" && r.status !== "cancelled"
  );

// ═════════════════════════════════════════════════════════════════════════════
// 1–2 · The walk-up case: an unassigned candidate can be claimed
// ═════════════════════════════════════════════════════════════════════════════

describe("unassigned candidate — self-claim", () => {
  it("1 · an eligible interviewer can self-claim a candidate nobody holds", async () => {
    const result = await claim(APP_WALKUP);

    expect(result.ok).toBe(true);
    expect(result.alreadyClaimed).toBeFalsy();
    expect(result.reviewId).toBeTruthy();
    expect(rpcCalls).toContain("vam095_claim_interview_review");
  });

  it("2 · the claim creates the canonical interview review owned by the actor", async () => {
    await claim(APP_WALKUP);

    const reviews = activeInterviewReviews(APP_WALKUP);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      review_round: "interview",
      reviewer_admin_user_id: INTERVIEWER_A,
      assigned_by: INTERVIEWER_A,
      status: "in_progress",
      claim_source: "self_claim"
    });
    expect(reviews[0].claimed_at).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · Idempotency
// ═════════════════════════════════════════════════════════════════════════════

describe("same actor retry", () => {
  it("3 · a second claim by the holder resumes the same review instead of forking", async () => {
    const first = await claim(APP_WALKUP);
    const second = await claim(APP_WALKUP);

    expect(second.ok).toBe(true);
    expect(second.reviewId).toBe(first.reviewId);
    expect(activeInterviewReviews(APP_WALKUP)).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4–5 · Reserved candidates keep working exactly as Core Team assigned them
// ═════════════════════════════════════════════════════════════════════════════

describe("pre-assigned candidate", () => {
  it("4 · the assigned interviewer can continue their own pre-assigned interview", async () => {
    actAs(INTERVIEWER_B, "reviewer");

    const result = await claim(APP_RESERVED);

    expect(result.ok).toBe(true);
    expect(result.reviewId).toBe(EXISTING_REVIEW);
    // Resumed, not replaced: still the Core Team row, not a self_claim row.
    expect(activeInterviewReviews(APP_RESERVED)).toHaveLength(1);
    expect(activeInterviewReviews(APP_RESERVED)[0].claim_source).toBeNull();
  });

  it("5 · another interviewer cannot steal a reserved candidate", async () => {
    actAs(INTERVIEWER_A, "reviewer");

    const result = await claim(APP_RESERVED);

    expect(result.ok).toBe(false);
    expect(result.alreadyClaimed).toBe(true);
    expect(result.message).toContain("Interviewer B");
    // The decisive assertion: no parallel review was created.
    expect(activeInterviewReviews(APP_RESERVED)).toHaveLength(1);
    expect(activeInterviewReviews(APP_RESERVED)[0].reviewer_admin_user_id).toBe(INTERVIEWER_B);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 · Concurrency — first claim wins
// ═════════════════════════════════════════════════════════════════════════════

describe("two interviewers claiming the same walk-up candidate at once", () => {
  it("6 · exactly one wins and exactly one review exists", async () => {
    const client = makeFakeClient(true);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const [a, b] = await Promise.all([
      (actAs(INTERVIEWER_A, "reviewer"), claim(APP_WALKUP)),
      (actAs(INTERVIEWER_B, "reviewer"), claim(APP_WALKUP))
    ]);

    const winners = [a, b].filter((r) => r.ok && !r.alreadyClaimed);
    const losers = [a, b].filter((r) => r.alreadyClaimed);

    expect(activeInterviewReviews(APP_WALKUP)).toHaveLength(1);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].ok).toBe(false);
  });

  it("6b · the same race DOES double-claim without the lock — the test can see the defect", async () => {
    // Guards test 6 against passing on a fake that simply never interleaves.
    const client = makeFakeClient(false);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    await Promise.all([
      (actAs(INTERVIEWER_A, "reviewer"), claim(APP_WALKUP)),
      (actAs(INTERVIEWER_B, "reviewer"), claim(APP_WALKUP))
    ]);

    expect(activeInterviewReviews(APP_WALKUP).length).toBeGreaterThan(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7–9 · Authorization, season scope, lifecycle
// ═════════════════════════════════════════════════════════════════════════════

describe("authorization and scope", () => {
  it("7 · a role without interview permission cannot claim", async () => {
    actAs(HELPER, "support_team");

    const result = await claim(APP_WALKUP);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
    expect(activeInterviewReviews(APP_WALKUP)).toHaveLength(0);
    // Refused before any database work.
    expect(rpcCalls).toHaveLength(0);
  });

  it("7b · a signed-out actor cannot claim", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue(null);

    const result = await claim(APP_WALKUP);

    expect(result.ok).toBe(false);
    expect(activeInterviewReviews(APP_WALKUP)).toHaveLength(0);
  });

  it("8 · an interviewer with no participation in the candidate's season cannot claim", async () => {
    // Holds S12 interviewer membership, but this candidate belongs to S11.
    const result = await claim(APP_OTHER_SEASON);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("interviewer");
    expect(activeInterviewReviews(APP_OTHER_SEASON)).toHaveLength(0);
    expect(rpcCalls).not.toContain("vam095_claim_interview_review");
  });

  it("8b · a season the admin scope refuses is rejected before participation is even asked", async () => {
    (canReviewSeason as Mock).mockResolvedValue(false);

    const result = await claim(APP_WALKUP);

    expect(result.ok).toBe(false);
    expect(activeInterviewReviews(APP_WALKUP)).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("9 · a candidate not yet invited to interview cannot be claimed", async () => {
    const result = await claim(APP_NOT_ELIGIBLE);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("screening_passed");
    expect(activeInterviewReviews(APP_NOT_ELIGIBLE)).toHaveLength(0);
  });

  it("9b · the RPC refuses an ineligible status even when the pre-flight is bypassed", async () => {
    // Proves the lifecycle gate is a guard, not just a friendly message: the
    // status flips underneath the pre-flight, as a concurrent decision would.
    const client = makeFakeClient(true);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const originalFrom = client.from;
    client.from = vi.fn((table: string) => {
      const q = originalFrom(table);
      const originalMaybeSingle = q.maybeSingle;
      q.maybeSingle = async () => {
        const res = await originalMaybeSingle();
        if (table === "applications" && res.data) {
          // Pre-flight sees an eligible status; the stored row is not.
          db.applications.find((a) => a.id === APP_WALKUP)!.status = "rejected";
        }
        return res;
      };
      return q;
    }) as never;

    const result = await claim(APP_WALKUP);

    expect(result.ok).toBe(false);
    expect(activeInterviewReviews(APP_WALKUP)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10 · Application status advance
// ═════════════════════════════════════════════════════════════════════════════

describe("application status", () => {
  it("10 · claiming an invited candidate advances the application to interview_in_progress", async () => {
    await claim(APP_WALKUP);

    expect(db.applications.find((a) => a.id === APP_WALKUP)!.status).toBe("interview_in_progress");
  });

  it("10b · a scheduled candidate advances the same way", async () => {
    await claim(APP_SCHEDULED);

    expect(db.applications.find((a) => a.id === APP_SCHEDULED)!.status).toBe("interview_in_progress");
  });

  it("10c · a refused claim never moves the application status", async () => {
    actAs(INTERVIEWER_A, "reviewer");
    const before = db.applications.find((a) => a.id === APP_RESERVED)!.status;

    await claim(APP_RESERVED);

    expect(db.applications.find((a) => a.id === APP_RESERVED)!.status).toBe(before);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11 · My Work compatibility
// ═════════════════════════════════════════════════════════════════════════════

describe("My Work contract", () => {
  it("11 · a self-claimed review is owned by the actor, so My Work needs no second inbox", async () => {
    await claim(APP_WALKUP);

    // My Work selects application_reviews by reviewer_admin_user_id with a
    // non-cancelled status. The claimed row satisfies that query unchanged.
    const mine = db.application_reviews.filter(
      (r) => r.reviewer_admin_user_id === INTERVIEWER_A && r.status !== "cancelled"
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].application_id).toBe(APP_WALKUP);

    const source = readFileSync("lib/interview-claim.ts", "utf8");
    expect(source).not.toMatch(/my_work|interview_queue|claim_inbox/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SQL contract — the properties the JS port assumes
// ═════════════════════════════════════════════════════════════════════════════

describe("migration contract", () => {
  const sql = readFileSync(
    "supabase/migrations/20260905090000_s12_interview_self_claim_atomic.sql",
    "utf8"
  );

  it("serializes the claim on (application, interview) with a transaction-scoped lock", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(/hashtextextended\(\s*p_application_id::text \|\| ':interview'/);
  });

  it("takes the lock BEFORE the existence check that decides the claim", () => {
    const lockAt = sql.indexOf("pg_advisory_xact_lock");
    const checkAt = sql.indexOf("from public.application_reviews ar", lockAt);
    const insertAt = sql.indexOf("insert into public.application_reviews");
    expect(lockAt).toBeGreaterThan(-1);
    expect(checkAt).toBeGreaterThan(lockAt);
    expect(insertAt).toBeGreaterThan(lockAt);
  });

  it("re-proves season participation and lifecycle inside the trusted function", () => {
    expect(sql).toContain("vam084_participant_for_stage(p_actor, v_season_id, 'interview')");
    expect(sql).toContain("'invited_to_interview'");
    expect(sql).toContain("Trusted server context required");
  });

  it("delegates the status advance to the canonical recompute function", () => {
    expect(sql).toContain("vam084_recompute_application_review_status(p_application_id, 'interview')");
  });

  it("writes the canonical claim columns", () => {
    expect(sql).toContain("'self_claim'");
    expect(sql).toContain("claimed_at");
    expect(sql).toContain("'in_progress'");
  });

  it("does not add a unique index that would forbid a legitimate second interview review", () => {
    expect(sql).not.toMatch(/create\s+unique\s+index/i);
  });

  it("is reachable only from the trusted server context", () => {
    expect(sql).toContain("revoke all on function public.vam095_claim_interview_review(uuid, uuid)");
    expect(sql).toContain("to service_role");
  });

  it("adds no interview scheduling surface", () => {
    expect(sql).not.toMatch(/interview_slot|scheduled_at|calendar/i);
  });
});
