/**
 * Direct production tests for lib/mentor-confirmations.ts.
 *
 * Supabase I/O, admin auth, scope checks and email sending are mocked; the real
 * function bodies run, so the guards, the concurrency checks and the public
 * token rules are verified against the actual code.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn(),
  canReadSeason: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendMentorConfirmationLink: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { sendMentorConfirmationLink } from "@/lib/email";
import {
  getPublicConfirmationByToken,
  grantExtraSlots,
  listMentorSeasonConfirmations,
  recordMentorConfirmation,
  sendConfirmationLinks,
  submitMentorConfirmation
} from "@/lib/mentor-confirmations";

// ── Mock helpers ──────────────────────────────────────────────────────────────

type ChainResult = { data?: unknown; error?: unknown };

/** A Supabase query-builder stub that records the filters it was given. */
function makeChain(result: ChainResult = {}, calls?: Record<string, unknown[]>) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const record = (name: string) => (...args: unknown[]) => {
    if (calls) (calls[name] ??= []).push(args);
    return chain;
  };
  for (const method of ["select", "eq", "neq", "in", "is", "limit", "order", "update", "insert"]) {
    chain[method] = record(method);
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null, ...result });
  chain.then = (f: unknown, r: unknown) => (resolved as Promise<unknown>).then(f as never, r as never);
  chain.catch = (r: unknown) => (resolved as Promise<unknown>).catch(r as never);
  chain.finally = (f: unknown) => (resolved as Promise<unknown>).finally(f as never);
  return chain;
}

function makeClient(responses: unknown[]) {
  const fromMock = vi.fn();
  responses.forEach((r) => fromMock.mockReturnValueOnce(r));
  fromMock.mockReturnValue(makeChain()); // fallback: audit-log inserts etc.
  return { from: fromMock } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

const CONFIRMATION_ID = "00000000-0000-4000-8000-000000000001";
const PERSON_ID = "00000000-0000-4000-8000-000000000002";
const SEASON_ID = "00000000-0000-4000-8000-000000000003";
const TOKEN = "00000000-0000-4000-8000-000000000004";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIRMATION_ID,
    person_id: PERSON_ID,
    mentor_profile_id: null,
    season_id: SEASON_ID,
    status: "pending",
    max_mentees: null,
    extra_slots: 0,
    agree_to_review: null,
    agree_to_interview: null,
    note: null,
    response_source: null,
    responded_at: null,
    responded_by_admin_user_id: null,
    token: TOKEN,
    token_expires_at: "2099-01-01T00:00:00.000Z",
    contact_email: null,
    link_sent_at: null,
    link_send_error: null,
    updated_at: "2026-08-18T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "super_admin" });
  (getAdminScopeContext as Mock).mockResolvedValue({ isSuperAdmin: true, programScopes: [] });
  (canOperateSeason as Mock).mockResolvedValue(true);
  (canReadSeason as Mock).mockResolvedValue(true);
});

// ── Admin write: authorization ────────────────────────────────────────────────

describe("recordMentorConfirmation — authorization", () => {
  it("refuses a role that may not record confirmations", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "u", role: "reviewer" });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([makeChain({ data: makeRow() })]));

    const result = await recordMentorConfirmation({
      confirmationId: CONFIRMATION_ID,
      decision: "confirmed",
      maxMentees: "2"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
  });

  it("allows support_team, the role that does the phone follow-up", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "support-1", role: "support_team" });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow() }), makeChain({ data: { id: CONFIRMATION_ID } })])
    );

    const result = await recordMentorConfirmation({
      confirmationId: CONFIRMATION_ID,
      decision: "confirmed",
      maxMentees: "2"
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("2 mentee");
  });

  it("refuses when the operator lacks operations scope on that season", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "u", role: "core_team" });
    (canOperateSeason as Mock).mockResolvedValue(false);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([makeChain({ data: makeRow() })]));

    const result = await recordMentorConfirmation({
      confirmationId: CONFIRMATION_ID,
      decision: "declined"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("vận hành mùa này");
  });

  it("rejects a malformed id before touching the database", async () => {
    const client = makeClient([]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await recordMentorConfirmation({ confirmationId: "not-a-uuid", decision: "confirmed" });

    expect(result.ok).toBe(false);
    expect((client as unknown as { from: Mock }).from).not.toHaveBeenCalled();
  });
});

// ── Admin write: concurrency and validation ───────────────────────────────────

describe("recordMentorConfirmation — concurrency and validation", () => {
  it("refuses when the row moved on since the page was rendered", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow({ status: "confirmed" }) })])
    );

    const result = await recordMentorConfirmation({
      confirmationId: CONFIRMATION_ID,
      decision: "declined",
      expectedStatus: "pending"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("tải lại trang");
  });

  it("reports a lost race when the conditional update matches nothing", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow() }), makeChain({ data: null })])
    );

    const result = await recordMentorConfirmation({
      confirmationId: CONFIRMATION_ID,
      decision: "confirmed",
      maxMentees: "1",
      expectedStatus: "pending"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("tải lại trang");
  });

  it("refuses an out-of-range capacity", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([makeChain({ data: makeRow() })]));

    const result = await recordMentorConfirmation({
      confirmationId: CONFIRMATION_ID,
      decision: "confirmed",
      maxMentees: "9"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("từ 1 đến 3");
  });

  it("writes the phone source and the operator id", async () => {
    const calls: Record<string, unknown[]> = {};
    const updateChain = makeChain({ data: { id: CONFIRMATION_ID } }, calls);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow() }), updateChain])
    );
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "support-9", role: "support_team" });

    const result = await recordMentorConfirmation({
      confirmationId: CONFIRMATION_ID,
      decision: "confirmed",
      maxMentees: "3",
      source: "phone"
    });

    expect(result.ok).toBe(true);
    const payload = (calls.update?.[0] as [Record<string, unknown>])[0];
    expect(payload.response_source).toBe("phone");
    expect(payload.responded_by_admin_user_id).toBe("support-9");
    expect(payload.max_mentees).toBe(3);
    expect(payload.responded_at).toBeTruthy();
  });

  it("reports a missing row plainly", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([makeChain({ data: null })]));

    const result = await recordMentorConfirmation({ confirmationId: CONFIRMATION_ID, decision: "confirmed" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Không tìm thấy");
  });

  it("never leaks a raw Postgres message on a read failure", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({
          data: null,
          error: { code: "42501", message: 'permission denied for table mentor_season_confirmations' }
        })
      ])
    );

    const result = await recordMentorConfirmation({ confirmationId: CONFIRMATION_ID, decision: "confirmed" });

    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("permission denied");
    expect(result.message).not.toContain("mentor_season_confirmations");
  });
});

// ── Public read ───────────────────────────────────────────────────────────────

describe("getPublicConfirmationByToken", () => {
  it("treats a malformed token as not found without querying", async () => {
    const client = makeClient([]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const view = await getPublicConfirmationByToken("not-a-uuid");

    expect(view.state).toBe("not_found");
    expect((client as unknown as { from: Mock }).from).not.toHaveBeenCalled();
  });

  it("returns ready with the mentor and season labels", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRow() }), // confirmation row
        makeChain({ data: [] }), // active matches
        makeChain({ data: { full_name: "Nguyễn Văn A" } }), // people
        makeChain({ data: { code: "UEHM-S12", name: "UEH Mentoring Season 12" } }) // seasons
      ])
    );

    const view = await getPublicConfirmationByToken(TOKEN);

    expect(view.state).toBe("ready");
    expect(view.mentorName).toBe("Nguyễn Văn A");
    expect(view.seasonLabel).toBe("UEH Mentoring Season 12");
    expect(view.updatedAt).toBe("2026-08-18T00:00:00.000Z");
  });

  it("reports expired for a past deadline", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRow({ token_expires_at: "2020-01-01T00:00:00.000Z" }) }),
        makeChain({ data: [] }),
        makeChain({ data: null }),
        makeChain({ data: null })
      ])
    );

    const view = await getPublicConfirmationByToken(TOKEN);
    expect(view.state).toBe("expired");
  });

  it("reports locked once the mentor already has a match", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRow() }),
        makeChain({ data: [{ mentor_person_id: PERSON_ID }] }),
        makeChain({ data: null }),
        makeChain({ data: null })
      ])
    );

    const view = await getPublicConfirmationByToken(TOKEN);
    expect(view.state).toBe("locked");
  });
});

// ── Public write ──────────────────────────────────────────────────────────────

describe("submitMentorConfirmation", () => {
  it("stores the mentor's own answer with source=form", async () => {
    const calls: Record<string, unknown[]> = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRow() }), // load
        makeChain({ data: [] }), // matches
        makeChain({ data: { id: CONFIRMATION_ID } }, calls) // update
      ])
    );

    const result = await submitMentorConfirmation({
      token: TOKEN,
      decision: "confirmed",
      maxMentees: "2",
      agreeToReview: "on",
      agreeToInterview: "on",
      updatedAtSnapshot: "2026-08-18T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    const payload = (calls.update?.[0] as [Record<string, unknown>])[0];
    expect(payload.response_source).toBe("form");
    expect(payload.max_mentees).toBe(2);
    expect(payload.agree_to_review).toBe(true);
    // The public path must never stamp an operator id.
    expect(payload).not.toHaveProperty("responded_by_admin_user_id");
  });

  it("defaults to one mentee when the mentor confirms without choosing", async () => {
    const calls: Record<string, unknown[]> = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow() }), makeChain({ data: [] }), makeChain({ data: { id: CONFIRMATION_ID } }, calls)])
    );

    await submitMentorConfirmation({ token: TOKEN, decision: "confirmed" });

    const payload = (calls.update?.[0] as [Record<string, unknown>])[0];
    expect(payload.max_mentees).toBe(1);
  });

  it("refuses an expired link", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow({ token_expires_at: "2020-01-01T00:00:00.000Z" }) }), makeChain({ data: [] })])
    );

    const result = await submitMentorConfirmation({ token: TOKEN, decision: "confirmed" });

    expect(result.ok).toBe(false);
    expect(result.state).toBe("expired");
    expect(result.message).toContain("hết hạn");
  });

  it("refuses once an operator recorded the answer by phone", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow({ responded_by_admin_user_id: "admin-1" }) }), makeChain({ data: [] })])
    );

    const result = await submitMentorConfirmation({ token: TOKEN, decision: "declined" });

    expect(result.ok).toBe(false);
    expect(result.state).toBe("locked");
  });

  it("refuses a stale tab whose snapshot no longer matches", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow() }), makeChain({ data: [] }), makeChain({ data: null })])
    );

    const result = await submitMentorConfirmation({
      token: TOKEN,
      decision: "confirmed",
      updatedAtSnapshot: "2026-01-01T00:00:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("tải lại trang");
  });

  it("rejects a malformed token before any query", async () => {
    const client = makeClient([]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await submitMentorConfirmation({ token: "abc", decision: "confirmed" });

    expect(result.ok).toBe(false);
    expect(result.state).toBe("not_found");
    expect((client as unknown as { from: Mock }).from).not.toHaveBeenCalled();
  });

  it("requires no admin identity at all — the token is the capability", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue(null);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow() }), makeChain({ data: [] }), makeChain({ data: { id: CONFIRMATION_ID } })])
    );

    const result = await submitMentorConfirmation({ token: TOKEN, decision: "declined" });

    expect(result.ok).toBe(true);
    expect(getCurrentAdminUser).not.toHaveBeenCalled();
  });
});

// ── Extra slots ───────────────────────────────────────────────────────────────

describe("grantExtraSlots", () => {
  it("only applies to a mentor who confirmed", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: makeRow({ status: "pending" }) })])
    );

    const result = await grantExtraSlots({ confirmationId: CONFIRMATION_ID, extraSlots: "1" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã xác nhận");
  });

  it("bounds the grant", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient([]));

    for (const value of ["-1", "4", "abc", ""]) {
      const result = await grantExtraSlots({ confirmationId: CONFIRMATION_ID, extraSlots: value });
      expect(result.ok, value).toBe(false);
      expect(result.message).toContain("từ 0 đến 3");
    }
  });

  it("reports the new effective cap", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: makeRow({ status: "confirmed", max_mentees: 2, extra_slots: 0 }) }),
        makeChain({ data: { id: CONFIRMATION_ID } })
      ])
    );

    const result = await grantExtraSlots({ confirmationId: CONFIRMATION_ID, extraSlots: "1" });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("tối đa 3 mentee");
  });
});

// ── Listing ───────────────────────────────────────────────────────────────────

describe("listMentorSeasonConfirmations", () => {
  it("refuses when the caller cannot read the season", async () => {
    (canReadSeason as Mock).mockResolvedValue(false);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: null, program_id: null } })])
    );

    const result = await listMentorSeasonConfirmations({ seasonIdOrCode: "UEHM-S12" });

    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.error).toContain("không có quyền");
  });

  it("enriches rows with load, cap and a personal link", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: null, program_id: null } }), // season
        makeChain({ data: [makeRow({ status: "confirmed", max_mentees: 2, extra_slots: 1 })] }), // rows
        makeChain({ data: [{ id: PERSON_ID, full_name: "Nguyễn Văn A", email_primary: "a@example.test" }] }), // people
        makeChain({ data: [{ mentor_person_id: PERSON_ID }, { mentor_person_id: PERSON_ID }] }) // matches
      ])
    );

    const result = await listMentorSeasonConfirmations({
      seasonIdOrCode: "UEHM-S12",
      baseUrl: "https://portal.test"
    });

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.full_name).toBe("Nguyễn Văn A");
    expect(row.effective_cap).toBe(3); // 2 declared + 1 extra
    expect(row.active_match_count).toBe(2);
    expect(row.confirm_url).toBe(`https://portal.test/confirm/${TOKEN}`);
    expect(result.summary.confirmed).toBe(1);
    expect(result.summary.totalCapacity).toBe(3);
  });

  it("omits the link when no base URL is configured", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: null, program_id: null } }),
        makeChain({ data: [makeRow()] }),
        makeChain({ data: [] }),
        makeChain({ data: [] })
      ])
    );

    const result = await listMentorSeasonConfirmations({ seasonIdOrCode: "UEHM-S12" });

    expect(result.rows[0]?.confirm_url).toBeNull();
  });
});

// ── Sending ───────────────────────────────────────────────────────────────────

describe("sendConfirmationLinks", () => {
  it("requires a base URL rather than mailing a broken link", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: null, program_id: null } })])
    );

    const result = await sendConfirmationLinks({ seasonIdOrCode: "UEHM-S12", baseUrl: "  " });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("VAM_OS_PUBLIC_BASE_URL");
    expect(sendMentorConfirmationLink).not.toHaveBeenCalled();
  });

  it("caps a batch at 50 even when asked for more", async () => {
    const calls: Record<string, unknown[]> = {};
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: null, program_id: null } }),
        makeChain({ data: [] }, calls)
      ])
    );

    await sendConfirmationLinks({ seasonIdOrCode: "UEHM-S12", baseUrl: "https://portal.test", limit: 500 });

    expect(calls.limit?.[0]).toEqual([50]);
  });

  it("records a mentor with no email as failed instead of sending", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: null, program_id: null } }),
        makeChain({ data: [makeRow()] }),
        makeChain({ data: [{ id: PERSON_ID, full_name: "A", email_primary: null }] })
      ])
    );

    const result = await sendConfirmationLinks({
      seasonIdOrCode: "UEHM-S12",
      baseUrl: "https://portal.test"
    });

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(sendMentorConfirmationLink).not.toHaveBeenCalled();
  });

  it("counts a configuration-skipped send separately from a failure", async () => {
    (sendMentorConfirmationLink as Mock).mockResolvedValue({
      ok: true,
      skipped: true,
      reason: "VAM_OS_EMAIL_ENABLED chưa bật"
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: null, program_id: null } }),
        makeChain({ data: [makeRow()] }),
        makeChain({ data: [{ id: PERSON_ID, full_name: "A", email_primary: "a@example.test" }] })
      ])
    );

    const result = await sendConfirmationLinks({
      seasonIdOrCode: "UEHM-S12",
      baseUrl: "https://portal.test"
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("sends the personal link built from the configured base URL", async () => {
    (sendMentorConfirmationLink as Mock).mockResolvedValue({ ok: true, skipped: false, providerMessageId: "m-1" });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([
        makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: "Season 12", program_id: null } }),
        makeChain({ data: [makeRow()] }),
        makeChain({ data: [{ id: PERSON_ID, full_name: "Nguyễn Văn A", email_primary: "a@example.test" }] })
      ])
    );

    const result = await sendConfirmationLinks({
      seasonIdOrCode: "UEHM-S12",
      baseUrl: "https://portal.test/"
    });

    expect(result.sent).toBe(1);
    const arg = (sendMentorConfirmationLink as Mock).mock.calls[0][0];
    expect(arg.confirmUrl).toBe(`https://portal.test/confirm/${TOKEN}`);
    expect(arg.toEmail).toBe("a@example.test");
    expect(arg.seasonLabel).toBe("Season 12");
    expect(arg.confirmationId).toBe(CONFIRMATION_ID);
  });

  it("refuses when the operator lacks scope on the season", async () => {
    (canOperateSeason as Mock).mockResolvedValue(false);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      makeClient([makeChain({ data: { id: SEASON_ID, code: "UEHM-S12", name: null, program_id: null } })])
    );

    const result = await sendConfirmationLinks({
      seasonIdOrCode: "UEHM-S12",
      baseUrl: "https://portal.test"
    });

    expect(result.ok).toBe(false);
    expect(sendMentorConfirmationLink).not.toHaveBeenCalled();
  });
});
