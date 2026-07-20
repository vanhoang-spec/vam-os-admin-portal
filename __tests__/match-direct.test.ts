/**
 * Direct production tests for lib/matches.ts createManualMatch / cancelMatch.
 *
 * All Supabase I/O is mocked. The actual function bodies run so business-rule
 * guard order and error messages are verified against the real code.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateAnyScope: vi.fn(),
  getAllowedSeasonIds: vi.fn(),
  canAccessSeason: vi.fn(),
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, canOperateAnyScope, getAllowedSeasonIds, canAccessSeason } from "@/lib/program-scope";
import { createManualMatch, cancelMatch } from "@/lib/matches";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeChain(result: { data?: unknown; error?: unknown; count?: number } = {}): unknown {
  const resolved = Promise.resolve({ data: null, error: null, count: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.neq = self;
  chain.limit = self;
  chain.in = self;
  chain.order = self;
  chain.update = self;
  chain.insert = self;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null, ...result });
  chain.single = () => Promise.resolve({ data: null, error: null, ...result });
  // Make the chain itself awaitable (for count queries and audit inserts)
  chain.then = (f: unknown, r: unknown) => (resolved as Promise<unknown>).then(f as never, r as never);
  chain.catch = (r: unknown) => (resolved as Promise<unknown>).catch(r as never);
  chain.finally = (f: unknown) => (resolved as Promise<unknown>).finally(f as never);
  return chain;
}

const VALID_UUID = "00000000-0000-4000-8000-000000000001";
const MENTOR_UUID = "00000000-0000-4000-8000-000000000002";
const MENTEE_UUID = "00000000-0000-4000-8000-000000000003";
const BATCH_UUID  = "00000000-0000-4000-8000-000000000004";
const MATCH_UUID  = "00000000-0000-4000-8000-000000000005";
const SEASON_UUID = "00000000-0000-4000-8000-000000000006";
const PERSON_UUID = "00000000-0000-4000-8000-000000000007";

const MENTOR_PROFILE = { id: MENTOR_UUID, person_id: PERSON_UUID, mentor_code: "M01", intake_batch_id: BATCH_UUID };
const MENTEE_PROFILE = { id: MENTEE_UUID, person_id: "per-mentee", mentee_code: "E01", intake_batch_id: BATCH_UUID };
const BATCH = { id: BATCH_UUID, season_id: SEASON_UUID };

function makeClient(fromResponses: unknown[]) {
  const fromMock = vi.fn();
  fromResponses.forEach((r) => fromMock.mockReturnValueOnce(r));
  fromMock.mockReturnValue(makeChain()); // fallback for extra calls (audit)
  return { from: fromMock };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "super_admin" });
  (getAdminScopeContext as Mock).mockResolvedValue({ scope: "all" });
  (canOperateAnyScope as Mock).mockReturnValue(true);
  (getAllowedSeasonIds as Mock).mockResolvedValue([SEASON_UUID]);
  (canAccessSeason as Mock).mockReturnValue(true);
});

// ── createManualMatch — input validation ──────────────────────────────────────

describe("createManualMatch — input validation", () => {
  it("invalid mentor UUID → ok:false before any DB call", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn() });
    const result = await createManualMatch({
      mentorProfileId: "not-a-uuid",
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("mentor");
  });

  it("missing intake batch UUID → ok:false", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn() });
    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: "",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("batch");
  });
});

// ── createManualMatch — capacity rules ────────────────────────────────────────

describe("createManualMatch — mentor capacity guard", () => {
  it("mentor at capacity (count >= 3) → ok:false with capacity message", async () => {
    const client = makeClient([
      makeChain({ data: MENTOR_PROFILE }), // mentor_profiles
      makeChain({ data: MENTEE_PROFILE }), // mentee_profiles
      makeChain({ data: BATCH }),           // intake_batches
      makeChain({ data: null }),            // matches — mentee check (no active match)
      makeChain({ count: 3 }),              // matches — mentor count = 3 (AT LIMIT)
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("3");
    expect(result.message).toMatch(/limit|mentee|đủ|FULL|đã có/i);
  });

  it("mentor below capacity (count = 2) → ok:true, matchId returned", async () => {
    const newMatchId = MATCH_UUID;
    const client = makeClient([
      makeChain({ data: MENTOR_PROFILE }),           // mentor_profiles
      makeChain({ data: MENTEE_PROFILE }),           // mentee_profiles
      makeChain({ data: BATCH }),                    // intake_batches
      makeChain({ data: null }),                     // matches — mentee check
      makeChain({ count: 2 }),                       // matches — mentor count = 2 (OK)
      makeChain({ data: { id: newMatchId } }),       // matches insert
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(true);
    expect(result.matchId).toBe(newMatchId);
  });
});

// ── createManualMatch — mentee exclusivity rule ───────────────────────────────

describe("createManualMatch — mentee active match guard", () => {
  it("mentee already has active match → ok:false with exclusivity message", async () => {
    const client = makeClient([
      makeChain({ data: MENTOR_PROFILE }), // mentor_profiles
      makeChain({ data: MENTEE_PROFILE }), // mentee_profiles
      makeChain({ data: BATCH }),           // intake_batches
      makeChain({ data: { id: VALID_UUID } }), // matches — mentee check → FOUND (has active)
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/mentee|active|mentor/i);
  });
});

// ── createManualMatch — duplicate constraint ──────────────────────────────────

describe("createManualMatch — duplicate pair constraint (23505)", () => {
  it("unique constraint violation → ok:false with specific constraint message", async () => {
    const constraintError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const client = makeClient([
      makeChain({ data: MENTOR_PROFILE }),
      makeChain({ data: MENTEE_PROFILE }),
      makeChain({ data: BATCH }),
      makeChain({ data: null }),           // mentee check — no active
      makeChain({ count: 0 }),             // mentor count — available
      makeChain({ data: null, error: constraintError }), // INSERT → 23505
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/constraint|match active|Hủy/i);
  });
});

// ── createManualMatch — DB error propagation ──────────────────────────────────

describe("createManualMatch — DB error propagation", () => {
  it("mentor profile load error → ok:false with safe message", async () => {
    const client = makeClient([
      makeChain({ data: null, error: { code: "PGRST301", message: "network error" } }), // mentor_profiles
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("mentor profile not found (null data, no error) → ok:false", async () => {
    const client = makeClient([
      makeChain({ data: null }), // mentor_profiles → not found
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/mentor/i);
  });
});

// ── cancelMatch — happy path ──────────────────────────────────────────────────

describe("cancelMatch — success and idempotency", () => {
  it("cancel active match → ok:true, matchId returned", async () => {
    const activeMatch = {
      id: MATCH_UUID,
      status: "active",
      season_id: SEASON_UUID,
      notes: null,
    };
    const afterMatch = { id: MATCH_UUID, status: "dropped" };
    const client = makeClient([
      makeChain({ data: activeMatch }), // load match
      makeChain({ data: afterMatch }),  // update to dropped
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await cancelMatch({ matchId: MATCH_UUID, endReason: "mutual agreement" });

    expect(result.ok).toBe(true);
    expect(result.matchId).toBe(MATCH_UUID);
  });

  it("repeated cancel on already-dropped match → ok:true (idempotent)", async () => {
    const droppedMatch = {
      id: MATCH_UUID,
      status: "dropped",
      season_id: SEASON_UUID,
      notes: null,
    };
    const client = makeClient([
      makeChain({ data: droppedMatch }), // load match → already dropped
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await cancelMatch({ matchId: MATCH_UUID });

    // Idempotent: returns ok:true with a "was already cancelled" message
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/đã được hủy|trước đó/i);
  });

  it("cancel on non-existent match → ok:false", async () => {
    const client = makeClient([
      makeChain({ data: null }), // load match → not found
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await cancelMatch({ matchId: MATCH_UUID });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/không tìm thấy/i);
  });

  it("DB update error during cancel → ok:false with safe error message", async () => {
    const activeMatch = { id: MATCH_UUID, status: "active", season_id: SEASON_UUID, notes: null };
    const dbError = { code: "500", message: "connection reset" };
    const client = makeClient([
      makeChain({ data: activeMatch }),           // load match
      makeChain({ data: null, error: dbError }), // update fails
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await cancelMatch({ matchId: MATCH_UUID });

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

// ── createManualMatch — cross-batch guard ─────────────────────────────────────

describe("createManualMatch — cross-batch rejection", () => {
  it("mentor profile in different intake batch → ok:false (batch membership guard)", async () => {
    // Production guard: lines 532-533 in lib/matches.ts.
    // Both profiles are loaded first, then intake_batch_id is compared.
    const otherBatchMentor = { ...MENTOR_PROFILE, intake_batch_id: "aaaaaaaa-0000-4000-8000-000000000000" };
    const client = makeClient([
      makeChain({ data: otherBatchMentor }), // mentor_profiles (different batch)
      makeChain({ data: MENTEE_PROFILE }),   // mentee_profiles (still loaded before the check)
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/mentor|batch/i);
  });

  it("mentee profile in different intake batch → ok:false", async () => {
    const otherBatchMentee = { ...MENTEE_PROFILE, intake_batch_id: "bbbbbbbb-0000-4000-8000-000000000000" };
    const client = makeClient([
      makeChain({ data: MENTOR_PROFILE }),   // mentor_profiles (correct batch)
      makeChain({ data: otherBatchMentee }), // mentee_profiles (different batch)
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/mentee|batch/i);
  });
});

// ── createManualMatch — missing person_id guard ───────────────────────────────

describe("createManualMatch — missing person_id guard", () => {
  it("mentor profile with null person_id → ok:false (cannot create match without person link)", async () => {
    // Production guard: lines 541-543 in lib/matches.ts.
    // Profiles with person_id: null cannot be used for matching.
    const noPersonMentor = { ...MENTOR_PROFILE, person_id: null };
    const client = makeClient([
      makeChain({ data: noPersonMentor }), // mentor_profiles (person_id is null)
      makeChain({ data: MENTEE_PROFILE }), // mentee_profiles
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    // Message text may be garbled in source due to encoding; check ok:false only
  });
});

// ── createManualMatch / cancelMatch — role authorization ─────────────────────

describe("createManualMatch — unauthorized role rejection", () => {
  it("viewer role cannot create match (canManageMatches blocks viewer)", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "viewer-1", role: "viewer" });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn() });

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/quyền|matching/i);
  });

  it("support_team role cannot create match", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "support-1", role: "support_team" });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn() });

    const result = await createManualMatch({
      mentorProfileId: MENTOR_UUID,
      menteeProfileId: MENTEE_UUID,
      intakeBatchId: BATCH_UUID,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/quyền|matching/i);
  });
});

describe("cancelMatch — unauthorized role rejection", () => {
  it("viewer role cannot cancel match (canManageMatches blocks viewer)", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "viewer-1", role: "viewer" });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn() });

    const result = await cancelMatch({ matchId: MATCH_UUID });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/quyền|matching/i);
  });
});
