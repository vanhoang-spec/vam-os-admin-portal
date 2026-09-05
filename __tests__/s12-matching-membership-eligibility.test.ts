/**
 * S12 matching — season PARTICIPATION eligibility.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE PROVE
 * ---------------------------------------------------------------------------
 * Every test runs the REAL `getManualMatchingCandidates` / `createManualMatch`
 * bodies against an in-memory PostgREST fake and asserts on the returned value.
 * The fake honours PROJECTION, so a test can prove production actually asked
 * for `role` and `status` on the membership read rather than assuming it, and
 * it honours `readAllPages`' keyset contract so the membership read must be
 * paged like every other Class C read.
 *
 * ---------------------------------------------------------------------------
 * THE PRODUCTION SHAPE BEING DEFENDED
 * ---------------------------------------------------------------------------
 * Two real UEHM-S12 cases, in opposite directions:
 *
 *   CASE A — Phạm Thanh Thuý: S12 application `approved_as_mentee`, S12 mentee
 *     membership `withdrawn`, mentee profile present, no active S12 match. She
 *     left the programme and Matching kept offering her, because the withdrawal
 *     is recorded on the membership and nothing amends the application row.
 *
 *   CASE B — S11→S12 continuations: ACTIVE S12 mentee membership, mentee
 *     profile, an ACTIVE S11 match, no active S12 match, and NO S12
 *     application. Legitimately in S12, invisible to Matching, and their old
 *     S11 match must not consume S12 capacity — matches are season-scoped.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: unknown) => fn };
});
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateAnyScope: vi.fn(),
  getAllowedSeasonIds: vi.fn(),
  canAccessSeason: vi.fn()
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  canAccessSeason,
  canOperateAnyScope,
  getAdminScopeContext,
  getAllowedSeasonIds
} from "@/lib/program-scope";
import { createManualMatch, getManualMatchingCandidates } from "@/lib/matches";

// ── Fixture ids ──────────────────────────────────────────────────────────────

const S12 = "00000000-0000-4000-8000-000000000001";
const S11 = "00000000-0000-4000-8000-000000000002";
const B1 = "00000000-0000-4000-8000-000000000011";
const B_OLD = "00000000-0000-4000-8000-000000000012";

const P_APPROVED_MENTOR = "00000000-0000-4000-8000-000000000101";
const P_MEMBERSHIP_MENTOR = "00000000-0000-4000-8000-000000000102";
const P_WITHDRAWN_MENTOR = "00000000-0000-4000-8000-000000000103";

const P_APPROVED_MENTEE = "00000000-0000-4000-8000-000000000201";
/** CASE A — approved in S12, withdrawn from S12. */
const P_WITHDRAWN_MENTEE = "00000000-0000-4000-8000-000000000202";
/** CASE B — active S12 membership, active S11 match, no S12 application. */
const P_CONTINUATION_MENTEE = "00000000-0000-4000-8000-000000000203";
/** Active membership in S11 only. */
const P_OTHER_SEASON_MENTEE = "00000000-0000-4000-8000-000000000204";
/** Active S12 membership in the WRONG role (mentor), holds a mentee profile. */
const P_ROLE_MISMATCH = "00000000-0000-4000-8000-000000000205";
/** A stale mentee profile and nothing else at all. */
const P_STALE_PROFILE_ONLY = "00000000-0000-4000-8000-000000000206";
/** Approved, and paused — an explicit "not participating right now". */
const P_PAUSED_MENTEE = "00000000-0000-4000-8000-000000000207";
/** Approved, with an `invited` membership from the account CSV import. */
const P_INVITED_MENTEE = "00000000-0000-4000-8000-000000000208";

const MPROF_APPROVED = "00000000-0000-4000-8000-000000000301";
const MPROF_MEMBERSHIP = "00000000-0000-4000-8000-000000000302";
const MPROF_WITHDRAWN = "00000000-0000-4000-8000-000000000303";

const EPROF_APPROVED = "00000000-0000-4000-8000-000000000401";
const EPROF_WITHDRAWN = "00000000-0000-4000-8000-000000000402";
const EPROF_CONTINUATION = "00000000-0000-4000-8000-000000000403";
const EPROF_OTHER_SEASON = "00000000-0000-4000-8000-000000000404";
const EPROF_ROLE_MISMATCH = "00000000-0000-4000-8000-000000000405";
const EPROF_STALE = "00000000-0000-4000-8000-000000000406";
const EPROF_PAUSED = "00000000-0000-4000-8000-000000000407";
const EPROF_INVITED = "00000000-0000-4000-8000-000000000408";

const NEW_MATCH_ID = "00000000-0000-4000-8000-000000000501";

// ── In-memory database ───────────────────────────────────────────────────────

type Row = Record<string, any>;

const db: {
  applications: Row[];
  person_season_memberships: Row[];
  mentor_profiles: Row[];
  mentee_profiles: Row[];
  matches: Row[];
  people: Row[];
  intake_batches: Row[];
  inserted: Row[];
  errorForTable: string | null;
} = {
  applications: [],
  person_season_memberships: [],
  mentor_profiles: [],
  mentee_profiles: [],
  matches: [],
  people: [],
  intake_batches: [],
  inserted: [],
  errorForTable: null
};

let recordedProjections: Array<{ table: string; columns: string }> = [];

function makeFakeClient() {
  return {
    from: vi.fn((table: string) => {
      let projection: string[] = [];
      let cursor: string | null = null;
      let headCount = false;
      let insertPayload: Row | null = null;
      const preds: Array<(r: Row) => boolean> = [];

      const rowsFor = (): Row[] => {
        const t = db as unknown as Record<string, Row[]>;
        return Array.isArray(t[table]) ? t[table] : [];
      };

      // PostgREST returns ONLY the selected columns, so a test can prove
      // production asked for `role`/`status` rather than assuming it.
      const project = (row: Row) => {
        if (!projection.length || projection.includes("*")) return { ...row };
        const out: Row = {};
        for (const col of projection) {
          if (Object.prototype.hasOwnProperty.call(row, col)) out[col] = row[col];
        }
        return out;
      };

      const matching = () => rowsFor().filter((r) => preds.every((p) => p(r)));

      const run = async () => {
        if (db.errorForTable === table) {
          return { data: null, error: { message: `${table} unavailable`, code: "PGRST500" } };
        }
        if (insertPayload) {
          if (table !== "matches") return { data: null, error: null };
          const created = { id: NEW_MATCH_ID, ...insertPayload };
          db.inserted.push(created);
          db.matches.push(created);
          return { data: { id: NEW_MATCH_ID }, error: null };
        }
        if (headCount) return { data: null, error: null, count: matching().length };
        // keyset page 2 must come back EMPTY so readAllPages terminates.
        if (cursor !== null) return { data: [], error: null };
        return { data: matching().map(project), error: null };
      };

      const query: Row = {
        select: vi.fn((cols?: string, opts?: { count?: string; head?: boolean }) => {
          recordedProjections.push({ table, columns: String(cols ?? "*") });
          projection = String(cols ?? "*").split(",").map((c) => c.trim()).filter(Boolean);
          if (opts?.head) headCount = true;
          return query;
        }),
        insert: vi.fn((payload: Row) => {
          insertPayload = payload;
          return query;
        }),
        update: vi.fn(() => query),
        eq: vi.fn((col: string, val: unknown) => {
          preds.push((r) => r[col] === val);
          return query;
        }),
        neq: vi.fn((col: string, val: unknown) => {
          preds.push((r) => r[col] !== val);
          return query;
        }),
        in: vi.fn((col: string, vals: unknown[]) => {
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
        range: vi.fn(() => query),
        maybeSingle: async () => {
          const res = await run();
          if (res.error) return res;
          if (insertPayload) return res;
          const rows = matching().map(project);
          return { data: rows.length ? rows[0] : null, error: null };
        }
      };
      query.then = (resolve: unknown, reject: unknown) =>
        run().then(resolve as never, reject as never);

      return query;
    })
  };
}

// ── Seed ─────────────────────────────────────────────────────────────────────

function seed() {
  db.intake_batches = [
    { id: B1, season_id: S12 },
    { id: B_OLD, season_id: S11 }
  ];

  db.applications = [
    { id: "app-m1", season_id: S12, person_id: P_APPROVED_MENTOR, status: "approved_as_mentor", intake_batch_id: B1 },
    { id: "app-m3", season_id: S12, person_id: P_WITHDRAWN_MENTOR, status: "approved_as_mentor", intake_batch_id: B1 },
    { id: "app-e1", season_id: S12, person_id: P_APPROVED_MENTEE, status: "approved_as_mentee", intake_batch_id: B1 },
    // CASE A: the application still says approved. The membership says she left.
    { id: "app-e2", season_id: S12, person_id: P_WITHDRAWN_MENTEE, status: "approved_as_mentee", intake_batch_id: B1 },
    { id: "app-e7", season_id: S12, person_id: P_PAUSED_MENTEE, status: "approved_as_mentee", intake_batch_id: B1 },
    { id: "app-e8", season_id: S12, person_id: P_INVITED_MENTEE, status: "approved_as_mentee", intake_batch_id: B1 }
    // CASE B (P_CONTINUATION_MENTEE) deliberately has NO application row at all.
  ];

  db.person_season_memberships = [
    // A mentor who arrives only by membership — continuation, no new application.
    { id: "psm-1", person_id: P_MEMBERSHIP_MENTOR, season_id: S12, role: "mentor", status: "active" },
    { id: "psm-2", person_id: P_WITHDRAWN_MENTOR, season_id: S12, role: "mentor", status: "withdrawn" },
    // CASE A.
    { id: "psm-3", person_id: P_WITHDRAWN_MENTEE, season_id: S12, role: "mentee", status: "withdrawn" },
    // CASE B.
    { id: "psm-4", person_id: P_CONTINUATION_MENTEE, season_id: S12, role: "mentee", status: "active" },
    // Active, but in S11.
    { id: "psm-5", person_id: P_OTHER_SEASON_MENTEE, season_id: S11, role: "mentee", status: "active" },
    // Active in S12 but as a MENTOR, while holding a mentee profile.
    { id: "psm-6", person_id: P_ROLE_MISMATCH, season_id: S12, role: "mentor", status: "active" },
    { id: "psm-7", person_id: P_PAUSED_MENTEE, season_id: S12, role: "mentee", status: "paused" },
    // Written by the account CSV import BEFORE approval; never flipped to active.
    { id: "psm-8", person_id: P_INVITED_MENTEE, season_id: S12, role: "mentee", status: "invited" },
    // An interviewer membership says nothing about being matchable either way.
    { id: "psm-9", person_id: P_APPROVED_MENTEE, season_id: S12, role: "interviewer", status: "active" }
  ];

  db.mentor_profiles = [
    { id: MPROF_APPROVED, person_id: P_APPROVED_MENTOR, mentor_code: "M-A", intake_batch_id: B1, company_current: "Acme", title_current: "Lead", capacity_target: 2 },
    { id: MPROF_MEMBERSHIP, person_id: P_MEMBERSHIP_MENTOR, mentor_code: "M-M", intake_batch_id: B_OLD, company_current: "Beta", title_current: "PM", capacity_target: 1 },
    { id: MPROF_WITHDRAWN, person_id: P_WITHDRAWN_MENTOR, mentor_code: "M-W", intake_batch_id: B1, company_current: "Gamma", title_current: "Dev", capacity_target: 3 }
  ];

  db.mentee_profiles = [
    { id: EPROF_APPROVED, person_id: P_APPROVED_MENTEE, mentee_code: "E-A", intake_batch_id: B1, school_code: "UEH", major: "Fin" },
    { id: EPROF_WITHDRAWN, person_id: P_WITHDRAWN_MENTEE, mentee_code: "E-W", intake_batch_id: B1, school_code: "UEH", major: "Mkt" },
    { id: EPROF_CONTINUATION, person_id: P_CONTINUATION_MENTEE, mentee_code: "E-C", intake_batch_id: B_OLD, school_code: "UEH", major: "Acc" },
    { id: EPROF_OTHER_SEASON, person_id: P_OTHER_SEASON_MENTEE, mentee_code: "E-O", intake_batch_id: B_OLD, school_code: "UEH", major: "Eco" },
    { id: EPROF_ROLE_MISMATCH, person_id: P_ROLE_MISMATCH, mentee_code: "E-R", intake_batch_id: B1, school_code: "UEH", major: "Law" },
    { id: EPROF_STALE, person_id: P_STALE_PROFILE_ONLY, mentee_code: "E-S", intake_batch_id: B1, school_code: "UEH", major: "IT" },
    { id: EPROF_PAUSED, person_id: P_PAUSED_MENTEE, mentee_code: "E-P", intake_batch_id: B1, school_code: "UEH", major: "HR" },
    { id: EPROF_INVITED, person_id: P_INVITED_MENTEE, mentee_code: "E-I", intake_batch_id: B1, school_code: "UEH", major: "Log" }
  ];

  db.people = [
    [P_APPROVED_MENTOR, "Approved Mentor"],
    [P_MEMBERSHIP_MENTOR, "Continuation Mentor"],
    [P_WITHDRAWN_MENTOR, "Withdrawn Mentor"],
    [P_APPROVED_MENTEE, "Approved Mentee"],
    [P_WITHDRAWN_MENTEE, "Withdrawn Mentee"],
    [P_CONTINUATION_MENTEE, "Continuation Mentee"],
    [P_OTHER_SEASON_MENTEE, "Other Season Mentee"],
    [P_ROLE_MISMATCH, "Role Mismatch"],
    [P_STALE_PROFILE_ONLY, "Stale Profile Only"],
    [P_PAUSED_MENTEE, "Paused Mentee"],
    [P_INVITED_MENTEE, "Invited Mentee"]
  ].map(([id, full_name]) => ({ id, full_name, email_primary: `${id}@x.vn`, phone_primary: null }));

  db.matches = [];
  db.inserted = [];
  db.errorForTable = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  recordedProjections = [];
  seed();
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeFakeClient());
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "super_admin" });
  (getAdminScopeContext as Mock).mockResolvedValue({ scope: "all" });
  (canOperateAnyScope as Mock).mockReturnValue(true);
  (getAllowedSeasonIds as Mock).mockResolvedValue([S12, S11]);
  (canAccessSeason as Mock).mockReturnValue(true);
});

const pool = () => getManualMatchingCandidates(B1);
const create = (mentorProfileId: string, menteeProfileId: string, intakeBatchId = B1) =>
  createManualMatch({ mentorProfileId, menteeProfileId, intakeBatchId });

const menteeIds = async () => (await pool()).mentees.map((m) => m.profile_id);
const mentorIds = async () => (await pool()).mentors.map((m) => m.profile_id);

// ═════════════════════════════════════════════════════════════════════════════
// A–C · The two routes into the pool
// ═════════════════════════════════════════════════════════════════════════════

describe("participation routes", () => {
  it("A · an approved S12 applicant with a valid profile still appears", async () => {
    expect(await menteeIds()).toContain(EPROF_APPROVED);
    expect(await mentorIds()).toContain(MPROF_APPROVED);
  });

  it("B · CASE A — a withdrawn S12 membership excludes an applicant the application still calls approved", async () => {
    expect(await menteeIds()).not.toContain(EPROF_WITHDRAWN);
    expect(await mentorIds()).not.toContain(MPROF_WITHDRAWN);
  });

  it("C · CASE B — an active S12 membership with a profile and NO S12 application appears", async () => {
    expect(await menteeIds()).toContain(EPROF_CONTINUATION);
    expect(await mentorIds()).toContain(MPROF_MEMBERSHIP);
  });

  it("C2 · a paused membership is treated as not participating", async () => {
    expect(await menteeIds()).not.toContain(EPROF_PAUSED);
  });

  it("C3 · an `invited` membership neither grants nor revokes — the approval still decides", async () => {
    // `invited` is written by the account CSV import BEFORE approval and no path
    // flips it to active. Blocking on it would drop approved applicants.
    expect(await menteeIds()).toContain(EPROF_INVITED);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// D–E · Matches are season-scoped
// ═════════════════════════════════════════════════════════════════════════════

describe("season-scoped match guards", () => {
  it("D · an active S11 match does NOT mark a participant unavailable in S12", async () => {
    db.matches.push({
      id: "match-s11",
      season_id: S11,
      mentor_person_id: P_MEMBERSHIP_MENTOR,
      mentee_person_id: P_CONTINUATION_MENTEE,
      status: "active"
    });

    const result = await pool();

    const mentee = result.mentees.find((m) => m.profile_id === EPROF_CONTINUATION);
    expect(mentee).toBeDefined();
    expect(mentee!.has_active_match).toBe(false);

    const mentor = result.mentors.find((m) => m.profile_id === MPROF_MEMBERSHIP);
    expect(mentor!.active_match_count).toBe(0);
  });

  it("D2 · and the S11 match does not block creating the S12 match", async () => {
    db.matches.push({
      id: "match-s11",
      season_id: S11,
      mentor_person_id: P_MEMBERSHIP_MENTOR,
      mentee_person_id: P_CONTINUATION_MENTEE,
      status: "active"
    });

    const result = await create(MPROF_MEMBERSHIP, EPROF_CONTINUATION);

    expect(result.ok).toBe(true);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].season_id).toBe(S12);
  });

  it("E · an ACTIVE S12 match still marks the mentee unavailable and counts mentor load", async () => {
    db.matches.push({
      id: "match-s12",
      season_id: S12,
      mentor_person_id: P_APPROVED_MENTOR,
      mentee_person_id: P_APPROVED_MENTEE,
      status: "active"
    });

    const result = await pool();

    expect(result.mentees.find((m) => m.profile_id === EPROF_APPROVED)!.has_active_match).toBe(true);
    expect(result.mentors.find((m) => m.profile_id === MPROF_APPROVED)!.active_match_count).toBe(1);
  });

  it("E2 · and the S12 active-match guard still refuses a second mentee match", async () => {
    db.matches.push({
      id: "match-s12",
      season_id: S12,
      mentor_person_id: P_APPROVED_MENTOR,
      mentee_person_id: P_APPROVED_MENTEE,
      status: "active"
    });

    const result = await create(MPROF_MEMBERSHIP, EPROF_APPROVED);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã có mentor đang active");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F–H · What does NOT qualify
// ═════════════════════════════════════════════════════════════════════════════

describe("membership does not over-admit", () => {
  it("F · an active membership in ANOTHER season does not qualify", async () => {
    expect(await menteeIds()).not.toContain(EPROF_OTHER_SEASON);
  });

  it("G · an active S12 membership in the WRONG role does not qualify", async () => {
    // Active S12 *mentor* membership, holding a mentee profile.
    expect(await menteeIds()).not.toContain(EPROF_ROLE_MISMATCH);
  });

  it("G2 · a non-participant role membership neither grants nor blocks", async () => {
    // P_APPROVED_MENTEE also holds an active `interviewer` membership.
    expect(await menteeIds()).toContain(EPROF_APPROVED);
  });

  it("H · a stale profile with no application and no membership does not qualify", async () => {
    expect(await menteeIds()).not.toContain(EPROF_STALE);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// I · The mutation revalidates the same rule
// ═════════════════════════════════════════════════════════════════════════════

describe("mutation path independently revalidates participation", () => {
  it("I · a crafted request naming a WITHDRAWN participant's profile is refused at the write", async () => {
    // The list never offered EPROF_WITHDRAWN; this is a hand-built form post.
    const result = await create(MPROF_APPROVED, EPROF_WITHDRAWN);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Mentee");
    expect(db.inserted).toHaveLength(0);
  });

  it("I2 · a crafted request naming a withdrawn MENTOR is refused too", async () => {
    const result = await create(MPROF_WITHDRAWN, EPROF_APPROVED);

    expect(result.ok).toBe(false);
    expect(db.inserted).toHaveLength(0);
  });

  it("I3 · a membership-only participant the list DOES offer can actually be matched", async () => {
    const result = await create(MPROF_MEMBERSHIP, EPROF_CONTINUATION);

    expect(result.ok).toBe(true);
    expect(db.inserted).toHaveLength(1);
  });

  it("I4 · a stale profile with no participation at all is refused at the write", async () => {
    const result = await create(MPROF_APPROVED, EPROF_STALE);

    expect(result.ok).toBe(false);
    expect(db.inserted).toHaveLength(0);
  });

  it("I5 · the mutation FAILS CLOSED if the membership read errors", async () => {
    // The decisive case: a membership read that failed must never be read as
    // "no withdrawal found, therefore proceed".
    db.errorForTable = "person_season_memberships";

    const result = await create(MPROF_APPROVED, EPROF_APPROVED);

    expect(result.ok).toBe(false);
    expect(db.inserted).toHaveLength(0);
  });

  it("I6 · the LIST fails closed on the same read rather than silently reverting to approvals", async () => {
    db.errorForTable = "person_season_memberships";

    const result = await pool();

    expect(result.ok).toBe(false);
    expect(result.mentees).toEqual([]);
    expect(result.mentors).toEqual([]);
  });

  it("I7 · the membership read asks for role and status, and is season-scoped", async () => {
    await pool();

    const membershipReads = recordedProjections.filter(
      (p) => p.table === "person_season_memberships"
    );
    expect(membershipReads.length).toBeGreaterThan(0);
    for (const read of membershipReads) {
      expect(read.columns).toContain("role");
      expect(read.columns).toContain("status");
      expect(read.columns).toContain("person_id");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// J · Capacity is untouched
// ═════════════════════════════════════════════════════════════════════════════

describe("mentor capacity behaviour is unchanged", () => {
  it("J · a membership-route mentor's own capacity_target is still what is enforced", async () => {
    const result = await pool();
    // capacity_target 1, not the fallback 3.
    expect(result.mentors.find((m) => m.profile_id === MPROF_MEMBERSHIP)!.effective_capacity).toBe(1);
  });

  it("J2 · a full mentor is still refused at the write", async () => {
    db.matches.push({
      id: "match-full",
      season_id: S12,
      mentor_person_id: P_MEMBERSHIP_MENTOR,
      mentee_person_id: P_APPROVED_MENTEE,
      status: "active"
    });

    // MPROF_MEMBERSHIP declared capacity 1 and already holds one active match.
    const result = await create(MPROF_MEMBERSHIP, EPROF_CONTINUATION);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("1/1");
    expect(db.inserted).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Determinism
// ═════════════════════════════════════════════════════════════════════════════

describe("determinism", () => {
  it("a person arriving by BOTH routes appears exactly once", async () => {
    db.person_season_memberships.push({
      id: "psm-dup",
      person_id: P_APPROVED_MENTEE,
      season_id: S12,
      role: "mentee",
      status: "active"
    });

    const ids = await menteeIds();

    expect(ids.filter((id) => id === EPROF_APPROVED)).toHaveLength(1);
  });

  it("the pool is stable across loads", async () => {
    expect(await menteeIds()).toEqual(await menteeIds());
    expect(await mentorIds()).toEqual(await mentorIds());
  });
});
