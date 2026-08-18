import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn()
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/renewal-runtime", () => ({
  submitRenewalAccepted: vi.fn(),
  submitRenewalDeclined: vi.fn(),
  createRenewalInvite: vi.fn(),
  revokeRenewalInvite: vi.fn(),
  regenerateRenewalInvite: vi.fn(),
  confirmRenewalAndApprove: vi.fn()
}));

import { getAdminScopeContext, canOperateSeason } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  confirmRenewalAndApprove,
  createRenewalInvite,
  regenerateRenewalInvite,
  revokeRenewalInvite
} from "@/lib/renewal-runtime";
import {
  confirmRenewalAction,
  createRenewalInviteAction,
  regenerateRenewalInviteAction,
  revokeRenewalInviteAction
} from "@/app/actions/renewals";

const IDS = {
  invite: "00000000-0000-4000-8000-000000000001",
  person: "00000000-0000-4000-8000-000000000002",
  program: "00000000-0000-4000-8000-000000000003",
  season: "00000000-0000-4000-8000-000000000004",
  application: "00000000-0000-4000-8000-000000000005"
};

const previous = { ok: false, message: "" };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function query(data: unknown) {
  const chain: Record<string, any> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data, error: null }));
  return chain;
}

function client() {
  return {
    from: vi.fn((table: string) => {
      if (table === "person_season_invites") {
        return query({ id: IDS.invite, season_id: IDS.season });
      }
      if (table === "seasons") {
        return query({ id: IDS.season, program_id: IDS.program, code: "UEHM-S12" });
      }
      if (table === "mentor_profiles") return query({ id: "profile-1" });
      return query(null);
    })
  };
}

function operatorContext(role = "admin") {
  return {
    adminUser: {
      id: "admin-1",
      email: "admin@example.com",
      full_name: "Admin",
      role,
      status: "active",
      auth_user_id: "auth-1"
    },
    isSuperAdmin: role === "super_admin",
    programScopes: [],
    scopeError: null
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (getAdminScopeContext as Mock).mockResolvedValue(operatorContext());
  (canOperateSeason as Mock).mockResolvedValue(true);
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(client());
  for (const mutation of [createRenewalInvite, revokeRenewalInvite, regenerateRenewalInvite, confirmRenewalAndApprove]) {
    (mutation as Mock).mockResolvedValue({ ok: true, outcome: "ok", message: "ok" });
  }
});

describe("renewal server actions — exact season authorization", () => {
  it("permits create, revoke, regenerate, and confirm for an authorized S12 operator", async () => {
    await createRenewalInviteAction(previous, form({
      person_id: IDS.person,
      program_id: IDS.program,
      season_id: IDS.season,
      expires_days: "14"
    }));
    await revokeRenewalInviteAction(previous, form({ invite_id: IDS.invite }));
    await regenerateRenewalInviteAction(previous, form({ invite_id: IDS.invite, expires_days: "14" }));
    await confirmRenewalAction({
      applicationId: IDS.application,
      expectedProfile: {},
      profileUpdate: {},
      diff: []
    }, previous, new FormData());

    expect(createRenewalInvite).toHaveBeenCalledOnce();
    expect(revokeRenewalInvite).toHaveBeenCalledOnce();
    expect(regenerateRenewalInvite).toHaveBeenCalledOnce();
    expect(confirmRenewalAndApprove).toHaveBeenCalledOnce();
    expect(canOperateSeason).toHaveBeenCalledTimes(4);
    for (const call of (canOperateSeason as Mock).mock.calls) expect(call[1]).toBe(IDS.season);
  });

  it("refuses all four actions before their mutation when the exact season scope is absent", async () => {
    (canOperateSeason as Mock).mockResolvedValue(false);

    const results = await Promise.all([
      createRenewalInviteAction(previous, form({
        person_id: IDS.person,
        program_id: IDS.program,
        season_id: IDS.season,
        expires_days: "14"
      })),
      revokeRenewalInviteAction(previous, form({ invite_id: IDS.invite })),
      regenerateRenewalInviteAction(previous, form({ invite_id: IDS.invite, expires_days: "14" })),
      confirmRenewalAction({
        applicationId: IDS.application,
        expectedProfile: {},
        profileUpdate: {},
        diff: []
      }, previous, new FormData())
    ]);

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(createRenewalInvite).not.toHaveBeenCalled();
    expect(revokeRenewalInvite).not.toHaveBeenCalled();
    expect(regenerateRenewalInvite).not.toHaveBeenCalled();
    expect(confirmRenewalAndApprove).not.toHaveBeenCalled();
  });

  it("refuses a globally ineligible role even when a season helper would allow it", async () => {
    (getAdminScopeContext as Mock).mockResolvedValue(operatorContext("viewer"));
    const result = await createRenewalInviteAction(previous, form({
      person_id: IDS.person,
      program_id: IDS.program,
      season_id: IDS.season,
      expires_days: "14"
    }));
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("accepts UUID v7 and v8 in payloads without failing UUID validation", async () => {
    const v7 = "018e6e5a-73d7-7f5b-9d62-123456789abc";
    const v8 = "018e6e5a-73d7-8f5b-9d62-123456789abc";
    const result = await createRenewalInviteAction(previous, form({
      person_id: v7,
      program_id: v8,
      season_id: IDS.season,
      expires_days: "14"
    }));
    // Should pass UUID check. If it fails later due to mock data mismatch,
    // the error will be different than the UUID validation error.
    expect(result.message).not.toBe("Person, program hoặc season không hợp lệ.");
  });
});
