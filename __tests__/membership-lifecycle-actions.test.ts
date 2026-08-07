import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { isServerActionModule, scanServerActionExports } from "./use-server-scanner";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { addMembershipRoleAction, transitionMembershipAction } from "@/app/actions/membership-lifecycle";
import { initialMembershipLifecycleState } from "@/lib/membership-lifecycle";
import { getAdminScopeContext, canOperateSeason } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const PERSON = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP = "22222222-2222-4222-8222-222222222222";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const SEASON = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";

function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
function transitionForm(operation = "pause", status = "active", extra: Record<string, string> = {}) {
  return form({ membership_id: MEMBERSHIP, person_id: PERSON, expected_status: status, operation, reason: "synthetic test", ...extra });
}
function query(single: unknown) {
  const chain: any = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle: vi.fn(async () => single) };
  return chain;
}
function client(options: { status?: string; validSeason?: boolean; rpcOutcome?: string; rpcError?: string } = {}) {
  const membership = { data: { id: MEMBERSHIP, person_id: PERSON, program_id: PROGRAM, season_id: SEASON, status: options.status ?? "active" }, error: null };
  const season = { data: options.validSeason === false ? null : { id: SEASON, program_id: PROGRAM }, error: null };
  const membershipQuery = query(membership), seasonQuery = query(season);
  const rpc = vi.fn(async () => options.rpcError ? { data: null, error: { message: options.rpcError } } : { data: [{ outcome_status: options.rpcOutcome ?? "transitioned" }], error: null });
  return { from: vi.fn((table: string) => table === "person_season_memberships" ? membershipQuery : seasonQuery), rpc };
}
function actor(role = "core_team", status = "active") { return { id: ACTOR, role, status, auth_user_id: "auth-synthetic" }; }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminScopeContext).mockResolvedValue({ adminUser: actor() as any, authUserId: "auth-synthetic", globalRole: "core_team", isSuperAdmin: false, programScopes: [] });
  vi.mocked(canOperateSeason).mockResolvedValue(true);
});

describe("membership lifecycle server actions", () => {
  it("rejects unauthenticated, inactive, and viewer+read callers before RPC", async () => {
    for (const admin of [null, actor("core_team", "inactive"), actor("viewer")]) {
      const db = client(); vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
      vi.mocked(getAdminScopeContext).mockResolvedValue({ adminUser: admin as any, authUserId: null, globalRole: admin?.role ?? null, isSuperAdmin: false, programScopes: [] });
      vi.mocked(canOperateSeason).mockResolvedValue(admin?.role !== "viewer");
      const result = await transitionMembershipAction(initialMembershipLifecycleState, transitionForm());
      expect(result.ok).toBe(false); expect(db.rpc).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["pause", "vam063_pause_membership"], ["reactivate", "vam063_reactivate_membership"],
    ["withdraw", "vam063_withdraw_membership"], ["opt_out", "vam063_opt_out_membership"],
    ["cancel", "vam063_cancel_membership"], ["remove_role", "vam063_remove_membership_role"]
  ])("routes %s through the authoritative RPC with the session actor", async (operation, rpcName) => {
    const db = client({ status: operation === "reactivate" ? "paused" : "active" });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    const result = await transitionMembershipAction(initialMembershipLifecycleState, transitionForm(operation, operation === "reactivate" ? "paused" : "active", { actor_admin_user_id: "forged" }));
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith(rpcName, expect.objectContaining({ p_actor_admin_user_id: ACTOR, p_membership_id: MEMBERSHIP }));
  });

  it("rejects wrong program-season, wrong scope, stale status, and missing required reason", async () => {
    let db = client({ validSeason: false }); vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    expect((await transitionMembershipAction(initialMembershipLifecycleState, transitionForm())).ok).toBe(false);
    db = client(); vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any); vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect((await transitionMembershipAction(initialMembershipLifecycleState, transitionForm())).ok).toBe(false);
    vi.mocked(canOperateSeason).mockResolvedValue(true); db = client({ status: "paused" }); vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    expect((await transitionMembershipAction(initialMembershipLifecycleState, transitionForm("pause", "active"))).message).toContain("đã thay đổi");
    expect((await transitionMembershipAction(initialMembershipLifecycleState, transitionForm("cancel", "active", { reason: "" }))).message).toContain("lý do");
  });

  it("handles repeated RPC no-op safely and adds only supported roles", async () => {
    let db = client({ rpcOutcome: "noop" }); vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    expect((await transitionMembershipAction(initialMembershipLifecycleState, transitionForm())).outcome).toBe("noop");
    db = client({ rpcOutcome: "created" }); vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    const result = await addMembershipRoleAction(initialMembershipLifecycleState, form({ person_id: PERSON, program_id: PROGRAM, season_id: SEASON, role: "mentor", reason: "synthetic" }));
    expect(result.ok).toBe(true); expect(db.rpc).toHaveBeenCalledWith("vam063_add_membership_role", expect.objectContaining({ p_actor_admin_user_id: ACTOR, p_role: "mentor" }));
    expect((await addMembershipRoleAction(initialMembershipLifecycleState, form({ person_id: PERSON, program_id: PROGRAM, season_id: SEASON, role: "admin" }))).ok).toBe(false);
  });

  it("contains no delete path and preserves safe error/UI evidence", () => {
    const action = readFileSync("app/actions/membership-lifecycle.ts", "utf8");
    const ui = readFileSync("app/people/[id]/membership-lifecycle-controls.tsx", "utf8");
    expect(action).not.toMatch(/\.delete\(|delete\s+from/i);
    expect(action).toContain("revalidatePath"); expect(action).not.toContain("actor_admin_user_id\"");
    expect(ui).toContain("window.confirm"); expect(ui).toContain("required={required}"); expect(ui).not.toMatch(/auth_user_id|password|token/i);
  });

  it("proves strict server action export contract via AST", () => {
    const filePath = "app/actions/membership-lifecycle.ts";
    const sourceCode = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

    expect(isServerActionModule(sourceFile)).toBe(true);
    const invalidExports = scanServerActionExports(sourceFile);
    expect(invalidExports).toEqual([]);
  });
});
