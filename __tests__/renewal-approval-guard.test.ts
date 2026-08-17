import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { approveApplication, type ApproveApplicationInput } from "@/lib/application-approvals";

const APP = "00000000-0000-4000-8000-000000000010";
const PERSON = "00000000-0000-4000-8000-000000000011";
const PROFILE = "00000000-0000-4000-8000-000000000012";
const SEASON = "00000000-0000-4000-8000-000000000013";
const MEMBERSHIP = "00000000-0000-4000-8000-000000000014";

function input(): ApproveApplicationInput {
  return {
    applicationId: APP,
    approvedByAdminUserId: "admin-1",
    approvedByName: "Admin",
    fullName: "Returning Mentor",
    emailPrimary: "mentor@example.com",
    phonePrimary: null,
    gender: null,
    seasonCode: "UEHM-S12",
    intakeBatchId: null,
    targetRole: "mentor",
    previousStatus: "submitted"
  };
}

function chain(result: { data?: unknown; error?: unknown }, writes: Mock[]) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const q: Record<string, any> = {};
  for (const method of ["select", "eq", "ilike", "order", "limit"]) q[method] = vi.fn(() => q);
  q.update = vi.fn(() => { writes.push(q.update); return q; });
  q.insert = vi.fn(() => { writes.push(q.insert); return q; });
  q.maybeSingle = vi.fn(async () => ({ data: null, error: null, ...result }));
  q.then = (resolve: any, reject: any) => resolved.then(resolve, reject);
  return q;
}

function renewalApplication(overrides: Record<string, unknown> = {}) {
  return {
    person_id: PERSON,
    season_id: SEASON,
    role_applied: "mentor",
    raw_payload: { renewal: {} },
    source: "s12_mentor_renewal",
    renewal_invites: [{ id: "invite-1", person_id: PERSON, season_id: SEASON, role: "mentor" }],
    ...overrides
  };
}

function clientFor(
  application: Record<string, unknown>,
  options: {
    confirmations?: unknown[];
    confirmationError?: unknown;
    membership?: unknown;
    membershipError?: unknown;
  } = {}
) {
  const writes: Mock[] = [];
  const calls: string[] = [];
  const rpc = vi.fn();
  let membershipQuery: Record<string, any> | null = null;
  let applicationsCalls = 0;
  const from = vi.fn((table: string) => {
    calls.push(table);
    if (table === "applications") {
      applicationsCalls += 1;
      return chain(applicationsCalls === 1 ? { data: application } : {}, writes);
    }
    if (table === "admin_audit_log" && calls.filter((name) => name === "admin_audit_log").length === 1) {
      return chain({ data: options.confirmations ?? [], error: options.confirmationError ?? null }, writes);
    }
    if (table === "person_season_memberships") {
      membershipQuery = chain({
        data: options.membership === undefined
          ? { id: MEMBERSHIP, status: "active" }
          : options.membership,
        error: options.membershipError ?? null
      }, writes);
      return membershipQuery;
    }
    if (table === "people") return chain({ data: { id: PERSON, full_name: "Returning Mentor", email_primary: "mentor@example.com", phone_primary: null, gender: null } }, writes);
    if (table === "mentor_profiles") return chain({ data: { id: PROFILE, person_id: PERSON, mentor_code: "M01" } }, writes);
    return chain({}, writes);
  });
  return { client: { from, rpc }, from, rpc, writes, get membershipQuery() { return membershipQuery; } };
}

beforeEach(() => vi.resetAllMocks());

describe("P0-RT-11 shared approveApplication boundary", () => {
  it("ordinary application is unaffected and does not require confirm_renewal", async () => {
    const setup = clientFor({ person_id: PERSON, raw_payload: {}, source: "vam_os_form", renewal_invites: [] });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
    const result = await approveApplication(input());
    expect(result.ok).toBe(true);
    expect(setup.from.mock.calls.filter(([table]) => table === "admin_audit_log")).toHaveLength(1); // final approval audit only
  });

  it("renewal without confirmation evidence refuses before every write", async () => {
    const setup = clientFor(renewalApplication());
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await approveApplication(input());
    expect(result.ok).toBe(false);
    expect(setup.writes).toHaveLength(0);
    expect(setup.from.mock.calls.map(([table]) => table)).toEqual(["applications", "admin_audit_log"]);
  });

  it("renewal with exact durable confirmation evidence may continue", async () => {
    const setup = clientFor(renewalApplication(), {
      confirmations: [{ id: "audit-1", details: { application_id: APP } }]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
    const result = await approveApplication(input());
    expect(result.ok).toBe(true);
    expect(setup.writes.length).toBeGreaterThan(0);
    expect(setup.membershipQuery?.eq.mock.calls).toEqual([
      ["person_id", PERSON],
      ["season_id", SEASON],
      ["role", "mentor"]
    ]);
  });

  it("invite-bound application remains guarded even when source is malformed", async () => {
    const setup = clientFor(renewalApplication({ source: "legacy_typo" }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await approveApplication(input());
    expect(result.ok).toBe(false);
    expect(setup.writes).toHaveLength(0);
  });

  it("confirmed renewal with paused membership refuses ordinary approval before writes", async () => {
    const setup = clientFor(renewalApplication(), {
      confirmations: [{ id: "audit-1", details: { application_id: APP } }],
      membership: { id: MEMBERSHIP, status: "paused" }
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await approveApplication(input());
    expect(result).toMatchObject({ ok: false });
    expect(setup.writes).toHaveLength(0);
    expect(setup.rpc).not.toHaveBeenCalled();
  });

  it("confirmed renewal with opted_out membership refuses without reconciling it", async () => {
    const setup = clientFor(renewalApplication(), {
      confirmations: [{ id: "audit-1", details: { application_id: APP } }],
      membership: { id: MEMBERSHIP, status: "opted_out" }
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await approveApplication(input());
    expect(result).toMatchObject({ ok: false });
    expect(setup.writes).toHaveLength(0);
    expect(setup.rpc).not.toHaveBeenCalled();
  });

  it("RT-11 audit query errors fail closed before membership or writes", async () => {
    const setup = clientFor(renewalApplication(), {
      confirmationError: { code: "AUDIT_READ_FAILED" }
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await approveApplication(input());
    expect(result).toMatchObject({ ok: false });
    expect(setup.from).not.toHaveBeenCalledWith("person_season_memberships");
    expect(setup.writes).toHaveLength(0);
  });

  it("RT-11 audit details for a different application fail closed", async () => {
    const setup = clientFor(renewalApplication(), {
      confirmations: [{ id: "audit-1", details: { application_id: "different-app" } }]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await approveApplication(input());
    expect(result).toMatchObject({ ok: false });
    expect(setup.from).not.toHaveBeenCalledWith("person_season_memberships");
    expect(setup.writes).toHaveLength(0);
  });

  it("missing, erroneous, or ambiguous membership binding fails closed", async () => {
    for (const options of [
      { membership: null },
      { membership: null, membershipError: { code: "MEMBERSHIP_READ_FAILED" } }
    ]) {
      const setup = clientFor(renewalApplication(), {
        confirmations: [{ id: "audit-1", details: { application_id: APP } }],
        ...options
      });
      (getSupabaseServiceRoleClient as Mock).mockReturnValue(setup.client);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await approveApplication(input())).toMatchObject({ ok: false });
      expect(setup.writes).toHaveLength(0);
    }

    const ambiguous = clientFor(renewalApplication({
      renewal_invites: [
        { id: "invite-1", person_id: PERSON, season_id: SEASON, role: "mentor" },
        { id: "invite-2", person_id: PERSON, season_id: SEASON, role: "mentor" }
      ]
    }), { confirmations: [{ id: "audit-1", details: { application_id: APP } }] });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(ambiguous.client);
    expect(await approveApplication(input())).toMatchObject({ ok: false });
    expect(ambiguous.writes).toHaveLength(0);
  });
});
