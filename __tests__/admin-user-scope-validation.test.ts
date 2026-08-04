import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn(async () => ({ id: "actor-1", email: "owner@example.invalid", role: "super_admin", status: "active" }))
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ envName: "server-key", loaded: true, usesPublicPrefix: false, sameAsAnonKey: false }))
}));
vi.mock("@/lib/account-auth-ownership", () => ({ findExactAuthUsers: vi.fn(), resolveAuthOwnership: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createManagedAdminUser, updateManagedAdminUser } from "@/lib/admin-users";

const UEHM = "00000000-0000-4000-8000-000000000101";
const HAM = "00000000-0000-4000-8000-000000000102";
const UEHM_S12 = "00000000-0000-4000-8000-000000000201";
const HAM_S6 = "00000000-0000-4000-8000-000000000202";

function makeClient() {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: null, error: null }));
  const inviteUserByEmail = vi.fn();
  const writes = { update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
  const from = vi.fn((table: string) => {
    let selection = "";
    const filters = new Map<string, unknown>();
    const chain: any = {
      select(columns: string) { selection = columns; return chain; },
      eq(column: string, value: unknown) { filters.set(column, value); return chain; },
      neq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      update(payload: unknown) { writes.update(table, payload); return chain; },
      insert(payload: unknown) { writes.insert(table, payload); return chain; },
      delete() { writes.delete(table); return chain; },
      async maybeSingle() {
        if (table === "programs") {
          const id = String(filters.get("id") ?? "");
          return { data: id === UEHM || id === HAM ? { id, is_active: true } : null, error: null };
        }
        if (table === "seasons") {
          const id = String(filters.get("id") ?? "");
          if (id === UEHM_S12) return { data: { id, program_id: UEHM }, error: null };
          if (id === HAM_S6) return { data: { id, program_id: HAM }, error: null };
          return { data: null, error: null };
        }
        if (table === "admin_users" && selection === "id,role,status") {
          return { data: { id: "target-1", role: "viewer", status: "active" }, error: null };
        }
        if (table === "admin_users") {
          return { data: { id: "target-1", auth_user_id: null, email: "hidden@example.invalid", full_name: "Existing", role: "viewer", status: "active", created_at: "", updated_at: "" }, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); }
    };
    return chain;
  });
  return { from, rpc, auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } }, writes, inviteUserByEmail };
}

function updateInput(overrides: Record<string, unknown> = {}) {
  return { id: "target-1", fullName: "Updated", role: "viewer", status: "active", scopeId: "scope-1", programId: UEHM, seasonId: UEHM_S12, scopeRole: "read", scopeStatus: "active", ...overrides };
}

describe("updateManagedAdminUser explicit authoritative scope", () => {
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    vi.clearAllMocks();
    client = makeClient();
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
  });

  it.each([
    ["missing program", { programId: "" }, "missing_program"],
    ["missing season", { seasonId: "" }, "missing_season"],
    ["invalid program", { programId: "00000000-0000-4000-8000-000000000999" }, "invalid_program"],
    ["invalid season", { seasonId: "00000000-0000-4000-8000-000000000999" }, "invalid_season"],
    ["HAM plus UEHM-S12", { programId: HAM, seasonId: UEHM_S12 }, "unrelated_program_season"]
  ])("rejects %s before mutation", async (_label, overrides, failureClass) => {
    const result = await updateManagedAdminUser(updateInput(overrides));
    expect(result).toMatchObject({ ok: false, status: "rejected", failureClass, reconciliationRequired: false });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.writes.update).not.toHaveBeenCalled();
    expect(client.writes.insert).not.toHaveBeenCalled();
    expect(client.writes.delete).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalledWith("admin_scope_access");
    expect(client.from).not.toHaveBeenCalledWith("admin_audit_log");
  });

  it("accepts UEHM plus UEHM-S12 and passes the exact validated IDs to the atomic RPC", async () => {
    const result = await updateManagedAdminUser(updateInput());
    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("vam062_admin_mutation_atomic", expect.objectContaining({
      p_operation: "update",
      p_payload: expect.objectContaining({ program_id: UEHM, season_id: UEHM_S12 })
    }));
    const payloads = client.rpc.mock.calls.map((call) => JSON.stringify(call[1]));
    expect(payloads.join(" ")).not.toContain('"program_id":"VAM"');
    expect(payloads.join(" ")).not.toContain('"season_id":"UEHM-S11"');
  });
});

describe("createManagedAdminUser authoritative scope remains enforced", () => {
  it("rejects an unrelated program/season before journal or provider activity", async () => {
    const client = makeClient();
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const result = await createManagedAdminUser({ email: "new@example.invalid", fullName: "New User", role: "viewer", status: "invited", programId: HAM, seasonId: UEHM_S12, scopeRole: "read", scopeStatus: "active" });
    expect(result).toMatchObject({ ok: false, status: "rejected", failureClass: "unrelated_program_season" });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.inviteUserByEmail).not.toHaveBeenCalled();
    expect(client.writes.update).not.toHaveBeenCalled();
    expect(client.writes.insert).not.toHaveBeenCalled();
  });
});
