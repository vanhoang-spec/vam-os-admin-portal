import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ envName: "server-key", loaded: true, usesPublicPrefix: false, sameAsAnonKey: false }))
}));
vi.mock("@/lib/account-auth-ownership", () => ({ findExactAuthUsers: vi.fn(), resolveAuthOwnership: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { findExactAuthUsers } from "@/lib/account-auth-ownership";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { syncManagedAdminAuthUser } from "@/lib/admin-users";

const UEHM = "00000000-0000-4000-8000-000000000101";
const HAM = "00000000-0000-4000-8000-000000000102";
const UEHM_S12 = "00000000-0000-4000-8000-000000000201";
const AUTH_ID = "00000000-0000-4000-8000-000000000301";

type ScopeFixture = { id: string; user_id: string; program_id: string | null; season_id: string | null; role: string; status: string; created_at: string; updated_at: string | null };

function scope(overrides: Partial<ScopeFixture> = {}): ScopeFixture {
  return { id: "scope-1", user_id: AUTH_ID, program_id: UEHM, season_id: UEHM_S12, role: "operations", status: "active", created_at: "", updated_at: null, ...overrides };
}

function makeClient(scopes: ScopeFixture[]) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: null, error: null }));
  const writes = { update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
  const inviteUserByEmail = vi.fn();
  const deleteUser = vi.fn();
  const from = vi.fn((table: string) => {
    let selection = "";
    const filters = new Map<string, unknown>();
    const resolved = () => table === "admin_scope_access" ? { data: scopes, error: null } : { data: [], error: null };
    const chain: any = {
      select(columns: string) { selection = columns; return chain; },
      eq(column: string, value: unknown) { filters.set(column, value); return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      update(payload: unknown) { writes.update(table, payload); return chain; },
      insert(payload: unknown) { writes.insert(table, payload); return chain; },
      delete() { writes.delete(table); return chain; },
      async maybeSingle() {
        if (table === "admin_users" && selection.includes("auth_user_id")) return { data: { id: "target-1", auth_user_id: null, email: "private@example.invalid", full_name: "Target", role: "admin", status: "active", created_at: "", updated_at: "" }, error: null };
        if (table === "programs") {
          const id = String(filters.get("id") ?? "");
          return { data: id === UEHM || id === HAM ? { id, is_active: true } : null, error: null };
        }
        if (table === "seasons") {
          const id = String(filters.get("id") ?? "");
          return { data: id === UEHM_S12 ? { id, program_id: UEHM } : null, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolved()).then(resolve); }
    };
    return chain;
  });
  return { from, rpc, auth: { admin: { inviteUserByEmail, deleteUser } }, writes, inviteUserByEmail, deleteUser };
}

describe("syncManagedAdminAuthUser explicit existing scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "actor-1", email: "owner@example.invalid", role: "super_admin", status: "active" });
    (findExactAuthUsers as Mock).mockResolvedValue({ ok: true, users: [{ id: AUTH_ID }] });
  });

  async function run(scopes: ScopeFixture[]) {
    const client = makeClient(scopes);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    return { client, result: await syncManagedAdminAuthUser("target-1") };
  }

  it("rejects no scope without provider or application mutation", async () => {
    const { client, result } = await run([]);
    expect(result).toMatchObject({ ok: false, status: "rejected", failureClass: "sync_scope_missing" });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.inviteUserByEmail).not.toHaveBeenCalled();
    expect(client.deleteUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid scope without RPC", async () => {
    const { client, result } = await run([scope({ program_id: "00000000-0000-4000-8000-000000000999" })]);
    expect(result).toMatchObject({ ok: false, status: "rejected", failureClass: "invalid_program" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects unrelated program and season without RPC", async () => {
    const { client, result } = await run([scope({ program_id: HAM, season_id: UEHM_S12 })]);
    expect(result).toMatchObject({ ok: false, status: "rejected", failureClass: "unrelated_program_season" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects multiple scopes instead of selecting implicitly", async () => {
    const { client, result } = await run([scope(), scope({ id: "scope-2", role: "read" })]);
    expect(result).toMatchObject({ ok: false, status: "rejected", failureClass: "sync_scope_ambiguous" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("preserves one valid UEHM-S12 scope including level and status", async () => {
    const { client, result } = await run([scope({ role: "operations", status: "active" })]);
    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("vam062_admin_mutation_atomic", expect.objectContaining({
      p_operation: "link_auth",
      p_payload: { auth_user_id: AUTH_ID, program_id: UEHM, season_id: UEHM_S12, scope_role: "operations", scope_status: "active" }
    }));
    const serialized = JSON.stringify(client.rpc.mock.calls);
    expect(serialized).not.toContain('"program_id":"VAM"');
    expect(serialized).not.toContain('"season_id":"UEHM-S11"');
  });

  it("rejects an inactive scope rather than silently changing its status", async () => {
    const { client, result } = await run([scope({ status: "inactive" })]);
    expect(result).toMatchObject({ ok: false, failureClass: "sync_scope_inactive" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("keeps rejected sync free of admin, scope, Auth-link, and audit writes", async () => {
    const { client } = await run([]);
    expect(client.writes.update).not.toHaveBeenCalled();
    expect(client.writes.insert).not.toHaveBeenCalled();
    expect(client.writes.delete).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalledWith("admin_audit_log");
  });

  it("enforces server-derived super-admin authorization before reads or mutations", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue(null);
    const client = makeClient([scope()]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const result = await syncManagedAdminAuthUser("target-1");
    expect(result.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns and logs no raw identity or credential data on rejection", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = await run([]);
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain("private@example.invalid");
    expect(rendered).not.toContain(AUTH_ID);
    expect(rendered).not.toMatch(/token|password|credential|provider payload|cookie/i);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
