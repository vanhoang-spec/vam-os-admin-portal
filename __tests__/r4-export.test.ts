/**
 * R4 — full recruitment-results export.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * The previous version of this file passed against a route that crashed for
 * every authorized caller and returned a `.xlsx` no spreadsheet program could
 * open. It did so because its doubles were not the production contracts:
 *
 *   * `getSupabaseServerClient` was mocked SYNCHRONOUS. In production it is
 *     async, the route did not await it, and `.from()` on a Promise throws.
 *     The mock removed the only condition under which the bug is visible.
 *   * `write-excel-file` was mocked to resolve `Buffer.from("fake-excel-data")`
 *     and the test asserted those bytes came back. The real library returns a
 *     handle whose `.toBuffer()` yields the file; the route was passing the
 *     handle straight to `Response`, which stringifies it. The mock asserted
 *     the route can copy a buffer, which was never in doubt.
 *   * CSV assertions used `split(",")`, which cannot read a quoted field, so
 *     the quoting cases proved nothing about quoting.
 *
 * So: the DB boundary is faked (`@/lib/data`), everything above it is the real
 * route; `write-excel-file` is real and its output is opened by an independent
 * ZIP/SpreadsheetML reader; CSV is read with an RFC 4180 parser.
 * Pagination and the real data-layer reads are covered in `r4-pagination.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn(),
  getScopeFilterResult: vi.fn()
}));
vi.mock("@/lib/data", () => ({
  getApplications: vi.fn(),
  getAllApplicationReviews: vi.fn(),
  getIntakeBatches: vi.fn(),
  getSeasons: vi.fn(),
  getAdminUsersByIds: vi.fn()
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new RedirectSignal(target);
  })
}));
vi.mock("@/components/ui", () => ({ PageHeader: () => null }));

import { GET } from "@/app/api/applications/export/route";
import ExportPage from "@/app/applications/export/page";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, getScopeFilter, getScopeFilterResult } from "@/lib/program-scope";
import {
  getAdminUsersByIds,
  getAllApplicationReviews,
  getApplications,
  getIntakeBatches,
  getSeasons
} from "@/lib/data";
import { canExportApplicationResults } from "@/lib/permissions";
import { canBrowseApplications } from "@/lib/read-access";
import { parseCsv, parseCsvTable } from "./support/rfc4180";
import { readXlsx } from "./support/ooxml-reader";

class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`NEXT_REDIRECT:${target}`);
  }
}

// Real-shaped UUIDs: several assertions turn on "this UUID never appears in the
// output", which a placeholder like "season-1" cannot demonstrate.
const SEASON_ID = "11111111-1111-4111-8111-111111111111";
const SEASON_CODE = "UEHM-S12";
const OTHER_SEASON_ID = "99999999-9999-4999-8999-999999999999";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_CODE = "B1";
const OTHER_BATCH_ID = "88888888-8888-4888-8888-888888888888";
const REVIEWER_ACTIVE = "33333333-3333-4333-8333-333333333333";
const REVIEWER_INACTIVE = "44444444-4444-4444-8444-444444444444";
const REVIEWER_DELETED = "55555555-5555-4555-8555-555555555555";
const MISSING_REVIEWER_LABEL = "Reviewer không còn trong hệ thống";

const SCOPED_FILTER = { allowedProgramIds: ["prog-1"], allowedSeasonIds: [SEASON_ID] };
const EMPTY_FILTER = { allowedProgramIds: [] as string[], allowedSeasonIds: [] as string[] };

const SEASONS = [{ id: SEASON_ID, code: SEASON_CODE, name: "UEH Mentoring S12", program_id: "prog-1" }];
const BATCHES = [{ id: BATCH_ID, season_id: SEASON_ID, code: BATCH_CODE, name: "Đợt 1", is_active: true }];

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    season_id: SEASON_ID,
    intake_batch_id: BATCH_ID,
    role_applied: "mentee",
    full_name: "Nguyễn Văn Ánh",
    email_primary: "anh@example.com",
    status: "submitted",
    raw_payload: { mssv: "0012345678" },
    ...overrides
  };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    application_id: "app-1",
    reviewer_admin_user_id: REVIEWER_ACTIVE,
    review_round: "profile_screening",
    status: "submitted",
    total_score: 10,
    recommendation: "Yes",
    ...overrides
  };
}

type Fixture = {
  apps?: unknown[];
  reviews?: unknown[];
  seasons?: unknown[];
  batches?: unknown[];
  reviewers?: unknown[];
  errors?: Partial<Record<"apps" | "reviews" | "seasons" | "batches" | "reviewers", string>>;
};

function seed(fixture: Fixture = {}) {
  const e = fixture.errors ?? {};
  vi.mocked(getApplications).mockResolvedValue({
    data: e.apps ? [] : (fixture.apps ?? []),
    error: e.apps ?? null
  } as never);
  vi.mocked(getAllApplicationReviews).mockResolvedValue({
    data: e.reviews ? [] : (fixture.reviews ?? []),
    error: e.reviews ?? null
  } as never);
  vi.mocked(getSeasons).mockResolvedValue({
    data: e.seasons ? [] : (fixture.seasons ?? SEASONS),
    error: e.seasons ?? null
  } as never);
  vi.mocked(getIntakeBatches).mockResolvedValue({
    data: e.batches ? [] : (fixture.batches ?? BATCHES),
    error: e.batches ?? null
  } as never);
  vi.mocked(getAdminUsersByIds).mockResolvedValue({
    data: e.reviewers ? [] : (fixture.reviewers ?? []),
    error: e.reviewers ?? null
  } as never);
}

function setAuth(
  role: string | null,
  options: { scope?: unknown; scopeError?: string | null; catalogError?: string | null } = {}
) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue(
    role ? ({ id: "actor-1", email: "actor@example.com", full_name: "Actor", role, status: "active", auth_user_id: "auth-1" } as never) : null
  );
  const isSuperAdmin = role === "super_admin";
  const scope = "scope" in options ? options.scope : isSuperAdmin ? undefined : SCOPED_FILTER;
  vi.mocked(getAdminScopeContext).mockResolvedValue({
    adminUser: null,
    authUserId: "auth-1",
    globalRole: role,
    isSuperAdmin,
    programScopes: [],
    scopeError: options.scopeError ?? null
  } as never);
  vi.mocked(getScopeFilter).mockResolvedValue(scope as never);
  // The catalog error rides alongside the (possibly degraded) filter, exactly
  // as `getScopeFilterResult` returns it in production.
  vi.mocked(getScopeFilterResult).mockResolvedValue({
    scope,
    error: options.catalogError ?? null
  } as never);
}

function call(query = "") {
  return GET(new NextRequest(`http://localhost/api/applications/export${query}`));
}

async function csvOf(query: string) {
  const res = await call(query);
  expect(res.status).toBe(200);
  return { res, text: await res.text() };
}

function filenameOf(res: Response) {
  return /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "";
}

async function pageAllows(role: string | null) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue(role ? ({ id: "actor-1", role } as never) : null);
  try {
    await ExportPage();
    return true;
  } catch (error) {
    if (error instanceof RedirectSignal) return false;
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("export permission helper", () => {
  it("grants exactly super_admin, admin and core_team", () => {
    expect(canExportApplicationResults("super_admin")).toBe(true);
    expect(canExportApplicationResults("admin")).toBe(true);
    expect(canExportApplicationResults("core_team")).toBe(true);
  });

  it("denies support_team, reviewer, viewer and absent roles", () => {
    for (const role of ["support_team", "reviewer", "viewer", "", null, undefined]) {
      expect(canExportApplicationResults(role as string)).toBe(false);
    }
  });

  it("is not an alias of canBrowseApplications — that helper includes support_team", () => {
    // The regression this guards: reusing the browse gate silently re-admits
    // support_team to the whole-season export.
    expect(canBrowseApplications("support_team" as never)).toBe(true);
    expect(canExportApplicationResults("support_team")).toBe(false);
  });
});

describe("supabase server client contract", () => {
  it("getSupabaseServerClient is async — the contract the route used to violate", async () => {
    const actual = await vi.importActual<typeof import("@/lib/supabase-server")>("@/lib/supabase-server");
    const result = actual.getSupabaseServerClient();
    expect(typeof (result as { then?: unknown }).then).toBe("function");
    await result;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("role matrix", () => {
  const allowed = ["super_admin", "admin", "core_team"];
  const denied = [null, "viewer", "reviewer", "support_team"];

  it.each(allowed)("allows %s", async (role) => {
    setAuth(role);
    const res = await call();
    expect(res.status).toBe(200);
  });

  it.each(denied.map((role) => [String(role), role] as const))("denies %s with 403", async (_label, role) => {
    setAuth(role);
    const res = await call();
    expect(res.status).toBe(403);
  });

  it("page policy matches API policy for every role", async () => {
    for (const role of [...allowed, ...denied]) {
      setAuth(role);
      const apiAllowed = (await call()).status !== 403;
      setAuth(role);
      const uiAllowed = await pageAllows(role);
      expect({ role, uiAllowed }).toEqual({ role, uiAllowed: apiAllowed });
    }
  });
});

describe("scope enforcement", () => {
  it("denies a core_team member with no resolved scope instead of returning an empty file", async () => {
    setAuth("core_team", { scope: EMPTY_FILTER });
    const res = await call();
    expect(res.status).toBe(403);
  });

  it("denies an admin whose scope could not be resolved at all", async () => {
    setAuth("admin", { scopeError: "scope lookup failed" });
    const res = await call();
    expect(res.status).toBe(403);
  });

  it("denies a season outside the granted scope", async () => {
    setAuth("core_team");
    const res = await call(`?season=${OTHER_SEASON_ID}`);
    expect(res.status).toBe(403);
  });

  it("denies a batch outside the granted scope", async () => {
    setAuth("core_team");
    const res = await call(`?batch=${OTHER_BATCH_ID}`);
    expect(res.status).toBe(403);
  });

  it("accepts an in-scope season and batch and narrows the rows", async () => {
    setAuth("core_team");
    seed({
      apps: [
        application({ id: "app-in", intake_batch_id: BATCH_ID }),
        application({ id: "app-other-batch", intake_batch_id: OTHER_BATCH_ID })
      ]
    });
    const { text } = await csvOf(`?season=${SEASON_CODE}&batch=${BATCH_CODE}`);
    const { rows } = parseCsvTable(text);
    expect(rows.map((row) => row[3])).toEqual(["app-in"]);
  });

  it("rejects an unrecognised role filter rather than widening to all", async () => {
    setAuth("core_team");
    const res = await call("?role=super_admin");
    expect(res.status).toBe(400);
  });

  it("narrows, never widens, on a recognised role filter", async () => {
    setAuth("core_team");
    seed({
      apps: [application({ id: "app-mentee", role_applied: "mentee" }), application({ id: "app-mentor", role_applied: "mentor" })]
    });
    const { text } = await csvOf("?role=mentor");
    const { rows } = parseCsvTable(text);
    expect(rows.map((row) => row[3])).toEqual(["app-mentor"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("fail-closed source contract", () => {
  const sources: Array<[string, keyof NonNullable<Fixture["errors"]>, string]> = [
    ["applications", "apps", ""],
    ["reviews", "reviews", "?type=detail"],
    ["intake batches", "batches", ""],
    ["seasons", "seasons", ""],
    ["reviewer identity", "reviewers", "?type=detail"]
  ];

  it.each(sources)("returns non-200 when %s fails", async (_name, key, query) => {
    setAuth("admin");
    seed({
      apps: [application()],
      reviews: [review()],
      reviewers: [{ id: REVIEWER_ACTIVE, full_name: "A", email: "a@example.com", role: "reviewer" }],
      errors: { [key]: "DB Error" }
    });
    const res = await call(query);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("still returns a 200 empty file for a legitimately empty dataset", async () => {
    setAuth("admin");
    seed({ apps: [] });
    const { text } = await csvOf("");
    const rows = parseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Season");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("season metadata", () => {
  it("prints the canonical season code, never the UUID", async () => {
    setAuth("admin");
    seed({ apps: [application()] });
    const { text } = await csvOf("");
    const { rows } = parseCsvTable(text);
    expect(rows[0][0]).toBe(SEASON_CODE);
    expect(text).not.toContain(SEASON_ID);
  });

  it("fails closed when an exported application's season is not in the catalog", async () => {
    setAuth("admin");
    seed({ apps: [application({ season_id: OTHER_SEASON_ID, intake_batch_id: null })] });
    const res = await call();
    expect(res.status).toBe(500);
  });

  it("returns non-200 when the scope catalog could not be resolved, even though a scope was granted", async () => {
    // S1 at the route boundary: the degraded filter still names a program, so
    // `hasAnyScope` is satisfied and every loader beneath returns nothing. The
    // 200 header-only file this used to produce reads as "no applicants".
    setAuth("admin", { catalogError: "catalog read failed" });
    seed({ apps: [] });
    const res = await call();
    expect(res.status).toBe(500);
  });

  describe("canonical season resolution", () => {
    // applications.season_id is canonical. The batch is a fallback for rows
    // that have none — never a second opinion about rows that do.
    it("S3 accepts a populated season that resolves, with a matching batch", async () => {
      setAuth("admin");
      seed({ apps: [application({ season_id: SEASON_ID, intake_batch_id: BATCH_ID })] });
      const { rows } = parseCsvTable((await csvOf("")).text);
      expect(rows[0][0]).toBe(SEASON_CODE);
    });

    it("accepts a populated season with no intake batch at all", async () => {
      setAuth("admin");
      seed({ apps: [application({ season_id: SEASON_ID, intake_batch_id: null })] });
      const { rows } = parseCsvTable((await csvOf("")).text);
      expect(rows[0][0]).toBe(SEASON_CODE);
      expect(rows[0][1]).toBe("");
    });

    it("S4 falls back to the batch season only when the application has none", async () => {
      setAuth("admin");
      seed({ apps: [application({ season_id: null, intake_batch_id: BATCH_ID })] });
      const { rows } = parseCsvTable((await csvOf("")).text);
      expect(rows[0][0]).toBe(SEASON_CODE);
    });

    it("S5 fails closed on an unknown populated season, even beside an authorized batch", async () => {
      setAuth("admin");
      seed({
        apps: [application({ season_id: "00000000-0000-4000-8000-000000000000", intake_batch_id: BATCH_ID })]
      });
      const res = await call();
      expect(res.status).toBe(500);
      // The batch's season must not have been borrowed to label the row.
      expect(await res.text()).not.toContain(SEASON_CODE);
    });

    it("S6 fails closed on an out-of-scope populated season rather than relabelling it from the batch", async () => {
      setAuth("admin");
      seed({
        // OTHER_SEASON_ID is a real season the caller was not granted, so it is
        // absent from the scoped catalog. Relabelling it as UEHM-S12 would
        // carry an out-of-scope applicant into an in-scope file.
        apps: [application({ season_id: OTHER_SEASON_ID, intake_batch_id: BATCH_ID })]
      });
      const res = await call();
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain(SEASON_CODE);
    });

    it("S7 fails closed when the application and its batch disagree about the season", async () => {
      setAuth("admin");
      seed({
        apps: [application({ season_id: SEASON_ID, intake_batch_id: OTHER_BATCH_ID })],
        // Both seasons resolve, so neither side is "unresolvable" — the fault
        // is the disagreement, and picking a side would invent an answer.
        seasons: [...SEASONS, { id: OTHER_SEASON_ID, code: "UEHM-S11", name: "S11", program_id: "prog-1" }],
        batches: [...BATCHES, { id: OTHER_BATCH_ID, season_id: OTHER_SEASON_ID, code: "B0", name: "Đợt 0", is_active: false }]
      });
      const res = await call();
      expect(res.status).toBe(500);
    });

    it("S8 fails closed when a null-season application's batch season does not resolve", async () => {
      setAuth("admin");
      seed({
        apps: [application({ season_id: null, intake_batch_id: OTHER_BATCH_ID })],
        batches: [...BATCHES, { id: OTHER_BATCH_ID, season_id: OTHER_SEASON_ID, code: "B0", name: "Đợt 0", is_active: false }]
      });
      const res = await call();
      expect(res.status).toBe(500);
    });

    it("fails closed when a null-season application names a batch that did not resolve", async () => {
      setAuth("admin");
      seed({ apps: [application({ season_id: null, intake_batch_id: OTHER_BATCH_ID })] });
      const res = await call();
      expect(res.status).toBe(500);
    });

    it("fails closed when neither the application nor a batch names a season", async () => {
      setAuth("admin");
      seed({ apps: [application({ season_id: null, intake_batch_id: null })] });
      const res = await call();
      expect(res.status).toBe(500);
    });
  });

  it("fails closed rather than labelling a season row that has no code", async () => {
    setAuth("admin");
    seed({ apps: [application()], seasons: [{ id: SEASON_ID, code: null, name: "No code", program_id: "prog-1" }] });
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(SEASON_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("reviewer identity", () => {
  const detailFixture = (reviewers: unknown[]) =>
    seed({
      apps: [application()],
      reviews: [
        review({ id: "rev-active", reviewer_admin_user_id: REVIEWER_ACTIVE }),
        review({ id: "rev-inactive", reviewer_admin_user_id: REVIEWER_INACTIVE }),
        review({ id: "rev-deleted", reviewer_admin_user_id: REVIEWER_DELETED })
      ],
      reviewers
    });

  it("names active and inactive reviewers, and labels a deleted one without leaking its UUID", async () => {
    setAuth("admin");
    detailFixture([
      { id: REVIEWER_ACTIVE, full_name: "Trần Thị Hoa", email: "hoa@example.com", role: "reviewer" },
      { id: REVIEWER_INACTIVE, full_name: "Lê Văn Cũ", email: "cu@example.com", role: "reviewer" }
    ]);

    const { text } = await csvOf("?type=detail");
    const { rows } = parseCsvTable(text);

    expect([rows[0][4], rows[0][5]]).toEqual(["Trần Thị Hoa", "hoa@example.com"]);
    expect([rows[1][4], rows[1][5]]).toEqual(["Lê Văn Cũ", "cu@example.com"]);
    expect([rows[2][4], rows[2][5]]).toEqual([MISSING_REVIEWER_LABEL, ""]);

    for (const id of [REVIEWER_ACTIVE, REVIEWER_INACTIVE, REVIEWER_DELETED]) {
      expect(text).not.toContain(id);
    }
  });

  it("asks for every reviewer id in ONE bulk call, not one call per review", async () => {
    setAuth("admin");
    detailFixture([]);
    await call("?type=detail");
    expect(vi.mocked(getAdminUsersByIds)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getAdminUsersByIds).mock.calls[0][0]).toEqual([
      REVIEWER_ACTIVE,
      REVIEWER_INACTIVE,
      REVIEWER_DELETED
    ]);
  });

  it("distinguishes a missing historical row from a failed identity query", async () => {
    setAuth("admin");
    detailFixture([]);
    const missingRowResponse = await call("?type=detail");
    expect(missingRowResponse.status).toBe(200);

    seed({
      apps: [application()],
      reviews: [review()],
      errors: { reviewers: "identity lookup failed" }
    });
    const failedQueryResponse = await call("?type=detail");
    expect(failedQueryResponse.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("data contract", () => {
  it("emits exactly one summary row per application", async () => {
    setAuth("admin");
    seed({
      apps: [application({ id: "app-1" }), application({ id: "app-2" }), application({ id: "app-3" })],
      reviews: [
        review({ id: "r1", application_id: "app-1" }),
        review({ id: "r2", application_id: "app-1" }),
        review({ id: "r3", application_id: "app-2" })
      ]
    });
    const { text } = await csvOf("");
    const { rows } = parseCsvTable(text);
    expect(rows.map((row) => row[3])).toEqual(["app-1", "app-2", "app-3"]);
  });

  it("aggregates submitted reviews only, per round, deterministically", async () => {
    setAuth("admin");
    seed({
      apps: [application()],
      reviews: [
        review({ id: "r1", status: "submitted", total_score: 10, recommendation: "Yes" }),
        review({ id: "r2", status: "submitted", total_score: 20, recommendation: "Maybe" }),
        review({ id: "r3", status: "assigned", total_score: 30, recommendation: "No" }),
        review({ id: "r4", status: "in_progress", total_score: 31, recommendation: "No" }),
        review({ id: "r5", status: "returned_for_clarification", total_score: 32, recommendation: "No" }),
        review({ id: "r6", status: "cancelled", total_score: 40, recommendation: "No" }),
        review({ id: "r7", review_round: "interview", status: "submitted", total_score: 50, recommendation: "Pass" })
      ]
    });
    const { text } = await csvOf("");
    const { rows } = parseCsvTable(text);
    expect(rows[0].slice(9, 15)).toEqual(["2", "15.00", "Yes; Maybe", "1", "50.00", "Pass"]);
  });

  it("keeps cancelled assignments out of the summary but visible in the detail sheet", async () => {
    setAuth("admin");
    seed({
      apps: [application()],
      reviews: [review({ id: "r1", status: "submitted", total_score: 10 }), review({ id: "r2", status: "cancelled", total_score: 99 })],
      reviewers: [{ id: REVIEWER_ACTIVE, full_name: "Hoa", email: "hoa@example.com", role: "reviewer" }]
    });

    const summary = parseCsvTable((await csvOf("")).text);
    expect(summary.rows[0][9]).toBe("1");

    const detail = parseCsvTable((await csvOf("?type=detail")).text);
    expect(detail.rows).toHaveLength(2);
    expect(detail.rows.map((row) => row[6])).toEqual(["submitted", "CANCELLED"]);
  });

  it("takes the final decision from applications.status, not from score", async () => {
    setAuth("admin");
    seed({
      apps: [
        application({ id: "a1", status: "approved_as_mentor" }),
        application({ id: "a2", status: "approved_as_mentee" }),
        application({ id: "a3", status: "rejected_or_not_fit" }),
        application({ id: "a4", status: "withdrawn" }),
        application({ id: "a5", status: "waitlisted" }),
        application({ id: "a6", status: "submitted" }),
        application({ id: "a7", status: null })
      ],
      reviews: [review({ id: "r1", application_id: "a3", total_score: 100 })]
    });
    const { text } = await csvOf("");
    const { rows } = parseCsvTable(text);
    expect(rows.map((row) => row[8])).toEqual([
      "Accepted",
      "Accepted",
      "Rejected",
      "Withdrawn",
      "Pending",
      "Pending",
      "Pending"
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("CSV contract", () => {
  const hostile = () =>
    seed({
      apps: [
        application({
          id: "app-1",
          full_name: "Nguyễn, Văn A",
          email_primary: 'Anh nói "OK"',
          raw_payload: { mssv: "0012345678" }
        }),
        application({ id: "app-2", full_name: "=cmd|' /C calc'!A0", email_primary: "+12345", role_applied: "-500", raw_payload: { mssv: "@danger" } })
      ],
      reviews: [review({ id: "r1", application_id: "app-1", reviewer_note: "line 1\nline 2" })],
      reviewers: [{ id: REVIEWER_ACTIVE, full_name: "Nguyễn Văn Ánh", email: "anh@example.com", role: "reviewer" }]
    });

  it("emits a UTF-8 BOM and round-trips Vietnamese, commas, quotes and newlines", async () => {
    setAuth("admin");
    hostile();

    // Asserted on the raw bytes: `Response.text()` performs WHATWG BOM
    // sniffing and strips the mark, so a decoded string cannot prove it was
    // ever sent — and without it Excel opens the file as Windows-1252 and
    // mangles every Vietnamese name.
    const bom = Buffer.from(await (await call("")).arrayBuffer()).subarray(0, 3);
    expect(Array.from(bom)).toEqual([0xef, 0xbb, 0xbf]);

    const summary = await csvOf("");
    expect(summary.res.headers.get("Content-Type")).toContain("charset=utf-8");

    const { rows } = parseCsvTable(summary.text);
    expect(rows[0][4]).toBe("Nguyễn, Văn A");
    expect(rows[0][5]).toBe('Anh nói "OK"');

    const detail = parseCsvTable((await csvOf("?type=detail")).text);
    expect(detail.rows[0][16]).toBe("line 1\nline 2");
    expect(detail.rows[0][4]).toBe("Nguyễn Văn Ánh");
  });

  it("keeps a leading-zero MSSV intact", async () => {
    setAuth("admin");
    hostile();
    const { rows } = parseCsvTable((await csvOf("")).text);
    expect(rows[0][6]).toBe("0012345678");
  });

  it("neutralises =, +, - and @ prefixes without corrupting the value", async () => {
    setAuth("admin");
    hostile();
    const { rows } = parseCsvTable((await csvOf("")).text);
    expect(rows[1][2]).toBe("'-500");
    expect(rows[1][4]).toBe("'=cmd|' /C calc'!A0");
    expect(rows[1][5]).toBe("'+12345");
    expect(rows[1][6]).toBe("'@danger");
  });

  it("names the file from the resolved context and never from a raw UUID", async () => {
    setAuth("admin");
    seed({ apps: [application()] });
    const today = new Date().toISOString().split("T")[0];

    const summary = await csvOf(`?batch=${BATCH_ID}&role=mentee`);
    expect(filenameOf(summary.res)).toBe(`${SEASON_CODE}_${BATCH_CODE}_mentee_ket-qua-tuyen_${today}.csv`);

    const detail = await csvOf("?type=detail");
    expect(filenameOf(detail.res)).toBe(`${SEASON_CODE}_ALL_ALL_chi-tiet-cham_${today}.csv`);

    for (const name of [filenameOf(summary.res), filenameOf(detail.res)]) {
      expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("XLSX contract (real write-excel-file, independent reader)", () => {
  async function workbookFor(query = "?format=xlsx") {
    const res = await call(query);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    return { res, bytes, workbook: readXlsx(bytes) };
  }

  beforeEach(() => {
    setAuth("admin");
    seed({
      apps: [
        application({ id: "app-1", full_name: "Nguyễn Văn Ánh", raw_payload: { mssv: "0012345678" } }),
        application({ id: "app-2", full_name: "=cmd|' /C calc'!A0", email_primary: "+12345", raw_payload: { mssv: "@danger" } })
      ],
      reviews: [
        review({ id: "r1", application_id: "app-1", reviewer_note: "line 1\nline 2", total_score: 10 }),
        review({ id: "r2", application_id: "app-2", reviewer_admin_user_id: REVIEWER_DELETED, total_score: 20 })
      ],
      reviewers: [{ id: REVIEWER_ACTIVE, full_name: "Trần Thị Hoa", email: "hoa@example.com", role: "reviewer" }]
    });
  });

  it("returns real OOXML bytes, not a stringified object", async () => {
    const { res, bytes } = await workbookFor();
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(bytes.toString("utf8")).not.toContain("[object Object]");
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("is an OOXML package containing exactly the two contracted sheets", async () => {
    const { workbook } = await workbookFor();
    expect(workbook.entries.has("[Content_Types].xml")).toBe(true);
    expect(workbook.sheetNames).toEqual(["Ket_qua_tuyen", "Chi_tiet_cham"]);
  });

  it("carries the summary data, with Vietnamese and a text-typed leading-zero MSSV", async () => {
    const { workbook } = await workbookFor();
    const sheet = workbook.sheets["Ket_qua_tuyen"];
    expect(sheet[0].slice(0, 7)).toEqual([
      "Season",
      "Batch",
      "Role",
      "Application ID",
      "Applicant Name",
      "Email",
      "MSSV"
    ]);
    expect(sheet[1][0]).toBe(SEASON_CODE);
    expect(sheet[1][4]).toBe("Nguyễn Văn Ánh");

    const mssv = workbook.cellTypes["Ket_qua_tuyen"][1][6];
    expect(mssv).toEqual({ value: "0012345678", type: "string" });
  });

  it("stores formula-like values as inert text", async () => {
    const { workbook } = await workbookFor();
    const row = workbook.cellTypes["Ket_qua_tuyen"][2];
    expect(row[4]).toEqual({ value: "'=cmd|' /C calc'!A0", type: "string" });
    expect(row[5]).toEqual({ value: "'+12345", type: "string" });
    expect(row[6]).toEqual({ value: "'@danger", type: "string" });
  });

  it("carries the detail data with resolved reviewer identities", async () => {
    const { workbook, bytes } = await workbookFor();
    const sheet = workbook.sheets["Chi_tiet_cham"];
    expect(sheet[0][4]).toBe("Reviewer Name");
    expect(sheet[1][4]).toBe("Trần Thị Hoa");
    expect(sheet[1][5]).toBe("hoa@example.com");
    expect(sheet[1][16]).toBe("line 1\nline 2");
    expect(sheet[2][4]).toBe(MISSING_REVIEWER_LABEL);
    expect(sheet[2][5]).toBe("");
    expect(bytes.toString("utf8")).not.toContain(REVIEWER_DELETED);
  });

  it("names the workbook from the resolved context", async () => {
    const { res } = await workbookFor(`?format=xlsx&batch=${BATCH_ID}&role=mentee`);
    const today = new Date().toISOString().split("T")[0];
    expect(filenameOf(res)).toBe(`${SEASON_CODE}_${BATCH_CODE}_mentee_tong-hop_${today}.xlsx`);
    expect(filenameOf(res)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("privacy minimisation", () => {
  it("exports MSSV but no payload, contact, auth or security metadata", async () => {
    setAuth("admin");
    seed({
      apps: [
        application({
          phone_primary: "0900000000",
          auth_user_id: "auth-secret-id",
          raw_payload: {
            mssv: "0012345678",
            cccd: "079300000000",
            emergency_contact: "0911111111",
            reset_token: "tok_should_never_ship"
          },
          internal_notes: { note: "internal-only-note" }
        })
      ],
      reviews: [review({ reviewer_note: "Điểm ổn" })],
      reviewers: [
        {
          id: REVIEWER_ACTIVE,
          full_name: "Trần Thị Hoa",
          email: "hoa@example.com",
          role: "reviewer",
          auth_user_id: "reviewer-auth-id",
          password_hash: "hash_should_never_ship"
        }
      ]
    });

    const forbidden = [
      "0900000000",
      "auth-secret-id",
      "079300000000",
      "0911111111",
      "tok_should_never_ship",
      "internal-only-note",
      "reviewer-auth-id",
      "hash_should_never_ship"
    ];

    const summary = (await csvOf("")).text;
    const detail = (await csvOf("?type=detail")).text;
    const xlsx = Buffer.from(await (await call("?format=xlsx")).arrayBuffer()).toString("utf8");

    for (const secret of forbidden) {
      expect(summary).not.toContain(secret);
      expect(detail).not.toContain(secret);
      expect(xlsx).not.toContain(secret);
    }
    expect(parseCsvTable(summary).rows[0][6]).toBe("0012345678");
  });
});
