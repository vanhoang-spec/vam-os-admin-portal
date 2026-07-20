/**
 * Direct production tests for lib/application-approvals.ts approveApplication.
 *
 * All Supabase I/O is mocked. The actual function body runs so dedup logic,
 * profile reuse, non-transactional partial-failure risk, and gender normalization
 * are verified against the real code.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production export).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { approveApplication, type ApproveApplicationInput } from "@/lib/application-approvals";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeChain(result: { data?: unknown; error?: unknown } = {}): unknown {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.neq = self;
  chain.limit = self;
  chain.ilike = self;
  chain.update = self;
  chain.insert = self;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null, ...result });
  chain.single = () => Promise.resolve({ data: null, error: null, ...result });
  chain.then = (f: unknown, r: unknown) => (resolved as Promise<unknown>).then(f as never, r as never);
  chain.catch = (r: unknown) => (resolved as Promise<unknown>).catch(r as never);
  chain.finally = (f: unknown) => (resolved as Promise<unknown>).finally(f as never);
  return chain;
}

const APP_UUID    = "00000000-0000-4000-8000-000000000010";
const PERSON_UUID = "00000000-0000-4000-8000-000000000011";
const PROFILE_UUID = "00000000-0000-4000-8000-000000000012";

function baseInput(overrides: Partial<ApproveApplicationInput> = {}): ApproveApplicationInput {
  return {
    applicationId: APP_UUID,
    approvedByAdminUserId: "admin-1",
    approvedByName: "Admin User",
    fullName: "Nguyễn Văn Test",
    emailPrimary: "test@example.com",
    phonePrimary: null,
    gender: null,
    seasonCode: "UEHM-S12",
    intakeBatchId: null,
    targetRole: "mentor",
    previousStatus: "submitted",
    ...overrides,
  };
}

function makeClient(fromResponses: unknown[]) {
  const fromMock = vi.fn();
  fromResponses.forEach((r) => fromMock.mockReturnValueOnce(r));
  fromMock.mockReturnValue(makeChain()); // fallback for audit inserts
  return { from: fromMock };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Input validation (pure — no DB) ──────────────────────────────────────────

describe("approveApplication — input validation", () => {
  it("empty fullName → ok:false before any DB call", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn() });
    const result = await approveApplication(baseInput({ fullName: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/họ tên|tên/i);
  });

  it("null fullName → ok:false", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn() });
    const result = await approveApplication(baseInput({ fullName: null }));
    expect(result.ok).toBe(false);
  });

  it("service client unavailable → ok:false", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(null);
    const result = await approveApplication(baseInput());
    expect(result.ok).toBe(false);
  });
});

// ── Person deduplication by email ─────────────────────────────────────────────

describe("approveApplication — person deduplication", () => {
  it("existing person found by email → personCreated:false (re-approval safe)", async () => {
    const existingPerson = { id: PERSON_UUID, full_name: "Nguyễn Văn Test", email_primary: "test@example.com" };
    const existingProfile = { id: PROFILE_UUID, person_id: PERSON_UUID, mentor_code: null };
    const client = makeClient([
      makeChain({ data: existingPerson }),  // ilike email → found
      makeChain({ data: existingProfile }), // findMentorProfileByPersonId → found
      makeChain({ data: null, error: null }), // update application status
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveApplication(baseInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.personCreated).toBe(false);
      expect(result.personId).toBe(PERSON_UUID);
    }
  });

  it("person not found by email → new person created → personCreated:true", async () => {
    const newPerson = { id: PERSON_UUID, full_name: "Nguyễn Văn Test", email_primary: "test@example.com" };
    const newProfile = { id: PROFILE_UUID };
    const client = makeClient([
      makeChain({ data: null }),            // ilike email → NOT found
      makeChain({ data: null }),            // applications.select person_id → no link
      makeChain({ data: newPerson }),       // people.insert → created
      makeChain({ data: null }),            // findMentorProfileByPersonId → not found
      makeChain({ data: newProfile }),      // mentor_profiles.insert → created
      makeChain({ data: null, error: null }), // update application status
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveApplication(baseInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.personCreated).toBe(true);
    }
  });
});

// ── Profile reuse (idempotency) ───────────────────────────────────────────────

describe("approveApplication — profile reuse (app-layer idempotency)", () => {
  it("existing mentor profile found → profileCreated:false (reused)", async () => {
    const existingPerson = { id: PERSON_UUID, full_name: "Test", email_primary: "test@example.com" };
    const existingProfile = { id: PROFILE_UUID, person_id: PERSON_UUID, mentor_code: "M01" };
    const client = makeClient([
      makeChain({ data: existingPerson }),
      makeChain({ data: existingProfile }), // mentor profile exists
      makeChain({ data: null, error: null }),
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveApplication(baseInput({ targetRole: "mentor" }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profileCreated).toBe(false);
      expect(result.profileId).toBe(PROFILE_UUID);
    }
  });

  it("existing mentee profile found → profileCreated:false", async () => {
    const existingPerson = { id: PERSON_UUID, full_name: "Test", email_primary: "test@example.com" };
    const existingProfile = { id: PROFILE_UUID, person_id: PERSON_UUID };
    const client = makeClient([
      makeChain({ data: existingPerson }),
      makeChain({ data: existingProfile }), // mentee profile exists
      makeChain({ data: null, error: null }),
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveApplication(baseInput({ targetRole: "mentee" }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profileCreated).toBe(false);
    }
  });

  it("no mentor profile → profile created → profileCreated:true", async () => {
    const existingPerson = { id: PERSON_UUID, full_name: "Test", email_primary: "test@example.com" };
    const newProfile = { id: PROFILE_UUID };
    const client = makeClient([
      makeChain({ data: existingPerson }),
      makeChain({ data: null }),       // mentor profile NOT found
      makeChain({ data: newProfile }), // mentor_profiles.insert
      makeChain({ data: null, error: null }),
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveApplication(baseInput({ targetRole: "mentor" }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profileCreated).toBe(true);
    }
  });
});

// ── Non-transactional partial failure ─────────────────────────────────────────

describe("approveApplication — non-transactional partial failure", () => {
  it("application status update fails after person+profile created → ok:false (orphan risk)", async () => {
    // This is the critical partial-failure scenario:
    // person and profile creation succeed, but the final application status
    // update fails. The person/profile row exists but application still shows
    // old status. Not transactionally atomic.
    const existingPerson = { id: PERSON_UUID, full_name: "Test", email_primary: "test@example.com" };
    const newProfile = { id: PROFILE_UUID };
    const updateError = { code: "23503", message: "foreign key violation" };
    const client = makeClient([
      makeChain({ data: existingPerson }),
      makeChain({ data: null }),       // profile not found
      makeChain({ data: newProfile }), // profile created
      makeChain({ data: null, error: updateError }), // application UPDATE FAILS
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveApplication(baseInput());

    // Person and profile were written; application status was NOT updated.
    // The function returns ok:false because the status update failed.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/cập nhật|trạng thái|đơn/i);
  });
});

// ── Gender normalization ──────────────────────────────────────────────────────

describe("approveApplication — gender normalization", () => {
  it("prefer_not_say is normalized to undisclosed before DB insert", async () => {
    // We verify this indirectly by checking the function succeeds and by
    // inspecting what data was passed to the mock (via spy on the insert chain).
    const insertSpy = vi.fn().mockReturnValue(makeChain({ data: { id: PERSON_UUID, full_name: "Test" } }));
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "people") {
        const chain: Record<string, unknown> = {};
        chain.ilike = () => makeChain({ data: null }); // email not found
        chain.select = () => makeChain({ data: null }); // fallback
        chain.eq = () => makeChain({ data: null });
        chain.limit = () => chain;
        chain.maybeSingle = () => Promise.resolve({ data: null });
        chain.insert = insertSpy;
        return chain;
      }
      return makeChain({ data: null });
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: mockFrom });

    await approveApplication(baseInput({ fullName: "Test", gender: "prefer_not_say" }));

    // The insert spy was called; the first argument is the inserted row
    expect(insertSpy).toHaveBeenCalled();
    const insertedPayload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedPayload.gender).toBe("undisclosed");
  });
});

// ── Audit non-fatality ────────────────────────────────────────────────────────

describe("approveApplication — audit rows are non-fatal", () => {
  it("audit insert error does not cause ok:false when core steps succeed", async () => {
    const existingPerson = { id: PERSON_UUID, full_name: "Test", email_primary: "test@example.com" };
    const existingProfile = { id: PROFILE_UUID, person_id: PERSON_UUID };
    const auditError = { code: "500", message: "audit table unavailable" };
    const client = makeClient([
      makeChain({ data: existingPerson }),
      makeChain({ data: existingProfile }),
      makeChain({ data: null, error: null }),         // application update ok
      makeChain({ data: null, error: auditError }),   // application_decisions FAIL — non-fatal
      makeChain({ data: null, error: auditError }),   // admin_audit_log FAIL — non-fatal
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveApplication(baseInput());

    // Audit failures must not fail the entire operation
    expect(result.ok).toBe(true);
  });
});

// ── Authorization boundary ────────────────────────────────────────────────────

describe("approveApplication — authorization boundary", () => {
  it("approveApplication has no internal auth check — authorization is caller's responsibility", async () => {
    // approveApplication() contains no call to getCurrentAdminUser() or canManage*().
    // Authorization MUST be enforced by the server action wrapper before calling this.
    // Consequence: calling approveApplication with a service-role client always executes
    // the business logic regardless of who made the request.
    // This test confirms the function succeeds even without any admin mock being set —
    // which is the evidence that auth is delegated to the caller.
    const existingPerson = { id: PERSON_UUID, full_name: "Test", email_primary: "test@example.com" };
    const existingProfile = { id: PROFILE_UUID, person_id: PERSON_UUID };
    const client = makeClient([
      makeChain({ data: existingPerson }),
      makeChain({ data: existingProfile }),
      makeChain({ data: null, error: null }),
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    // No getCurrentAdminUser mock — the function doesn't call it
    const result = await approveApplication(baseInput());
    expect(result.ok).toBe(true);
    // Interpretation: auth gate must be in the server action, not this library function
  });
});

// ── Raw DB error text not exposed to UI ───────────────────────────────────────

describe("approveApplication — raw DB error text safety", () => {
  it("internal DB error message is not returned verbatim to the caller", async () => {
    // If people.insert fails with a sensitive error, the raw DB message must not
    // appear in the result.message returned to the UI.
    const sensitiveDbError = {
      code: "P0001",
      message: "INTERNAL_SENSITIVE: row-level-security violation on table people"
    };
    const client = makeClient([
      makeChain({ data: null }),            // email lookup → not found
      makeChain({ data: null }),            // existing application link → none
      makeChain({ data: null, error: sensitiveDbError }), // people.insert FAILS
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveApplication(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("INTERNAL_SENSITIVE");
      expect(result.message).not.toContain("row-level-security");
      expect(result.message).toBeTruthy();
    }
  });
});

// ── Approval retry safety (sequential mock, stateful simulation) ───────────────
//
// Accepted MVP mitigation: approveApplication is non-transactional.
// Failure scenario: person and profile are created successfully, but the
// final application status update (step 3) fails.
// Retry behaviour: on the second call, findPersonByEmail returns the SAME
// person (dedup by email), findMentorProfileByPersonId returns the SAME
// profile. No duplicate insert occurs. The status update is retried and
// can now succeed.
//
// This test uses two sequential mock states (call 1 vs call 2) to prove
// the dedup path is taken on retry, satisfying the accepted mitigation.
// ─────────────────────────────────────────────────────────────────────────────

describe("approveApplication — approval retry safety (non-transactional mitigation)", () => {
  it("call-1 creates person+profile but fails status update; call-2 reuses both without duplicating", async () => {
    const createdPerson = { id: PERSON_UUID, full_name: "Nguyễn Văn Test", email_primary: "test@example.com" };
    const createdProfile = { id: PROFILE_UUID };
    const updateError = { code: "23505", message: "duplicate key value" };

    // ── Call 1: person not found → created; profile not found → created;
    //            application status UPDATE FAILS → ok:false
    const clientCall1 = makeClient([
      makeChain({ data: null }),              // findPersonByEmail → NOT found
      makeChain({ data: null }),              // applications.select person_id → none
      makeChain({ data: createdPerson }),     // people.insert → CREATED
      makeChain({ data: null }),              // findMentorProfileByPersonId → NOT found
      makeChain({ data: createdProfile }),    // mentor_profiles.insert → CREATED
      makeChain({ data: null, error: updateError }), // applications.update → FAILS
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(clientCall1);

    const result1 = await approveApplication(baseInput());

    expect(result1.ok).toBe(false);
    // Person and profile were written but application status update failed.
    // Operator must retry.

    // ── Call 2: person NOW FOUND by email (the one created in call 1);
    //            profile FOUND for that person_id;
    //            application status UPDATE SUCCEEDS → ok:true
    const clientCall2 = makeClient([
      makeChain({ data: createdPerson }),    // findPersonByEmail → FOUND (existing)
      makeChain({ data: createdProfile }),   // findMentorProfileByPersonId → FOUND (existing)
      makeChain({ data: null, error: null }), // applications.update → SUCCEEDS
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(clientCall2);

    const result2 = await approveApplication(baseInput());

    expect(result2.ok).toBe(true);
    if (result2.ok) {
      // Dedup path taken: personCreated and profileCreated are false on retry
      expect(result2.personCreated).toBe(false);
      expect(result2.profileCreated).toBe(false);
      expect(result2.personId).toBe(PERSON_UUID);
      expect(result2.profileId).toBe(PROFILE_UUID);
    }
    // Verification: clientCall2.from was called only 3 times (find person,
    // find profile, update status) — no insert calls were made.
    const insertCallCount = (clientCall2.from as ReturnType<typeof vi.fn>).mock.calls
      .filter((args: string[]) => args[0] === "people" || args[0] === "mentor_profiles")
      .length;
    // Note: call-2 touches "people" once (email lookup) and "mentor_profiles" once (profile lookup)
    // — no insert calls, so exactly 2 relevant from() calls
    expect(insertCallCount).toBe(2);
  });
});
