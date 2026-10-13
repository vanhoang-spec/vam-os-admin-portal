/**
 * S12 matching pool safety — behavioural tests.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE PROVE, AND WHY THEY ARE NOT MARKER TESTS
 * ---------------------------------------------------------------------------
 * Every test here runs the REAL `getManualMatchingCandidates` /
 * `createManualMatch` bodies against an in-memory PostgREST fake, and asserts on
 * the value the function returns. None of them grep the source. A marker test
 * would have passed on the broken code, because the defect was never a missing
 * string — it was that eligibility was read from the wrong table.
 *
 * The fake honours PROJECTION: a column the production code forgets to
 * `select()` is absent from the response, exactly as PostgREST behaves. That is
 * what makes the capacity tests real — if `capacity_target` were dropped from
 * either query, `effectiveMentorCapacity` would silently fall back to 3 and the
 * capacity tests would fail rather than quietly pass.
 *
 * It also honours `readAllPages`' keyset contract: page one returns rows, and
 * the `.gt(key, cursor)` page that proves exhaustion returns empty.
 *
 * ---------------------------------------------------------------------------
 * THE PRODUCTION SHAPE BEING DEFENDED
 * ---------------------------------------------------------------------------
 * UEHM-S12 has one intake batch (B1) and 142 approved mentors, 130 of them
 * renewals whose application carries NO intake_batch_id and whose reused
 * mentor_profile still points at an older batch. Under the previous
 * batch-filtered pool, ZERO of the 142 were offered for matching and one
 * unapproved profile WAS. Tests A, B and E are that exact situation.
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
import {
  createManualMatch,
  effectiveMentorCapacity,
  getManualMatchingCandidates
} from "@/lib/matches";

// ── Fixture ids ──────────────────────────────────────────────────────────────

const S12 = "00000000-0000-4000-8000-0000000000s1".replace("s1", "01");
const S11 = "00000000-0000-4000-8000-000000000002";
const B1 = "00000000-0000-4000-8000-000000000011";
const B_OLD = "00000000-0000-4000-8000-000000000012";

const P_RENEWAL_MENTOR = "00000000-0000-4000-8000-000000000101";
const P_FORM_MENTOR = "00000000-0000-4000-8000-000000000102";
const P_UNAPPROVED_MENTOR = "00000000-0000-4000-8000-000000000103";
const P_OTHER_SEASON_MENTOR = "00000000-0000-4000-8000-000000000104";
const P_MENTEE = "00000000-0000-4000-8000-000000000201";
const P_UNAPPROVED_MENTEE = "00000000-0000-4000-8000-000000000202";

const MPROF_RENEWAL = "00000000-0000-4000-8000-000000000301";
const MPROF_FORM = "00000000-0000-4000-8000-000000000302";
const MPROF_UNAPPROVED = "00000000-0000-4000-8000-000000000303";
const MPROF_OTHER_SEASON = "00000000-0000-4000-8000-000000000304";
const EPROF_MENTEE = "00000000-0000-4000-8000-000000000401";
const EPROF_UNAPPROVED = "00000000-0000-4000-8000-000000000402";

const NEW_MATCH_ID = "00000000-0000-4000-8000-000000000501";

// ── In-memory database ───────────────────────────────────────────────────────

type Row = Record<string, any>;

const db: {
  applications: Row[];
  mentor_profiles: Row[];
  mentee_profiles: Row[];
  mentee_profilesAlias?: Row[];
  matches: Row[];
  people: Row[];
  intake_batches: Row[];
  inserted: Row[];
  insertError: Row | null;
} = {
  applications: [],
  mentor_profiles: [],
  mentee_profiles: [],
  matches: [],
  people: [],
  intake_batches: [],
  inserted: [],
  insertError: null
};

/** Every projection actually issued, per table — lets a test assert a column was asked for. */
let recordedProjections: Array<{ table: string; columns: string }> = [];

function makeFakeClient() {
  return {
    from: vi.fn((table: string) => {
      let projection: string[] = [];
      let cursor: string | null = null;
      let headCount = false;
      let insertPayload: Row | null = null;
      let updatePayload: Row | null = null;
      const preds: Array<(r: Row) => boolean> = [];

      const rowsFor = (): Row[] => {
        const t = db as unknown as Record<string, Row[]>;
        return Array.isArray(t[table]) ? t[table] : [];
      };

      // PostgREST returns ONLY the selected columns. A test can therefore prove
      // that production asked for `capacity_target` rather than assuming it.
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
        if (insertPayload) {
          // Only `matches` inserts are the subject here. The audit write goes
          // to admin_audit_log through the same builder and must not be
          // counted as a created match.
          if (table !== "matches") return { data: null, error: null };
          if (db.insertError) return { data: null, error: db.insertError };
          const created = { id: NEW_MATCH_ID, ...insertPayload };
          db.inserted.push(created);
          db.matches.push(created);
          return { data: { id: NEW_MATCH_ID }, error: null };
        }
        if (updatePayload) {
          const hit = matching();
          for (const r of hit) Object.assign(r, updatePayload);
          return { data: hit.length ? { ...hit[0] } : null, error: null };
        }
        if (headCount) return { data: null, error: null, count: matching().length };
        // keyset page 2 (`.gt(key, cursor)`) must come back EMPTY so
        // readAllPages terminates, exactly as an exhausted table would.
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
        update: vi.fn((payload: Row) => {
          updatePayload = payload;
          return query;
        }),
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
          if (insertPayload || updatePayload) return res;
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
    // A renewal mentor: approved in S12, but the application carries NO batch.
    { id: "app-r", season_id: S12, person_id: P_RENEWAL_MENTOR, status: "approved_as_mentor", intake_batch_id: null },
    // A form mentor: approved in S12, batch present.
    { id: "app-f", season_id: S12, person_id: P_FORM_MENTOR, status: "approved_as_mentor", intake_batch_id: B1 },
    // Approved as a mentor in S11 ONLY. Must never be matchable in S12.
    { id: "app-o", season_id: S11, person_id: P_OTHER_SEASON_MENTOR, status: "approved_as_mentor", intake_batch_id: B_OLD },
    // Reached interview but was never approved.
    { id: "app-u", season_id: S12, person_id: P_UNAPPROVED_MENTOR, status: "interview_passed", intake_batch_id: B1 },
    { id: "app-e", season_id: S12, person_id: P_MENTEE, status: "approved_as_mentee", intake_batch_id: B1 },
    { id: "app-eu", season_id: S12, person_id: P_UNAPPROVED_MENTEE, status: "ready_for_final_decision", intake_batch_id: B1 }
  ];

  db.mentor_profiles = [
    // Reused profile still addressed to the PREVIOUS batch — the exact shape
    // the old batch-filtered pool dropped.
    { id: MPROF_RENEWAL, person_id: P_RENEWAL_MENTOR, mentor_code: "M-R", intake_batch_id: B_OLD, company_current: "Acme", title_current: "Lead", capacity_target: 1 },
    { id: MPROF_FORM, person_id: P_FORM_MENTOR, mentor_code: "M-F", intake_batch_id: B1, company_current: "Beta", title_current: "PM", capacity_target: 2 },
    // Unapproved, but carries B1 — the profile the old pool DID offer.
    { id: MPROF_UNAPPROVED, person_id: P_UNAPPROVED_MENTOR, mentor_code: "M-U", intake_batch_id: B1, company_current: "Gamma", title_current: "Dev", capacity_target: 3 },
    { id: MPROF_OTHER_SEASON, person_id: P_OTHER_SEASON_MENTOR, mentor_code: "M-O", intake_batch_id: B_OLD, company_current: "Delta", title_current: "Head", capacity_target: 3 }
  ];

  db.mentee_profiles = [
    { id: EPROF_MENTEE, person_id: P_MENTEE, mentee_code: "E-1", intake_batch_id: B1, school_code: "UEH", major: "Fin" },
    { id: EPROF_UNAPPROVED, person_id: P_UNAPPROVED_MENTEE, mentee_code: "E-2", intake_batch_id: B1, school_code: "UEH", major: "Mkt" }
  ];

  db.people = [
    { id: P_RENEWAL_MENTOR, full_name: "Renewal Mentor", email_primary: "r@x.vn", phone_primary: null },
    { id: P_FORM_MENTOR, full_name: "Form Mentor", email_primary: "f@x.vn", phone_primary: null },
    { id: P_UNAPPROVED_MENTOR, full_name: "Unapproved Mentor", email_primary: "u@x.vn", phone_primary: null },
    { id: P_OTHER_SEASON_MENTOR, full_name: "Other Season Mentor", email_primary: "o@x.vn", phone_primary: null },
    { id: P_MENTEE, full_name: "Approved Mentee", email_primary: "e@x.vn", phone_primary: null },
    { id: P_UNAPPROVED_MENTEE, full_name: "Unapproved Mentee", email_primary: "eu@x.vn", phone_primary: null }
  ];

  db.matches = [];
  db.inserted = [];
  db.insertError = null;
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

const create = (mentorProfileId: string, menteeProfileId: string, intakeBatchId = B1) =>
  createManualMatch({ mentorProfileId, menteeProfileId, intakeBatchId });

// ═══════════════════════════════════════════════════════════════════════════
// POOL — eligibility comes from approval in the season, not from a batch id
// ═══════════════════════════════════════════════════════════════════════════

describe("candidate pool — season approval is the source of truth", () => {
  it("A · an approved renewal mentor with a NULL application batch and an older profile batch APPEARS", async () => {
    const result = await getManualMatchingCandidates(B1);

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    const ids = result.mentors.map((m) => m.profile_id);
    expect(ids).toContain(MPROF_RENEWAL);
  });

  it("B · a profile carrying the selected batch but WITHOUT an approved S12 application does NOT appear", async () => {
    const result = await getManualMatchingCandidates(B1);

    const mentorIds = result.mentors.map((m) => m.profile_id);
    expect(mentorIds).not.toContain(MPROF_UNAPPROVED);

    const menteeIds = result.mentees.map((m) => m.profile_id);
    expect(menteeIds).not.toContain(EPROF_UNAPPROVED);
  });

  it("E · an approved S12 form mentor appears", async () => {
    const result = await getManualMatchingCandidates(B1);
    expect(result.mentors.map((m) => m.profile_id)).toContain(MPROF_FORM);
  });

  it("J · a mentor approved only in another season does NOT appear in the S12 pool", async () => {
    const result = await getManualMatchingCandidates(B1);
    expect(result.mentors.map((m) => m.profile_id)).not.toContain(MPROF_OTHER_SEASON);
  });

  it("carries each mentor's own declared capacity onto the candidate", async () => {
    const result = await getManualMatchingCandidates(B1);

    const renewal = result.mentors.find((m) => m.profile_id === MPROF_RENEWAL);
    const form = result.mentors.find((m) => m.profile_id === MPROF_FORM);
    expect(renewal?.effective_capacity).toBe(1);
    expect(form?.effective_capacity).toBe(2);

    // Proves the value came from the row rather than from a default: the query
    // must actually have asked for the column.
    const mentorProjection = recordedProjections.find((p) => p.table === "mentor_profiles");
    expect(mentorProjection?.columns).toContain("capacity_target");
  });

  it("does not filter mentor_profiles by the selected intake batch", async () => {
    await getManualMatchingCandidates(B1);
    // The renewal mentor's profile sits on B_OLD and still resolves, which a
    // batch-equality filter could not do.
    const result = await getManualMatchingCandidates(B1);
    expect(result.mentors.map((m) => m.profile_id)).toContain(MPROF_RENEWAL);
  });

  it("returns one deterministic row per person when a person holds several profiles", async () => {
    const lower = "00000000-0000-4000-8000-000000000300";
    db.mentor_profiles.push({
      id: lower,
      person_id: P_RENEWAL_MENTOR,
      mentor_code: "M-R2",
      intake_batch_id: null,
      company_current: "Acme",
      title_current: "Lead",
      capacity_target: 1
    });

    const first = await getManualMatchingCandidates(B1);
    const second = await getManualMatchingCandidates(B1);

    const forPerson = first.mentors.filter((m) => m.person_id === P_RENEWAL_MENTOR);
    expect(forPerson).toHaveLength(1);
    expect(forPerson[0].profile_id).toBe(lower);
    expect(second.mentors.map((m) => m.profile_id)).toEqual(first.mentors.map((m) => m.profile_id));
  });

  it("reflects existing active matches in the load count", async () => {
    db.matches = [
      { id: "m1", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: P_MENTEE, status: "active" }
    ];
    const result = await getManualMatchingCandidates(B1);

    expect(result.mentors.find((m) => m.profile_id === MPROF_FORM)?.active_match_count).toBe(1);
    expect(result.mentees.find((m) => m.profile_id === EPROF_MENTEE)?.has_active_match).toBe(true);
  });

  it("returns nothing for a season the caller's scope excludes", async () => {
    const result = await getManualMatchingCandidates(B1, { allowedSeasonIds: [S11] } as never);
    expect(result.mentors).toHaveLength(0);
    expect(result.mentees).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION — the approval gate must hold against a crafted request
// ═══════════════════════════════════════════════════════════════════════════

describe("createManualMatch — approval gate", () => {
  it("C · a direct request naming an UNAPPROVED mentor profile is rejected", async () => {
    const result = await create(MPROF_UNAPPROVED, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/duyệt/i);
    expect(db.inserted).toHaveLength(0);
  });

  it("D · a direct request naming an UNAPPROVED mentee profile is rejected", async () => {
    const result = await create(MPROF_FORM, EPROF_UNAPPROVED);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/duyệt/i);
    expect(db.inserted).toHaveLength(0);
  });

  it("J · a mentor approved only in ANOTHER season is rejected for S12", async () => {
    const result = await create(MPROF_OTHER_SEASON, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/duyệt/i);
    expect(db.inserted).toHaveLength(0);
  });

  it("accepts an approved renewal mentor whose profile batch differs from the selected batch", async () => {
    const result = await create(MPROF_RENEWAL, EPROF_MENTEE);

    expect(result.ok).toBe(true);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].mentor_person_id).toBe(P_RENEWAL_MENTOR);
    // The selected batch stays the operational context: the match is written
    // against the batch's season.
    expect(db.inserted[0].season_id).toBe(S12);
  });

  it("fails closed when the approval lookup errors rather than assuming approval", async () => {
    const failing = makeFakeClient();
    const original = failing.from;
    failing.from = vi.fn((table: string) => {
      const q = original(table) as Row;
      if (table === "applications") {
        q.then = (resolve: unknown) =>
          Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve as never);
      }
      return q;
    }) as never;
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(failing);

    const result = await create(MPROF_FORM, EPROF_MENTEE);
    expect(result.ok).toBe(false);
    expect(db.inserted).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION — per-mentor capacity
// ═══════════════════════════════════════════════════════════════════════════

describe("createManualMatch — capacity_target is enforced", () => {
  it("F · capacity_target = 1 with one active mentee is BLOCKED", async () => {
    db.matches = [
      { id: "m1", season_id: S12, mentor_person_id: P_RENEWAL_MENTOR, mentee_person_id: "someone", status: "active" }
    ];

    const result = await create(MPROF_RENEWAL, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("1/1");
    expect(db.inserted).toHaveLength(0);
  });

  it("G · capacity_target = 2 with one active mentee is ALLOWED", async () => {
    db.matches = [
      { id: "m1", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "someone", status: "active" }
    ];

    const result = await create(MPROF_FORM, EPROF_MENTEE);

    expect(result.ok).toBe(true);
    expect(db.inserted).toHaveLength(1);
  });

  it("H · capacity_target = 2 with two active mentees is BLOCKED", async () => {
    db.matches = [
      { id: "m1", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "a", status: "active" },
      { id: "m2", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "b", status: "active" }
    ];

    const result = await create(MPROF_FORM, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("2/2");
    expect(db.inserted).toHaveLength(0);
  });

  it("I · a null or invalid capacity_target falls back to 3", async () => {
    for (const bad of [null, undefined, 0, -1, 2.5, "abc"]) {
      expect(effectiveMentorCapacity(bad)).toBe(3);
    }

    // And end-to-end: a mentor with a null capacity is blocked at 3, not at 1.
    db.mentor_profiles = db.mentor_profiles.map((m) =>
      m.id === MPROF_FORM ? { ...m, capacity_target: null } : m
    );
    db.matches = [
      { id: "m1", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "a", status: "active" },
      { id: "m2", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "b", status: "active" }
    ];

    const allowed = await create(MPROF_FORM, EPROF_MENTEE);
    expect(allowed.ok).toBe(true);

    // Reset to three OTHER active mentees, so the mentor cap is what refuses
    // the next attempt rather than the mentee's own single-match rule.
    db.matches = [
      { id: "m1", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "a", status: "active" },
      { id: "m2", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "b", status: "active" },
      { id: "m3", season_id: S12, mentor_person_id: P_FORM_MENTOR, mentee_person_id: "c", status: "active" }
    ];
    db.inserted = [];
    const blocked = await create(MPROF_FORM, EPROF_MENTEE);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("3/3");
  });

  it("valid positive capacities pass through unchanged", () => {
    expect(effectiveMentorCapacity(1)).toBe(1);
    expect(effectiveMentorCapacity(2)).toBe(2);
    expect(effectiveMentorCapacity(5)).toBe(5);
  });

  it("the mutation reads capacity_target rather than defaulting", async () => {
    await create(MPROF_RENEWAL, EPROF_MENTEE);
    const projection = recordedProjections.find((p) => p.table === "mentor_profiles");
    expect(projection?.columns).toContain("capacity_target");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION — existing protections must survive the change
// ═══════════════════════════════════════════════════════════════════════════

describe("createManualMatch — pre-existing guards preserved", () => {
  it("K · a mentee with an active match is still refused", async () => {
    db.matches = [
      { id: "m1", season_id: S12, mentor_person_id: "other", mentee_person_id: P_MENTEE, status: "active" }
    ];

    const result = await create(MPROF_FORM, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/mentor đang active|Hủy match cũ/i);
    expect(db.inserted).toHaveLength(0);
  });

  it("K · the database unique-constraint violation is still surfaced distinctly", async () => {
    db.insertError = { code: "23505", message: "duplicate key value violates unique constraint" };

    const result = await create(MPROF_FORM, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/constraint|đã có match/i);
  });

  it("L · a caller without match-management permission is refused before any read", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "u", role: "viewer" });

    const result = await create(MPROF_FORM, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/quyền/i);
    expect(db.inserted).toHaveLength(0);
  });

  it("L · a caller outside the batch's season scope is refused", async () => {
    (canAccessSeason as Mock).mockReturnValue(false);

    const result = await create(MPROF_FORM, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(db.inserted).toHaveLength(0);
  });

  it("L · a caller with no operations scope at all is refused", async () => {
    (canOperateAnyScope as Mock).mockReturnValue(false);

    const result = await create(MPROF_FORM, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(db.inserted).toHaveLength(0);
  });

  it("still rejects a malformed profile id before touching the database", async () => {
    const result = await create("not-a-uuid", EPROF_MENTEE);
    expect(result.ok).toBe(false);
    expect(db.inserted).toHaveLength(0);
  });

  it("reports the missing-person_id case in readable Vietnamese", async () => {
    db.mentor_profiles = db.mentor_profiles.map((m) =>
      m.id === MPROF_FORM ? { ...m, person_id: null } : m
    );

    const result = await create(MPROF_FORM, EPROF_MENTEE);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Hồ sơ mentor/mentee thiếu person_id");
    // The replaced string was mojibake; guard against it coming back.
    expect(result.message).not.toContain("Ã");
  });
});
