import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scope: "test" })),
  canOperateSeason: vi.fn(async () => true)
}));

import { GET as resultsGet } from "@/app/api/exports/recruitment-results/route";
import { GET as scoresGet } from "@/app/api/exports/review-scores/route";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createFakeDb, fakeClient, requestsFor } from "./support/fake-postgrest";

const BOM = String.fromCharCode(0xfeff);

const SEASON = "11111111-1111-4111-8111-111111111111";
const OTHER_SEASON = "22222222-2222-4222-8222-222222222222";
const BATCH = "33333333-3333-4333-8333-333333333333";
const OTHER_BATCH = "44444444-4444-4444-8444-444444444444";
const REVIEWER_A = "55555555-5555-4555-8555-555555555555";
const REVIEWER_B = "66666666-6666-4666-8666-666666666666";

const db = createFakeDb();

/** Pads a counter into a sortable v4-shaped uuid so keyset paging is deterministic. */
function uuid(n: number) {
  return `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function application(over: Record<string, unknown> = {}) {
  return {
    id: uuid(1),
    sbd: "SBD-1",
    full_name: "Nguyễn Văn A",
    email_primary: "a@example.com",
    role_applied: "mentor",
    season_id: SEASON,
    intake_batch_id: BATCH,
    status: "submitted",
    submitted_at: "2026-08-01T00:00:00Z",
    ...over
  };
}

/**
 * A decision row as PostgREST returns it for the aliased `!inner` embed: the
 * parent is nested under the alias the embed was requested as, which is also
 * what the batch/season/role/status filters resolve against.
 */
function decision(over: Record<string, unknown> = {}) {
  const parent = (over.application as Record<string, unknown>) ?? {
    id: uuid(1),
    season_id: SEASON,
    intake_batch_id: BATCH,
    role_applied: "mentor",
    status: "submitted"
  };
  return {
    id: uuid(1),
    application_id: parent.id,
    decision: null,
    new_status: "screening_passed",
    previous_status: "screening_completed",
    created_at: "2026-08-02T00:00:00Z",
    ...over,
    application: parent
  };
}

function review(over: Record<string, unknown> = {}) {
  return {
    id: uuid(1),
    application_id: uuid(1),
    reviewer_admin_user_id: REVIEWER_A,
    review_round: "profile_screening",
    status: "submitted",
    score_motivation: 4,
    score_goal_clarity: 4,
    score_commitment: 5,
    score_fit: 3,
    score_communication: 4,
    total_score: 20,
    recommendation: "advance",
    reviewer_note: "Tốt",
    submitted_at: "2026-08-02T00:00:00Z",
    reviewer: { email: "rev.a@example.com", full_name: "Reviewer A" },
    application: {
      full_name: "Nguyễn Văn A",
      email_primary: "a@example.com",
      role_applied: "mentor",
      season_id: SEASON,
      intake_batch_id: BATCH
    },
    ...over
  };
}

beforeEach(() => {
  db.reset();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "admin" } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true as never);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
  db.tables.intake_batches = [
    { id: BATCH, season_id: SEASON },
    { id: OTHER_BATCH, season_id: OTHER_SEASON }
  ];
  db.tables.applications = [];
  db.tables.application_reviews = [];
  db.tables.application_decisions = [];
});

function req(path: string, query: string) {
  return new Request(`https://preview.test${path}?${query}`);
}

function parseCsv(text: string) {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  return body.split("\n").map((line) => line.split('","').map((cell) => cell.replace(/^"|"$/g, "")));
}

// ── Authorization ────────────────────────────────────────────────────────────

describe("export routes — authorization", () => {
  it.each([
    ["results", resultsGet],
    ["scores", scoresGet]
  ])("%s rejects an unauthenticated caller", async (_name, handler) => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as never);
    const res = await handler(req("/x", `season_id=${SEASON}`));
    expect(res.status).toBe(401);
  });

  it.each([
    ["results", resultsGet],
    ["scores", scoresGet]
  ])("%s rejects a role without assign-review rights", async (_name, handler) => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "v", role: "viewer" } as never);
    const res = await handler(req("/x", `season_id=${SEASON}`));
    expect(res.status).toBe(403);
  });

  // A pure `reviewer` holds canReview (they score applications) but NOT
  // canAssignReview. Both exports carry candidate PII — name and email on the
  // results file, and candidate name/email alongside every reviewer's scores
  // and notes on the scores file — so a reviewer must never be able to
  // download either, in any season, however they were granted review scope.
  it.each([
    ["results", resultsGet],
    ["scores", scoresGet]
  ])("%s denies a pure reviewer role the candidate PII download", async (_name, handler) => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "rev", role: "reviewer" } as never);
    const res = await handler(req("/x", `season_id=${SEASON}`));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it.each([
    ["results", resultsGet],
    ["scores", scoresGet]
  ])("%s denies a reviewer even with full season scope granted", async (_name, handler) => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "rev", role: "reviewer" } as never);
    vi.mocked(canOperateSeason).mockResolvedValue(true as never);
    db.tables.applications = [application()];
    db.tables.application_reviews = [review()];
    const res = await handler(req("/x", `intake_batch_id=${BATCH}`));
    expect(res.status).toBe(403);
  });

  it.each([
    ["results", resultsGet],
    ["scores", scoresGet]
  ])("%s admits the admin tiers that hold canAssignReview", async (_name, handler) => {
    for (const role of ["super_admin", "admin", "core_team"]) {
      vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: role, role } as never);
      const res = await handler(req("/x", `season_id=${SEASON}`));
      expect(res.status).toBe(200);
    }
  });

  it.each([
    ["results", resultsGet],
    ["scores", scoresGet]
  ])("%s refuses a batch outside the caller's season scope", async (_name, handler) => {
    vi.mocked(canOperateSeason).mockResolvedValue(false as never);
    const res = await handler(req("/x", `intake_batch_id=${OTHER_BATCH}`));
    expect(res.status).toBe(403);
  });

  it.each([
    ["results", resultsGet],
    ["scores", scoresGet]
  ])("%s requires an explicit scope rather than exporting everything", async (_name, handler) => {
    const res = await handler(req("/x", "role_applied=mentor"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Missing scope");
  });
});

// ── Filter contract: invalid values must never silently broaden ──────────────

describe("filter contract — invalid values fail closed", () => {
  const badResults: [string, string][] = [
    ["role_applied=mentors", "role_applied"],
    ["status=not_a_status", "status"],
    ["status=", "status"],
    ["stage=phỏng vấn", "stage"],
    ["screening_decision=dau", "screening_decision"],
    ["intake_batch_id=not-a-uuid", "intake_batch_id"]
  ];
  it.each(badResults)("results rejects ?%s", async (query, param) => {
    const res = await resultsGet(req("/x", `season_id=${SEASON}&${query}`));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(param);
  });

  const badScores: [string, string][] = [
    ["review_round=screening", "review_round"],
    ["review_status=done", "review_status"],
    ["reviewer=someone", "reviewer"],
    ["role_applied=both", "role_applied"]
  ];
  it.each(badScores)("scores rejects ?%s", async (query, param) => {
    const res = await scoresGet(req("/x", `season_id=${SEASON}&${query}`));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(param);
  });

  it("rejects a batch that contradicts the supplied season rather than intersecting", async () => {
    const res = await resultsGet(req("/x", `intake_batch_id=${BATCH}&season_id=${OTHER_SEASON}`));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("does not belong");
  });

  it("ignores an unrecognised parameter name", async () => {
    db.tables.applications = [application()];
    const res = await resultsGet(req("/x", `season_id=${SEASON}&totally_unknown=1`));
    expect(res.status).toBe(200);
  });
});

// ── Results: decision derivation ─────────────────────────────────────────────

describe("recruitment results — per-stage decision derivation", () => {
  it("distinguishes screening, interview and final outcomes instead of one pass concept", async () => {
    const parent = { id: uuid(1), season_id: SEASON, intake_batch_id: BATCH, role_applied: "mentor", status: "approved_as_mentor" };
    db.tables.applications = [application({ id: uuid(1), status: "approved_as_mentor" })];
    db.tables.application_decisions = [
      decision({ id: uuid(1), application: parent, new_status: "screening_passed", created_at: "2026-08-02T00:00:00Z" }),
      decision({ id: uuid(2), application: parent, new_status: "interview_passed", created_at: "2026-08-04T00:00:00Z" }),
      decision({ id: uuid(3), application: parent, new_status: "approved_as_mentor", created_at: "2026-08-05T00:00:00Z" })
    ];
    const res = await resultsGet(req("/x", `season_id=${SEASON}`));
    const rows = parseCsv(await res.text());
    const [header, row] = rows;
    expect(header).toContain("Kết quả sơ loại");
    expect(header).toContain("Kết quả phỏng vấn");
    expect(header).toContain("Kết quả cuối cùng");
    expect(row[9]).toBe("screening_passed");
    expect(row[11]).toBe("interview_passed");
    expect(row[13]).toBe("approved_as_mentor");
  });

  it("attributes an ambiguous rejection to the stage it actually happened in", async () => {
    const p1 = { id: uuid(1), season_id: SEASON, intake_batch_id: BATCH, role_applied: "mentor", status: "rejected_or_not_fit" };
    const p2 = { id: uuid(2), season_id: SEASON, intake_batch_id: BATCH, role_applied: "mentor", status: "rejected_or_not_fit" };
    db.tables.applications = [
      // Rejected during screening — never reached the interview stage.
      application({ id: uuid(1), status: "rejected_or_not_fit" }),
      // Same terminal status, but rejected after passing screening.
      application({ id: uuid(2), status: "rejected_or_not_fit" })
    ];
    db.tables.application_decisions = [
      decision({ id: uuid(1), application: p1, new_status: "rejected_or_not_fit", created_at: "2026-08-02T00:00:00Z" }),
      decision({ id: uuid(2), application: p2, new_status: "screening_passed", created_at: "2026-08-02T00:00:00Z" }),
      decision({ id: uuid(3), application: p2, new_status: "rejected_or_not_fit", created_at: "2026-08-06T00:00:00Z" })
    ];
    const res = await resultsGet(req("/x", `season_id=${SEASON}`));
    const [, first, second] = parseCsv(await res.text());
    expect(first[9]).toBe("rejected_or_not_fit");
    expect(first[11]).toBe("");
    expect(second[9]).toBe("screening_passed");
    expect(second[11]).toBe("rejected_or_not_fit");
  });

  it("leaves decision columns empty rather than inventing an outcome with no audit row", async () => {
    db.tables.applications = [application({ status: "screening_passed" })];
    const res = await resultsGet(req("/x", `season_id=${SEASON}`));
    const [, row] = parseCsv(await res.text());
    expect(row[6]).toBe("screening_passed");
    expect(row[9]).toBe("");
    expect(row[11]).toBe("");
    expect(row[13]).toBe("");
  });

  it("filters by derived per-stage outcome", async () => {
    const q1 = { id: uuid(1), season_id: SEASON, intake_batch_id: BATCH, role_applied: "mentor", status: "submitted" };
    const q2 = { id: uuid(2), season_id: SEASON, intake_batch_id: BATCH, role_applied: "mentor", status: "submitted" };
    db.tables.applications = [application({ id: uuid(1) }), application({ id: uuid(2) })];
    db.tables.application_decisions = [
      decision({ id: uuid(1), application: q1, new_status: "screening_passed", created_at: "2026-08-02T00:00:00Z" }),
      decision({ id: uuid(2), application: q2, new_status: "rejected_or_not_fit", created_at: "2026-08-02T00:00:00Z" })
    ];
    const passed = parseCsv(await (await resultsGet(req("/x", `season_id=${SEASON}&screening_decision=passed`))).text());
    expect(passed).toHaveLength(2);
    expect(passed[1][0]).toBe(uuid(1));

    const rejected = parseCsv(await (await resultsGet(req("/x", `season_id=${SEASON}&screening_decision=rejected`))).text());
    expect(rejected).toHaveLength(2);
    expect(rejected[1][0]).toBe(uuid(2));
  });
});

// ── Results: DB-level filters and isolation ──────────────────────────────────

describe("recruitment results — filtering and isolation", () => {
  it("separates Mentor from Mentee", async () => {
    db.tables.applications = [
      application({ id: uuid(1), role_applied: "mentor" }),
      application({ id: uuid(2), role_applied: "mentee" })
    ];
    const rows = parseCsv(await (await resultsGet(req("/x", `season_id=${SEASON}&role_applied=mentee`))).text());
    expect(rows).toHaveLength(2);
    expect(rows[1][4]).toBe("mentee");
  });

  it("does not leak across intake batches", async () => {
    db.tables.applications = [
      application({ id: uuid(1), intake_batch_id: BATCH }),
      application({ id: uuid(2), intake_batch_id: OTHER_BATCH, season_id: OTHER_SEASON })
    ];
    const rows = parseCsv(await (await resultsGet(req("/x", `intake_batch_id=${BATCH}`))).text());
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe(uuid(1));
  });

  it("filters by operational status list", async () => {
    db.tables.applications = [
      application({ id: uuid(1), status: "screening_passed" }),
      application({ id: uuid(2), status: "needs_more_review" }),
      application({ id: uuid(3), status: "submitted" })
    ];
    const rows = parseCsv(
      await (await resultsGet(req("/x", `season_id=${SEASON}&status=screening_passed,needs_more_review`))).text()
    );
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((row) => row[6]).sort()).toEqual(["needs_more_review", "screening_passed"]);
  });

  it("filters by current stage", async () => {
    db.tables.applications = [
      application({ id: uuid(1), status: "submitted" }),
      application({ id: uuid(2), status: "interview_scheduled" }),
      application({ id: uuid(3), status: "approved_as_mentor" })
    ];
    const rows = parseCsv(await (await resultsGet(req("/x", `season_id=${SEASON}&stage=interview`))).text());
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe(uuid(2));
  });
});

// ── Results: source fields projection ────────────────────────────────────────

describe("recruitment results — source fields projection", () => {
  it("exports exact source field permutations and preserves alignment", async () => {
    db.tables.applications = [
      application({ id: uuid(1), raw_payload: { referrer_or_source: "friend" }, acquisition_channel: null }),
      application({ id: uuid(2), raw_payload: { referrer_or_source: "other", referrer_or_source_other: "Workshop" }, acquisition_channel: null }),
      application({ id: uuid(3), raw_payload: null, acquisition_channel: "legacy_channel" }),
      application({ id: uuid(4), raw_payload: null, acquisition_channel: null })
    ];

    const res = await resultsGet(req("/x", `season_id=${SEASON}`));
    expect(res.status).toBe(200);

    const rows = parseCsv(await res.text());
    const header = rows[0];

    // Assert CSV header contains exactly one "Biết đến chương trình qua"
    const channelCols = header.filter(col => col === "Biết đến chương trình qua");
    expect(channelCols).toHaveLength(1);
    
    const channelIndex = header.indexOf("Biết đến chương trình qua");

    // Case A: friend -> Bạn bè
    expect(rows[1][channelIndex]).toBe("Bạn bè");
    expect(rows[1].length).toBe(header.length);

    // Case B: other + detail -> Khác (Workshop)
    expect(rows[2][channelIndex]).toBe("Khác (Workshop)");
    expect(rows[2].length).toBe(header.length);

    // Case C: legacy-only -> legacy_channel
    expect(rows[3][channelIndex]).toBe("legacy_channel");
    expect(rows[3].length).toBe(header.length);

    // Case D: both absent -> canonical missing marker (—)
    expect(rows[4][channelIndex]).toBe("—");
    expect(rows[4].length).toBe(header.length);
  });
});

// ── Paged read tests end ────────────────────────────────────────────────────────

// ── Scores: filtering ────────────────────────────────────────────────────────

describe("review scores — filtering", () => {
  it("separates profile_screening from interview rounds", async () => {
    db.tables.application_reviews = [
      review({ id: uuid(1), review_round: "profile_screening" }),
      review({ id: uuid(2), review_round: "interview" })
    ];
    const rows = parseCsv(await (await scoresGet(req("/x", `season_id=${SEASON}&review_round=interview`))).text());
    expect(rows).toHaveLength(2);
    expect(rows[1][4]).toBe("interview");
  });

  it("filters by reviewer", async () => {
    db.tables.application_reviews = [
      review({ id: uuid(1), reviewer_admin_user_id: REVIEWER_A }),
      review({ id: uuid(2), reviewer_admin_user_id: REVIEWER_B, reviewer: { email: "rev.b@example.com", full_name: "Reviewer B" } })
    ];
    const rows = parseCsv(await (await scoresGet(req("/x", `season_id=${SEASON}&reviewer=${REVIEWER_B}`))).text());
    expect(rows).toHaveLength(2);
    expect(rows[1][5]).toBe("rev.b@example.com");
  });

  it("filters by review status", async () => {
    db.tables.application_reviews = [
      review({ id: uuid(1), status: "submitted" }),
      review({ id: uuid(2), status: "cancelled" })
    ];
    const rows = parseCsv(await (await scoresGet(req("/x", `season_id=${SEASON}&review_status=submitted`))).text());
    expect(rows).toHaveLength(2);
    expect(rows[1][7]).toBe("submitted");
  });

  it("separates Mentor from Mentee through the embedded application", async () => {
    db.tables.application_reviews = [
      review({ id: uuid(1) }),
      review({
        id: uuid(2),
        application: { full_name: "B", email_primary: "b@example.com", role_applied: "mentee", season_id: SEASON, intake_batch_id: BATCH }
      })
    ];
    const rows = parseCsv(await (await scoresGet(req("/x", `season_id=${SEASON}&role_applied=mentee`))).text());
    expect(rows).toHaveLength(2);
    expect(rows[1][3]).toBe("mentee");
  });

  it("exports the score dimensions, total and recommendation", async () => {
    db.tables.application_reviews = [review()];
    const rows = parseCsv(await (await scoresGet(req("/x", `season_id=${SEASON}`))).text());
    expect(rows[0]).toEqual(
      expect.arrayContaining(["Điểm động lực", "Tổng điểm", "Khuyến nghị", "Email ứng viên"])
    );
    expect(rows[1].slice(8, 15)).toEqual(["4", "4", "5", "3", "4", "20", "advance"]);
  });
});

// ── Pagination to exhaustion, with filters re-applied on every page ──────────

describe("exports page to exhaustion", () => {
  it("returns every result row beyond the 1000-row PostgREST cap", async () => {
    db.tables.applications = Array.from({ length: 2500 }, (_, i) =>
      application({ id: uuid(i + 1), sbd: `SBD-${i + 1}` })
    );
    const rows = parseCsv(await (await resultsGet(req("/x", `season_id=${SEASON}`))).text());
    expect(rows).toHaveLength(2501);
  });

  it("reads every application_decisions row beyond the cap, not just the first page", async () => {
    // One application carrying a decision history far longer than the
    // PostgREST cap. As a nested embed this history had no cursor of its own
    // and would be silently truncated; as its own keyset-paged read the final
    // decision is still reached, which is the only reason the export can
    // report the correct final outcome.
    const parent = {
      id: uuid(1),
      season_id: SEASON,
      intake_batch_id: BATCH,
      role_applied: "mentor",
      status: "approved_as_mentor"
    };
    db.tables.applications = [application({ id: uuid(1), status: "approved_as_mentor" })];
    db.tables.application_decisions = [
      decision({ id: uuid(1), application: parent, new_status: "screening_passed", created_at: "2026-08-01T00:00:00Z" }),
      // 2500 intervening needs_more_review cycles.
      ...Array.from({ length: 2500 }, (_, i) =>
        decision({
          id: uuid(i + 2),
          application: parent,
          new_status: "needs_more_review",
          created_at: `2026-08-02T00:00:${String(i % 60).padStart(2, "0")}Z`
        })
      ),
      decision({ id: uuid(2600), application: parent, new_status: "interview_passed", created_at: "2026-09-01T00:00:00Z" }),
      decision({ id: uuid(2601), application: parent, new_status: "approved_as_mentor", created_at: "2026-09-02T00:00:00Z" })
    ];

    const rows = parseCsv(await (await resultsGet(req("/x", `season_id=${SEASON}`))).text());
    const pages = requestsFor(db, "application_decisions");
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.reduce((sum, page) => sum + page.returned, 0)).toBe(2503);
    // Outcomes from the far end of the history survived.
    expect(rows[1][11]).toBe("interview_passed");
    expect(rows[1][13]).toBe("approved_as_mentor");
  });

  it("re-applies the decision-read scope on every decisions page", async () => {
    const inScope = { id: uuid(1), season_id: SEASON, intake_batch_id: BATCH, role_applied: "mentor", status: "submitted" };
    const outOfScope = { id: uuid(2), season_id: OTHER_SEASON, intake_batch_id: OTHER_BATCH, role_applied: "mentee", status: "submitted" };
    db.tables.applications = [application({ id: uuid(1) })];
    db.tables.application_decisions = [
      ...Array.from({ length: 1400 }, (_, i) =>
        decision({ id: uuid(i + 1), application: inScope, new_status: "needs_more_review", created_at: "2026-08-02T00:00:00Z" })
      ),
      ...Array.from({ length: 1400 }, (_, i) =>
        decision({ id: uuid(i + 2000), application: outOfScope, new_status: "screening_passed", created_at: "2026-08-02T00:00:00Z" })
      )
    ];

    await resultsGet(req("/x", `intake_batch_id=${BATCH}&role_applied=mentor`));
    const pages = requestsFor(db, "application_decisions");
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.filters).toContain("application.intake_batch_id");
      expect(page.filters).toContain("application.role_applied");
    }
    // No out-of-scope decision was ever returned, on any page.
    expect(pages.reduce((sum, page) => sum + page.returned, 0)).toBe(1400);
  });

  it("returns every review row beyond the cap", async () => {
    db.tables.application_reviews = Array.from({ length: 2500 }, (_, i) =>
      review({ id: uuid(i + 1), application_id: uuid(i + 1) })
    );
    const rows = parseCsv(await (await scoresGet(req("/x", `season_id=${SEASON}`))).text());
    expect(rows).toHaveLength(2501);
  });

  it("re-applies every results filter on each page, not only the first", async () => {
    db.tables.applications = Array.from({ length: 2500 }, (_, i) =>
      application({ id: uuid(i + 1), role_applied: i % 2 === 0 ? "mentor" : "mentee" })
    );
    const rows = parseCsv(
      await (await resultsGet(req("/x", `intake_batch_id=${BATCH}&role_applied=mentor&status=submitted`))).text()
    );
    expect(rows.slice(1).every((row) => row[4] === "mentor")).toBe(true);

    const pages = requestsFor(db, "applications");
    expect(pages.length).toBeGreaterThan(1);
    // Every page must carry the identical predicate set; a filter dropped after
    // page 1 is the exact silent-widening defect this contract exists to stop.
    for (const page of pages) {
      expect(page.filters).toContain("intake_batch_id");
      expect(page.filters).toContain("role_applied");
      expect(page.filters).toContain("status");
    }
    // Identical once the keyset cursor (the only legitimate per-page
    // difference) is removed.
    const withoutCursor = pages.map((page) =>
      JSON.stringify(
        (JSON.parse(page.filters) as { kind: string; column: string }[]).filter(
          (filter) => !(filter.kind === "gt" && filter.column === "id")
        )
      )
    );
    expect(new Set(withoutCursor).size).toBe(1);
  });

  it("re-applies every scores filter on each page, not only the first", async () => {
    db.tables.application_reviews = Array.from({ length: 2500 }, (_, i) =>
      review({ id: uuid(i + 1), application_id: uuid(i + 1) })
    );
    await scoresGet(req("/x", `intake_batch_id=${BATCH}&review_round=profile_screening&reviewer=${REVIEWER_A}`));
    const pages = requestsFor(db, "application_reviews");
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.filters).toContain("application.intake_batch_id");
      expect(page.filters).toContain("review_round");
      expect(page.filters).toContain("reviewer_admin_user_id");
    }
  });
});

// ── CSV shape ────────────────────────────────────────────────────────────────

describe("CSV encoding", () => {
  it("emits a UTF-8 BOM so Excel reads Vietnamese diacritics correctly", async () => {
    db.tables.applications = [application()];
    const res = await resultsGet(req("/x", `season_id=${SEASON}`));
    // Asserted on the raw bytes on purpose: WHATWG text decoding strips a
    // leading BOM, so `res.text()` would report success whether or not the
    // BOM was ever written — the exact thing this test needs to prove.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain("Nguyễn Văn A");
  });

  it("neutralises a spreadsheet formula in applicant-controlled free text", async () => {
    db.tables.application_reviews = [review({ reviewer_note: '=HYPERLINK("http://evil","x")' })];
    const text = await (await scoresGet(req("/x", `season_id=${SEASON}`))).text();
    expect(text).toContain("\"'=HYPERLINK");
  });

  it("keeps an embedded newline from widening a row", async () => {
    db.tables.applications = [application({ full_name: "Dòng 1\nDòng 2" })];
    const text = await (await resultsGet(req("/x", `season_id=${SEASON}`))).text();
    const body = text.slice(1).split("\n");
    expect(body).toHaveLength(2);
    expect(body[1]).toContain("Dòng 1 Dòng 2");
  });

  it("serves a downloadable CSV content type", async () => {
    db.tables.applications = [application()];
    const res = await resultsGet(req("/x", `season_id=${SEASON}`));
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });
});
