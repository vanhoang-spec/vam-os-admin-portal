import { describe, it, expect, vi, beforeEach } from "vitest";
// @ts-ignore
import { runFixtures, email } from "../scripts/create-uat-fixtures.mjs";
import { execSync } from "child_process";
import { resolve } from "path";

const scriptPath = resolve(__dirname, "../scripts/create-uat-fixtures.mjs");
const FIXTURE_TAG = "20260805";

function createMockDb() {
  const db = {
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth_new" } }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ error: null })
      }
    },
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
      };

      if (table === "seasons") {
        builder.maybeSingle.mockResolvedValue({ data: { id: "season_id", program_id: "program_id" }, error: null });
      } else if (table === "programs") {
        builder.maybeSingle.mockResolvedValue({ data: { id: "program_id", code: "VAM", is_active: true }, error: null });
      } else if (table === "intake_batches") {
        builder.maybeSingle.mockResolvedValue({ data: { id: "batch_id", season_id: "season_id" }, error: null });
      } else if (["admin_users", "admin_scope_access", "people", "person_season_memberships"].includes(table)) {
        builder.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: `new_${table}` }, error: null })
        });
      } else if (table === "admin_audit_log" || table === "person_season_membership_log") {
        builder.maybeSingle = vi.fn().mockResolvedValue({ count: 0, error: null });
      }
      return builder;
    })
  };
  return db;
}

const mockLogger = { log: vi.fn(), error: vi.fn() };

describe("create-uat-fixtures Provisioning Tests", () => {
  let db: any;
  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("1. Existing Auth email nhưng metadata khác -> abort", async () => {
    db.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: "auth_old", email: email("admin"), user_metadata: { vam_uat_fixture: "wrong_tag" } }] },
      error: null
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(/exists but lacks correct UAT fixture metadata/);
    expect(db.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("2. Existing admin row role hoặc status khác -> abort", async () => {
    db.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: "auth_id", email: email("admin"), user_metadata: { vam_uat_fixture: FIXTURE_TAG } }] },
      error: null
    });
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "admin_users") b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "admin_id", role: "wrong_role", status: "active", auth_user_id: "auth_id", notes: `VAM UAT fixture ${FIXTURE_TAG}` }, error: null });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(/does not exact-match expected/);
  });

  it("3. Existing admin row đúng role/status nhưng thiếu marker -> abort", async () => {
    db.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: "auth_id", email: email("admin"), user_metadata: { vam_uat_fixture: FIXTURE_TAG } }] },
      error: null
    });
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "admin_users") b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "admin_id", role: "admin", status: "active", auth_user_id: "auth_id", notes: "no marker" }, error: null });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(/lacks correct UAT fixture marker in notes/);
  });

  it("4. Existing scope UUID/scope role khác -> abort", async () => {
    db.auth.admin.listUsers.mockResolvedValue({ data: { users: [{ id: "auth_id", email: email("admin"), user_metadata: { vam_uat_fixture: FIXTURE_TAG } }] }, error: null });
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "admin_users") b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "admin_id", role: "admin", status: "active", auth_user_id: "auth_id", notes: `VAM UAT fixture ${FIXTURE_TAG}` }, error: null });
      if (t === "admin_scope_access") b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "scope_id", role: "wrong_scope", status: "active" }, error: null });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(/does not exact-match/);
  });

  it("6. Existing person thiếu marker -> abort", async () => {
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "people") b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "person_id", full_name: `VAM-UAT-${FIXTURE_TAG} Person`, data_quality_flags: "missing" }, error: null });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(/lacks correct UAT fixture marker/);
  });

  it("7. Failure sau Auth creation -> rollback Auth mới", async () => {
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "admin_users") b.insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("Insert fail") }) });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow();
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith("auth_new");
  });

  it("8. Failure sau admin creation -> rollback admin, auth đúng thứ tự", async () => {
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "admin_scope_access") b.insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("Insert fail") }) });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow();
    const deleteCalls = db.from.mock.results.filter((r: any) => r.value.delete.mock.calls.length > 0);
    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith("auth_new");
  });

  it("9. Failure sau scope creation -> rollback scope, admin, Auth đúng thứ tự", async () => {
    let callOrder: string[] = [];
    db.auth.admin.deleteUser.mockImplementation(() => { callOrder.push("auth"); return { error: null }; });
    
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "people") {
        b.insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("Insert fail") }) });
      }
      b.delete = vi.fn().mockReturnValue({ eq: vi.fn().mockImplementation(() => { callOrder.push(t); return { error: null }; }) });
      return b;
    });

    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow();
    // In an 8 account loop, there will be multiple scopes and admins.
    // The first rollback should be scope, the last should be auth.
    expect(callOrder[0]).toBe("admin_scope_access");
    expect(callOrder[callOrder.length - 1]).toBe("auth");
  });

  it("12. Pre-existing objects không bị rollback", async () => {
    db.auth.admin.listUsers.mockResolvedValue({ data: { users: [{ id: "pre_auth", email: email("admin"), user_metadata: { vam_uat_fixture: FIXTURE_TAG } }] }, error: null });
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "admin_users") b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "pre_admin", role: "admin", status: "active", auth_user_id: "pre_auth", notes: `VAM UAT fixture ${FIXTURE_TAG}` }, error: null });
      if (t === "admin_scope_access") b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("Scope fail") });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow();
    expect(db.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("13/14. Rollback fail vẫn tiếp tục, exit non-zero", async () => {
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "people") b.insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("Insert fail") }) });
      if (t === "admin_users") b.delete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: new Error("Delete fail") }) });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow();
    expect(db.auth.admin.deleteUser).toHaveBeenCalled();
    const errorLogs = mockLogger.error.mock.calls.map(c => c[0]);
    expect(errorLogs.some(l => l.includes("[ROLLBACK] Completed with"))).toBeTruthy();
  });

  it("15. Dry-run không gọi mutate", async () => {
    await expect(runFixtures(db, false, "pass", mockLogger)).resolves.not.toThrow();
    expect(db.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("18. Malformed API response fail closed", async () => {
    db.auth.admin.createUser.mockResolvedValue({ data: null, error: null });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(TypeError);
  });

  it("19. Malformed insert response fail closed", async () => {
    db.from.mockImplementation((t: string) => {
      const b = createMockDb().from(t);
      if (t === "admin_users") b.insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) });
      return b;
    });
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(TypeError);
  });
});

describe("CLI & Cleanup tests", () => {
  it("16. Wrong project abort", () => {
    try {
      execSync(`node "${scriptPath}"`, { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://wrong.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret", VAM_UAT_FIXTURE_PASSWORD: "longpassword123" }, stdio: "pipe" });
      expect.fail();
    } catch (e: any) { expect(e.message).toContain("Command failed"); }
  });

  it("17. Typo flag abort", () => {
    try {
      const out = execSync(`node "${scriptPath}" --aply`, { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://ljfneyuvpxrmejpxsmpz.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret", VAM_UAT_FIXTURE_PASSWORD: "longpassword123" }, stdio: "pipe" });
      expect(out.toString()).toContain("DRY RUN");
    } catch (error: any) {
      const allOutput = (error.stdout?.toString() || "") + (error.stderr?.toString() || "") + error.message;
      expect(allOutput).toContain("DRY RUN");
    }
  });
});
